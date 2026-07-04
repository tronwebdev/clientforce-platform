/**
 * Event catalog — the typed, versioned source of truth (DATA_MODEL.md §5).
 *
 * The full v1 catalog. Each event type maps to a zod schema for its payload (the
 * "key payload fields" from the spec); `EVENT_SCHEMAS` is the source of truth and
 * both `EventType` and `EventPayloads` are derived from it, so adding an event =
 * adding one schema entry (+ optionally a symbolic constant).
 */
import { z } from "zod";

/**
 * Classified reply intent (attached by the Claude classifier — §5 rule).
 *
 * DEC-034: the labels ARE the prototype's Inbox category chips (`inboxCatDefs`
 * in `Campaign View.dc.html` — `all` is a filter, not a label), plus
 * `unsubscribe`, which never renders as a chip: an unsubscribe thread leaves
 * the Inbox for Suppression. Classifier, catalog, and the P1.8 Inbox UI all
 * share this one enum — do not fork it.
 */
export const IntentSchema = z.enum([
  "interested", // buying signal
  "booked", // explicitly booked / accepted a time
  "replied", // generic reply, none of the sharper labels fit
  "question", // asks something / needs info before moving
  "not", // not interested (prototype chip "Not interested")
  "ooo", // auto-reply / out-of-office (prototype chip "Auto-reply")
  "unsubscribe", // demands removal — side effects, never a chip
]);
export type Intent = z.infer<typeof IntentSchema>;

const messageRef = { messageId: z.string().min(1) };

/**
 * Per-event payload schemas. Keys are the versioned event-type strings. Schemas
 * encode the documented key fields; optional fields stay optional so producers
 * aren't over-constrained.
 */
export const EVENT_SCHEMAS = {
  // ── Messaging · email ──────────────────────────────────────────────────────
  "email.sent.v1": z.object({ ...messageRef, stepNodeId: z.string().optional(), to: z.string().optional() }),
  "email.delivered.v1": z.object({ ...messageRef }),
  "email.opened.v1": z.object({ ...messageRef, link: z.string().optional() }),
  "email.clicked.v1": z.object({ ...messageRef, link: z.string() }),
  "email.bounced.v1": z.object({ ...messageRef, reason: z.string().optional() }),
  "email.spam.v1": z.object({ ...messageRef }),
  "email.replied.v1": z.object({ ...messageRef, intent: IntentSchema }),

  // ── Messaging · SMS ────────────────────────────────────────────────────────
  "sms.sent.v1": z.object({ ...messageRef, segmentCount: z.number().int().nonnegative(), body: z.string().optional() }),
  "sms.delivered.v1": z.object({ ...messageRef }),
  "sms.replied.v1": z.object({ ...messageRef, body: z.string(), intent: IntentSchema }),
  "sms.opted_out.v1": z.object({ ...messageRef, reason: z.string().optional() }),

  // ── Messaging · WhatsApp ───────────────────────────────────────────────────
  "whatsapp.sent.v1": z.object({ ...messageRef, templateId: z.string() }),
  "whatsapp.delivered.v1": z.object({ ...messageRef }),
  "whatsapp.replied.v1": z.object({ ...messageRef, intent: IntentSchema, button: z.string().optional() }),
  "whatsapp.button_clicked.v1": z.object({ ...messageRef, button: z.string() }),

  // ── Voice ──────────────────────────────────────────────────────────────────
  "call.started.v1": z.object({ callId: z.string() }),
  "call.completed.v1": z.object({
    callId: z.string(),
    durationSec: z.number().int().nonnegative(),
    outcome: z.string(),
    transcriptId: z.string().optional(),
    recordingUrl: z.string().optional(),
  }),
  "call.failed.v1": z.object({ callId: z.string(), reason: z.string().optional() }),
  "call.booked.v1": z.object({ callId: z.string(), durationSec: z.number().int().nonnegative().optional(), outcome: z.string().optional() }),

  // ── Inbound ────────────────────────────────────────────────────────────────
  "form.submitted.v1": z.object({ formId: z.string(), fields: z.record(z.unknown()), routedTo: z.string().optional() }),
  "widget.conversation_started.v1": z.object({ widgetId: z.string() }),
  "widget.lead_captured.v1": z.object({ widgetId: z.string(), fields: z.record(z.unknown()), routedTo: z.string().optional() }),
  "linkedin.captured.v1": z.object({ fields: z.record(z.unknown()), routedTo: z.string().optional() }),

  // ── Proposals ──────────────────────────────────────────────────────────────
  "proposal.sent.v1": z.object({ proposalId: z.string(), trackedLinkId: z.string() }),
  "proposal.viewed.v1": z.object({ proposalId: z.string(), trackedLinkId: z.string() }),
  "proposal.accepted.v1": z.object({ proposalId: z.string(), trackedLinkId: z.string() }),
  "proposal.paid.v1": z.object({ proposalId: z.string(), trackedLinkId: z.string(), amount: z.number().int() }),

  // ── Pipeline ───────────────────────────────────────────────────────────────
  // `lead.replied` was removed from the canonical catalog (handoff A9 /
  // DEC-018, aligned in P1.7): replies are channel events — `email.replied.v1`.
  "lead.enrolled.v1": z.object({ campaignId: z.string().optional() }),
  "lead.stage_changed.v1": z.object({ fromStage: z.string(), toStage: z.string() }),
  "lead.unsubscribed.v1": z.object({ channel: z.string().optional() }),

  // ── Billing ────────────────────────────────────────────────────────────────
  "payment.received.v1": z.object({ amount: z.number().int(), channel: z.string().optional() }),
  "credits.consumed.v1": z.object({ amount: z.number().int(), channel: z.string(), balance: z.number().int() }),
  "credits.low.v1": z.object({ balance: z.number().int() }),

  // ── Integrations ───────────────────────────────────────────────────────────
  "integration.connected.v1": z.object({ provider: z.string() }),
  "integration.sync_failed.v1": z.object({ provider: z.string(), error: z.string().optional() }),
} satisfies Record<string, z.ZodTypeAny>;

/** The union of all versioned event-type strings. */
export type EventType = keyof typeof EVENT_SCHEMAS;

/** Map of event type → its inferred payload type. */
export type EventPayloads = { [K in EventType]: z.infer<(typeof EVENT_SCHEMAS)[K]> };

/** All event types as an array (e.g. for registration/iteration). */
export const EVENT_TYPES_LIST = Object.keys(EVENT_SCHEMAS) as EventType[];

/**
 * Symbolic constants for ergonomic, refactor-safe references in producer code,
 * e.g. `EVENT_TYPES.EMAIL_REPLIED`. Values are checked against `EventType`.
 */
export const EVENT_TYPES = {
  EMAIL_SENT: "email.sent.v1",
  EMAIL_DELIVERED: "email.delivered.v1",
  EMAIL_OPENED: "email.opened.v1",
  EMAIL_CLICKED: "email.clicked.v1",
  EMAIL_BOUNCED: "email.bounced.v1",
  EMAIL_SPAM: "email.spam.v1",
  EMAIL_REPLIED: "email.replied.v1",
  SMS_SENT: "sms.sent.v1",
  SMS_DELIVERED: "sms.delivered.v1",
  SMS_REPLIED: "sms.replied.v1",
  SMS_OPTED_OUT: "sms.opted_out.v1",
  WHATSAPP_SENT: "whatsapp.sent.v1",
  WHATSAPP_DELIVERED: "whatsapp.delivered.v1",
  WHATSAPP_REPLIED: "whatsapp.replied.v1",
  WHATSAPP_BUTTON_CLICKED: "whatsapp.button_clicked.v1",
  CALL_STARTED: "call.started.v1",
  CALL_COMPLETED: "call.completed.v1",
  CALL_FAILED: "call.failed.v1",
  CALL_BOOKED: "call.booked.v1",
  FORM_SUBMITTED: "form.submitted.v1",
  WIDGET_CONVERSATION_STARTED: "widget.conversation_started.v1",
  WIDGET_LEAD_CAPTURED: "widget.lead_captured.v1",
  LINKEDIN_CAPTURED: "linkedin.captured.v1",
  PROPOSAL_SENT: "proposal.sent.v1",
  PROPOSAL_VIEWED: "proposal.viewed.v1",
  PROPOSAL_ACCEPTED: "proposal.accepted.v1",
  PROPOSAL_PAID: "proposal.paid.v1",
  LEAD_ENROLLED: "lead.enrolled.v1",
  LEAD_STAGE_CHANGED: "lead.stage_changed.v1",
  LEAD_UNSUBSCRIBED: "lead.unsubscribed.v1",
  PAYMENT_RECEIVED: "payment.received.v1",
  CREDITS_CONSUMED: "credits.consumed.v1",
  CREDITS_LOW: "credits.low.v1",
  INTEGRATION_CONNECTED: "integration.connected.v1",
  INTEGRATION_SYNC_FAILED: "integration.sync_failed.v1",
} as const satisfies Record<string, EventType>;
