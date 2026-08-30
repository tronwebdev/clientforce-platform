/**
 * B8 (DEC-135) stats e2e in a fresh workspace: a small deterministic ledger
 * (outbound + inbound messages, an open event, stage-change events, a call,
 * a payment) and the /stats read over it —
 *  - tiles/funnel come from the REAL rows (distinct-contact semantics);
 *  - a booking attributes to the channel of the LAST outbound before its
 *    stage event (the F1 last-sent rule);
 *  - below the min-send floor the RATES are null while counts stay real;
 *  - "collected" sums real payment.received amounts; the estimate rides
 *    the owner-typed valueEstCents × won;
 *  - range=7 excludes older rows; campaign scope excludes the other
 *    campaign's rows.
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Stats e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let agentA: string;

  const api = () => request(app.getHttpServer());
  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `st-${suffix}`, slug: `st-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({ data: { agencyId, name: "ST", slug: `st-ws-${suffix}`, settings: {} } })
    ).id;
    const u1 = await owner.user.create({
      data: { email: `st-owner-${suffix}@t.test`, authProviderId: `auth|st-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|st-${suffix}`, email: u1.email });

    // Campaign A: the full story — reach, open, reply, booked→won, payment.
    const a = await owner.agent.create({
      data: { workspaceId: ws, name: "A", goal: "book_appointments", guardrails: {}, valueEstCents: 10_000 },
    });
    agentA = a.id;
    const campA = await owner.campaign.create({
      data: { workspaceId: ws, agentId: a.id, name: "A — primary", graphId: "" },
    });
    // Campaign B: one old outbound (outside the 7-day window; inside 30).
    const b = await owner.agent.create({
      data: { workspaceId: ws, name: "B", goal: "book_appointments", guardrails: {} },
    });
    const campB = await owner.campaign.create({
      data: { workspaceId: ws, agentId: b.id, name: "B — primary", graphId: "" },
    });

    const mkContact = (n: number) =>
      owner.contact.create({
        data: { workspaceId: ws, source: "t", optOut: {}, tags: [], email: `st-c${n}-${suffix}@t.test` },
      });
    const c1 = await mkContact(1); // books via SMS
    const c2 = await mkContact(2); // replies only
    const c3 = await mkContact(3); // reached only, older
    const enr = await owner.enrollment.create({
      data: { workspaceId: ws, campaignId: campA.id, contactId: c1.id, workflowId: `st-${suffix}-1`, pipelineStage: "won", status: "DONE" },
    });

    const msg = (data: Record<string, unknown>) => owner.message.create({ data: data as never });
    // c1: email then SMS outbound; the booking's LAST outbound is the SMS.
    await msg({ workspaceId: ws, campaignId: campA.id, enrollmentId: enr.id, contactId: c1.id, channel: "email", direction: "OUTBOUND", body: "t", sentAt: daysAgo(5) });
    await msg({ workspaceId: ws, campaignId: campA.id, enrollmentId: enr.id, contactId: c1.id, channel: "sms", direction: "OUTBOUND", body: "t", sentAt: daysAgo(4) });
    await msg({ workspaceId: ws, campaignId: campA.id, enrollmentId: enr.id, contactId: c1.id, channel: "sms", direction: "INBOUND", intent: "interested", body: "yes", sentAt: daysAgo(3) });
    // c2: email outbound + reply.
    await msg({ workspaceId: ws, campaignId: campA.id, contactId: c2.id, channel: "email", direction: "OUTBOUND", body: "t", sentAt: daysAgo(5) });
    await msg({ workspaceId: ws, campaignId: campA.id, contactId: c2.id, channel: "email", direction: "INBOUND", intent: "question", body: "how", sentAt: daysAgo(4) });
    // c3: an OLD outbound on campaign B (outside 7d).
    await msg({ workspaceId: ws, campaignId: campB.id, contactId: c3.id, channel: "email", direction: "OUTBOUND", body: "t", sentAt: daysAgo(20) });

    const ev = (data: Record<string, unknown>) => owner.event.create({ data: data as never });
    await ev({ workspaceId: ws, type: "email.opened.v1", campaignId: campA.id, contactId: c2.id, payload: {}, occurredAt: daysAgo(4) });
    await ev({ workspaceId: ws, type: "lead.stage_changed.v1", campaignId: campA.id, enrollmentId: enr.id, contactId: c1.id, payload: { fromStage: "engaged", toStage: "booked" }, occurredAt: daysAgo(3) });
    await ev({ workspaceId: ws, type: "lead.stage_changed.v1", campaignId: campA.id, enrollmentId: enr.id, contactId: c1.id, payload: { fromStage: "booked", toStage: "won" }, occurredAt: daysAgo(2) });
    await ev({ workspaceId: ws, type: "payment.received.v1", campaignId: campA.id, enrollmentId: enr.id, contactId: c1.id, payload: { amount: 12_300 }, occurredAt: daysAgo(1) });
    await owner.call.create({
      data: { workspaceId: ws, campaignId: campA.id, agentId: a.id, contactId: c1.id, caller: "ada", direction: "OUTBOUND", status: "COMPLETED", providerCallSid: `st-${suffix}`, createdAt: daysAgo(2) },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  it("workspace scope: tiles and funnel from real rows, distinct-contact semantics", async () => {
    const res = await api().get("/stats?range=30").set(asOwner()).expect(200);
    expect(res.body.tiles.reached).toBe(3);
    expect(res.body.tiles.replied).toBe(2);
    expect(res.body.tiles.booked).toBe(1);
    const byKey = Object.fromEntries(res.body.funnel.map((f: { key: string; count: number }) => [f.key, f.count]));
    expect(byKey.opened).toBe(1);
    expect(byKey.interested).toBe(1); // c1's "interested"; c2's "question" is not positive
    expect(byKey.won).toBe(1);
    // Below the 20-send floor: counts real, rates honestly null.
    expect(res.body.floors.totalSent).toBeLessThan(res.body.floors.low);
    expect(res.body.tiles.repliedPct).toBeNull();
  });

  it("a booking attributes to the LAST outbound's channel; money is real", async () => {
    const res = await api().get("/stats?range=30").set(asOwner()).expect(200);
    const sms = res.body.channels.find((c: { channel: string }) => c.channel === "sms");
    const email = res.body.channels.find((c: { channel: string }) => c.channel === "email");
    const voice = res.body.channels.find((c: { channel: string }) => c.channel === "voice");
    expect(sms.booked).toBe(1);
    expect(email.booked).toBe(0);
    expect(voice.sent).toBe(1);
    expect(res.body.tiles.collectedCents).toBe(12_300);
    expect(res.body.tiles.estValueCents).toBe(10_000); // 1 won × the owner's estimate
  });

  it("range and campaign scoping exclude the other rows", async () => {
    const seven = await api().get("/stats?range=7").set(asOwner()).expect(200);
    expect(seven.body.tiles.reached).toBe(2); // c3's 20-day-old touch drops out
    const scoped = await api().get(`/stats?range=30&agentId=${agentA}`).set(asOwner()).expect(200);
    expect(scoped.body.scope).toBe("campaign");
    expect(scoped.body.tiles.reached).toBe(2); // campaign B's contact excluded
  });
});
