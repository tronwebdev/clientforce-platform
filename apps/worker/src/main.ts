import { NativeConnection, Worker } from "@temporalio/worker";
import {
  AiGateway,
  AiProviderError,
  AnthropicProvider,
  OpenAiEmbeddingsProvider,
} from "@clientforce/ai";
import { isConfigured } from "@clientforce/config";
import { goalKeySchema, type GoalKey } from "@clientforce/core";
import { createDistillQueue, createDistillWorker } from "@clientforce/context";
import { createAppPrismaClient, withTenant, type PrismaClient } from "@clientforce/db";
import { createIngestWorker, createUploadStoreFromEnv } from "@clientforce/knowledge";
import { createPlanWorker } from "@clientforce/planner";

const TASK_QUEUE = "clientforce";

/**
 * Worker entrypoint: BullMQ knowledge-ingest + context-distill workers (P1.2/
 * P1.3, live when REDIS_URL is set) + the Temporal worker (T0 stub until
 * T4/P1.6 — connects only when TEMPORAL_ADDRESS is set).
 */

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

  // Distilling needs real completions; without the key the distill worker
  // stays off (ingest is unaffected) and jobs wait in Redis.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[worker] ANTHROPIC_API_KEY not set — context-distill worker disabled");
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
      `[worker] Temporal stub (config ok=${isConfigured()}). ` +
        `Set TEMPORAL_ADDRESS to connect; workflows land in P1.6.`,
    );
    // Stay alive as a healthy long-running container until Temporal (mTLS) is
    // wired in a later ticket — otherwise the process would exit and the
    // Container App would crash-loop.
    await new Promise<never>(() => {});
    return;
  }

  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: TASK_QUEUE,
    // workflows + activities are registered in P1.6.
    activities: {},
  });
  await worker.run();
}

void run().catch((err: unknown) => {
  console.error("[worker] failed to start", err);
  process.exitCode = 1;
});
