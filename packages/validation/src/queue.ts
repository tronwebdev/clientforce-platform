/**
 * Validation queue (LH1, DEC-087) — one self-requeueing job per batch, so
 * concurrent batches interleave turn-by-turn: tenant A's 500k upload cannot
 * starve tenant B's 200-row import (each turn re-enters at the queue tail).
 * Provider rate limits / outages retry with exponential backoff; day-held
 * batches (allowance/ceiling) requeue delayed to the next UTC day; the
 * requeue sweep is the crash/redis-less safety net.
 */
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { PrismaClient } from "@clientforce/db";
import { BULL_PREFIX, bullConnectionFromUrl } from "@clientforce/events";
import { processValidationBatchChunk, type ChunkResult, type ValidationDeps } from "./service";

export const VALIDATION_QUEUE_NAME = "clientforce.validation";

export interface ValidationJob {
  workspaceId: string;
  batchId: string;
}

const connectionFrom = (
  redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
): ConnectionOptions => bullConnectionFromUrl(redisUrl);

export function createValidationQueue(redisUrl?: string): Queue<ValidationJob> {
  return new Queue<ValidationJob>(VALIDATION_QUEUE_NAME, {
    connection: connectionFrom(redisUrl),
    prefix: BULL_PREFIX,
  });
}

export async function enqueueValidationBatch(
  queue: Queue<ValidationJob>,
  job: ValidationJob,
  delayMs = 0,
): Promise<void> {
  await queue.add("validate", job, {
    delay: delayMs,
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export interface ValidationWorkerOptions {
  redisUrl?: string;
  concurrency?: number;
  /** Fires whenever contact verdicts landed — W3 drains enrollment holds here. */
  onVerdictsLanded?: (result: ChunkResult) => Promise<void>;
}

export function createValidationWorker(
  deps: ValidationDeps,
  opts: ValidationWorkerOptions = {},
): Worker<ValidationJob> {
  const queue = createValidationQueue(opts.redisUrl);
  return new Worker<ValidationJob>(
    VALIDATION_QUEUE_NAME,
    async (job) => {
      const result = await processValidationBatchChunk(deps, job.data.workspaceId, job.data.batchId);
      if (result.verdictsLanded && opts.onVerdictsLanded) {
        await opts.onVerdictsLanded(result);
      }
      if (result.requeue) {
        await enqueueValidationBatch(queue, job.data, result.requeueDelayMs ?? 0);
      }
    },
    { connection: connectionFrom(opts.redisUrl), prefix: BULL_PREFIX, concurrency: opts.concurrency ?? 4 },
  );
}

/**
 * Requeue sweep (worker boot + interval): re-enqueues batches that have no
 * live job — created while Redis was absent, held past their day boundary,
 * orphaned by a crash (stale claim), or provider-down cooling off. Discovery
 * is cross-tenant on the privileged client (the sweep precedent); processing
 * stays tenant-scoped.
 */
export async function sweepValidationBatches(
  ownerPrisma: PrismaClient,
  queue: Queue<ValidationJob>,
  now: () => Date = () => new Date(),
): Promise<number> {
  const stale = new Date(now().getTime() - 10 * 60_000);
  const batches = await ownerPrisma.validationBatch.findMany({
    where: {
      OR: [
        { status: "queued" },
        { status: "held" },
        { status: "running", updatedAt: { lt: stale } },
      ],
    },
    select: { id: true, workspaceId: true },
    take: 500,
    orderBy: { updatedAt: "asc" },
  });
  for (const b of batches) {
    await enqueueValidationBatch(queue, { workspaceId: b.workspaceId, batchId: b.id });
  }
  return batches.length;
}
