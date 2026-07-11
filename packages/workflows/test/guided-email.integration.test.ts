/**
 * G2 (DEC-071) acceptance integration: the guided EMAIL loop END TO END
 * against Postgres — brief → REAL createEmailStepComposer (prompt-driven fake
 * gateway, the M1a fixture pattern: no network) → deterministic checks → the
 * UNCHANGED sendStep rails → Message persisted as rendered with `{mode,
 * briefVersion, composerVersion}` meta and the boundary's CAN-SPAM footer
 * appended EXACTLY ONCE.
 *
 * Proves the acceptance pillars: (1) two leads on the SAME step produce
 * DIFFERENT compliant emails (variety + grounding); (2) the footer is the
 * boundary's job — the composer writes none, the persisted body carries
 * exactly one; (3) a subject-rule violation walks retry → typed refusal →
 * pause + channel-aware event, never a silent skip, never an unchecked send;
 * (4) compose runs AFTER the idempotency check (replays never re-spend a
 * model call); (5) scripted email sends stay byte-identical (meta
 * regression); (6) a MIXED-MODE sequence — scripted step 1 + guided step 2 —
 * executes correctly on one enrollment. Skips without infra.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { AiGateway } from "@clientforce/ai";
import {
  createEmailStepComposer,
  EMAIL_COMPOSE_MAX_WORDS,
  type EmailSender,
  type RenderedEmail,
} from "@clientforce/channels";
import { GUIDED_EMAIL_CREDITS, type StepBrief } from "@clientforce/core";
import {
  createAppPrismaClient,
  createPrismaClient,
  type PrismaClient,
  type SenderConnection,
} from "@clientforce/db";
import { createActivities, type CampaignActivities } from "../src/activities";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `g2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
/** Tuesday 10:00 UTC — inside the Mon–Fri 09:00–17:00 UTC window. */
const IN_WINDOW = () => new Date("2026-07-07T10:00:00Z");

// The grounding fixture: the fake composer may only "know" this fact when the
// cached context block actually carries it (lifted, DEC-015 style).
const FACT_AUDIT = "free growth audit";
const BANNED = "rock-bottom prices";
const COMPANY_ADDRESS = "1200 Main St Suite 400, Dallas, TX 75201";

const BRIEF: StepBrief = {
  objective: "Earn a reply about the audit",
  talkingPoints: [
    `the ${FACT_AUDIT} shows where bookings leak`,
    "results land within 7 days",
    "no commitment to look",
  ],
  mustSay: [FACT_AUDIT],
  subjectHint: "where bookings leak",
};

class CapturingEmail implements EmailSender {
  sent: RenderedEmail[] = [];
  private n = 0;
  async send(email: RenderedEmail, _sender: SenderConnection) {
    this.sent.push(email);
    return { providerMessageId: `<g2-${++this.n}-${suffix}@test>` };
  }
}

/** Prompt-driven fake composer model: personalizes ONLY from the prompt's
 *  LEAD block, grounds ONLY on facts in the cached context, and misbehaves
 *  per `misbehave` (clean retry when "once"). */
let misbehave: { kind: "none" | "subject" | "footer" | "ban"; until: "once" | "always" } = {
  kind: "none",
  until: "always",
};
let toolCalls = 0;
let lastPrompt = "";
const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string; cachedContext?: string }) => {
      toolCalls += 1;
      lastPrompt = params.prompt;
      const first = /- First name: (.+)/.exec(params.prompt)?.[1]?.trim() ?? "there";
      const company = /- Company: (.+)/.exec(params.prompt)?.[1]?.trim() ?? "your team";
      const practice = /- practice_type: (.+)/.exec(params.prompt)?.[1]?.trim();
      const fact = params.cachedContext?.includes(FACT_AUDIT) ? FACT_AUDIT : "our service";
      const isRepair = params.prompt.includes("FAILED its checks");
      const active = misbehave.kind !== "none" && (misbehave.until === "always" || !isRepair);
      const subject = active && misbehave.kind === "subject"
        ? "QUICK QUESTION!!!"
        : `Where ${company} bookings leak`;
      const body =
        `${first}, noticed ${company}${practice ? ` (${practice})` : ""} still books mostly by phone — ` +
        `our ${fact} shows where bookings leak.` +
        `${active && misbehave.kind === "ban" ? ` No ${BANNED} tricks.` : ""}` +
        `${active && misbehave.kind === "footer" ? " Unsubscribe anytime if this isn't useful." : ""}` +
        ` Worth a look?`;
      return { input: { subject, body }, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  },
  config: { maxRetries: 0 },
});

describe.skipIf(!hasInfra)("guided EMAIL end-to-end (compose → checks → boundary → footer once)", () => {
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
  const transport = new CapturingEmail();
  const refusals: Array<{ stepNodeId: string; channel: string; reason: string; detail?: string }> = [];

  beforeEach(() => {
    misbehave = { kind: "none", until: "always" };
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
      await owner.workspace.create({ data: { agencyId, name: "g2", slug: suffix, settings: {} } })
    ).id;
    agentId = (
      await owner.agent.create({
        data: {
          workspaceId: ws,
          name: "Guided Email",
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
    // The composer's only permitted fact source (stored context, DEC-015) —
    // company_address doubles as the boundary's CAN-SPAM footer input.
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
          company_address: { value: COMPANY_ADDRESS, citations: [], source: "typed" },
        },
      },
    });
    emailSenderId = (
      await owner.senderConnection.create({
        data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: "agent@send.test", fromName: "Clinic Agent", dailyLimit: 100 },
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
      transport,
      allowlist: [`ada-${suffix}@allowed.test`, `ben-${suffix}@allowed.test`],
      now: IN_WINDOW,
      composeEmail: createEmailStepComposer({ prisma: app, gateway }),
      publishComposeRefused: async (e) => {
        refusals.push({ stepNodeId: e.stepNodeId, channel: e.channel, reason: e.reason, detail: e.detail });
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

  const guidedParams = (enrollmentId: string, contactId: string, stepNodeId = "email-g1") => ({
    workspaceId: ws,
    enrollmentId,
    campaignId,
    agentId,
    contactId,
    senderId: emailSenderId,
    stepNodeId,
    content: {},
    channel: "email",
    mode: "guided" as const,
    brief: BRIEF,
    graphVersion: 4,
    position: { index: 1, count: 3 },
  });

  it("ACCEPTANCE: two leads on the same guided step → DIFFERENT compliant emails; footer appended EXACTLY ONCE by the boundary", async () => {
    const outA = await acts.sendEnrollmentStep(guidedParams(enrollA, contactA));
    // The arc role reached the composer's prompt (M1a ladder: step 1 = OPENER).
    expect(lastPrompt).toContain("step 1 of 3 — OPENER");
    expect(lastPrompt).toContain("where bookings leak"); // subjectHint rode along
    const outB = await acts.sendEnrollmentStep(guidedParams(enrollB, contactB));
    expect(outA.kind).toBe("sent");
    expect(outB.kind).toBe("sent");

    const [msgA, msgB] = await Promise.all([
      owner.message.findUniqueOrThrow({ where: { id: outA.messageId } }),
      owner.message.findUniqueOrThrow({ where: { id: outB.messageId } }),
    ]);

    // Different texts — each personalized from ITS lead's real fields.
    expect(msgA.body).not.toBe(msgB.body);
    expect(msgA.subject).not.toBe(msgB.subject);
    expect(msgA.body).toContain("Ada");
    expect(msgA.body).toContain("Bright Ortho");
    expect(msgA.body).toContain("orthodontics"); // C2.7 custom value reached the composer
    expect(msgB.body).toContain("Ben");
    expect(msgB.body).toContain("Lakeside Dental");
    expect(msgB.body).not.toContain("Ada"); // never the other lead's details

    for (const msg of [msgA, msgB]) {
      // Grounding: the fact traces to the STORED BusinessContext.
      expect(msg.body).toContain(FACT_AUDIT);
      // FOOTER EXACTLY ONCE: the composer wrote none (the checks refuse it),
      // the boundary appended the CAN-SPAM block — company_address verbatim +
      // one unsubscribe line.
      expect(msg.body.match(/Unsubscribe:/g)).toHaveLength(1);
      expect(msg.body.match(/unsubscribe/gi)).toHaveLength(1);
      expect(msg.body).toContain(COMPANY_ADDRESS);
      const composedPart = msg.body.split("\n\n--\n")[0]!;
      expect(composedPart.toLowerCase()).not.toContain("unsubscribe");
      // The composed part respects the hard cap; the whole wire body is text.
      expect(composedPart.trim().split(/\s+/).length).toBeLessThanOrEqual(EMAIL_COMPOSE_MAX_WORDS);
      expect(msg.channel).toBe("email");
      // Provenance meta (A6): who wrote the copy, from which brief version.
      expect(msg.meta).toMatchObject({
        mode: "guided",
        briefVersion: 4,
        composerVersion: "composer.email@v1",
        threaded: false,
      });
      // No unresolved tokens ever reach the wire.
      expect(msg.body).not.toMatch(/\{\{/);
      expect(msg.subject).not.toMatch(/\{\{/);
    }
    // Sanity: the credits figure is display-only — no billing event exists.
    expect(GUIDED_EMAIL_CREDITS).toBe(2);
  });

  it("compose runs AFTER the idempotency check — a replay never re-spends a model call", async () => {
    toolCalls = 0;
    const again = await acts.sendEnrollmentStep(guidedParams(enrollA, contactA));
    expect(again.kind).toBe("duplicate");
    expect(toolCalls).toBe(0);
  });

  it("neverSay slip on attempt 1 → bounded retry heals → SENT (2 model calls)", async () => {
    misbehave = { kind: "ban", until: "once" };
    const out = await acts.sendEnrollmentStep(guidedParams(enrollA, contactA, "email-g2"));
    expect(out.kind).toBe("sent");
    expect(toolCalls).toBe(2);
    const msg = await owner.message.findUniqueOrThrow({ where: { id: out.messageId } });
    expect(msg.body.toLowerCase()).not.toContain(BANNED);
  });

  it("SUBJECT-CHECK REFUSAL: clickbait/caps/bang subject after the retry → typed SUBJECT_RULE, lead PAUSED + email event, ZERO sends", async () => {
    misbehave = { kind: "subject", until: "always" };
    const before = await owner.message.count({ where: { workspaceId: ws } });
    const err = await acts
      .sendEnrollmentStep(guidedParams(enrollB, contactB, "email-g3"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).type).toBe("ComposeRefusedError");
    const detail = (err as ApplicationFailure).details?.[0] as { reason?: string; detail?: string };
    expect(detail.reason).toBe("SUBJECT_RULE");
    expect(detail.detail).toContain('"quick question"');
    expect(toolCalls).toBe(2); // exactly ONE bounded retry
    expect(await owner.message.count({ where: { workspaceId: ws } })).toBe(before); // unchecked copy never sent

    // …the workflow then records it: pause THAT lead + the channel-aware event.
    await acts.recordComposeRefused({
      workspaceId: ws,
      enrollmentId: enrollB,
      contactId: contactB,
      campaignId,
      nodeId: "email-g3",
      channel: "email",
      reason: "SUBJECT_RULE",
      detail: detail.detail ?? "",
    });
    const enrollment = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollB } });
    expect(enrollment.status).toBe("PAUSED");
    expect(enrollment.meta).toMatchObject({
      blocked: { nodeId: "email-g3", reason: "SUBJECT_RULE" },
    });
    expect(refusals).toContainEqual(
      expect.objectContaining({ stepNodeId: "email-g3", channel: "email", reason: "SUBJECT_RULE" }),
    );
    // Reset for later tests: the pause is real data; un-pause the fixture lead.
    await owner.enrollment.update({ where: { id: enrollB }, data: { status: "ACTIVE", meta: {} } });
  });

  it("COMPOSED-FOOTER REFUSAL: the composer writing unsubscribe language is a check failure — the footer stays the boundary's job", async () => {
    misbehave = { kind: "footer", until: "always" };
    const err = await acts
      .sendEnrollmentStep(guidedParams(enrollB, contactB, "email-g4"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(((err as ApplicationFailure).details?.[0] as { reason?: string }).reason).toBe(
      "COMPOSED_FOOTER",
    );
    expect(toolCalls).toBe(2);
  });

  it("no composer configured → typed COMPOSER_UNCONFIGURED refusal; scripted email regression stays byte-identical (honest absence)", async () => {
    const bare = createActivities({
      prisma: app,
      transport,
      allowlist: [`ada-${suffix}@allowed.test`, `ben-${suffix}@allowed.test`],
      now: IN_WINDOW,
    });
    const err = await bare
      .sendEnrollmentStep(guidedParams(enrollA, contactA, "email-g5"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(((err as ApplicationFailure).details?.[0] as { reason?: string }).reason).toBe(
      "COMPOSER_UNCONFIGURED",
    );

    // Scripted regression on the SAME bare deps: full copy sends untouched,
    // meta carries NO provenance keys (byte-identical to pre-G2), tokens
    // resolve at the boundary exactly as before.
    const out = await bare.sendEnrollmentStep({
      workspaceId: ws,
      enrollmentId: enrollA,
      campaignId,
      agentId,
      contactId: contactA,
      senderId: emailSenderId,
      stepNodeId: "email-scripted",
      content: { subject: "A note for {{company}}", body: "Hi {{firstName}}, one thought from {{senderName}}." },
      channel: "email",
    });
    expect(out.kind).toBe("sent");
    const msg = await owner.message.findUniqueOrThrow({ where: { id: out.messageId } });
    expect(msg.subject).toBe("A note for Bright Ortho");
    expect(msg.body).toContain("Ada");
    expect(msg.body).toContain("Clinic Agent");
    expect(msg.body.match(/Unsubscribe:/g)).toHaveLength(1); // the boundary footer, as always
    const meta = msg.meta as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(["senderId", "threaded"]);
  });

  it("MIXED-MODE SEQUENCE: scripted step 1 + guided step 2 execute correctly on one enrollment", async () => {
    // A dedicated lead — enrollments are unique per (campaign, contact).
    const cara = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "test",
        optOut: {},
        tags: [],
        email: `cara-${suffix}@allowed.test`,
        firstName: "Cara",
        company: "Hilltop Smiles",
      },
    });
    const enrollC = await owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId: cara.id,
        workflowId: `enroll-c-${suffix}`,
        pipelineStage: "new",
        meta: {},
      },
    });
    const mixedActs = createActivities({
      prisma: app,
      transport,
      allowlist: [`cara-${suffix}@allowed.test`],
      now: IN_WINDOW,
      composeEmail: createEmailStepComposer({ prisma: app, gateway }),
    });
    // Step 1 — SCRIPTED: exact saved copy through the boundary; meta clean.
    const s1 = await mixedActs.sendEnrollmentStep({
      workspaceId: ws,
      enrollmentId: enrollC.id,
      campaignId,
      agentId,
      contactId: cara.id,
      senderId: emailSenderId,
      stepNodeId: "mixed-s1",
      content: { subject: "Your booking flow, {{firstName}}", body: "Hi {{firstName}}, a first note for {{company}}." },
      channel: "email",
    });
    expect(s1.kind).toBe("sent");
    const scripted = await owner.message.findUniqueOrThrow({ where: { id: s1.messageId } });
    expect(Object.keys(scripted.meta as object).sort()).toEqual(["senderId", "threaded"]);

    // Step 2 — GUIDED follow-up on the SAME enrollment: composes (the fake
    // sees the step-1 history), sends through the same rails, guided meta.
    toolCalls = 0;
    const s2 = await mixedActs.sendEnrollmentStep({
      ...guidedParams(enrollC.id, cara.id, "mixed-g2"),
      position: { index: 2, count: 2 },
    });
    expect(s2.kind).toBe("sent");
    expect(toolCalls).toBe(1);
    // Position mapped to the ladder's LAST role (step 2 of 2 = BREAKUP).
    expect(lastPrompt).toContain("step 2 of 2 — BREAKUP");
    // The prior scripted send reached the composer as history.
    expect(lastPrompt).toContain("[email · we sent]");
    const guided = await owner.message.findUniqueOrThrow({ where: { id: s2.messageId } });
    expect(guided.meta).toMatchObject({
      mode: "guided",
      briefVersion: 4,
      composerVersion: "composer.email@v1",
    });
    expect(guided.body.match(/Unsubscribe:/g)).toHaveLength(1);
    // Both sends live on one enrollment (order proven by the history line
    // above — the injectable clock gives them identical sentAt values).
    const rows = await owner.message.findMany({
      where: { workspaceId: ws, enrollmentId: enrollC.id },
    });
    expect(rows.map((r) => r.stepNodeId).sort()).toEqual(["mixed-g2", "mixed-s1"]);
  });
});
