/**
 * G1 (DEC-070) acceptance integration: the guided loop END TO END against
 * Postgres — brief → REAL createSmsStepComposer (prompt-driven fake gateway,
 * the M1a fixture pattern: no network) → deterministic checks → the UNCHANGED
 * sendSmsStep rails → Message persisted as rendered with `{mode,
 * briefVersion, composerVersion}` meta.
 *
 * Proves the four acceptance pillars: (1) two leads on the SAME step produce
 * DIFFERENT compliant texts (variety + grounding — the fake only personalizes
 * from prompt-provided lead fields and only "knows" facts present in the
 * cached business-context block); (2) a neverSay violation walks retry →
 * typed refusal → pause + event, never a silent skip and never an unchecked
 * send; (3) scripted sends stay byte-identical (meta regression); (4) compose
 * runs AFTER the idempotency check — replays never re-spend a model call.
 * Skips without infra.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { AiGateway } from "@clientforce/ai";
import { createSmsStepComposer, SMS_OPT_OUT_LINE, smsSegmentCount, type EmailSender, type RenderedSms, type SmsSender } from "@clientforce/channels";
import { GUIDED_SMS_CREDITS, type StepBrief } from "@clientforce/core";
import {
  createAppPrismaClient,
  createPrismaClient,
  encryptField,
  type PrismaClient,
  type SenderConnection,
} from "@clientforce/db";
import { createActivities, type CampaignActivities } from "../src/activities";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `g1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PHONE_A = "+15005550101";
const PHONE_B = "+15005550102";
const ENC_KEY = Buffer.from(new Array(32).fill(7)).toString("base64");
/** Tuesday 10:00 UTC — inside the Mon–Fri 09:00–17:00 UTC window. */
const IN_WINDOW = () => new Date("2026-07-07T10:00:00Z");

// The grounding fixture: the fake composer may only "know" this fact when the
// cached context block actually carries it (lifted, DEC-015 style).
const FACT_AUDIT = "free growth audit";
const BANNED = "rock-bottom prices";

const BRIEF: StepBrief = {
  objective: "Earn a reply about the audit",
  talkingPoints: [
    `the ${FACT_AUDIT} shows where bookings leak`,
    "results land within 7 days",
    "no commitment to look",
  ],
  mustSay: [FACT_AUDIT],
};

class CapturingSms implements SmsSender {
  sent: RenderedSms[] = [];
  private n = 0;
  async send(sms: RenderedSms, _sender: SenderConnection) {
    this.sent.push(sms);
    return { providerMessageId: `SM-g1-${++this.n}-${suffix}`, segments: smsSegmentCount(sms.body) };
  }
}
const emailStub: EmailSender = {
  send: async () => ({ providerMessageId: `<unused-${suffix}@test>` }),
};

/** Prompt-driven fake composer model: personalizes ONLY from the prompt's
 *  LEAD block, grounds ONLY on facts in the cached context, and violates the
 *  prompt's ban list per `banMode` (clean retry when "once"). */
let banMode: "none" | "once" | "always" = "none";
let toolCalls = 0;
const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string; cachedContext?: string }) => {
      toolCalls += 1;
      const first = /- First name: (.+)/.exec(params.prompt)?.[1]?.trim() ?? "there";
      const company = /- Company: (.+)/.exec(params.prompt)?.[1]?.trim() ?? "your team";
      const practice = /- practice_type: (.+)/.exec(params.prompt)?.[1]?.trim();
      const fact = params.cachedContext?.includes(FACT_AUDIT) ? FACT_AUDIT : "our service";
      const isRepair = params.prompt.includes("FAILED its checks");
      const violate = banMode === "always" || (banMode === "once" && !isRepair);
      const body =
        `${first}, noticed ${company}${practice ? ` (${practice})` : ""} still books mostly by phone — ` +
        `our ${fact} shows where bookings leak.${violate ? ` No ${BANNED} tricks.` : ""} Worth a look?`;
      return { input: { body }, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  },
  config: { maxRetries: 0 },
});

describe.skipIf(!hasInfra)("guided SMS end-to-end (compose → checks → boundary)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let acts: CampaignActivities;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let emailSenderId: string;
  let contactA: string;
  let contactB: string;
  let enrollA: string;
  let enrollB: string;
  const smsTransport = new CapturingSms();
  const refusals: Array<{ stepNodeId: string; reason: string; detail?: string }> = [];

  beforeEach(() => {
    banMode = "none";
    toolCalls = 0;
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: suffix, slug: suffix, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({ data: { agencyId, name: "g1", slug: suffix, settings: {} } })
    ).id;
    agentId = (
      await owner.agent.create({
        data: {
          workspaceId: ws,
          name: "Guided",
          goal: "book_appointments",
          category: "Dental & Orthodontics",
          guardrails: {
            sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
            dailyCap: { email: 10, sms: 10 },
            consent: null,
            composeMode: "guided",
            strategy: { neverSay: [BANNED] },
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "primary", graphId: "" },
      })
    ).id;
    // The composer's only permitted fact source (stored context, DEC-015).
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        status: "READY",
        fields: {
          offer: {
            value: `We book dental appointments with a ${FACT_AUDIT}.`,
            citations: [],
            source: "typed",
          },
        },
      },
    });
    await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "TWILIO_SMS",
        fromEmail: "+15005550006",
        fromName: "Clinic SMS",
        dailyLimit: 100,
        credentialsEnc: encryptField(
          JSON.stringify({ messagingServiceSid: `MG${"a".repeat(32)}` }),
          ENC_KEY,
        ),
      },
    });
    emailSenderId = (
      await owner.senderConnection.create({
        data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: "a@send.test", fromName: "A" },
      })
    ).id;
    contactA = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "test",
          optOut: {},
          tags: [],
          email: `ada-${suffix}@allowed.test`,
          firstName: "Ada",
          company: "Bright Ortho",
          phone: PHONE_A,
          custom: { practice_type: "orthodontics" },
        },
      })
    ).id;
    contactB = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "test",
          optOut: {},
          tags: [],
          email: `ben-${suffix}@allowed.test`,
          firstName: "Ben",
          company: "Lakeside Dental",
          phone: PHONE_B,
        },
      })
    ).id;
    enrollA = (
      await owner.enrollment.create({
        data: { workspaceId: ws, campaignId, contactId: contactA, workflowId: `enroll-a-${suffix}`, pipelineStage: "new", meta: {} },
      })
    ).id;
    enrollB = (
      await owner.enrollment.create({
        data: { workspaceId: ws, campaignId, contactId: contactB, workflowId: `enroll-b-${suffix}`, pipelineStage: "new", meta: {} },
      })
    ).id;

    acts = createActivities({
      prisma: app,
      transport: emailStub,
      smsTransport,
      smsAllowlist: [PHONE_A, PHONE_B],
      now: IN_WINDOW,
      composeSms: createSmsStepComposer({ prisma: app, gateway }),
      publishComposeRefused: async (e) => {
        refusals.push({ stepNodeId: e.stepNodeId, reason: e.reason, detail: e.detail });
      },
    });
  });

  afterAll(async () => {
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await app?.$disconnect();
  });

  const guidedParams = (enrollmentId: string, contactId: string, stepNodeId = "sms-g1") => ({
    workspaceId: ws,
    enrollmentId,
    campaignId,
    agentId,
    contactId,
    senderId: emailSenderId, // the enrollment's sender is the EMAIL sender (DEC-061)
    stepNodeId,
    content: {},
    channel: "sms",
    mode: "guided" as const,
    brief: BRIEF,
    graphVersion: 3,
  });

  it("ACCEPTANCE: two leads on the same guided step → DIFFERENT compliant texts through the unchanged rails", async () => {
    const outA = await acts.sendEnrollmentStep(guidedParams(enrollA, contactA));
    const outB = await acts.sendEnrollmentStep(guidedParams(enrollB, contactB));
    expect(outA.kind).toBe("sent");
    expect(outB.kind).toBe("sent");

    const [msgA, msgB] = await Promise.all([
      owner.message.findUniqueOrThrow({ where: { id: outA.messageId } }),
      owner.message.findUniqueOrThrow({ where: { id: outB.messageId } }),
    ]);

    // Different texts — each personalized from ITS lead's real fields.
    expect(msgA.body).not.toBe(msgB.body);
    expect(msgA.body).toContain("Ada");
    expect(msgA.body).toContain("Bright Ortho");
    expect(msgA.body).toContain("orthodontics"); // C2.7 custom value reached the composer
    expect(msgB.body).toContain("Ben");
    expect(msgB.body).toContain("Lakeside Dental");
    expect(msgB.body).not.toContain("Ada"); // never the other lead's details

    for (const msg of [msgA, msgB]) {
      // Grounding: the fact traces to the STORED BusinessContext (the fake
      // only knows it because the cached context block carried it).
      expect(msg.body).toContain(FACT_AUDIT);
      // The unchanged boundary did its job: first outbound carries the
      // literal opt-out line; the composed part respects the hard cap.
      expect(msg.body).toContain(SMS_OPT_OUT_LINE);
      expect(msg.channel).toBe("sms");
      // Provenance meta (A6): who wrote the copy, from which brief version.
      expect(msg.meta).toMatchObject({
        mode: "guided",
        briefVersion: 3,
        composerVersion: "composer.sms@v1",
        optOutLine: true,
      });
      // No unresolved tokens ever reach the wire.
      expect(msg.body).not.toMatch(/\{\{/);
    }
    // Sanity: the credits figure is display-only — no billing event exists.
    expect(GUIDED_SMS_CREDITS).toBe(3);
  });

  it("compose runs AFTER the idempotency check — a replay never re-spends a model call", async () => {
    toolCalls = 0;
    const again = await acts.sendEnrollmentStep(guidedParams(enrollA, contactA));
    expect(again.kind).toBe("duplicate");
    expect(toolCalls).toBe(0);
  });

  it("neverSay slip on attempt 1 → bounded retry heals → SENT (2 model calls)", async () => {
    banMode = "once";
    const out = await acts.sendEnrollmentStep(guidedParams(enrollA, contactA, "sms-g2"));
    expect(out.kind).toBe("sent");
    expect(toolCalls).toBe(2);
    const msg = await owner.message.findUniqueOrThrow({ where: { id: out.messageId } });
    expect(msg.body.toLowerCase()).not.toContain(BANNED);
  });

  it("REFUSAL WALK: still dirty after the retry → typed failure, lead PAUSED + event, ZERO sends", async () => {
    banMode = "always";
    const before = await owner.message.count({ where: { workspaceId: ws } });
    const err = await acts
      .sendEnrollmentStep(guidedParams(enrollB, contactB, "sms-g3"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).type).toBe("ComposeRefusedError");
    const detail = (err as ApplicationFailure).details?.[0] as { reason?: string };
    expect(detail.reason).toBe("NEVER_SAY_VIOLATION");
    expect(toolCalls).toBe(2); // exactly ONE bounded retry
    expect(await owner.message.count({ where: { workspaceId: ws } })).toBe(before); // unchecked copy never sent

    // …the workflow then records it: pause THAT lead + the Logs-row event.
    await acts.recordComposeRefused({
      workspaceId: ws,
      enrollmentId: enrollB,
      contactId: contactB,
      campaignId,
      nodeId: "sms-g3",
      reason: "NEVER_SAY_VIOLATION",
      detail: `contains banned phrase(s): "${BANNED}"`,
    });
    const enrollment = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollB } });
    expect(enrollment.status).toBe("PAUSED");
    expect(enrollment.meta).toMatchObject({
      blocked: { nodeId: "sms-g3", reason: "NEVER_SAY_VIOLATION" },
    });
    expect(refusals).toContainEqual(
      expect.objectContaining({ stepNodeId: "sms-g3", reason: "NEVER_SAY_VIOLATION" }),
    );
  });

  it("no composer configured → typed COMPOSER_UNCONFIGURED refusal; scripted sms still sends (honest absence)", async () => {
    const bare = createActivities({
      prisma: app,
      transport: emailStub,
      smsTransport,
      smsAllowlist: [PHONE_A, PHONE_B],
      now: IN_WINDOW,
    });
    const err = await bare
      .sendEnrollmentStep(guidedParams(enrollA, contactA, "sms-g4"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(((err as ApplicationFailure).details?.[0] as { reason?: string }).reason).toBe(
      "COMPOSER_UNCONFIGURED",
    );

    // Scripted regression on the SAME bare deps: full copy sends untouched,
    // meta carries NO provenance keys (byte-identical to pre-G1).
    const out = await bare.sendEnrollmentStep({
      workspaceId: ws,
      enrollmentId: enrollA,
      campaignId,
      agentId,
      contactId: contactA,
      senderId: emailSenderId,
      stepNodeId: "sms-scripted",
      content: { body: "Hi {{firstName}}, quick note from {{senderName}}." },
      channel: "sms",
    });
    expect(out.kind).toBe("sent");
    const msg = await owner.message.findUniqueOrThrow({ where: { id: out.messageId } });
    expect(msg.body).toContain("Ada");
    const meta = msg.meta as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(["optOutLine", "segments", "senderId"]);
  });
});
