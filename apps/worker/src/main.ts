import { join } from "node:path";
import { NativeConnection, Worker } from "@temporalio/worker";
import {
  AiGateway,
  AiProviderError,
  AnthropicProvider,
  OpenAiEmbeddingsProvider,
} from "@clientforce/ai";
import { createClassifyWorker, createSmsStepComposer, SendGridSender , TwilioSmsSender} from "@clientforce/channels";
import { isConfigured } from "@clientforce/config";
import { goalKeySchema, type GoalKey } from "@clientforce/core";
import { createDistillQueue, createDistillWorker } from "@clientforce/context";
import {
  createAppPrismaClient,
  createPrismaClient,
  withTenant,
  type PrismaClient,
} from "@clientforce/db";
import {
  automationsConsumer,
  bullConnectionFromUrl,
  createRedisClient,
  createTemporalSignalConsumer,
  dispatcherConsumer,
  EventBus,
  WORKER_HEARTBEAT_KEY,
} from "@clientforce/events";
import {
  createIngestQueue,
  createIngestWorker,
  createUploadStoreFromEnv,
} from "@clientforce/knowledge";
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

/** Local uploads root — must match the API's resolution (see GET /system/health). */
const uploadsRoot = (): string =>
  process.env.STORAGE_CONNECTION_STRING
    ? "azure"
    : (process.env.UPLOADS_DIR ?? join(process.cwd(), ".uploads"));

/**
 * Liveness heartbeat: a 45s-TTL Redis key refreshed every 15s so the API's
 * GET /system/health can tell "worker alive" from "jobs will wait forever".
 * Written even when ANTHROPIC_API_KEY is absent — the payload says which
 * workers are actually on.
 */
function startHeartbeat(redisUrl: string): void {
  const redis = createRedisClient(redisUrl);
  const beat = (): void => {
    const payload = JSON.stringify({
      at: new Date().toISOString(),
      ingest: true,
      distill: !!process.env.ANTHROPIC_API_KEY,
      planner: !!process.env.ANTHROPIC_API_KEY,
      storage: process.env.STORAGE_CONNECTION_STRING ? "azure" : "file",
      uploadsRoot: uploadsRoot(),
    });
    redis.setex(WORKER_HEARTBEAT_KEY, 45, payload).catch((err: unknown) => {
      console.error("[worker] heartbeat write failed", err);
    });
  };
  beat();
  setInterval(beat, 15_000);
}

function startKnowledgeWorkers(): void {
  if (!process.env.REDIS_URL) {
    console.log("[worker] REDIS_URL not set — knowledge-ingest/context-distill workers disabled");
    return;
  }
  console.log(`[worker] uploads root: ${uploadsRoot()}`);
  startHeartbeat(process.env.REDIS_URL);
  startStrandedSourceSweep();
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
    connection: bullConnectionFromUrl(process.env.REDIS_URL),
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
    const ms =
      job.finishedOn !== undefined && job.processedOn !== undefined
        ? `${job.finishedOn - job.processedOn}ms`
        : "unknown";
    console.log(
      `[worker] planner completed ws=${job.data.workspaceId} agent=${job.data.agentId} duration=${ms}`,
    );
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

/**
 * Stranded-source sweep (hardening, wizard bug round #2): sources whose ingest
 * enqueue was lost — outage, worker death mid-job — sit in PENDING/INGESTING
 * forever, because nothing in the product re-enqueues them (the 2026-07-08
 * outage left 17 such rows; a manual drain workflow recovered them). On boot
 * and every 10 minutes, re-enqueue anything stale for >10 minutes: never a
 * live job (a healthy ingest moves the row in seconds), and re-ingest is
 * idempotent (P1.2). Cross-tenant maintenance read — owner client, same
 * precedent as P1.7 inbound thread resolution.
 */
function startStrandedSourceSweep(): void {
  const owner = createPrismaClient();
  const queue = createIngestQueue();
  const sweep = async (): Promise<void> => {
    const stale = await owner.knowledgeSource.findMany({
      where: {
        status: { in: ["PENDING", "INGESTING"] },
        updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      select: { id: true, workspaceId: true },
      take: 100,
    });
    for (const s of stale) {
      await queue.add(
        "ingest",
        { sourceId: s.id, workspaceId: s.workspaceId },
        { attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
      );
      console.log(`[worker] stranded-source sweep re-enqueued source=${s.id}`);
    }
    if (stale.length > 0) console.log(`[worker] stranded-source sweep: ${stale.length} re-enqueued`);
  };
  void sweep().catch((err: unknown) => console.error("[worker] stranded-source sweep failed", err));
  setInterval(() => {
    void sweep().catch((err: unknown) =>
      console.error("[worker] stranded-source sweep failed", err),
    );
  }, 10 * 60_000);
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
        connection: bullConnectionFromUrl(process.env.REDIS_URL),
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
      // P2.1 (DEC-061): sms steps route through Twilio (SMS_SANDBOX default ON).
      smsTransport: new TwilioSmsSender(),
      // G1 (DEC-070): guided sms steps compose per lead on the copy route —
      // key absent → guided steps refuse typed (COMPOSER_UNCONFIGURED), the
      // same honest-absence pattern as the transports.
      ...(process.env.ANTHROPIC_API_KEY
        ? {
            composeSms: createSmsStepComposer({
              prisma: activityPrisma,
              gateway: new AiGateway({ provider: new AnthropicProvider() }),
            }),
          }
        : {}),
      ...(stageBus
        ? {
            publishStageChanged: async (change) => {
              await stageBus.publish({
                type: "lead.stage_changed.v1",
                workspaceId: change.workspaceId,
                contactId: change.contactId,
                enrollmentId: change.enrollmentId,
                campaignId: change.campaignId,
                payload: {
                  fromStage: change.fromStage,
                  toStage: change.toStage,
                  // C2.9: present on goal-completion moves (DEC-059).
                  ...(change.goalKey ? { goalKey: change.goalKey, label: change.label } : {}),
                },
              });
            },
            // G1: the composer refusal's Logs row (Event) — the pause itself
            // persists in the activity regardless of the bus.
            publishComposeRefused: async (refusal) => {
              await stageBus.publish({
                type: "sms.compose_refused.v1",
                workspaceId: refusal.workspaceId,
                contactId: refusal.contactId,
                enrollmentId: refusal.enrollmentId,
                campaignId: refusal.campaignId,
                payload: {
                  stepNodeId: refusal.stepNodeId,
                  reason: refusal.reason,
                  ...(refusal.detail ? { detail: refusal.detail } : {}),
                },
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
