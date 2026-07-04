import type { Provider } from "@nestjs/common";
import { createPlanQueue, type PlanTarget } from "@clientforce/planner";

export const PLAN_ENQUEUER = "PLANNER_PLAN_ENQUEUER";

/** Seam between the controller and BullMQ so tests can run plans inline. */
export interface PlanEnqueuer {
  enqueue(target: PlanTarget): Promise<void>;
}

/** Lazy BullMQ queue (`REDIS_URL`) — the API boots without Redis. */
class BullPlanEnqueuer implements PlanEnqueuer {
  private queue?: ReturnType<typeof createPlanQueue>;

  async enqueue(target: PlanTarget): Promise<void> {
    this.queue ??= createPlanQueue();
    await this.queue.add("plan", target, {
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}

export const plannerProviders: Provider[] = [
  { provide: PLAN_ENQUEUER, useClass: BullPlanEnqueuer },
];
