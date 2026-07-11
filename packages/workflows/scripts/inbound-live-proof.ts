/**
 * P1.7 live verification (§G): the loop, closed for real — enroll → REAL
 * SendGrid sandbox send → simulated inbound reply at the parse boundary →
 * REAL Sonnet classification → email.replied.v1 on the REAL bus (Redis) →
 * temporal-signal consumer → the workflow branch routes → stage change.
 * Then the unsubscribe path: a "remove me" reply → opt-out + Suppression +
 * enrollment UNSUBSCRIBED + the durable run cancelled.
 *
 * Gates (exit 1 on any miss):
 *   1. reply classified `interested` by the REAL model; intent persisted on
 *      the INBOUND Message (A6);
 *   2. `email.replied.v1` Event row persisted with that intent;
 *   3. the workflow received the signal and completed via the interested
 *      branch — enrollment DONE, pipeline `booked`; `lead.stage_changed.v1`
 *      Event row persisted;
 *   4. (M1b, DEC-068) the pinned fixture MATRIX: every classifier-v2 emission
 *      label's pinned reply classifies to its pin with the REAL model;
 *   5. (M1b) the objection path end-to-end on the six-case playbook graph:
 *      objection_price reply → REAL classify → branch routes the VALUE-REFRAME
 *      step (stage `replied`) → reframe SENT (threaded) → interested reply →
 *      branch → enrollment DONE, stage `booked`;
 *   6. (M1b) not_interested reply → graceful-close step SENT → enrollment
 *      DONE, stage `lost`, and NO suppression / NO opt-out (≠ unsubscribe);
 *   7. unsubscribe reply classified `unsubscribe` → Contact.optOut +
 *      Suppression + enrollment UNSUBSCRIBED + workflow CANCELLED +
 *      `lead.unsubscribed.v1` Event row (runs LAST — its suppression of the
 *      shared allow-listed inbox would block every later send).
 * §G: allow-listed inbox only, sandbox mode, root-domain DNS untouched.
 */
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import {
  classifyReply,
  createClassifyQueue,
  createClassifyWorker,
  fixtureFor,
  ingestInboundEmail,
  MULTILINGUAL_REPLY_FIXTURES,
  normalizeInboundParse,
  REPLY_INTENT_FIXTURES,
  SendGridSender,
  type EmailSender,
  type RenderedEmail,
  type SenderConnection,
} from "@clientforce/channels";
import type { CampaignGraph } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient } from "@clientforce/db";
import {
  automationsConsumer,
  createTemporalSignalConsumer,
  dispatcherConsumer,
  EventBus,
  redisOptionsFromUrl,
} from "@clientforce/events";
import { createActivities } from "../src/activities";
import { cancelEnrollmentWorkflow, signalEnrollmentReply } from "../src/client";
import { TASK_QUEUE, workflowIdFor, type CampaignWorkflowInput } from "../src/shared";

const TEST_INBOX = process.env.LIVE_PROOF_INBOX ?? "tronwebng@gmail.com";
const ADDRESS = process.env.LIVE_PROOF_ADDRESS ?? "Clientforce, Lagos, Nigeria";

class RecordingTransport implements EmailSender {
  readonly sent: Array<{ email: RenderedEmail; rfcMessageId?: string }> = [];
  constructor(private readonly inner: EmailSender) {}
  async send(email: RenderedEmail, sender: SenderConnection) {
    const result = await this.inner.send(email, sender);
    this.sent.push({ email, rfcMessageId: result.rfcMessageId });
    return result;
  }
}

const t0 = Date.now();
const stamp = (msg: string): void =>
  console.log(`[t+${String(Date.now() - t0).padStart(6, " ")}ms] ${msg}`);

const until = async <T>(fn: () => Promise<T | null | undefined>, what: string, ms = 90_000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
};

async function main(): Promise<void> {
  for (const env of ["SENDGRID_API_KEY", "ANTHROPIC_API_KEY", "REDIS_URL"]) {
    if (!process.env[env]) throw new Error(`${env} missing`);
  }
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const transport = new RecordingTransport(new SendGridSender(undefined, /* sandbox */ true));
  const gateway = new AiGateway({
    provider: new AnthropicProvider(),
    // The classifier never embeds; a stub keeps OPENAI out of this proof.
    embeddings: {
      embed: async () => ({ vectors: [], usage: { inputTokens: 0, outputTokens: 0 } }),
    },
  });

  console.log("Starting local Temporal dev server…");
  const env = await TestWorkflowEnvironment.createLocal();
  const redis = redisOptionsFromUrl(process.env.REDIS_URL!);
  const queueName = `proof.events.${Date.now()}`;

  const suffix = `inb-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "proof", slug: suffix, settings: {} },
  });

  // Bus with the REAL temporal-signal consumer, signalling through the dev server.
  const bus = new EventBus({
    prisma: app,
    connection: redis,
    queueName,
    consumers: [
      createTemporalSignalConsumer(async (enrollmentId, intent) => {
        await signalEnrollmentReply(env.client, enrollmentId, intent);
        stamp(`SIGNAL delivered: enrollment=${enrollmentId} intent=${intent}`);
      }),
      automationsConsumer,
      dispatcherConsumer,
    ],
  });
  bus.startConsumer();
  const classifyQueue = createClassifyQueue(redis);
  const classifier = createClassifyWorker({
    prisma: app,
    gateway,
    bus,
    stopWorkflow: async (enrollmentId) => {
      await cancelEnrollmentWorkflow(env.client, enrollmentId);
      stamp(`WORKFLOW cancelled for enrollment=${enrollmentId}`);
    },
    connection: redis,
  });

  try {
    // ── M1b (DEC-068) gate 4: the pinned fixture matrix vs the REAL model ────
    console.log("\n=== M1b LIVE PROOF · classifier-v2 pinned fixture matrix ===");
    for (const fixture of REPLY_INTENT_FIXTURES) {
      const verdict = await classifyReply(gateway, {
        goal: "book_appointments",
        replyText: fixture.reply,
        engagement: [],
      });
      stamp(`fixture "${fixture.reply.slice(0, 48)}…" → ${verdict}`);
      if (verdict !== fixture.intent)
        throw new Error(`fixture pin missed: expected "${fixture.intent}", got "${verdict}"`);
    }
    stamp(`fixture matrix ✓ — all ${REPLY_INTENT_FIXTURES.length} labels pinned by the REAL model`);

    // ── L1 (DEC-071): the multilingual pins vs the REAL model — a German and
    // a French reply classify to their pinned intents with ZERO classifier
    // code change (the understanding side of the loop is language-agnostic).
    console.log("\n=== L1 LIVE PROOF · multilingual pinned fixtures ===");
    for (const fixture of MULTILINGUAL_REPLY_FIXTURES) {
      const verdict = await classifyReply(gateway, {
        goal: "book_appointments",
        replyText: fixture.reply,
        engagement: [],
      });
      stamp(`[${fixture.language}] "${fixture.reply.slice(0, 48)}…" → ${verdict}`);
      if (verdict !== fixture.intent)
        throw new Error(
          `multilingual pin missed (${fixture.language}): expected "${fixture.intent}", got "${verdict}"`,
        );
    }
    stamp(`multilingual matrix ✓ — ${MULTILINGUAL_REPLY_FIXTURES.length} pins held by the REAL model`);

    console.log("\n=== P1.7 LIVE PROOF · inbound → classify → signal ===");
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Demo Booker",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
          dailyCap: { email: 20 },
          consent: null,
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws.id, agentId: agent.id, name: "primary", graphId: "" },
    });
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws.id,
        type: "CF_MANAGED",
        fromEmail: "agent@send.clientforce.io",
        fromName: "Clientforce Demo Agent",
        replyTo: "inbound@reply.clientforce.io",
      },
    });
    await owner.businessContext.create({
      data: {
        workspaceId: ws.id,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } },
      },
    });

    const graph: CampaignGraph = {
      entry: "s1",
      nodes: [
        {
          id: "s1",
          type: "step",
          channel: "email",
          content: {
            subject: "A quick idea for {{company}}",
            body: "Hi {{firstName}}, P1.7 live proof — reply and the loop closes.\n\n— {{senderName}}",
          },
          pipelineOnSend: "contacted",
        },
        {
          id: "br",
          type: "branch",
          on: "reply",
          cases: [
            { when: { intent: "interested" }, goto: "end-a", pipeline: "booked" },
            { when: { intent: "unsubscribe" }, goto: "end-b" },
            { when: "default", goto: "end-b" },
          ],
        },
        { id: "end-a", type: "end" },
        { id: "end-b", type: "end" },
      ],
      edges: [{ from: "s1", to: "br" }],
    };

    // M1b (DEC-068): the v4-planner-shaped graph — six-case REPLY PLAYBOOK,
    // price/info paths rejoin the branch, not_interested closes as `lost`.
    const playbookGraph: CampaignGraph = {
      entry: "s1",
      nodes: [
        {
          id: "s1",
          type: "step",
          channel: "email",
          content: {
            subject: "A quick idea for {{company}}",
            body: "Hi {{firstName}}, M1b live proof — object to the price and watch the reframe.\n\n— {{senderName}}",
          },
          pipelineOnSend: "contacted",
        },
        {
          id: "br",
          type: "branch",
          on: "reply",
          cases: [
            { when: { intent: "interested" }, goto: "end-a", pipeline: "booked" },
            { when: { intent: "objection_price" }, goto: "s-reframe", pipeline: "replied" },
            { when: { intent: "objection_timing" }, goto: "s-ack", pipeline: "replied" },
            { when: { intent: "wrong_person" }, goto: "s-referral", pipeline: "replied" },
            { when: { intent: "info_request" }, goto: "s-answer", pipeline: "replied" },
            { when: { intent: "not_interested" }, goto: "s-close", pipeline: "lost" },
            { when: "default", goto: "end-b" },
          ],
        },
        {
          id: "s-reframe",
          type: "step",
          channel: "email",
          content: {
            body: "Fair concern, {{firstName}} — the audit shows the number before you spend anything. Worth seeing it?",
            threaded: true,
          },
        },
        { id: "s-ack", type: "step", channel: "email", content: { body: "Understood — I'll circle back, {{firstName}}.", threaded: true } },
        { id: "d-ack", type: "delay", amount: 30, unit: "days" },
        { id: "s-follow", type: "step", channel: "email", content: { body: "Circling back as promised, {{firstName}}.", threaded: true } },
        { id: "s-referral", type: "step", channel: "email", content: { body: "Who should I speak with instead, {{firstName}}?", threaded: true } },
        { id: "s-answer", type: "step", channel: "email", content: { body: "Good question — here's the short answer, {{firstName}}.", threaded: true } },
        {
          id: "s-close",
          type: "step",
          channel: "email",
          content: {
            body: "All good, {{firstName}} — closing this out. The door stays open.",
            threaded: true,
          },
        },
        { id: "end-a", type: "end" },
        { id: "end-b", type: "end" },
      ],
      edges: [
        { from: "s1", to: "br" },
        { from: "s-reframe", to: "br" }, // loop-back: await the NEXT reply
        { from: "s-ack", to: "d-ack" },
        { from: "d-ack", to: "s-follow" },
        { from: "s-follow", to: "br" },
        { from: "s-referral", to: "end-b" },
        { from: "s-answer", to: "br" },
        { from: "s-close", to: "end-b" },
      ],
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
      activities: createActivities({
        prisma: app,
        transport,
        allowlist: [TEST_INBOX],
        publishStageChanged: async (change) => {
          await bus.publish({
            type: "lead.stage_changed.v1",
            workspaceId: change.workspaceId,
            contactId: change.contactId,
            enrollmentId: change.enrollmentId,
            campaignId: change.campaignId,
            payload: { fromStage: change.fromStage, toStage: change.toStage },
          });
        },
      }),
    });

    const enroll = async (firstName: string, enrollGraph: CampaignGraph = graph) => {
      const contact = await owner.contact.create({
        data: {
          workspaceId: ws.id,
          source: "live-proof",
          optOut: {},
          tags: [],
          email: TEST_INBOX,
          firstName,
          company: "Tronweb",
        },
      });
      const enrollment = await owner.enrollment.create({
        data: {
          workspaceId: ws.id,
          campaignId: campaign.id,
          contactId: contact.id,
          workflowId: `pending-${contact.id}`,
          pipelineStage: "new",
          meta: {},
        },
      });
      await owner.enrollment.update({
        where: { id: enrollment.id },
        data: { workflowId: workflowIdFor(enrollment.id) },
      });
      const input: CampaignWorkflowInput = {
        workspaceId: ws.id,
        enrollmentId: enrollment.id,
        campaignId: campaign.id,
        agentId: agent.id,
        contactId: contact.id,
        senderId: sender.id,
        graph: enrollGraph,
      };
      const handle = await env.client.workflow.start("campaignWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId: workflowIdFor(enrollment.id),
        args: [input],
      });
      return { contact, enrollment, handle };
    };

    const reply = async (contactEmail: string, rfcMessageId: string, text: string) => {
      const inbound = normalizeInboundParse({
        from: `Godswill <${contactEmail}>`,
        to: "agent@reply.clientforce.io",
        subject: "Re: A quick idea for Tronweb",
        text,
        headers: `In-Reply-To: ${rfcMessageId}`,
      });
      const result = await ingestInboundEmail({ owner, app }, inbound);
      if (!result) throw new Error("inbound reply did not resolve to a thread");
      await classifyQueue.add("classify", {
        workspaceId: result.resolution.workspaceId,
        messageId: result.message.id,
      });
      return result.message;
    };

    await worker.runUntil(async () => {
      // ── Lead 1: interested → branch → booked ────────────────────────────
      const one = await enroll("Godswill");
      stamp("lead 1 enrolled; workflow started");
      await until(async () => (transport.sent.length >= 1 ? true : null), "step-1 send");
      const firstSend = transport.sent[0]!;
      stamp(`step-1 SENT (sandbox), wire Message-ID ${firstSend.rfcMessageId}`);

      const inboundMsg = await reply(
        one.contact.email!,
        firstSend.rfcMessageId!,
        "This sounds interesting — how do we book a call this week?",
      );
      stamp(`inbound reply ingested as INBOUND Message ${inboundMsg.id}; classify queued`);

      const classified = await until(
        async () => owner.message.findFirst({ where: { id: inboundMsg.id, intent: { not: null } } }),
        "classification",
      );
      stamp(`REAL classifier verdict: intent=${classified.intent}`);
      if (classified.intent !== "interested")
        throw new Error(`expected intent "interested", got "${classified.intent}"`);

      const repliedEvent = await until(
        async () =>
          owner.event.findFirst({
            where: { workspaceId: ws.id, type: "email.replied.v1", enrollmentId: one.enrollment.id },
          }),
        "email.replied.v1 Event row",
      );
      if ((repliedEvent.payload as { intent?: string }).intent !== "interested")
        throw new Error("email.replied.v1 payload does not carry the intent");
      stamp("email.replied.v1 persisted with intent ✓");

      const result = await one.handle.result();
      if (result.status !== "completed" || result.endNode !== "end-a")
        throw new Error(`expected completed@end-a, got ${JSON.stringify(result)}`);
      const row = await owner.enrollment.findUniqueOrThrow({ where: { id: one.enrollment.id } });
      if (row.status !== "DONE" || row.pipelineStage !== "booked")
        throw new Error(`enrollment wrong: status=${row.status} stage=${row.pipelineStage}`);
      const stageEvent = await until(
        async () =>
          owner.event.findFirst({
            where: { workspaceId: ws.id, type: "lead.stage_changed.v1", enrollmentId: one.enrollment.id },
          }),
        "lead.stage_changed.v1 Event row",
      );
      stamp(
        `branch gate: signal routed interested → end-a; enrollment DONE, pipeline booked; stage event ${JSON.stringify(stageEvent.payload)} ✓`,
      );

      // ── Lead 3 (M1b gate 5): objection_price → reframe → interested → booked
      const three = await enroll("Objector", playbookGraph);
      stamp("lead 3 enrolled on the six-case playbook graph");
      await until(async () => (transport.sent.length >= 2 ? true : null), "step-1 send (lead 3)");
      const openerSend = transport.sent[1]!;

      const objection = await reply(
        three.contact.email!,
        openerSend.rfcMessageId!,
        fixtureFor("objection_price").reply,
      );
      stamp(`price objection ingested as ${objection.id}; classify queued`);
      const classified3 = await until(
        async () => owner.message.findFirst({ where: { id: objection.id, intent: { not: null } } }),
        "objection classification",
      );
      stamp(`REAL classifier verdict: intent=${classified3.intent}`);
      if (classified3.intent !== "objection_price")
        throw new Error(`expected intent "objection_price", got "${classified3.intent}"`);

      // The branch routes the VALUE-REFRAME step — a real (sandbox) send.
      await until(async () => (transport.sent.length >= 3 ? true : null), "reframe send");
      const reframeSend = transport.sent[2]!;
      if (!/Fair concern/.test(reframeSend.email.body))
        throw new Error("send #3 is not the value-reframe step");
      const midRow = await owner.enrollment.findUniqueOrThrow({ where: { id: three.enrollment.id } });
      if (midRow.pipelineStage !== "replied")
        throw new Error(`expected stage "replied" after the objection, got "${midRow.pipelineStage}"`);
      stamp("branch routed objection_price → VALUE-REFRAME sent (threaded), stage replied ✓");

      // The reframe path rejoins the branch — the NEXT reply closes it.
      const turnaround = await reply(
        three.contact.email!,
        reframeSend.rfcMessageId!,
        fixtureFor("interested").reply,
      );
      const classified3b = await until(
        async () => owner.message.findFirst({ where: { id: turnaround.id, intent: { not: null } } }),
        "turnaround classification",
      );
      stamp(`REAL classifier verdict: intent=${classified3b.intent}`);
      if (classified3b.intent !== "interested")
        throw new Error(`expected intent "interested", got "${classified3b.intent}"`);
      const result3 = await three.handle.result();
      if (result3.status !== "completed" || result3.endNode !== "end-a")
        throw new Error(`expected completed@end-a, got ${JSON.stringify(result3)}`);
      const row3 = await owner.enrollment.findUniqueOrThrow({ where: { id: three.enrollment.id } });
      if (row3.status !== "DONE" || row3.pipelineStage !== "booked")
        throw new Error(`enrollment wrong: status=${row3.status} stage=${row3.pipelineStage}`);
      stamp("M1b gate 5 ✓ — objection_price → reframe → interested → booked, enrollment DONE");

      // ── Lead 4 (M1b gate 6): not_interested → graceful close → lost, NO suppression
      const four = await enroll("Decliner", playbookGraph);
      stamp("lead 4 enrolled on the six-case playbook graph");
      await until(async () => (transport.sent.length >= 4 ? true : null), "step-1 send (lead 4)");
      const suppressionsBefore = await owner.suppression.count({
        where: { workspaceId: ws.id, address: TEST_INBOX },
      });

      const decline = await reply(
        four.contact.email!,
        transport.sent[3]!.rfcMessageId!,
        fixtureFor("not_interested").reply,
      );
      const classified4 = await until(
        async () => owner.message.findFirst({ where: { id: decline.id, intent: { not: null } } }),
        "decline classification",
      );
      stamp(`REAL classifier verdict: intent=${classified4.intent}`);
      if (classified4.intent !== "not_interested")
        throw new Error(`expected intent "not_interested", got "${classified4.intent}"`);

      await until(async () => (transport.sent.length >= 5 ? true : null), "graceful-close send");
      if (!/door stays open/.test(transport.sent[4]!.email.body))
        throw new Error("send #5 is not the graceful-close step");
      const result4 = await four.handle.result();
      if (result4.status !== "completed" || result4.endNode !== "end-b")
        throw new Error(`expected completed@end-b, got ${JSON.stringify(result4)}`);
      const row4 = await owner.enrollment.findUniqueOrThrow({ where: { id: four.enrollment.id } });
      if (row4.status !== "DONE" || row4.pipelineStage !== "lost")
        throw new Error(`enrollment wrong: status=${row4.status} stage=${row4.pipelineStage}`);
      // not_interested ≠ unsubscribe: suppression stays STOP/unsubscribe-only.
      const suppressionsAfter = await owner.suppression.count({
        where: { workspaceId: ws.id, address: TEST_INBOX },
      });
      if (suppressionsAfter !== suppressionsBefore)
        throw new Error("not_interested must NEVER suppress — a Suppression row appeared");
      const contact4 = await owner.contact.findUniqueOrThrow({ where: { id: four.contact.id } });
      if ((contact4.optOut as { email?: boolean })?.email)
        throw new Error("not_interested must NEVER set optOut");
      stamp("M1b gate 6 ✓ — graceful close SENT, enrollment DONE @ stage lost, zero suppression/opt-out");

      // ── Lead 2: unsubscribe → opt-out + suppression + cancel ────────────
      const two = await enroll("Suppressme");
      stamp("lead 2 enrolled; workflow started");
      await until(async () => (transport.sent.length >= 6 ? true : null), "step-1 send (lead 2)");
      const secondSend = transport.sent[5]!;
      const inbound2 = await reply(
        two.contact.email!,
        secondSend.rfcMessageId!,
        "Please remove me from your list. Do not email me again.",
      );
      stamp(`unsubscribe reply ingested as ${inbound2.id}; classify queued`);

      const classified2 = await until(
        async () => owner.message.findFirst({ where: { id: inbound2.id, intent: { not: null } } }),
        "unsubscribe classification",
      );
      stamp(`REAL classifier verdict: intent=${classified2.intent}`);
      if (classified2.intent !== "unsubscribe")
        throw new Error(`expected intent "unsubscribe", got "${classified2.intent}"`);

      await until(
        async () =>
          owner.suppression.findFirst({ where: { workspaceId: ws.id, address: TEST_INBOX } }),
        "Suppression row",
      );
      const contact2 = await until(
        async () => {
          const c = await owner.contact.findUnique({ where: { id: two.contact.id } });
          return (c?.optOut as { email?: boolean })?.email ? c : null;
        },
        "Contact.optOut.email",
      );
      void contact2;
      const enrollment2 = await until(
        async () => {
          const e = await owner.enrollment.findUnique({ where: { id: two.enrollment.id } });
          return e?.status === "UNSUBSCRIBED" ? e : null;
        },
        "enrollment UNSUBSCRIBED",
      );
      void enrollment2;
      await until(
        async () =>
          owner.event.findFirst({
            where: { workspaceId: ws.id, type: "lead.unsubscribed.v1", contactId: two.contact.id },
          }),
        "lead.unsubscribed.v1 Event row",
      );
      const cancelled = await two.handle
        .result()
        .then(() => false)
        .catch(() => true);
      if (!cancelled) throw new Error("unsubscribe did not stop the workflow");
      stamp("unsubscribe gate: optOut + Suppression + UNSUBSCRIBED + workflow CANCELLED ✓");
    });

    console.log(
      "\n§G gate passed: enroll → sandbox send → reply → REAL classify → signal → branch → stage change, plus the unsubscribe stop path." +
        "\nM1b gates passed: pinned fixture matrix (all emission labels), objection_price → reframe → interested → booked, not_interested → lost with ZERO suppression.",
    );
    console.log("\n=== END LIVE PROOF ===");
  } finally {
    await classifier.close().catch(() => {});
    await classifyQueue.close().catch(() => {});
    await bus.close().catch(() => {});
    await env.teardown().catch(() => {});
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
