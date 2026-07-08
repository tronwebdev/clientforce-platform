import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { BULL_PREFIX, bullConnectionFromUrl } from "@clientforce/events";
import { planCampaign, type PlanDeps, type PlanTarget } from "./plan";

export const PLANNER_QUEUE_NAME = "clientforce.planner.plan";

// One URL parser for the whole platform: the local copy this replaces passed
// `URL.password` percent-ENCODED to Redis AUTH (WRONGPASS on Azure keys
// ending in `=` — 2026-07-08 staging outage) and lacked SNI/username/db.
const connectionFrom = (
  redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
): ConnectionOptions => bullConnectionFromUrl(redisUrl);

/** Enqueue a planning run (the wizard's step-2 "drafting sequence" polls the graph). */
export function createPlanQueue(redisUrl?: string): Queue<PlanTarget> {
  return new Queue<PlanTarget>(PLANNER_QUEUE_NAME, { connection: connectionFrom(redisUrl), prefix: BULL_PREFIX });
}

export function createPlanWorker(deps: PlanDeps, redisUrl?: string): Worker<PlanTarget> {
  return new Worker<PlanTarget>(
    PLANNER_QUEUE_NAME,
    async (job) => {
      await planCampaign(deps, job.data);
    },
    { connection: connectionFrom(redisUrl), prefix: BULL_PREFIX, concurrency: 2 },
  );
}
