/**
 * Sample publisher — demonstrates the exported, typed payload contract.
 *
 * `intent` is typed straight from the catalog (`EventPayloads["lead.replied.v1"]`),
 * so a wrong/misspelled value is a compile error. Mirrors how real producers
 * (webhook ingest, the classifier) will emit events in later tickets.
 */
import type { EventBus } from "./bus";
import { EVENT_TYPES, type EventPayloads } from "./catalog";
import type { BusEvent } from "./types";

export interface LeadRepliedArgs {
  workspaceId: string;
  contactId?: string;
  intent: EventPayloads["lead.replied.v1"]["intent"];
  fromStage?: string;
  toStage?: string;
}

export async function emitLeadReplied(bus: EventBus, args: LeadRepliedArgs): Promise<BusEvent> {
  const payload: EventPayloads["lead.replied.v1"] = {
    intent: args.intent,
    ...(args.fromStage ? { fromStage: args.fromStage } : {}),
    ...(args.toStage ? { toStage: args.toStage } : {}),
  };

  return bus.publish({
    type: EVENT_TYPES.LEAD_REPLIED,
    workspaceId: args.workspaceId,
    ...(args.contactId ? { contactId: args.contactId } : {}),
    payload,
  });
}
