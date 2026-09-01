/**
 * D1 (DEC-171/173/174): the CONSEQUENCE layer, against real Postgres.
 *
 * The thing this unit exists to change is that bounce rate and complaint rate
 * were numbers on a page. These prove they are now outcomes:
 *   · a hard bounce suppresses permanently, through the ONE suppression path;
 *   · a soft bounce does NOT — it takes strikes, and the Nth reaches the same
 *     path (and the window resets rather than accumulating forever);
 *   · a complaint suppresses instantly with the COMPLAINT reason, including
 *     the "Spam Reported" drop that used to be filed as a bounce; and
 *   · the owner's 2% rule refuses at the send boundary, typed and reversible,
 *     while staying silent below the sample floor.
 *
 * Tests own their own data: one agency per run, torn down in afterAll, and
 * every selector scoped to this run's suffix.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  type PrismaClient,
  type SenderConnection,
} from "@clientforce/db";
import { DELIVERABILITY_DEFAULTS } from "@clientforce/core";
import { applyEmailEvent, normalizeSendGridEvents, toBusEvents } from "../src/webhooks";
import { sendStep, type SendDeps } from "../src/send";
import type { EmailSender, RenderedEmail } from "../src/types";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `d1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ADDRESS = "1 Main Street, Austin TX 78701";
const IN_WINDOW = () => new Date("2026-07-07T10:00:00Z");

/** A sample big enough to clear the F1 floor (>=20 sends), at a chosen rate. */
const snapshotAt = (bounceRate: number, sent = 200) => ({
  v: 1,
  score: 95,
  state: "healthy",
  band: "healthy",
  floor: "ok",
  windowDays: 7,
  computedAt: "2026-07-07T09:00:00.000Z",
  sample: { sent, delivered: sent, bounced: Math.round(sent * bounceRate), spam: 0, replied: 0 },
  rates: { bounce: bounceRate, spam: 0, delivery: 1, reply: 0 },
});

class CapturingSender implements EmailSender {
  sent: RenderedEmail[] = [];
  private n = 0;
  async send(email: RenderedEmail, _sender: SenderConnection) {
    this.sent.push(email);
    return { providerMessageId: `<d1-${++this.n}-${suffix}@send.clientforce.io>` };
  }
}

const sgEvent = (email: string, over: Record<string, unknown>) => ({
  email,
  timestamp: 1_780_000_000,
  sg_message_id: `m-${suffix}.filter0001`,
  ...over,
});

describe.skipIf(!hasInfra)("D1 · deliverability consequence layer", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  const transport = new CapturingSender();

  const deps = (over: Partial<SendDeps> = {}): SendDeps => ({
    prisma: app,
    transport,
    now: IN_WINDOW,
    allowlist: [],
    ...over,
  });

  const makeSender = async (over: Record<string, unknown> = {}): Promise<string> =>
    (
      await owner.senderConnection.create({
        data: {
          workspaceId: ws,
          type: "CF_MANAGED",
          fromEmail: `d1-${Math.random().toString(36).slice(2)}@send.clientforce.io`,
          fromName: "D1 Probe",
          dailyLimit: 500,
          ...over,
        },
      })
    ).id;

  const makeContact = async (label: string): Promise<{ id: string; email: string }> => {
    const email = `${label}-${suffix}@t.test`;
    const c = await owner.contact.create({
      data: { workspaceId: ws, source: "seed", optOut: {}, tags: [], email, firstName: "Ada" },
    });
    return { id: c.id, email };
  };

  const suppressionFor = (address: string) =>
    owner.suppression.findFirst({
      where: { workspaceId: ws, channel: "email", address: address.toLowerCase() },
    });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    agencyId = (await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } }))
      .id;
    ws = (
      await owner.workspace.create({ data: { agencyId, name: "D1", slug: suffix, settings: {} } })
    ).id;
    agentId = (
      await owner.agent.create({
        data: {
          workspaceId: ws,
          name: "Probe",
          goal: "book_appointments",
          guardrails: {
            sendingWindow: {
              days: [1, 2, 3, 4, 5, 6, 7],
              start: "00:00",
              end: "23:59",
              timezone: "UTC",
            },
            dailyCap: { email: 500, sms: 100 },
            consent: null,
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "primary", graphId: "g1" },
      })
    ).id;
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } },
      },
    });
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  /* ─────────────────────────── hard bounce ─────────────────────────── */

  it("HARD bounce suppresses permanently, through the existing Suppression path", async () => {
    const { id: contactId, email } = await makeContact("hard");
    const [event] = normalizeSendGridEvents([
      sgEvent(email, { event: "bounce", type: "bounce", status: "5.1.1", reason: "no such user" }),
    ]);
    const result = await applyEmailEvent(app, ws, event!);

    expect(result.suppressed).toBe(true);
    expect(result.softBounce).toBeUndefined();
    const row = await suppressionFor(email);
    expect(row).toMatchObject({ reason: "BOUNCED", source: "webhook" });
    // A7: the second rail moves too.
    const contact = await owner.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect((contact.optOut as { email?: boolean }).email).toBe(true);
    // No tally row: a hard bounce is not a strike, it is a verdict.
    expect(
      await owner.softBounce.findFirst({ where: { workspaceId: ws, address: email } }),
    ).toBeNull();
  });

  /* ─────────────────────────── soft bounce ─────────────────────────── */

  it("SOFT bounce does NOT suppress on sight — it takes strikes to the threshold", async () => {
    const { email } = await makeContact("soft");
    const [event] = normalizeSendGridEvents([
      sgEvent(email, { event: "bounce", type: "blocked", status: "5.7.1", reason: "blocked" }),
    ]);

    // Strikes 1 and 2: recorded, no consequence.
    for (const expected of [1, 2]) {
      const r = await applyEmailEvent(app, ws, event!);
      expect(r.suppressed).toBe(false);
      expect(r.softBounce).toEqual({
        strikes: expected,
        threshold: DELIVERABILITY_DEFAULTS.softBounceThreshold,
      });
      expect(await suppressionFor(email)).toBeNull();
    }

    // Strike 3 crosses the line and reaches the SAME suppression path.
    const third = await applyEmailEvent(app, ws, event!);
    expect(third.suppressed).toBe(true);
    expect(third.softBounce?.strikes).toBe(3);
    const row = await suppressionFor(email);
    expect(row).toMatchObject({ reason: "BOUNCED", source: "soft-bounce-threshold" });

    const tally = await owner.softBounce.findFirstOrThrow({
      where: { workspaceId: ws, address: email },
    });
    expect(tally.count).toBe(3);
    expect(tally.suppressedAt).not.toBeNull();
  });

  it("a soft-bounce window that has aged out RESETS rather than accumulating", async () => {
    const { email } = await makeContact("aged");
    const [event] = normalizeSendGridEvents([
      sgEvent(email, { event: "bounce", type: "expired" }),
    ]);
    const t0 = new Date("2026-07-07T10:00:00Z");
    await applyEmailEvent(app, ws, event!, { now: () => t0 });
    await applyEmailEvent(app, ws, event!, { now: () => t0 });
    expect(
      (await owner.softBounce.findFirstOrThrow({ where: { workspaceId: ws, address: email } }))
        .count,
    ).toBe(2);

    // Two strikes, then a year of silence. The next one must be strike ONE.
    const later = new Date(t0.getTime() + 365 * 86_400_000);
    const r = await applyEmailEvent(app, ws, event!, { now: () => later });
    expect(r.suppressed).toBe(false);
    expect(r.softBounce?.strikes).toBe(1);
    expect(await suppressionFor(email)).toBeNull();
  });

  it("the workspace's own threshold is honoured over the platform default", async () => {
    await owner.deliverabilityRule.upsert({
      where: { workspaceId: ws },
      create: { workspaceId: ws, softBounceThreshold: 2 },
      update: { softBounceThreshold: 2 },
    });
    try {
      const { email } = await makeContact("tuned");
      const [event] = normalizeSendGridEvents([
        sgEvent(email, { event: "bounce", type: "blocked" }),
      ]);
      expect((await applyEmailEvent(app, ws, event!)).suppressed).toBe(false);
      const second = await applyEmailEvent(app, ws, event!);
      expect(second.suppressed).toBe(true);
      expect(second.softBounce).toEqual({ strikes: 2, threshold: 2 });
    } finally {
      await owner.deliverabilityRule.deleteMany({ where: { workspaceId: ws } });
    }
  });

  /* ──────────────────────────── complaints ─────────────────────────── */

  it("a spam complaint suppresses INSTANTLY with the complaint reason", async () => {
    const { email } = await makeContact("fbl");
    const [event] = normalizeSendGridEvents([sgEvent(email, { event: "spamreport" })]);
    expect((await applyEmailEvent(app, ws, event!)).suppressed).toBe(true);
    expect(await suppressionFor(email)).toMatchObject({ reason: "SPAM_COMPLAINT" });
  });

  it("a 'Spam Reported' DROP is a complaint, not a bounce (pre-D1 it was BOUNCED)", async () => {
    const { email } = await makeContact("dropspam");
    const [event] = normalizeSendGridEvents([
      sgEvent(email, { event: "dropped", reason: "Spam Reported" }),
    ]);
    expect((await applyEmailEvent(app, ws, event!)).suppressed).toBe(true);
    // The reason is what makes this count against the 40-weight complaint
    // signal instead of the 30-weight bounce signal.
    expect(await suppressionFor(email)).toMatchObject({ reason: "SPAM_COMPLAINT" });
  });

  it("a 'Duplicate' DROP suppresses NOTHING — pre-D1 it killed the address", async () => {
    const { email } = await makeContact("dup");
    const [event] = normalizeSendGridEvents([
      sgEvent(email, { event: "dropped", reason: "Duplicate" }),
    ]);
    expect((await applyEmailEvent(app, ws, event!)).suppressed).toBe(false);
    expect(await suppressionFor(email)).toBeNull();
  });

  /* ────────────────────── the ledger the health engine reads ────────── */

  it("soft bounces stay OUT of the hard-bounce ledger event (DEC-171)", async () => {
    const { id: contactId } = await makeContact("ledger");
    const message = await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        channel: "email",
        direction: "OUTBOUND",
        body: "seed",
        sentAt: IN_WINDOW(),
        meta: {},
      },
    });
    const [hard] = normalizeSendGridEvents([
      sgEvent("x@t.test", { event: "bounce", type: "bounce", status: "5.1.1" }),
    ]);
    const [soft] = normalizeSendGridEvents([
      sgEvent("x@t.test", { event: "bounce", type: "blocked", status: "5.7.1" }),
    ]);
    expect(toBusEvents(hard!, message)[0]!.type).toBe("email.bounced.v1");
    const softBus = toBusEvents(soft!, message, 2)[0]!;
    expect(softBus.type).toBe("email.soft_bounced.v1");
    expect(softBus.payload).toMatchObject({ attempt: 2 });
  });

  /* ─────────────────── the 2% rule, at the send boundary ───────────── */

  it("SENDER_BOUNCE_RATE: over the 2% line refuses typed, and draining restores it", async () => {
    const { id: contactId } = await makeContact("rail");
    const senderId = await makeSender({ healthState: snapshotAt(0.03) });
    const params = {
      workspaceId: ws,
      campaignId,
      agentId,
      contactId,
      senderId,
      stepNodeId: "step-1",
      content: { subject: "Hello", body: "Hi {{firstName}}" },
    };

    await expect(sendStep(deps(), params)).rejects.toMatchObject({
      reason: "SENDER_BOUNCE_RATE",
      message: expect.stringContaining("3% over the 2% limit"),
    });

    // Reversible: the rolling window drains and the same sender sends again.
    await owner.senderConnection.update({
      where: { id: senderId },
      data: { healthState: snapshotAt(0.005) },
    });
    const sent = await sendStep(deps(), params);
    expect(sent.senderId).toBe(senderId);
  });

  it("exactly AT the threshold refuses — 'exceed 2%' is the >= the danger bounds use", async () => {
    const { id: contactId } = await makeContact("atline");
    const senderId = await makeSender({ healthState: snapshotAt(0.02) });
    await expect(
      sendStep(deps(), {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        senderId,
        stepNodeId: "step-1",
        content: { subject: "Hello", body: "Hi" },
      }),
    ).rejects.toMatchObject({ reason: "SENDER_BOUNCE_RATE" });
  });

  it("NEVER fires below the sample floor — four sends and one bounce is not 25%", async () => {
    const { id: contactId } = await makeContact("lowdata");
    // `rates: null` is what the engine persists below the floor. A sender that
    // could be paused on this would never survive its own first day.
    const senderId = await makeSender({
      healthState: {
        v: 1,
        score: null,
        state: "low_data",
        band: null,
        floor: "none",
        windowDays: 7,
        computedAt: "2026-07-07T09:00:00.000Z",
        sample: { sent: 4, delivered: 3, bounced: 1, spam: 0, replied: 0 },
        rates: null,
      },
    });
    const sent = await sendStep(deps(), {
      workspaceId: ws,
      campaignId,
      agentId,
      contactId,
      senderId,
      stepNodeId: "step-1",
      content: { subject: "Hello", body: "Hi" },
    });
    expect(sent.senderId).toBe(senderId);
  });

  it("the toggle OFF returns the sender to score-only auto-pause", async () => {
    await owner.deliverabilityRule.upsert({
      where: { workspaceId: ws },
      create: { workspaceId: ws, pauseOnBounceRate: false },
      update: { pauseOnBounceRate: false },
    });
    try {
      const { id: contactId } = await makeContact("off");
      // 4% bounce: over the owner's line, but the composite score stays well
      // above 40 — which is exactly why the single-signal rail has to exist.
      const senderId = await makeSender({ healthState: snapshotAt(0.04) });
      const sent = await sendStep(deps(), {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        senderId,
        stepNodeId: "step-1",
        content: { subject: "Hello", body: "Hi" },
      });
      expect(sent.senderId).toBe(senderId);
    } finally {
      await owner.deliverabilityRule.deleteMany({ where: { workspaceId: ws } });
    }
  });

  it("a sender with NO health snapshot is untouched (pre-D1 regression pin)", async () => {
    const { id: contactId } = await makeContact("legacy");
    const senderId = await makeSender(); // no healthState at all
    const sent = await sendStep(deps(), {
      workspaceId: ws,
      campaignId,
      agentId,
      contactId,
      senderId,
      stepNodeId: "step-1",
      content: { subject: "Hello", body: "Hi" },
    });
    expect(sent.senderId).toBe(senderId);
  });

  it("rail order: SENDER_UNHEALTHY still wins over the bounce-rate rail", async () => {
    const { id: contactId } = await makeContact("order");
    const senderId = await makeSender({
      healthState: { ...snapshotAt(0.09), score: 12, state: "unhealthy", band: "paused" },
    });
    await expect(
      sendStep(deps(), {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        senderId,
        stepNodeId: "step-1",
        content: { subject: "Hello", body: "Hi" },
      }),
    ).rejects.toMatchObject({ reason: "SENDER_UNHEALTHY" });
  });
});
