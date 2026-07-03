import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { ingestSource, type IngestDeps, type IngestJobPayload } from "./pipeline";

export const KNOWLEDGE_QUEUE_NAME = "clientforce.knowledge.ingest";

const connectionFrom = (
  redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
): ConnectionOptions => {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
};

/** Enqueue an ingestion run for a source (the API calls this on create/re-ingest). */
export function createIngestQueue(redisUrl?: string): Queue<IngestJobPayload> {
  return new Queue<IngestJobPayload>(KNOWLEDGE_QUEUE_NAME, {
    connection: connectionFrom(redisUrl),
  });
}

/** The worker process entry — runs the pipeline with bounded retries. */
export function createIngestWorker(deps: IngestDeps, redisUrl?: string): Worker<IngestJobPayload> {
  return new Worker<IngestJobPayload>(
    KNOWLEDGE_QUEUE_NAME,
    async (job) => ingestSource(deps, job.data),
    { connection: connectionFrom(redisUrl), concurrency: 2 },
  );
}
