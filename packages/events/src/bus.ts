/**
 * EventBus — persist every event to the `Event` table, then fan out over Redis
 * (BullMQ) to the three consumer hooks (ARCHITECTURE.md §3c, DATA_MODEL.md §5).
 */
import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { BULL_PREFIX } from "./redis";
import { Prisma, withTenant, type PrismaClient } from "@clientforce/db";
import type { EventType } from "./catalog";
import { DEFAULT_CONSUMERS, type ConsumerHook } from "./consumers";
import type { BusEvent } from "./types";
import { validateEvent, type EventInput } from "./validate";

export const EVENTS_QUEUE_NAME = "clientforce.events";

export interface EventBusOptions {
  /** Client used to persist events. Use the tenant-scoped (app-role) client. */
  prisma: PrismaClient;
  /** BullMQ Redis connection (see `redisOptionsFromUrl`). */
  connection: ConnectionOptions;
  /** Defaults to the three standard consumers. */
  consumers?: ConsumerHook[];
  queueName?: string;
}

export class EventBus {
  private readonly prisma: PrismaClient;
  private readonly connection: ConnectionOptions;
  private readonly consumers: ConsumerHook[];
  private readonly queueName: string;
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(opts: EventBusOptions) {
    this.prisma = opts.prisma;
    this.connection = opts.connection;
    this.consumers = opts.consumers ?? DEFAULT_CONSUMERS;
    this.queueName = opts.queueName ?? EVENTS_QUEUE_NAME;
    this.queue = new Queue(this.queueName, { connection: this.connection, prefix: BULL_PREFIX });
  }

  /**
   * Validate, persist, and enqueue an event. Throws `EventValidationError` for a
   * bad shape (before any side effects). Returns the persisted, JSON-safe event.
   *
   * TODO(hardening): persist-then-enqueue is not atomic — if the enqueue fails
   * (e.g. Redis outage) the event is stored but never dispatched. Add a
   * transactional outbox (write an `outbox` row in the same tx as the Event, with
   * a relay/redelivery worker draining it) before relying on this at volume.
   */
  async publish<T extends EventType>(input: EventInput<T>): Promise<BusEvent> {
    const validated = validateEvent(input);

    const row = await withTenant(this.prisma, { workspaceId: validated.workspaceId }, (tx) =>
      tx.event.create({
        data: {
          workspaceId: validated.workspaceId,
          type: validated.type,
          contactId: validated.contactId,
          enrollmentId: validated.enrollmentId,
          campaignId: validated.campaignId,
          payload: validated.payload as Prisma.InputJsonValue,
          ...(validated.occurredAt ? { occurredAt: validated.occurredAt } : {}),
        },
      }),
    );

    const event: BusEvent = {
      id: row.id,
      workspaceId: row.workspaceId,
      type: row.type as EventType,
      contactId: row.contactId,
      enrollmentId: row.enrollmentId,
      campaignId: row.campaignId,
      payload: row.payload,
      occurredAt: row.occurredAt.toISOString(),
    };

    await this.queue.add(validated.type, event, { removeOnComplete: true, removeOnFail: 1000 });
    return event;
  }

  /** Start the worker that fans each event out to all consumers. Idempotent. */
  startConsumer(): Worker {
    this.worker ??= new Worker(
      this.queueName,
      async (job: Job<BusEvent>) => {
        await this.dispatch(job.data);
      },
      { connection: this.connection, prefix: BULL_PREFIX },
    );
    return this.worker;
  }

  /** Invoke every consumer hook for an event. Exposed for direct dispatch/tests. */
  async dispatch(event: BusEvent): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.handle(event)));
  }

  /** Tear down the worker and queue (and their Redis connections). */
  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
