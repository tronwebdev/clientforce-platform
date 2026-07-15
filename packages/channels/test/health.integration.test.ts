/**
 * P5 W1 (DEC-083): the health engine against real Postgres+RLS — ledger
 * aggregation over the denormalized senderId columns, snapshot persistence,
 * collapse/recovery transitions emitting exactly once (guarded persist), and
 * the window-drain path (unhealthy → low_data clears the gate). Also the
 * warmup completion stamp + its freshness-gated emission. Skips without infra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  type PrismaClient,
} from "@clientforce/db";
import {
  recomputeSenderHealth,
  type HealthRecomputeDeps,
} from "../src/health";
import {
  applyWarmupHealthInterlock,
  ensureWarmupCompletion,
  warmupCapFor,
  WARMUP_DAYS,
} from "../src/warmup";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `hlth-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const DAY_MS = 86_400_000;

describe.skipIf(!hasInfra)("sender health engine integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let campaignId: string;
  let contactId: string;
  let published: Array<{ type: string; senderId?: string | null; payload: Record<string, unknown> }> = [];
  const publish: HealthRecomputeDeps["publish"] = async (input) => {
    published.push(input as (typeof published)[number]);
  };
  const deps = (): HealthRecomputeDeps => ({ prisma: app, publish });

  const makeSender = async (over: Record<string, unknown> = {}): Promise<string> =>
    (
      await owner.senderConnection.create({
        data: {
          workspaceId: ws,
          type: "CF_MANAGED",
          fromEmail: `s-${Math.random().toString(36).slice(2)}@send.clientforce.io`,
          fromName: "Health Probe",
          dailyLimit: 500,
          ...over,
        },
      })
    ).id;

  /** Seed n OUTBOUND messages + per-type events for a sender inside the window. */
  const seedLedger = async (
    senderId: string,
    counts: { sent: number; delivered?: number; bounced?: number; spam?: number; replied?: number },
    at: Date = new Date(),
  ): Promise<void> => {
    await owner.message.createMany({
      data: Array.from({ length: counts.sent }, () => ({
        workspaceId: ws,
        campaignId,
        contactId,
        channel: "email",
        direction: "OUTBOUND" as const,
        body: "probe",
        senderId,
        sentAt: at,
        meta: { senderId },
      })),
    });
    const events: Array<[string, number]> = [
      ["email.delivered.v1", counts.delivered ?? 0],
      ["email.bounced.v1", counts.bounced ?? 0],
      ["email.spam.v1", counts.spam ?? 0],
      ["email.replied.v1", counts.replied ?? 0],
    ];
    await owner.event.createMany({
      data: events.flatMap(([type, n]) =>
        Array.from({ length: n }, (_, i) => ({
          workspaceId: ws,
          type,
          senderId,
          payload: { messageId: `probe-${type}-${i}` },
          occurredAt: at,
        })),
      ),
    });
  };

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: suffix, slug: suffix, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "HLTH", slug: suffix, settings: {} },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({
        data: {
          workspaceId: ws,
          agentId: (
            await owner.agent.create({
              data: { workspaceId: ws, name: "Probe", goal: "book_appointments", guardrails: {} },
            })
          ).id,
          name: "primary",
          graphId: "g1",
        },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "seed",
          optOut: {},
          tags: [],
          email: `probe-${suffix}@t.test`,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("healthy sender: snapshot persisted, no transition, no emission", async () => {
    published = [];
    const senderId = await makeSender();
    await seedLedger(senderId, { sent: 60, delivered: 58, replied: 2 });
    const result = await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    expect(result?.snapshot.state).toBe("healthy");
    expect(result?.snapshot.floor).toBe("ok");
    expect(result?.transition).toBeNull();
    expect(published).toHaveLength(0);
    const row = await owner.senderConnection.findUnique({ where: { id: senderId } });
    expect((row?.healthState as { state?: string })?.state).toBe("healthy");
  });

  it("low-volume sender: low_data floor state, no score, never gated", async () => {
    const senderId = await makeSender();
    await seedLedger(senderId, { sent: 5, bounced: 5 }); // terrible rates, tiny sample
    const result = await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    expect(result?.snapshot).toMatchObject({ score: null, state: "low_data", floor: "none" });
  });

  it("collapse emits sender.health_collapsed.v1 exactly once; recompute is idempotent", async () => {
    published = [];
    const senderId = await makeSender();
    await seedLedger(senderId, { sent: 100, delivered: 85, bounced: 8, spam: 1 });
    const first = await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    expect(first?.snapshot.state).toBe("unhealthy");
    expect(first?.transition).toBe("collapsed");
    const again = await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    expect(again?.transition).toBeNull();
    const collapses = published.filter((e) => e.type === "sender.health_collapsed.v1");
    expect(collapses).toHaveLength(1);
    expect(collapses[0]?.payload).toMatchObject({ senderId, windowDays: 7 });
    expect(collapses[0]?.senderId).toBe(senderId);
  });

  it("recovery restores: clean recent ledger flips unhealthy → healthy with one recovered event", async () => {
    published = [];
    const senderId = await makeSender();
    await seedLedger(senderId, { sent: 100, delivered: 85, bounced: 8, spam: 1 });
    await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    // The bad window ages out; a clean sample takes its place.
    await owner.event.deleteMany({ where: { workspaceId: ws, senderId } });
    await owner.message.deleteMany({ where: { workspaceId: ws, senderId } });
    await seedLedger(senderId, { sent: 80, delivered: 78, replied: 2 });
    const result = await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    expect(result?.snapshot.state).toBe("healthy");
    expect(result?.transition).toBe("recovered");
    const recoveries = published.filter((e) => e.type === "sender.health_recovered.v1");
    expect(recoveries).toHaveLength(1);
  });

  it("window drain: an unhealthy sender whose sample empties goes low_data (gate open, lowData recovery)", async () => {
    published = [];
    const senderId = await makeSender();
    await seedLedger(senderId, { sent: 100, delivered: 85, bounced: 8, spam: 1 });
    await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    await owner.event.deleteMany({ where: { workspaceId: ws, senderId } });
    await owner.message.deleteMany({ where: { workspaceId: ws, senderId } });
    const drained = await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    expect(drained?.snapshot.state).toBe("low_data");
    expect(drained?.transition).toBe("recovered");
    const recovery = published.find((e) => e.type === "sender.health_recovered.v1");
    expect(recovery?.payload).toMatchObject({ lowData: true });
  });

  it("health interlock (owner pin): a bounce spike mid-warmup HOLDS the ramp; clearing resumes it", async () => {
    const T = new Date();
    // Day 5 of the ramp (cap 100 on curve v2), generous limit so the curve binds.
    const senderId = await makeSender({
      dailyLimit: 10_000,
      warmupState: { startedAt: new Date(T.getTime() - 4 * DAY_MS).toISOString(), curve: "v2" },
    });
    // A spike: 8% bounce — at/over the 5% danger bound.
    await seedLedger(senderId, { sent: 100, delivered: 90, bounced: 8 });
    await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    const opened = await applyWarmupHealthInterlock(
      { prisma: app, now: () => T },
      { workspaceId: ws, senderId },
    );
    expect(opened).toEqual({ holding: true, changed: true });

    // Three days pass while the hold is open: the ramp day FREEZES at 5
    // (without the hold it would be day 8 → cap 250).
    const T3 = new Date(T.getTime() + 3 * DAY_MS);
    const heldSender = await owner.senderConnection.findUniqueOrThrow({ where: { id: senderId } });
    expect(warmupCapFor(heldSender, T3)).toMatchObject({ day: 5, cap: 100, holding: true });

    // The spike clears (window replaced by a clean sample) → the hold closes,
    // banking 3 days of held time; the ramp resumes from where it stood.
    await owner.event.deleteMany({ where: { workspaceId: ws, senderId } });
    await owner.message.deleteMany({ where: { workspaceId: ws, senderId } });
    await seedLedger(senderId, { sent: 60, delivered: 58, replied: 2 });
    await recomputeSenderHealth(deps(), { workspaceId: ws, senderId });
    const closed = await applyWarmupHealthInterlock(
      { prisma: app, now: () => T3 },
      { workspaceId: ws, senderId },
    );
    expect(closed).toEqual({ holding: false, changed: true });
    const resumed = await owner.senderConnection.findUniqueOrThrow({ where: { id: senderId } });
    expect(warmupCapFor(resumed, T3)).toMatchObject({ day: 5, cap: 100, holding: false });
    // Three MORE days with the hold closed → the ramp advances again (day 8).
    expect(warmupCapFor(resumed, new Date(T3.getTime() + 3 * DAY_MS))).toMatchObject({
      day: 8,
      cap: 250,
      holding: false,
    });
    // Idempotent: nothing to change when there's no spike and no open hold.
    const noop = await applyWarmupHealthInterlock(
      { prisma: app, now: () => T3 },
      { workspaceId: ws, senderId },
    );
    expect(noop).toEqual({ holding: false, changed: false });
  });

  it("warmup completion: aged-past-curve ramp stamps completedAt once; stale completion stays silent", async () => {
    published = [];
    // Completed long ago (started 100 days back) → stamp, NO event.
    const staleId = await makeSender({
      warmupState: { startedAt: new Date(Date.now() - 100 * DAY_MS).toISOString(), curve: "v1" },
    });
    const stale = await ensureWarmupCompletion(deps(), { workspaceId: ws, senderId: staleId });
    expect(stale).toEqual({ completed: true, emitted: false });
    // Freshly completed (started exactly WARMUP_DAYS+~0.5 days back) → stamp + ONE event.
    const freshId = await makeSender({
      warmupState: {
        startedAt: new Date(Date.now() - (WARMUP_DAYS * DAY_MS + DAY_MS / 2)).toISOString(),
        curve: "v1",
      },
    });
    const fresh = await ensureWarmupCompletion(deps(), { workspaceId: ws, senderId: freshId });
    expect(fresh).toEqual({ completed: true, emitted: true });
    // Idempotent: second pass is a no-op.
    const again = await ensureWarmupCompletion(deps(), { workspaceId: ws, senderId: freshId });
    expect(again).toEqual({ completed: false, emitted: false });
    const completions = published.filter((e) => e.type === "sender.warmup_completed.v1");
    expect(completions).toHaveLength(1);
    expect(completions[0]?.payload).toMatchObject({ senderId: freshId, days: WARMUP_DAYS, target: 500 });
  });
});
