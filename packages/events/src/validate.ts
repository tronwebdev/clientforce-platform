/**
 * Event validation — envelope + per-type payload, with clear errors.
 */
import { z } from "zod";
import { EVENT_SCHEMAS, type EventPayloads, type EventType } from "./catalog";

/** Input accepted by `EventBus.publish` — mirrors the `Event` model. */
export interface EventInput<T extends EventType = EventType> {
  workspaceId: string;
  type: T;
  contactId?: string | null;
  enrollmentId?: string | null;
  campaignId?: string | null;
  payload: EventPayloads[T];
  occurredAt?: Date;
}

/** Normalized, validated event (nullable refs resolved to `null`). */
export interface ValidatedEvent<T extends EventType = EventType> {
  workspaceId: string;
  type: T;
  contactId: string | null;
  enrollmentId: string | null;
  campaignId: string | null;
  payload: EventPayloads[T];
  occurredAt?: Date;
}

/** Thrown when an event envelope or payload fails validation. */
export class EventValidationError extends Error {
  readonly issues?: unknown;
  constructor(message: string, issues?: unknown) {
    super(message);
    this.name = "EventValidationError";
    this.issues = issues;
  }
}

const EnvelopeSchema = z.object({
  workspaceId: z.string().min(1),
  type: z.string().min(1),
  contactId: z.string().nullish(),
  enrollmentId: z.string().nullish(),
  campaignId: z.string().nullish(),
  occurredAt: z.date().optional(),
});

/**
 * Validate an unknown input into a {@link ValidatedEvent}. Throws
 * {@link EventValidationError} on an invalid envelope, unknown event type, or a
 * payload that doesn't match the type's schema.
 */
export function validateEvent(input: unknown): ValidatedEvent {
  const env = EnvelopeSchema.safeParse(input);
  if (!env.success) {
    throw new EventValidationError(`Invalid event envelope: ${env.error.message}`, env.error.issues);
  }

  const { type } = env.data;
  const schema = (EVENT_SCHEMAS as Record<string, z.ZodTypeAny>)[type];
  if (!schema) {
    throw new EventValidationError(
      `Unknown event type: "${type}". Use a versioned type from the catalog (e.g. "email.replied.v1").`,
    );
  }

  const payload = (input as { payload?: unknown }).payload;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new EventValidationError(`Invalid payload for "${type}": ${parsed.error.message}`, parsed.error.issues);
  }

  return {
    workspaceId: env.data.workspaceId,
    type: type as EventType,
    contactId: env.data.contactId ?? null,
    enrollmentId: env.data.enrollmentId ?? null,
    campaignId: env.data.campaignId ?? null,
    payload: parsed.data as EventPayloads[EventType],
    ...(env.data.occurredAt ? { occurredAt: env.data.occurredAt } : {}),
  };
}
