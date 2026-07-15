/**
 * P5 W3 (DEC-085): suppression hygiene vs real Postgres — case-duplicate
 * merge (oldest wins), address normalization, opt-out sync, the aging-bounce
 * count (visibility only), idempotency, AND the boundary pin: after the
 * normalization hardening a MIXED-CASE contact cannot slip past its
 * suppression. Skips without infra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppPrismaClient, createPrismaClient, type PrismaClient, type SenderConnection } from "@clientforce/db";
import { runSuppressionHygiene } from "../src/suppression-hygiene";
import { sendStep, type SendDeps } from "../src/send";
import type { EmailSender, RenderedEmail } from "../src/types";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `hyg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const DAY = 86_400_000;

class CapturingSender implements EmailSender {
  async send(_email: RenderedEmail, _sender: SenderConnection) {
    return { providerMessageId: `<hyg-${Math.random()}@send.clientforce.io>` };
  }
}

describe.skipIf(!hasInfra)("suppression hygiene (P5 W3)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "HYG", slug: suffix, settings: {} } })).id;
  });
  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("merges case-duplicates (oldest wins), normalizes, repairs opt-out, counts aging bounces — idempotently", async () => {
    const old = new Date(Date.now() - 120 * DAY);
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: `victim-${suffix}@t.test`, reason: "BOUNCED", createdAt: old },
    });
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: `VICTIM-${suffix}@T.TEST`, reason: "MANUAL" },
    });
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: `MiXeD-${suffix}@t.test`, reason: "UNSUBSCRIBED" },
    });
    const contact = await owner.contact.create({
      data: { workspaceId: ws, source: "seed", optOut: {}, tags: [], email: `mixed-${suffix}@t.test` },
    });

    const first = await runSuppressionHygiene({ ownerPrisma: owner, prisma: app });
    expect(first.caseDuplicatesMerged).toBeGreaterThanOrEqual(1);
    expect(first.addressesNormalized).toBeGreaterThanOrEqual(1);
    expect(first.optOutsRepaired).toBeGreaterThanOrEqual(1);
    expect(first.agingBounces).toBeGreaterThanOrEqual(1);

    // Oldest row survived, lowercased; the duplicate is gone.
    const rows = await owner.suppression.findMany({
      where: { workspaceId: ws, address: { contains: `victim-${suffix}`, mode: "insensitive" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.address).toBe(`victim-${suffix}@t.test`);
    expect(rows[0]?.reason).toBe("BOUNCED");
    // The mixed-case contact gained its optOut flag.
    const repaired = await owner.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect((repaired.optOut as { email?: boolean }).email).toBe(true);

    // Idempotent: the second pass changes nothing.
    const second = await runSuppressionHygiene({ ownerPrisma: owner, prisma: app });
    expect(second.caseDuplicatesMerged).toBe(0);
    expect(second.addressesNormalized).toBe(0);
    expect(second.optOutsRepaired).toBe(0);
  });

  it("boundary pin: a MIXED-CASE contact refuses against its lowercase suppression row", async () => {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws, name: "Probe", goal: "book_appointments",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
          dailyCap: { email: 100 }, consent: null, unsubscribeFooter: true, suppressionCheck: true,
        },
      },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId: agent.id, name: "hyg", graphId: "g1" },
    });
    const sender = await owner.senderConnection.create({
      data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: `s-${suffix}@send.clientforce.io`, fromName: "Hyg", dailyLimit: 100 },
    });
    const contact = await owner.contact.create({
      data: { workspaceId: ws, source: "seed", optOut: {}, tags: [], email: `CasePin-${suffix}@T.Test`, firstName: "Case" },
    });
    await owner.businessContext.create({
      data: { workspaceId: ws, agentId: null, status: "READY", fields: { company_address: { value: "1 St, TX", citations: [], source: "typed" } } },
    });
    // Suppression stored LOWERCASE (as every writer now normalizes).
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: `casepin-${suffix}@t.test`, reason: "UNSUBSCRIBED" },
    });
    const deps: SendDeps = { prisma: app, transport: new CapturingSender(), now: () => new Date("2026-07-07T10:00:00Z"), allowlist: [] };
    await expect(
      sendStep(deps, {
        workspaceId: ws, campaignId: campaign.id, agentId: agent.id, contactId: contact.id,
        senderId: sender.id, stepNodeId: "s1", content: { subject: "Hi", body: "Hi {{firstName}} — {{senderName}}" },
      }),
    ).rejects.toMatchObject({ reason: "SUPPRESSED" });
  });
});
