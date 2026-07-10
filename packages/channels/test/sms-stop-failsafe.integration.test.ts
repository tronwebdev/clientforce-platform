/**
 * DEC-064: the threadless-STOP fail-safe. A STOP from a phone that matches a
 * contact must suppress even with NO prior outbound sms Message row (consent
 * fails toward suppression) — every workspace holding the contact is a
 * target, and a malformed short `From` matches nothing. Skips without infra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  withTenant,
  type PrismaClient,
} from "@clientforce/db";
import { applySmsStop, ingestInboundSms, resolveSmsStopFallback } from "../src/sms-inbound";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PHONE = "+2348005551234";

describe.skipIf(!hasInfra)("threadless STOP fail-safe (DEC-064)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let contactA: string;
  let contactB: string;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `stop-${suffix}`, slug: `stop-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    const a = await owner.workspace.create({
      data: { agencyId, name: "stop-a", slug: `stop-a-${suffix}`, settings: {} },
    });
    const b = await owner.workspace.create({
      data: { agencyId, name: "stop-b", slug: `stop-b-${suffix}`, settings: {} },
    });
    wsA = a.id;
    wsB = b.id;
    const mk = (workspaceId: string) =>
      owner.contact.create({
        data: {
          workspaceId,
          source: "test",
          optOut: {},
          tags: [],
          email: `stop-${workspaceId}-${suffix}@t.test`,
          phone: PHONE,
          firstName: "Sam",
        },
      });
    contactA = (await mk(wsA)).id;
    contactB = (await mk(wsB)).id;
  });

  afterAll(async () => {
    await owner.suppression.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
    await owner.contact.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
    await owner.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });
    await owner.agency.delete({ where: { id: agencyId } });
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("ingest returns null with no prior outbound thread", async () => {
    const result = await ingestInboundSms(
      { owner, app },
      { from: PHONE, to: "+15005550006", body: "STOP" },
    );
    expect(result).toBeNull();
  });

  it("fallback targets every workspace holding the phone's contact", async () => {
    const targets = await resolveSmsStopFallback(owner, PHONE);
    const mine = targets.filter((t) => [wsA, wsB].includes(t.workspaceId));
    expect(mine.map((t) => t.workspaceId).sort()).toEqual([wsA, wsB].sort());
    expect(mine.map((t) => t.contactId).sort()).toEqual([contactA, contactB].sort());
  });

  it("a malformed short From matches nothing", async () => {
    expect(await resolveSmsStopFallback(owner, "+1")).toEqual([]);
    expect(await resolveSmsStopFallback(owner, "")).toEqual([]);
  });

  it("applySmsStop on the fallback targets lands suppression + optOut in each workspace", async () => {
    for (const t of await resolveSmsStopFallback(owner, PHONE)) {
      if (![wsA, wsB].includes(t.workspaceId)) continue;
      await applySmsStop(app, t.workspaceId, t.contactId, PHONE, null);
    }
    for (const [ws, contactId] of [
      [wsA, contactA],
      [wsB, contactB],
    ] as const) {
      const suppression = await withTenant(app, { workspaceId: ws }, (tx) =>
        tx.suppression.findFirst({ where: { workspaceId: ws, channel: "sms", address: PHONE } }),
      );
      expect(suppression?.reason).toBe("UNSUBSCRIBED");
      const contact = await owner.contact.findUnique({ where: { id: contactId } });
      expect((contact?.optOut as Record<string, unknown>).sms).toBe(true);
    }
  });
});
