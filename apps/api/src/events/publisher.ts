import { Injectable } from "@nestjs/common";
import type { BusEventInput } from "@clientforce/channels";
import { withTenant, type Prisma } from "@clientforce/db";
import { EventBus, redisOptionsFromUrl, validateEvent } from "@clientforce/events";
import { PrismaService } from "../db/prisma.service";

export const EVENTS_PUBLISHER = Symbol("EVENTS_PUBLISHER");

/** Thin publish seam so e2e tests capture events without Redis. */
export interface EventsPublisher {
  publish(input: BusEventInput): Promise<void>;
}

/**
 * With REDIS_URL: the real T2 bus (persist Event row + fan out to consumers,
 * which run in apps/worker). Without it (local dev/tests): validate + persist
 * only, so the timeline data still lands and nothing silently drops — fan-out
 * side effects simply wait for an environment with Redis.
 */
@Injectable()
export class BusOrInlinePublisher implements EventsPublisher {
  private bus?: EventBus;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.REDIS_URL) {
      this.bus = new EventBus({
        prisma: this.prisma.app,
        connection: redisOptionsFromUrl(process.env.REDIS_URL),
      });
    }
  }

  async publish(input: BusEventInput): Promise<void> {
    if (this.bus) {
      await this.bus.publish(input as Parameters<EventBus["publish"]>[0]);
      return;
    }
    const validated = validateEvent(input);
    await withTenant(this.prisma.app, { workspaceId: validated.workspaceId }, (tx) =>
      tx.event.create({
        data: {
          workspaceId: validated.workspaceId,
          type: validated.type,
          contactId: validated.contactId,
          enrollmentId: validated.enrollmentId,
          campaignId: validated.campaignId,
          payload: validated.payload as Prisma.InputJsonValue,
        },
      }),
    );
  }
}
