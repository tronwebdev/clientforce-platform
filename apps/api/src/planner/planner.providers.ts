import type { Provider } from "@nestjs/common";
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import { createPlanQueue, type PlanTarget } from "@clientforce/planner";

export const PLAN_ENQUEUER = "PLANNER_PLAN_ENQUEUER";
export const COMPOSER_GATEWAY = "PLANNER_COMPOSER_GATEWAY";

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

/**
 * G1 (DEC-068): the sample-preview composer runs IN the api process — one
 * bounded Sonnet-class call per click (the api already carries
 * ANTHROPIC_API_KEY, DEC-027). Null when the key is absent: the endpoint
 * answers with a designed 503 naming the prerequisite (DEC-047 ladder),
 * never a dead click.
 */
export const plannerProviders: Provider[] = [
  { provide: PLAN_ENQUEUER, useClass: BullPlanEnqueuer },
  {
    provide: COMPOSER_GATEWAY,
    useFactory: (): AiGateway | null =>
      process.env.ANTHROPIC_API_KEY ? new AiGateway({ provider: new AnthropicProvider() }) : null,
  },
];
