import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { BULL_PREFIX, redisOptionsFromUrl } from "@clientforce/events";
import { distill, type DistillDeps, type DistillTarget } from "./distill";

export const CONTEXT_QUEUE_NAME = "clientforce.context.distill";

// One URL parser for the whole platform: the local copy this replaces passed
// `URL.password` percent-ENCODED to Redis AUTH (WRONGPASS on Azure keys
// ending in `=` — 2026-07-08 staging outage) and lacked SNI/username/db.
const connectionFrom = (
  redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
): ConnectionOptions => redisOptionsFromUrl(redisUrl);

/** Enqueue a (re-)distill — the API on typed answers, the ingest worker on READY sources. */
export function createDistillQueue(redisUrl?: string): Queue<DistillTarget> {
  return new Queue<DistillTarget>(CONTEXT_QUEUE_NAME, { connection: connectionFrom(redisUrl), prefix: BULL_PREFIX });
}

export function createDistillWorker(deps: DistillDeps, redisUrl?: string): Worker<DistillTarget> {
  return new Worker<DistillTarget>(
    CONTEXT_QUEUE_NAME,
    async (job) => {
      await distill(deps, job.data);
    },
    { connection: connectionFrom(redisUrl), prefix: BULL_PREFIX, concurrency: 2 },
  );
}
