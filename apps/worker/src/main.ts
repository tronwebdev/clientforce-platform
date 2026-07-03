import { NativeConnection, Worker } from "@temporalio/worker";
import { AiGateway, AiProviderError, OpenAiEmbeddingsProvider } from "@clientforce/ai";
import { isConfigured } from "@clientforce/config";
import { createAppPrismaClient } from "@clientforce/db";
import { createIngestWorker, createUploadStoreFromEnv } from "@clientforce/knowledge";

const TASK_QUEUE = "clientforce";

/**
 * Worker entrypoint: BullMQ knowledge-ingest worker (P1.2, live when REDIS_URL
 * is set) + the Temporal worker (T0 stub until T4/P1.6 — connects only when
 * TEMPORAL_ADDRESS is set).
 */

/**
 * Ingestion needs embeddings only; completions stay unwired in this process
 * until P1.6 activities need them.
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

function startKnowledgeWorker(): void {
  if (!process.env.REDIS_URL) {
    console.log("[worker] REDIS_URL not set — knowledge-ingest worker disabled");
    return;
  }
  const worker = createIngestWorker({
    prisma: createAppPrismaClient(),
    gateway: embeddingsOnlyGateway(),
    store: createUploadStoreFromEnv(),
  });
  worker.on("completed", (job) => {
    console.log(`[worker] knowledge-ingest completed source=${job.data.sourceId}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] knowledge-ingest failed source=${job?.data.sourceId}: ${err.message}`);
  });
  console.log("[worker] knowledge-ingest worker started (P1.2)");
}

async function run(): Promise<void> {
  startKnowledgeWorker();

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
