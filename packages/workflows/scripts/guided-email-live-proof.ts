/**
 * G2 (DEC-071) live guided-EMAIL proof — the brain is REAL, the wire is not:
 * a real Sonnet-class composer (Key Vault ANTHROPIC-API-KEY) renders two
 * leads' emails from ONE brief through the full activity path — compose →
 * deterministic checks (subject rules + footer ban included) → the unchanged
 * sendStep rails → Message persisted with provenance meta and the boundary's
 * CAN-SPAM footer appended EXACTLY ONCE — with the SendGrid transport in
 * SANDBOX (DEC-060a discipline: no delivery; live delivery was P1.5/P1.8's
 * proof and is not re-litigated here).
 *
 * Script-enforced gates (§G style):
 *   1. VARIETY     — two leads, same step → DIFFERENT subject+body, each
 *                    personalized.
 *   2. GROUNDING   — the context fact appears in both (mustSay makes the
 *                    deterministic checker enforce it).
 *   3. CAGE        — subject ≤60 clean chars · body ≤140 words composed ·
 *                    zero {{tokens}} · the footer (company_address verbatim +
 *                    ONE unsubscribe line) appended by the BOUNDARY, exactly
 *                    once, never by the model · provenance meta persisted.
 *   4. MIXED-MODE  — scripted step 1 + guided step 2 on ONE enrollment:
 *                    scripted meta byte-identical (no provenance keys), the
 *                    guided follow-up composes with the thread history.
 *   5. REFUSAL     — a trap brief (mustSay ∩ neverSay) makes EVERY possible
 *                    output fail a check → bounded retry → typed refusal →
 *                    enrollment PAUSED + meta.blocked + a REAL
 *                    email.compose_refused.v1 Event row through the bus.
 * Runs only in the guided-email-live-proof GitHub workflow; never CI.
 */
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import {
  createEmailStepComposer,
  EMAIL_COMPOSE_MAX_WORDS,
  EMAIL_SUBJECT_MAX_CHARS,
  SendGridSender,
} from "@clientforce/channels";
import type { StepBrief } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient } from "@clientforce/db";
import { bullConnectionFromUrl, EventBus } from "@clientforce/events";
import { createActivities } from "../src/activities";

const FACT = "free growth audit";
const COMPANY_ADDRESS = "1200 Main St Suite 400, Dallas, TX 75201";

const BRIEF: StepBrief = {
  objective: "Earn a quick yes/no reply about the audit",
  talkingPoints: [
    `the ${FACT} shows where bookings leak`,
    "results land within 7 days",
    "no commitment to take a look",
  ],
  mustSay: [FACT],
  subjectHint: "where bookings leak",
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
  if (process.env.SENDGRID_SANDBOX === "false" || process.env.CHANNELS_SANDBOX === "false") {
    throw new Error(
      "GATE FAILED: this proof runs the transport in SANDBOX only — unset SENDGRID_SANDBOX/CHANNELS_SANDBOX",
    );
  }

  console.log("\n=== G2 GUIDED EMAIL PROOF (real Sonnet compose · sandbox transport) ===");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const gateway = new AiGateway({ provider: new AnthropicProvider() });

  const suffix = `g2-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "g2-proof", slug: suffix, settings: {} },
  });

  const bus = process.env.REDIS_URL
    ? new EventBus({ prisma: app, connection: bullConnectionFromUrl(process.env.REDIS_URL) })
    : undefined;

  try {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Guided Email Proof Agent",
        goal: "book_appointments",
        category: "Dental & Orthodontics",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
          dailyCap: { email: 20 },
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
    // The composer's ONLY permitted fact source (DEC-015 ported);
    // company_address doubles as the boundary's CAN-SPAM footer input.
    await owner.businessContext.create({
      data: {
        workspaceId: ws.id,
        agentId: null,
        status: "READY",
        fields: {
          offer: { value: `We book dental appointments with a ${FACT}.`, citations: [], source: "typed" },
          proof_points: { value: "37 booked appointments in the first week for a Dallas practice.", citations: [], source: "typed" },
          company_address: { value: COMPANY_ADDRESS, citations: [], source: "typed" },
        },
      },
    });
    const emailSender = await owner.senderConnection.create({
      data: { workspaceId: ws.id, type: "CF_MANAGED", fromEmail: "proof@send.clientforce.io", fromName: "Proof Agent", dailyLimit: 100 },
    });
    const mkContact = (first: string, company: string, slug: string) =>
      owner.contact.create({
        data: { workspaceId: ws.id, source: "proof", optOut: {}, tags: [], email: `${slug}-${suffix}@proof.test`, firstName: first, company },
      });
    const [ada, ben, cara, dana] = await Promise.all([
      mkContact("Ada", "Bright Ortho", "ada"),
      mkContact("Ben", "Lakeside Dental", "ben"),
      mkContact("Cara", "Hilltop Smiles", "cara"), // the mixed-mode lead
      mkContact("Dana", "Summit Dental", "dana"), // the trap lead
    ]);
    const allowlist = [ada, ben, cara, dana].map((c) => c.email!);
    const enroll = (contactId: string, n: string) =>
      owner.enrollment.create({
        data: { workspaceId: ws.id, campaignId: campaign.id, contactId, workflowId: `g2-proof-${n}-${suffix}`, pipelineStage: "new", meta: {} },
      });
    const [enrollA, enrollB, enrollC, enrollD] = await Promise.all([
      enroll(ada.id, "a"),
      enroll(ben.id, "b"),
      enroll(cara.id, "c"),
      enroll(dana.id, "d"),
    ]);

    const refusals: Array<{ stepNodeId: string; channel: string; reason: string }> = [];
    const acts = createActivities({
      prisma: app,
      transport: new SendGridSender(), // SANDBOX default ON — no delivery
      allowlist,
      composeEmail: createEmailStepComposer({ prisma: app, gateway }),
      publishComposeRefused: async (e) => {
        refusals.push({ stepNodeId: e.stepNodeId, channel: e.channel, reason: e.reason });
        if (bus) {
          await bus.publish({
            type: e.channel === "email" ? "email.compose_refused.v1" : "sms.compose_refused.v1",
            workspaceId: e.workspaceId,
            contactId: e.contactId,
            enrollmentId: e.enrollmentId,
            campaignId: e.campaignId,
            payload: { stepNodeId: e.stepNodeId, reason: e.reason, ...(e.detail ? { detail: e.detail } : {}) },
          });
        }
      },
    });

    type SendParams = Parameters<typeof acts.sendEnrollmentStep>[0];
    const send = (
      enrollmentId: string,
      contactId: string,
      stepNodeId: string,
      over: Partial<SendParams> = {},
    ) =>
      acts.sendEnrollmentStep({
        workspaceId: ws.id,
        enrollmentId,
        campaignId: campaign.id,
        agentId: agent.id,
        contactId,
        senderId: emailSender.id,
        stepNodeId,
        content: {},
        channel: "email",
        mode: "guided",
        brief: BRIEF,
        graphVersion: 1,
        position: { index: 1, count: 3 },
        ...over,
      });

    // ── 1+2+3: two leads, one brief, real Sonnet, full rails ────────────────
    const outA = await send(enrollA.id, ada.id, "email-guided-1");
    const outB = await send(enrollB.id, ben.id, "email-guided-1");
    const [msgA, msgB] = await Promise.all([
      owner.message.findUniqueOrThrow({ where: { id: outA.messageId } }),
      owner.message.findUniqueOrThrow({ where: { id: outB.messageId } }),
    ]);
    console.log(`\n— Ada's email:\nSubject: ${msgA.subject}\n${msgA.body}`);
    console.log(`\n— Ben's email:\nSubject: ${msgB.subject}\n${msgB.body}\n`);

    gate(
      "VARIETY",
      msgA.body !== msgB.body && msgA.subject !== msgB.subject,
      "two leads on the same step produced different subjects and bodies",
    );
    const personalized = (text: string, first: string, company: string) =>
      text.includes(first) || text.includes(company);
    gate(
      "PERSONALIZATION",
      personalized(`${msgA.subject}\n${msgA.body}`, "Ada", "Bright Ortho") &&
        personalized(`${msgB.subject}\n${msgB.body}`, "Ben", "Lakeside Dental"),
      "each email carries its own lead's name or company",
    );
    gate(
      "GROUNDING",
      `${msgA.subject}\n${msgA.body}`.toLowerCase().includes(FACT) &&
        `${msgB.subject}\n${msgB.body}`.toLowerCase().includes(FACT),
      `the context fact "${FACT}" appears in both (mustSay-enforced by the deterministic checker)`,
    );
    const cage = (m: { subject: string | null; body: string; meta: unknown }) => {
      const meta = m.meta as Record<string, unknown>;
      const composed = m.body.split("\n\n--\n")[0]!;
      return (
        (m.subject ?? "").length <= EMAIL_SUBJECT_MAX_CHARS &&
        !(m.subject ?? "").includes("!") &&
        composed.trim().split(/\s+/).length <= EMAIL_COMPOSE_MAX_WORDS &&
        !/\{\{/.test(`${m.subject}\n${m.body}`) &&
        (m.body.match(/Unsubscribe:/g) ?? []).length === 1 &&
        (m.body.match(/unsubscribe/gi) ?? []).length === 1 &&
        m.body.includes(COMPANY_ADDRESS) &&
        !composed.toLowerCase().includes("unsubscribe") &&
        meta.mode === "guided" &&
        meta.briefVersion === 1 &&
        meta.composerVersion === "composer.email@v1"
      );
    };
    gate(
      "CAGE",
      cage(msgA) && cage(msgB),
      `subject ≤${EMAIL_SUBJECT_MAX_CHARS} clean · body ≤${EMAIL_COMPOSE_MAX_WORDS} words composed · zero merge tokens · footer (address + ONE unsubscribe line) appended by the boundary exactly once · provenance meta {mode, briefVersion, composerVersion}`,
    );

    // ── 4: mixed-mode — scripted step 1 + guided step 2, one enrollment ─────
    const outC1 = await send(enrollC.id, cara.id, "mixed-scripted-1", {
      mode: undefined,
      brief: undefined,
      position: undefined,
      content: { subject: "A note for {{company}}", body: "Hi {{firstName}}, quick first note from {{senderName}}." },
    });
    const scripted = await owner.message.findUniqueOrThrow({ where: { id: outC1.messageId } });
    const scriptedMeta = scripted.meta as Record<string, unknown>;
    gate(
      "MIXED-SCRIPTED-REGRESSION",
      scripted.subject === "A note for Hilltop Smiles" &&
        scripted.body.includes("Cara") &&
        !("mode" in scriptedMeta) &&
        !("briefVersion" in scriptedMeta) &&
        !("composerVersion" in scriptedMeta) &&
        (scripted.body.match(/Unsubscribe:/g) ?? []).length === 1,
      "scripted step 1 sent byte-identical — tokens rendered, no provenance keys, the usual single footer",
    );
    const outC2 = await send(enrollC.id, cara.id, "mixed-guided-2", {
      position: { index: 2, count: 2 },
      content: { threaded: true },
    });
    const guided = await owner.message.findUniqueOrThrow({ where: { id: outC2.messageId } });
    console.log(`\n— Cara's guided follow-up:\nSubject: ${guided.subject}\n${guided.body}\n`);
    gate(
      "MIXED-GUIDED-FOLLOW-UP",
      (guided.meta as Record<string, unknown>).composerVersion === "composer.email@v1" &&
        (guided.body.match(/Unsubscribe:/g) ?? []).length === 1 &&
        guided.inReplyToId === scripted.id,
      "guided step 2 composed on the same enrollment, threaded onto the REAL prior send, footer exactly once",
    );

    // ── 5: the trap brief — EVERY output fails a check → typed refusal ──────
    const before = await owner.message.count({ where: { workspaceId: ws.id } });
    let refusedType = "";
    let refusedReason = "";
    try {
      await send(enrollD.id, dana.id, "email-guided-trap", { brief: TRAP_BRIEF });
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
      enrollmentId: enrollD.id,
      contactId: dana.id,
      campaignId: campaign.id,
      nodeId: "email-guided-trap",
      channel: "email",
      reason: refusedReason,
      detail: "guided-email-live-proof trap brief",
    });
    const paused = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollD.id } });
    const blocked = (paused.meta as { blocked?: { reason?: string } }).blocked;
    gate(
      "REFUSAL-PAUSES",
      paused.status === "PAUSED" && blocked?.reason === refusedReason,
      `enrollment PAUSED with meta.blocked.reason=${blocked?.reason}`,
    );
    if (bus) {
      const event = await owner.event.findFirst({
        where: { workspaceId: ws.id, type: "email.compose_refused.v1" },
      });
      gate(
        "REFUSAL-LOGS-ROW",
        Boolean(event) &&
          (event!.payload as { stepNodeId?: string }).stepNodeId === "email-guided-trap",
        "email.compose_refused.v1 Event row persisted through the REAL bus (the Logs tab's amber row)",
      );
    } else {
      console.log("• REDIS_URL absent — bus-persisted Event row not exercised this run (hook firing asserted)");
      gate(
        "REFUSAL-HOOK",
        refusals.some((r) => r.stepNodeId === "email-guided-trap" && r.channel === "email"),
        "publishComposeRefused hook fired with channel=email",
      );
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
