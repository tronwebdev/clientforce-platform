import { NativeConnection, Worker } from "@temporalio/worker";
import {
  AiGateway,
  AiProviderError,
  AnthropicProvider,
  OpenAiEmbeddingsProvider,
} from "@clientforce/ai";
import { createClassifyWorker, SendGridSender } from "@clientforce/channels";
import { isConfigured } from "@clientforce/config";
import { goalKeySchema, type GoalKey } from "@clientforce/core";
import { createDistillQueue, createDistillWorker } from "@clientforce/context";
import { createAppPrismaClient, withTenant, type PrismaClient } from "@clientforce/db";
import {
  automationsConsumer,
  createTemporalSignalConsumer,
  dispatcherConsumer,
  EventBus,
  redisOptionsFromUrl,
} from "@clientforce/events";
import { createIngestWorker, createUploadStoreFromEnv } from "@clientforce/knowledge";
import { createPlanWorker } from "@clientforce/planner";
import {
  cancelEnrollmentWorkflow,
  connectTemporalClient,
  createActivities,
  signalEnrollmentReply,
  TASK_QUEUE,
  WORKFLOWS_PATH,
} from "@clientforce/workflows";

/**
 * Worker entrypoint: BullMQ knowledge-ingest / context-distill / planner /
 * inbound-classify workers + the T2 event-bus consumer (live when REDIS_URL
 * is set) + the Temporal CampaignWorkflow worker (P1.6 — connects when
 * TEMPORAL_ADDRESS is set; TEMPORAL_API_KEY ⇒ Temporal Cloud TLS).
 */

/** Lazy shared Temporal client — null when TEMPORAL_ADDRESS is unset. */
let temporalClientPromise: ReturnType<typeof connectTemporalClient> | undefined;
const temporalClient = () => (temporalClientPromise ??= connectTemporalClient());

/**
 * Ingestion needs embeddings only; P1.6 activities wire their own completions.
 */
function embeddingsOnlyGateway(): AiGateway {
  const notWired = async (): Promise<never> => {
    throw new AiProviderError(
      "Completions are not wired in the worker process until P1.6",
      undefined,
      false,
    );
  };
  return new AiGateway({
    provider: { completeText: notWired, completeTool: notWired },
    embeddings: new OpenAiEmbeddingsProvider(),
  });
}

function startKnowledgeWorkers(): void {
  if (!process.env.REDIS_URL) {
    console.log("[worker] REDIS_URL not set — knowledge-ingest/context-distill workers disabled");
    return;
  }
  const prisma = createAppPrismaClient();
  const distillQueue = createDistillQueue();

  const ingest = createIngestWorker({
    prisma,
    gateway: embeddingsOnlyGateway(),
    store: createUploadStoreFromEnv(),
  });
  ingest.on("completed", (job) => {
    console.log(`[worker] knowledge-ingest completed source=${job.data.sourceId}`);
    // Knowledge changed → re-distill the source's layer (DEC-024 trigger);
    // agent gaps covered by new WORKSPACE docs resolve through the layer merge
    // without touching the agent rows.
    void enqueueRedistill(prisma, distillQueue, job.data).catch((err: unknown) => {
      console.error(`[worker] re-distill enqueue failed for ${job.data.sourceId}`, err);
    });
  });
  ingest.on("failed", (job, err) => {
    console.error(`[worker] knowledge-ingest failed source=${job?.data.sourceId}: ${err.message}`);
  });
  console.log("[worker] knowledge-ingest worker started (P1.2)");

  // P1.7: the T2 event-bus consumer — consumer #1 is now REAL: a *.replied.v1
  // event signals the enrollment's CampaignWorkflow (skips with a log when
  // Temporal isn't configured; the Event row is persisted regardless).
  const bus = new EventBus({
    prisma,
    connection: redisOptionsFromUrl(process.env.REDIS_URL),
    consumers: [
      createTemporalSignalConsumer(async (enrollmentId, intent) => {
        const client = await temporalClient();
        if (!client) throw new Error("TEMPORAL_ADDRESS not configured — signal skipped");
        await signalEnrollmentReply(client, enrollmentId, intent);
        console.log(`[worker] reply signal delivered: enrollment=${enrollmentId} intent=${intent}`);
      }),
      automationsConsumer,
      dispatcherConsumer,
    ],
  });
  bus.startConsumer();
  console.log("[worker] event-bus consumer started (P1.7 — temporal-signal live)");

  // Distilling/classifying need real completions; without the key those
  // workers stay off (ingest + bus are unaffected) and jobs wait in Redis.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[worker] ANTHROPIC_API_KEY not set — distill/planner/classify workers disabled");
    return;
  }
  const realGateway = new AiGateway({
    provider: new AnthropicProvider(),
    embeddings: new OpenAiEmbeddingsProvider(),
  });
  const distiller = createDistillWorker({ prisma, gateway: realGateway });
  distiller.on("completed", (job) => {
    console.log(
      `[worker] context-distill completed ws=${job.data.workspaceId} agent=${job.data.agentId ?? "workspace-layer"}`,
    );
  });
  distiller.on("failed", (job, err) => {
    console.error(`[worker] context-distill failed ws=${job?.data.workspaceId}: ${err.message}`);
  });
  console.log("[worker] context-distill worker started (P1.3)");

  const planner = createPlanWorker({ prisma, gateway: realGateway });
  planner.on("completed", (job) => {
    console.log(`[worker] planner completed ws=${job.data.workspaceId} agent=${job.data.agentId}`);
  });
  planner.on("failed", (job, err) => {
    console.error(`[worker] planner failed agent=${job?.data.agentId}: ${err.message}`);
  });
  console.log("[worker] planner worker started (P1.4)");

  // P1.7: classify inbound replies (Sonnet, engagement-aware), publish
  // email.replied.v1 (bus → temporal-signal), apply unsubscribe side effects.
  const classifier = createClassifyWorker({
    prisma,
    gateway: realGateway,
    bus,
    stopWorkflow: async (enrollmentId) => {
      const client = await temporalClient();
      if (client) await cancelEnrollmentWorkflow(client, enrollmentId);
    },
  });
  classifier.on("completed", (job, result) => {
    console.log(
      `[worker] inbound-classify completed message=${job.data.messageId} intent=${(result as { intent?: string })?.intent}`,
    );
  });
  classifier.on("failed", (job, err) => {
    console.error(`[worker] inbound-classify failed message=${job?.data.messageId}: ${err.message}`);
  });
  console.log("[worker] inbound-classify worker started (P1.7)");
}

async function enqueueRedistill(
  prisma: PrismaClient,
  queue: ReturnType<typeof createDistillQueue>,
  job: { sourceId: string; workspaceId: string },
): Promise<void> {
  const source = await withTenant(prisma, { workspaceId: job.workspaceId }, (tx) =>
    tx.knowledgeSource.findUnique({ where: { id: job.sourceId } }),
  );
  if (!source || source.status !== "READY") return;
  let goal: GoalKey | null = null;
  let customObjective: string | undefined;
  if (source.agentId) {
    const agent = await withTenant(prisma, { workspaceId: job.workspaceId }, (tx) =>
      tx.agent.findUnique({ where: { id: source.agentId! } }),
    );
    const parsed = goalKeySchema.safeParse(agent?.goal);
    goal = parsed.success ? parsed.data : null;
    customObjective = agent?.instructions ?? undefined;
  }
  await queue.add(
    "distill",
    { workspaceId: job.workspaceId, agentId: source.agentId ?? null, goal, customObjective },
    { attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
  );
}

async function run(): Promise<void> {
  startKnowledgeWorkers();

  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) {
    console.log(
      `[worker] Temporal not connected (config ok=${isConfigured()}). ` +
        `Set TEMPORAL_ADDRESS to run CampaignWorkflows (P1.6); ` +
        `queues above keep running either way.`,
    );
    // Stay alive as a healthy long-running container until the owner
    // provisions a Temporal endpoint — otherwise the process would exit and
    // the Container App would crash-loop.
    await new Promise<never>(() => {});
    return;
  }

  // P1.6: the real CampaignWorkflow worker. TEMPORAL_API_KEY implies Temporal
  // Cloud (TLS); a bare address is a dev/self-hosted server.
  const apiKey = process.env.TEMPORAL_API_KEY;
  const connection = await NativeConnection.connect({
    address,
    ...(apiKey ? { tls: true, apiKey } : {}),
  });
  // P1.7: pipeline moves at branches publish lead.stage_changed.v1 (bus needs
  // Redis; without it the move still persists, just without the event).
  const activityPrisma = createAppPrismaClient();
  const stageBus = process.env.REDIS_URL
    ? new EventBus({
        prisma: activityPrisma,
        connection: redisOptionsFromUrl(process.env.REDIS_URL),
      })
    : undefined;
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: createActivities({
      prisma: activityPrisma,
      transport: new SendGridSender(),
      ...(stageBus
        ? {
            publishStageChanged: async (change) => {
              await stageBus.publish({
                type: "lead.stage_changed.v1",
                workspaceId: change.workspaceId,
                contactId: change.contactId,
                enrollmentId: change.enrollmentId,
                campaignId: change.campaignId,
                payload: { fromStage: change.fromStage, toStage: change.toStage },
              });
            },
          }
        : {}),
    }),
  });
  console.log(`[worker] Temporal worker started (P1.6) — task queue "${TASK_QUEUE}"`);
  await worker.run();
}

void run().catch((err: unknown) => {
  console.error("[worker] failed to start", err);
  process.exitCode = 1;
});
