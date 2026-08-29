/**
 * B6 (DEC-131, ruling 2): the FIRST-PARTY intent pipeline — a bus consumer
 * mapping qualifying events onto IntentSignal rows through the core
 * taxonomy. Free tier, real-time, every shape. Suppression happens at
 * WRITE: a signal never lands for a suppressed/opted-out contact or one in
 * an active enrollment (a customer mid-campaign is not "in the market" —
 * they are already yours). Receipts render from the registry templates with
 * the workspace's vertical vocabulary; decay is computed at read.
 */
import {
  intentReceipt,
  INTENT_SIGNALS,
  type IcpShape,
  SOURCE_ELIGIBILITY,
} from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import type { BusEvent, ConsumerHook } from "@clientforce/events";

/** event type → intent signal type (first-party rows of the taxonomy). */
const EVENT_TO_SIGNAL: Record<string, string> = {
  "widget.conversation_started.v1": "chat_started",
  "widget.lead_captured.v1": "lead_captured",
  "form.submitted.v1": "form_submitted",
  "email.clicked.v1": "link_clicked",
  "call.completed.v1": "call_finished",
  "calendar.booked.v1": "meeting_booked",
};

const REPLY_EVENTS = new Set(["email.replied.v1", "sms.replied.v1", "whatsapp.replied.v1"]);

export interface IntentConsumerDeps {
  prisma: PrismaClient;
  /** The workspace's shape+vertical (read per event; injectable for tests). */
  profileFor: (workspaceId: string) => Promise<{ shape: IcpShape; vertical: string | null }>;
  log?: (msg: string) => void;
}

function signalTypeFor(event: BusEvent): string | null {
  const direct = EVENT_TO_SIGNAL[event.type];
  if (direct) return direct;
  if (REPLY_EVENTS.has(event.type)) {
    const intent = (event.payload as { intent?: string } | null)?.intent;
    if (intent === "interested") return "reply_interested";
    if (intent === "objection_price" || intent === "info_request") return "pricing_asked";
  }
  return null;
}

export function createIntentConsumer(deps: IntentConsumerDeps): ConsumerHook {
  const log = deps.log ?? console.warn;
  return {
    name: "intent-signals",
    async handle(event: BusEvent): Promise<void> {
      try {
        const type = signalTypeFor(event);
        if (!type) return;
        const def = INTENT_SIGNALS[type];
        if (!def) return;
        const { shape, vertical } = await deps.profileFor(event.workspaceId);
        if (!def.shapes.includes(shape)) return;
        if (!SOURCE_ELIGIBILITY[shape].includes(def.source)) return;

        await withTenant(deps.prisma, { workspaceId: event.workspaceId }, async (tx) => {
          // Write-time suppression: DNC/opt-out and already-yours both stop
          // a signal — intent ranks strangers and lapsed contacts, never a
          // customer mid-campaign.
          if (event.contactId) {
            const contact = await tx.contact.findUnique({
              where: { id: event.contactId },
              select: { optOut: true },
            });
            const optOut = (contact?.optOut ?? {}) as Record<string, unknown>;
            if (optOut.email === true || optOut.sms === true || optOut.voice === true) return;
            const active = await tx.enrollment.findFirst({
              where: { contactId: event.contactId, status: "ACTIVE" },
              select: { id: true },
            });
            if (active && type !== "reply_interested" && type !== "pricing_asked") return;
          }
          await tx.intentSignal.create({
            data: {
              workspaceId: event.workspaceId,
              contactId: event.contactId,
              source: "first_party",
              type,
              receipt: intentReceipt(type, vertical) ?? type,
              occurredAt: new Date(event.occurredAt),
              meta: { eventId: event.id, eventType: event.type },
            },
          });
        });
      } catch (err) {
        // A signal miss must never dead-letter the event.
        log(`[intent] ${(err as Error).message}`);
      }
    },
  };
}
