/**
 * P5 W1 (DEC-083): the deliverability rails at the send boundary, against
 * real Postgres — the refusal walk (SENDER_UNHEALTHY typed + reversible),
 * the rail-order pins (suspension ▸ disabled ▸ UNHEALTHY ▸ window/caps ▸
 * suppression — the "make N rails fail, assert the earliest wins" pattern),
 * the warmup day-N cap fixture (min(warmup cap, daily limit), per-sender
 * count), and the pre-W1 regression pin (no warmupState → no ramp, no
 * healthState → no gate: legacy senders behave byte-identically).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  type PrismaClient,
  type SenderConnection,
} from "@clientforce/db";
import { sendStep, type SendDeps } from "../src/send";
import { sendSmsStep, type SendSmsDeps } from "../src/send-sms";
import { type EmailSender, type RenderedEmail, type RenderedSms, type SmsSender } from "../src/types";
import { warmupCurveCap } from "../src/warmup";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `dlv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const DAY_MS = 86_400_000;

const ADDRESS = "1 Main Street, Austin TX 78701";
/** Tuesday 10:00 UTC — inside the default Mon–Fri 09:00–17:00 UTC window. */
const IN_WINDOW = () => new Date("2026-07-07T10:00:00Z");

const UNHEALTHY_STATE = {
  v: 1,
  score: 12,
  state: "unhealthy",
  floor: "ok",
  windowDays: 7,
  computedAt: "2026-07-07T09:00:00.000Z",
  sample: { sent: 100, delivered: 85, bounced: 8, spam: 1, replied: 0 },
  rates: { bounce: 0.08, spam: 0.01, delivery: 0.85, reply: 0 },
  collapsedAt: "2026-07-07T09:00:00.000Z",
};

class CapturingSender implements EmailSender {
  sent: RenderedEmail[] = [];
  private n = 0;
  async send(email: RenderedEmail, _sender: SenderConnection) {
    this.sent.push(email);
    return { providerMessageId: `<dlv-${++this.n}-${suffix}@send.clientforce.io>` };
  }
}
class CapturingSms implements SmsSender {
  sent: RenderedSms[] = [];
  private n = 0;
  async send(sms: RenderedSms, _sender: SenderConnection) {
    this.sent.push(sms);
    return { providerMessageId: `SM-dlv-${++this.n}-${suffix}`, segments: 1 };
  }
}

describe.skipIf(!hasInfra)("send boundary — deliverability rails (P5 W1)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  const transport = new CapturingSender();
  const smsTransport = new CapturingSms();

  const deps = (over: Partial<SendDeps> = {}): SendDeps => ({
    prisma: app,
    transport,
    now: IN_WINDOW,
    allowlist: [],
    ...over,
  });
  const smsDeps = (over: Partial<SendSmsDeps> = {}): SendSmsDeps => ({
    prisma: app,
    transport: smsTransport,
    now: IN_WINDOW,
    allowlist: [],
    ...over,
  });
  const params = (senderId: string, over: Record<string, unknown> = {}) => ({
    workspaceId: ws,
    campaignId,
    agentId,
    contactId,
    senderId,
    stepNodeId: "step-1",
    content: { subject: "Hello {{company}}", body: "Hi {{firstName}},\n— {{senderName}}" },
    ...over,
  });

  const makeSender = async (over: Record<string, unknown> = {}): Promise<string> =>
    (
      await owner.senderConnection.create({
        data: {
          workspaceId: ws,
          type: "CF_MANAGED",
          fromEmail: `dlv-${Math.random().toString(36).slice(2)}@send.clientforce.io`,
          fromName: "Dlv Probe",
          dailyLimit: 200,
          ...over,
        },
      })
    ).id;

  /** Seed n per-sender OUTBOUND messages "today" (the warmup counter's input). */
  const seedSentToday = async (senderId: string, n: number, channel = "email"): Promise<void> => {
    await owner.message.createMany({
      data: Array.from({ length: n }, () => ({
        workspaceId: ws,
        campaignId,
        contactId,
        channel,
        direction: "OUTBOUND" as const,
        body: "seed",
        senderId,
        sentAt: IN_WINDOW(),
        meta: { senderId },
      })),
    });
  };

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({ data: { agencyId, name: "DLV", slug: suffix, settings: {} } })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Probe", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "primary", graphId: "g1" },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "seed",
          optOut: {},
          tags: [],
          email: `lead-${suffix}@t.test`,
          phone: "+15005550006",
          firstName: "Ada",
          company: "Analytical",
        },
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

  it("SENDER_UNHEALTHY: an unhealthy snapshot refuses typed; clearing it restores (reversible)", async () => {
    const senderId = await makeSender({ healthState: UNHEALTHY_STATE });
    await expect(sendStep(deps(), params(senderId))).rejects.toMatchObject({
      reason: "SENDER_UNHEALTHY",
    });
    // Recovery restores — the same sender sends once the snapshot is healthy.
    await owner.senderConnection.update({
      where: { id: senderId },
      data: { healthState: { ...UNHEALTHY_STATE, score: 92, state: "healthy" } },
    });
    const message = await sendStep(deps(), params(senderId));
    expect(message.senderId).toBe(senderId);
  });

  it("rail order pinned: unhealthy sender + suppressed contact → SENDER_UNHEALTHY fires first", async () => {
    const senderId = await makeSender({ healthState: UNHEALTHY_STATE });
    const victim = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "seed",
        optOut: {},
        tags: [],
        email: `supp-${suffix}@t.test`,
      },
    });
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: victim.email!, reason: "MANUAL" },
    });
    await expect(sendStep(deps(), params(senderId, { contactId: victim.id }))).rejects.toMatchObject({
      reason: "SENDER_UNHEALTHY",
    });
  });

  it("rail order pinned: PAUSED beats unhealthy (status is checked first, unchanged)", async () => {
    const senderId = await makeSender({ status: "PAUSED", healthState: UNHEALTHY_STATE });
    await expect(sendStep(deps(), params(senderId))).rejects.toMatchObject({
      reason: "SENDER_DISABLED",
    });
  });

  it("low_data snapshot never gates — a warming sender sends", async () => {
    const senderId = await makeSender({
      healthState: { ...UNHEALTHY_STATE, score: null, state: "low_data", floor: "none", rates: null },
    });
    const message = await sendStep(deps(), params(senderId));
    expect(message.senderId).toBe(senderId);
  });

  it("warmup day-N fixture: day 3 cap is enforced per-sender at the boundary; day N+1 raises it", async () => {
    const day = 3;
    const cap = warmupCurveCap(day, 200)!; // 200-limit sender, day 3
    const startedAt = new Date(IN_WINDOW().getTime() - (day - 1) * DAY_MS).toISOString();
    const senderId = await makeSender({ warmupState: { startedAt, curve: "v1" } });
    await seedSentToday(senderId, cap); // exactly at cap → next refuses
    await expect(sendStep(deps(), params(senderId))).rejects.toMatchObject({
      reason: "DAILY_CAP_REACHED",
      message: expect.stringContaining(`warmup cap ${cap} (day ${day} of 45)`),
    });
    // Another sender same day, one under its cap → sends (per-SENDER counting).
    const otherId = await makeSender({ warmupState: { startedAt, curve: "v1" } });
    await seedSentToday(otherId, cap - 1);
    const sent = await sendStep(deps(), params(otherId));
    expect(sent.senderId).toBe(otherId);
  });

  it("min(warmup cap, daily limit): a limit below the curve binds instead (existing check, untouched)", async () => {
    // Day 45 curve cap = 100% of target — the configured limit is the binder.
    const startedAt = new Date(IN_WINDOW().getTime() - 44 * DAY_MS).toISOString();
    const senderId = await makeSender({ dailyLimit: 2, warmupState: { startedAt, curve: "v1" } });
    await seedSentToday(senderId, 2);
    await expect(sendStep(deps(), params(senderId))).rejects.toMatchObject({
      reason: "DAILY_CAP_REACHED",
      message: expect.stringContaining("sender limit 2"),
    });
  });

  it("pre-W1 regression pin: no warmupState → no ramp; no healthState → no gate", async () => {
    const senderId = await makeSender(); // neither field set — the legacy shape
    await seedSentToday(senderId, 25); // day-1 curve cap (10) would refuse if a ramp applied
    const message = await sendStep(deps(), params(senderId));
    expect(message.senderId).toBe(senderId);
  });

  it("SMS twin: SENDER_UNHEALTHY refuses; warmup cap counts sms per-sender", async () => {
    const unhealthySms = await makeSender({
      type: "TWILIO_SMS",
      fromEmail: "+15005550009",
      healthState: UNHEALTHY_STATE,
    });
    await expect(
      sendSmsStep(smsDeps(), {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        senderId: unhealthySms,
        stepNodeId: "s1",
        content: { body: "Hi {{firstName}}" },
      }),
    ).rejects.toMatchObject({ reason: "SENDER_UNHEALTHY" });

    const day = 2;
    const cap = warmupCurveCap(day, 200)!;
    const startedAt = new Date(IN_WINDOW().getTime() - (day - 1) * DAY_MS).toISOString();
    const rampingSms = await makeSender({
      type: "TWILIO_SMS",
      fromEmail: "+15005550010",
      warmupState: { startedAt, curve: "v1" },
    });
    await seedSentToday(rampingSms, cap, "sms");
    await expect(
      sendSmsStep(smsDeps(), {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        senderId: rampingSms,
        stepNodeId: "s1",
        content: { body: "Hi {{firstName}}" },
      }),
    ).rejects.toMatchObject({
      reason: "DAILY_CAP_REACHED",
      message: expect.stringContaining(`warmup cap ${cap} (day ${day} of 45)`),
    });
  });
});
