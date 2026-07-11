/**
 * G1 (DEC-068) live guided-SMS proof — the brain is REAL, the wire is not:
 * a real Sonnet-class composer (Key Vault ANTHROPIC-API-KEY) renders two
 * leads' SMS from ONE brief through the full activity path — compose →
 * deterministic checks → the unchanged sendSmsStep rails → Message persisted
 * with provenance meta — with the Twilio transport in SANDBOX (DEC-060a/061
 * discipline: no network send, deterministic provider ids; carrier delivery
 * was P2.1's proof and is not re-litigated here).
 *
 * Script-enforced gates (§G style):
 *   1. VARIETY    — two leads, same step → DIFFERENT texts, each personalized.
 *   2. GROUNDING  — the context fact appears in both (mustSay makes the
 *                   deterministic checker enforce it — a passing compose
 *                   PROVES it, model whims can't wiggle out).
 *   3. CAGE       — ≤300 chars composed, zero {{tokens}}, opt-out line
 *                   appended by the boundary, provenance meta persisted.
 *   4. REFUSAL    — a trap brief (mustSay ∩ neverSay) makes EVERY possible
 *                   output fail a check → bounded retry → typed refusal →
 *                   enrollment PAUSED + meta.blocked + a REAL
 *                   sms.compose_refused.v1 Event row through the bus.
 * Runs only in the guided-sms-live-proof GitHub workflow; never CI.
 */
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import {
  createSmsStepComposer,
  SMS_COMPOSE_MAX_CHARS,
  SMS_OPT_OUT_LINE,
  TwilioSmsSender,
  type EmailSender,
} from "@clientforce/channels";
import type { StepBrief } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient } from "@clientforce/db";
import { bullConnectionFromUrl, EventBus } from "@clientforce/events";
import { createActivities } from "../src/activities";

const FACT = "free growth audit";
const PHONE_A = "+15005550101";
const PHONE_B = "+15005550102";

const BRIEF: StepBrief = {
  objective: "Earn a quick yes/no reply about the audit",
  talkingPoints: [
    `the ${FACT} shows where bookings leak`,
    "results land within 7 days",
    "no commitment to take a look",
  ],
  mustSay: [FACT],
};

/** Every output fails either MUST_SAY (absent) or NEVER_SAY (present). */
const TRAP_BRIEF: StepBrief = {
  objective: "Earn a reply about the audit",
  talkingPoints: [`the ${FACT} shows where bookings leak`, "results in 7 days", "easy to start"],
  mustSay: [FACT],
  neverSay: [FACT],
};

function gate(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "✓" : "✗"} GATE ${name}: ${detail}`);
  if (!ok) throw new Error(`GATE FAILED: ${name} — ${detail}`);
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("GATE FAILED: ANTHROPIC_API_KEY missing (Key Vault ANTHROPIC-API-KEY)");
  }
  if (process.env.SMS_SANDBOX === "false") {
    throw new Error("GATE FAILED: this proof runs the transport in SANDBOX only — unset SMS_SANDBOX");
  }

  console.log("\n=== G1 GUIDED SMS PROOF (real Sonnet compose · sandbox transport) ===");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const gateway = new AiGateway({ provider: new AnthropicProvider() });
  const emailStub: EmailSender = {
    send: async () => ({ providerMessageId: "<unused@proof>" }),
  };

  const suffix = `g1-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "g1-proof", slug: suffix, settings: {} },
  });

  const bus = process.env.REDIS_URL
    ? new EventBus({ prisma: app, connection: bullConnectionFromUrl(process.env.REDIS_URL) })
    : undefined;

  try {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Guided Proof Agent",
        goal: "book_appointments",
        category: "Dental & Orthodontics",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
          dailyCap: { email: 10, sms: 10 },
          consent: null,
          composeMode: "guided",
          strategy: { neverSay: ["industry-leading"] },
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws.id, agentId: agent.id, name: "primary", graphId: "" },
    });
    // The composer's ONLY permitted fact source (DEC-015 ported).
    await owner.businessContext.create({
      data: {
        workspaceId: ws.id,
        agentId: null,
        status: "READY",
        fields: {
          offer: { value: `We book dental appointments with a ${FACT}.`, citations: [], source: "typed" },
          proof_points: { value: "37 booked appointments in the first week for a Dallas practice.", citations: [], source: "typed" },
        },
      },
    });
    await owner.senderConnection.create({
      data: { workspaceId: ws.id, type: "TWILIO_SMS", fromEmail: "+15005550006", fromName: "Proof SMS" },
    });
    const emailSender = await owner.senderConnection.create({
      data: { workspaceId: ws.id, type: "CF_MANAGED", fromEmail: "proof@send.test", fromName: "Proof" },
    });
    const [ada, ben, cara] = await Promise.all([
      owner.contact.create({
        data: { workspaceId: ws.id, source: "proof", optOut: {}, tags: [], email: `ada-${suffix}@proof.test`, firstName: "Ada", company: "Bright Ortho", phone: PHONE_A },
      }),
      owner.contact.create({
        data: { workspaceId: ws.id, source: "proof", optOut: {}, tags: [], email: `ben-${suffix}@proof.test`, firstName: "Ben", company: "Lakeside Dental", phone: PHONE_B },
      }),
      // The trap lead — enrollments are unique per (campaign, contact).
      owner.contact.create({
        data: { workspaceId: ws.id, source: "proof", optOut: {}, tags: [], email: `cara-${suffix}@proof.test`, firstName: "Cara", company: "Hilltop Smiles", phone: PHONE_A },
      }),
    ]);
    const enroll = (contactId: string, n: string) =>
      owner.enrollment.create({
        data: { workspaceId: ws.id, campaignId: campaign.id, contactId, workflowId: `g1-proof-${n}-${suffix}`, pipelineStage: "new", meta: {} },
      });
    const [enrollA, enrollB, enrollC] = await Promise.all([
      enroll(ada.id, "a"),
      enroll(ben.id, "b"),
      enroll(cara.id, "c"),
    ]);

    const refusals: Array<{ stepNodeId: string; reason: string }> = [];
    const acts = createActivities({
      prisma: app,
      transport: emailStub,
      smsTransport: new TwilioSmsSender(), // SANDBOX default ON — no network
      smsAllowlist: [PHONE_A, PHONE_B],
      composeSms: createSmsStepComposer({ prisma: app, gateway }),
      publishComposeRefused: async (e) => {
        refusals.push({ stepNodeId: e.stepNodeId, reason: e.reason });
        if (bus) {
          await bus.publish({
            type: "sms.compose_refused.v1",
            workspaceId: e.workspaceId,
            contactId: e.contactId,
            enrollmentId: e.enrollmentId,
            campaignId: e.campaignId,
            payload: { stepNodeId: e.stepNodeId, reason: e.reason, ...(e.detail ? { detail: e.detail } : {}) },
          });
        }
      },
    });

    const send = (enrollmentId: string, contactId: string, stepNodeId: string, brief: StepBrief) =>
      acts.sendEnrollmentStep({
        workspaceId: ws.id,
        enrollmentId,
        campaignId: campaign.id,
        agentId: agent.id,
        contactId,
        senderId: emailSender.id,
        stepNodeId,
        content: {},
        channel: "sms",
        mode: "guided",
        brief,
        graphVersion: 1,
      });

    // ── 1+2+3: two leads, one brief, real Sonnet, full rails ────────────────
    const outA = await send(enrollA.id, ada.id, "sms-guided-1", BRIEF);
    const outB = await send(enrollB.id, ben.id, "sms-guided-1", BRIEF);
    const [msgA, msgB] = await Promise.all([
      owner.message.findUniqueOrThrow({ where: { id: outA.messageId } }),
      owner.message.findUniqueOrThrow({ where: { id: outB.messageId } }),
    ]);
    console.log(`\n— Ada's SMS  (${msgA.body.length} chars):\n${msgA.body}`);
    console.log(`\n— Ben's SMS  (${msgB.body.length} chars):\n${msgB.body}\n`);

    gate("VARIETY", msgA.body !== msgB.body, "two leads on the same step produced different texts");
    const personalized = (body: string, first: string, company: string) =>
      body.includes(first) || body.includes(company);
    gate(
      "PERSONALIZATION",
      personalized(msgA.body, "Ada", "Bright Ortho") && personalized(msgB.body, "Ben", "Lakeside Dental"),
      "each text carries its own lead's name or company",
    );
    gate(
      "GROUNDING",
      msgA.body.toLowerCase().includes(FACT) && msgB.body.toLowerCase().includes(FACT),
      `the context fact "${FACT}" appears in both (mustSay-enforced by the deterministic checker)`,
    );
    const cage = (m: { body: string; meta: unknown }) => {
      const composedLen = m.body.replace(`\n${SMS_OPT_OUT_LINE}`, "").length;
      const meta = m.meta as Record<string, unknown>;
      return (
        composedLen <= SMS_COMPOSE_MAX_CHARS &&
        !/\{\{/.test(m.body) &&
        m.body.includes(SMS_OPT_OUT_LINE) &&
        meta.mode === "guided" &&
        meta.briefVersion === 1 &&
        meta.composerVersion === "composer.sms@v1"
      );
    };
    gate(
      "CAGE",
      cage(msgA) && cage(msgB),
      `≤${SMS_COMPOSE_MAX_CHARS} chars composed · zero merge tokens · boundary opt-out line · provenance meta {mode, briefVersion, composerVersion}`,
    );

    // ── 4: the trap brief — EVERY output fails a check → typed refusal ──────
    const before = await owner.message.count({ where: { workspaceId: ws.id } });
    let refusedType = "";
    let refusedReason = "";
    try {
      await send(enrollC.id, enrollC.contactId, "sms-guided-trap", TRAP_BRIEF);
    } catch (err) {
      const e = err as { type?: string; details?: Array<{ reason?: string }> };
      refusedType = e.type ?? "";
      refusedReason = e.details?.[0]?.reason ?? "";
    }
    gate(
      "REFUSAL-TYPED",
      refusedType === "ComposeRefusedError" &&
        (refusedReason === "MUST_SAY_MISSING" || refusedReason === "NEVER_SAY_VIOLATION"),
      `trap brief refused after the bounded retry (${refusedType}/${refusedReason})`,
    );
    gate(
      "REFUSAL-NO-SEND",
      (await owner.message.count({ where: { workspaceId: ws.id } })) === before,
      "zero Message rows from the refused compose — never an unchecked send",
    );
    await acts.recordComposeRefused({
      workspaceId: ws.id,
      enrollmentId: enrollC.id,
      contactId: enrollC.contactId,
      campaignId: campaign.id,
      nodeId: "sms-guided-trap",
      reason: refusedReason,
      detail: "guided-sms-live-proof trap brief",
    });
    const paused = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollC.id } });
    const blocked = (paused.meta as { blocked?: { reason?: string } }).blocked;
    gate(
      "REFUSAL-PAUSES",
      paused.status === "PAUSED" && blocked?.reason === refusedReason,
      `enrollment PAUSED with meta.blocked.reason=${blocked?.reason}`,
    );
    if (bus) {
      const event = await owner.event.findFirst({
        where: { workspaceId: ws.id, type: "sms.compose_refused.v1" },
      });
      gate(
        "REFUSAL-LOGS-ROW",
        Boolean(event) &&
          (event!.payload as { stepNodeId?: string }).stepNodeId === "sms-guided-trap",
        "sms.compose_refused.v1 Event row persisted through the REAL bus (the Logs tab's amber row)",
      );
    } else {
      console.log("• REDIS_URL absent — bus-persisted Event row not exercised this run (hook firing asserted)");
      gate("REFUSAL-HOOK", refusals.some((r) => r.stepNodeId === "sms-guided-trap"), "publishComposeRefused hook fired");
    }

    console.log("\n=== ALL GATES PASSED ===");
  } finally {
    await owner.message.deleteMany({ where: { workspaceId: ws.id } }).catch(() => {});
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await bus?.close().catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
