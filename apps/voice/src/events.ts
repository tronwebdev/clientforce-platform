/**
 * Event publishing for the voice service — the api's BusOrInline pattern:
 * with REDIS_URL the real T2 bus (persist + fan out to the worker consumers),
 * without it validate + persist only, so Logs rows still land and nothing
 * silently drops.
 */
import { withTenant, type Prisma, type PrismaClient } from "@clientforce/db";
import { bullConnectionFromUrl, EventBus, validateEvent, type EventInput, type EventType } from "@clientforce/events";

export interface VoiceEventsPublisher {
  publish<T extends EventType>(input: EventInput<T>): Promise<void>;
}

export function createVoiceEventsPublisher(prisma: PrismaClient): VoiceEventsPublisher {
  const bus = process.env.REDIS_URL
    ? new EventBus({ prisma, connection: bullConnectionFromUrl(process.env.REDIS_URL) })
    : undefined;
  return {
    async publish(input) {
      try {
        if (bus) {
          await bus.publish(input);
          return;
        }
        const validated = validateEvent(input);
        await withTenant(prisma, { workspaceId: validated.workspaceId }, (tx) =>
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
      } catch (err) {
        // An event must never take a live call down — log loudly instead.
        console.error(`[events] publish ${String(input.type)} failed:`, (err as Error).message);
      }
    },
  };
}
