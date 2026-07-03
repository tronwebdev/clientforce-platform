import type { Provider } from "@nestjs/common";
import { createDistillQueue, type DistillTarget } from "@clientforce/context";

export const DISTILL_ENQUEUER = "CONTEXT_DISTILL_ENQUEUER";

/** Seam between the controller and BullMQ so tests can run distills inline. */
export interface DistillEnqueuer {
  enqueue(target: DistillTarget): Promise<void>;
}

/** Lazy BullMQ queue (`REDIS_URL`) — the API boots without Redis. */
class BullDistillEnqueuer implements DistillEnqueuer {
  private queue?: ReturnType<typeof createDistillQueue>;

  async enqueue(target: DistillTarget): Promise<void> {
    this.queue ??= createDistillQueue();
    await this.queue.add("distill", target, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}

export const contextProviders: Provider[] = [
  { provide: DISTILL_ENQUEUER, useClass: BullDistillEnqueuer },
];
