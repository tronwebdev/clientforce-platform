import type { EventType } from "./catalog";

/**
 * The JSON-safe shape of a persisted event as it travels through Redis to the
 * consumers. Dates are ISO strings (BullMQ serializes job data as JSON).
 */
export interface BusEvent {
  id: string;
  workspaceId: string;
  type: EventType;
  contactId: string | null;
  enrollmentId: string | null;
  campaignId: string | null;
  /** P5 W1 (DEC-083): sender attribution (null on non-sender events). */
  senderId: string | null;
  payload: unknown;
  /** ISO-8601 timestamp. */
  occurredAt: string;
}
