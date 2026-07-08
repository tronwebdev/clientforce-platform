import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { BULL_PREFIX } from "@clientforce/events";
import { planCampaign, type PlanDeps, type PlanTarget } from "./plan";

export const PLANNER_QUEUE_NAME = "clientforce.planner.plan";

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
