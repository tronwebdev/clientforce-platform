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
 *   4. unsubscribe reply classified `unsubscribe` → Contact.optOut +
 *      Suppression + enrollment UNSUBSCRIBED + workflow CANCELLED +
 *      `lead.unsubscribed.v1` Event row.
 * §G: allow-listed inbox only, sandbox mode, root-domain DNS untouched.
 */
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import {
  createClassifyQueue,
  createClassifyWorker,
  ingestInboundEmail,
  normalizeInboundParse,
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

    const enroll = async (firstName: string) => {
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
        graph,
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

      // ── Lead 2: unsubscribe → opt-out + suppression + cancel ────────────
      const two = await enroll("Suppressme");
      stamp("lead 2 enrolled; workflow started");
      await until(async () => (transport.sent.length >= 2 ? true : null), "step-1 send (lead 2)");
      const secondSend = transport.sent[1]!;
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
      "\n§G gate passed: enroll → sandbox send → reply → REAL classify → signal → branch → stage change, plus the unsubscribe stop path.",
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
