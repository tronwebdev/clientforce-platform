import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { distill, type DistillDeps, type DistillTarget } from "./distill";

export const CONTEXT_QUEUE_NAME = "clientforce.context.distill";

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

/** Enqueue a (re-)distill — the API on typed answers, the ingest worker on READY sources. */
export function createDistillQueue(redisUrl?: string): Queue<DistillTarget> {
  return new Queue<DistillTarget>(CONTEXT_QUEUE_NAME, { connection: connectionFrom(redisUrl) });
}

export function createDistillWorker(deps: DistillDeps, redisUrl?: string): Worker<DistillTarget> {
  return new Worker<DistillTarget>(
    CONTEXT_QUEUE_NAME,
    async (job) => {
      await distill(deps, job.data);
    },
    { connection: connectionFrom(redisUrl), concurrency: 2 },
  );
}
