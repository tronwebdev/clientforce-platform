import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { BULL_PREFIX, bullConnectionFromUrl } from "@clientforce/events";
import { ingestSource, type IngestDeps, type IngestJobPayload } from "./pipeline";

export const KNOWLEDGE_QUEUE_NAME = "clientforce.knowledge.ingest";

// One URL parser for the whole platform: the local copy this replaces passed
// `URL.password` percent-ENCODED to Redis AUTH (WRONGPASS on Azure keys
// ending in `=` — 2026-07-08 staging outage) and lacked SNI/username/db.
const connectionFrom = (
  redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
): ConnectionOptions => bullConnectionFromUrl(redisUrl);

/** Enqueue an ingestion run for a source (the API calls this on create/re-ingest). */
export function createIngestQueue(redisUrl?: string): Queue<IngestJobPayload> {
  return new Queue<IngestJobPayload>(KNOWLEDGE_QUEUE_NAME, {
    connection: connectionFrom(redisUrl), prefix: BULL_PREFIX,
  });
}

/** The worker process entry — runs the pipeline with bounded retries. */
export function createIngestWorker(deps: IngestDeps, redisUrl?: string): Worker<IngestJobPayload> {
  return new Worker<IngestJobPayload>(
    KNOWLEDGE_QUEUE_NAME,
    async (job) => ingestSource(deps, job.data),
    { connection: connectionFrom(redisUrl), prefix: BULL_PREFIX, concurrency: 2 },
  );
}
