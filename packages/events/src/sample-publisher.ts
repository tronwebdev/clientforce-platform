/**
 * Sample publisher — demonstrates the exported, typed payload contract.
 *
 * `intent` is typed straight from the catalog (`EventPayloads["email.replied.v1"]`),
 * so a wrong/misspelled value is a compile error. Mirrors how the P1.7
 * classifier emits the reply event. (`lead.replied` left the canonical catalog
 * per handoff A9 / DEC-018 — replies are channel events.)
 */
import type { EventBus } from "./bus";
import { EVENT_TYPES, type EventPayloads } from "./catalog";
import type { BusEvent } from "./types";

export interface EmailRepliedArgs {
  workspaceId: string;
  messageId: string;
  intent: EventPayloads["email.replied.v1"]["intent"];
  contactId?: string;
  enrollmentId?: string;
  campaignId?: string;
}

export async function emitEmailReplied(bus: EventBus, args: EmailRepliedArgs): Promise<BusEvent> {
  const payload: EventPayloads["email.replied.v1"] = {
    messageId: args.messageId,
    intent: args.intent,
  };

  return bus.publish({
    type: EVENT_TYPES.EMAIL_REPLIED,
    workspaceId: args.workspaceId,
    ...(args.contactId ? { contactId: args.contactId } : {}),
    ...(args.enrollmentId ? { enrollmentId: args.enrollmentId } : {}),
    ...(args.campaignId ? { campaignId: args.campaignId } : {}),
    payload,
  });
}
