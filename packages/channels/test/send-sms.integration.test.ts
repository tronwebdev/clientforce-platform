/**
 * P2.1 (DEC-061/062) acceptance integration: the SMS boundary end-to-end
 * against Postgres with a capturing fake transport — happy path (tokens +
 * the literal opt-out line on the FIRST outbound only + Message persisted
 * as rendered with segment meta), suppression/opt-out (channel "sms"),
 * guardrail window + per-channel caps, allow-list, STOP rail, and the
 * email path untouched. Skips without infra.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  encryptField,
  withTenant,
  type PrismaClient,
  type SenderConnection,
} from "@clientforce/db";
import { COMPLIANCE_STRINGS } from "@clientforce/core";
import { sendSmsStep, SMS_OPT_OUT_LINE, type SendSmsDeps } from "../src/send-sms";
import { applySmsStop, ingestInboundSms, isStopMessage, normalizeTwilioInbound } from "../src/sms-inbound";
import { smsSegmentCount, validateTwilioSignature } from "../src/twilio";
import type { RenderedSms, SmsSender } from "../src/types";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PHONE = "+15005551234";
// Explicit key — the boundary never decrypts in these tests; env-free like the
// email suite's crypto round-trip.
const ENC_KEY = Buffer.from(new Array(32).fill(7)).toString("base64");
/** Tuesday 10:00 UTC — inside the Mon–Fri 09:00–17:00 UTC window. */
const IN_WINDOW = () => new Date("2026-07-07T10:00:00Z");

class CapturingSms implements SmsSender {
  sent: RenderedSms[] = [];
  private n = 0;
  async send(sms: RenderedSms, _sender: SenderConnection) {
    this.sent.push(sms);
    return { providerMessageId: `SM-test-${++this.n}-${suffix}`, segments: smsSegmentCount(sms.body) };
  }
}

describe.skipIf(!hasInfra)("sendSmsStep boundary integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let senderId: string;
  let contactId: string;
  let enrollmentId: string;
  const transport = new CapturingSms();
  const deps = (over: Partial<SendSmsDeps> = {}): SendSmsDeps => ({
    prisma: app,
    transport,
    now: IN_WINDOW,
    allowlist: [PHONE],
    ...over,
  });
  const base = () => ({
    workspaceId: ws,
    campaignId,
    agentId,
    enrollmentId,
    contactId,
    senderId,
    stepNodeId: "sms-1",
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `sms-${suffix}`, slug: `sms-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    const workspace = await owner.workspace.create({
      data: { agencyId, name: "sms", slug: `sms-ws-${suffix}`, settings: {} },
    });
    ws = workspace.id;
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "SMS Agent",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
          dailyCap: { email: 10, sms: 3 },
          consent: null,
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    agentId = agent.id;
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "primary", graphId: "" },
    });
    campaignId = campaign.id;
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "TWILIO_SMS",
        fromEmail: "+15005550006", // DEC-061: E.164 rides the fromEmail column
        fromName: "Clinic SMS",
        dailyLimit: 100,
        credentialsEnc: encryptField(JSON.stringify({ messagingServiceSid: `MG${"a".repeat(32)}` }), ENC_KEY),
      },
    });
    senderId = sender.id;
    const contact = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "test",
        optOut: {},
        tags: [],
        email: `sms-${suffix}@t.test`,
        phone: PHONE,
        firstName: "Sam",
      },
    });
    contactId = contact.id;
    const enrollment = await owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        workflowId: `wf-sms-${suffix}`,
        status: "ACTIVE",
        pipelineStage: "new",
        currentNode: "sms-1",
      },
    });
    enrollmentId = enrollment.id;
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("happy path: tokens render, the FIRST outbound carries the literal opt-out line, segments in meta", async () => {
    const msg = await sendSmsStep(deps(), {
      ...base(),
      content: { body: "Hi {{firstName}}, quick question from {{senderName}}." },
    });
    expect(msg.channel).toBe("sms");
    expect(msg.body).toContain("Hi Sam, quick question from Clinic SMS.");
    expect(msg.body.endsWith(SMS_OPT_OUT_LINE)).toBe(true);
    expect((msg.meta as { segments?: number }).segments).toBeGreaterThan(0);
    expect(msg.providerMessageId).toMatch(/^SM-test-/);
  });

  it("the SECOND outbound of the enrollment does NOT repeat the opt-out line", async () => {
    const msg = await sendSmsStep(deps(), { ...base(), stepNodeId: "sms-2", content: { body: "Bump {{firstName}}" } });
    expect(msg.body).not.toContain(SMS_OPT_OUT_LINE);
    expect(msg.inReplyToId).not.toBeNull();
  });

  it("L1 (DEC-072): a GERMAN agent's first outbound carries the pre-translated STOP line — keyword STOP intact", async () => {
    const agent = await owner.agent.findUniqueOrThrow({ where: { id: agentId } });
    const germanAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: ws,
          name: "SMS Termine",
          goal: "book_appointments",
          guardrails: {
            ...(agent.guardrails as object),
            language: "de",
            languageSource: "detected",
          },
        },
      })
    ).id;
    const germanCampaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId: germanAgentId, name: "primär", graphId: "" },
      })
    ).id;
    const germanEnrollment = await owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId: germanCampaignId,
        contactId,
        workflowId: `wf-sms-de-${suffix}`,
        status: "ACTIVE",
        pipelineStage: "new",
        currentNode: "sms-1",
      },
    });

    const msg = await sendSmsStep(deps(), {
      ...base(),
      agentId: germanAgentId,
      campaignId: germanCampaignId,
      enrollmentId: germanEnrollment.id,
      content: { body: "Hallo {{firstName}}, kurze Frage von {{senderName}}." },
    });
    expect(msg.body.endsWith(COMPLIANCE_STRINGS.de.smsOptOut)).toBe(true);
    expect(msg.body).toContain("STOP"); // the only keyword the Twilio rail honors
    expect(msg.body).not.toContain(SMS_OPT_OUT_LINE); // never the English line
    expect((msg.meta as { optOutLine?: boolean }).optOutLine).toBe(true);
  });

  it("refuses outside the sending window (typed)", async () => {
    await expect(
      sendSmsStep(deps({ now: () => new Date("2026-07-05T10:00:00Z") /* Sunday */ }), {
        ...base(),
        stepNodeId: "sms-w",
        content: { body: "never" },
      }),
    ).rejects.toMatchObject({ reason: "OUTSIDE_SENDING_WINDOW" });
  });

  it("refuses over the per-channel sms cap (email counts don't collide)", async () => {
    // cap is 3; two sends above → one more passes, the next refuses.
    await sendSmsStep(deps(), { ...base(), stepNodeId: "sms-3", content: { body: "third" } });
    await expect(
      sendSmsStep(deps(), { ...base(), stepNodeId: "sms-4", content: { body: "fourth" } }),
    ).rejects.toMatchObject({ reason: "DAILY_CAP_REACHED" });
  });

  it("refuses a non-allow-listed number (DEC-063 rail)", async () => {
    const outsider = await owner.contact.create({
      data: { workspaceId: ws, source: "test", optOut: {}, tags: [], phone: "+15005559999", email: `o-${suffix}@t.test` },
    });
    await expect(
      // Fresh cap day (Wed) — the allow-list rail must be the one that fires.
      sendSmsStep(deps({ now: () => new Date("2026-07-08T10:00:00Z") }), { ...base(), contactId: outsider.id, stepNodeId: "sms-o", content: { body: "no" } }),
    ).rejects.toMatchObject({ reason: "RECIPIENT_NOT_ALLOWLISTED" });
  });

  it("refuses a contact without a phone (typed)", async () => {
    const nophone = await owner.contact.create({
      data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `np-${suffix}@t.test` },
    });
    await expect(
      sendSmsStep(deps(), { ...base(), contactId: nophone.id, stepNodeId: "sms-n", content: { body: "no" } }),
    ).rejects.toMatchObject({ reason: "CONTACT_NO_PHONE" });
  });

  it("STOP rail: inbound STOP suppresses, flips optOut.sms + enrollment, and the next send refuses", async () => {
    expect(isStopMessage(" stop ")).toBe(true);
    const inbound = normalizeTwilioInbound({ From: PHONE, To: "+15005550006", Body: "STOP", MessageSid: `SM-in-${suffix}` });
    const ingested = await ingestInboundSms({ owner, app }, inbound);
    expect(ingested?.stop).toBe(true);
    expect(ingested?.message.channel).toBe("sms");
    expect(ingested?.message.direction).toBe("INBOUND");

    await applySmsStop(app, ws, contactId, PHONE, enrollmentId);
    const supp = await withTenant(app, { workspaceId: ws }, (tx) =>
      tx.suppression.findFirst({ where: { channel: "sms", address: PHONE } }),
    );
    expect(supp?.reason).toBe("UNSUBSCRIBED");
    const enr = await owner.enrollment.findUnique({ where: { id: enrollmentId } });
    expect(enr?.status).toBe("UNSUBSCRIBED");

    await expect(
      sendSmsStep(deps({ now: () => new Date("2026-07-08T10:00:00Z") /* fresh cap day */ }), {
        ...base(),
        stepNodeId: "sms-after-stop",
        content: { body: "must refuse" },
      }),
    ).rejects.toMatchObject({ reason: "OPTED_OUT" });
  });

  it("validates Twilio signatures (reject on tamper)", () => {
    const url = "https://api.example.com/webhooks/twilio";
    const params = { From: PHONE, Body: "yes", MessageSid: "SM1" };
    // Signature computed with the same recipe — self-consistency + tamper check.
    const data = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
    const sig = createHmac("sha1", "token").update(Buffer.from(data, "utf-8")).digest("base64");
    expect(validateTwilioSignature("token", url, params, sig)).toBe(true);
    expect(validateTwilioSignature("token", url, { ...params, Body: "no" }, sig)).toBe(false);
    expect(validateTwilioSignature("other", url, params, sig)).toBe(false);
  });

  it("segment math: GSM-7 single/concat + UCS-2", () => {
    expect(smsSegmentCount("a".repeat(160))).toBe(1);
    expect(smsSegmentCount("a".repeat(161))).toBe(2);
    expect(smsSegmentCount("😀".repeat(30))).toBe(1);
    expect(smsSegmentCount("😀".repeat(40))).toBe(2);
  });
});
