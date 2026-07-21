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
 *
 * M1b (DEC-068): the six-intent reply-strategy taxonomy joins ADDITIVELY —
 * every pre-M1b value stays forever (old Message rows, old graphs, old events
 * remain valid); `question`/`not`/`booked` are retired from classifier
 * EMISSION only (superseded by `info_request`/`not_interested`/`interested`).
 */
export const IntentSchema = z.enum([
  "interested", // buying signal — routes the booking/close branch
  "booked", // explicitly booked / accepted a time (legacy — no longer emitted)
  "replied", // generic reply, none of the sharper labels fit (fallback — routes default)
  "question", // asks something (legacy — superseded by info_request)
  "not", // not interested (legacy — superseded by not_interested)
  "ooo", // auto-reply / out-of-office (prototype chip "Auto-reply")
  "unsubscribe", // demands removal — side effects, never a chip
  // ── M1b (DEC-068) reply-strategy intents ──────────────────────────────────
  "objection_price", // "too expensive" / budget pushback → value-reframe branch
  "objection_timing", // "call me in March" → ack + delayed follow-up branch
  "wrong_person", // "I don't handle this" → referral-ask branch
  "info_request", // needs an answer before moving → answer-from-context + CTA branch
  "not_interested", // clear decline → graceful close, stage lost, NO suppression
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
  // G2 (DEC-071): the guided email composer refused after its bounded retry —
  // the lead's enrollment paused, NOTHING was sent. Deliberately no messageId
  // (no Message row exists — DEC-064: the catalog payload matches reality);
  // the sms twin landed in G1 (DEC-070).
  "email.compose_refused.v1": z.object({
    stepNodeId: z.string(),
    reason: z.string(),
    detail: z.string().optional(),
  }),

  // ── Messaging · SMS ────────────────────────────────────────────────────────
  "sms.sent.v1": z.object({ ...messageRef, segmentCount: z.number().int().nonnegative(), body: z.string().optional() }),
  "sms.delivered.v1": z.object({ ...messageRef }),
  // P2.1 (DEC-061): provider delivery failure (Twilio status callback).
  "sms.failed.v1": z.object({ ...messageRef, reason: z.string().optional(), errorCode: z.string().optional() }),
  "sms.replied.v1": z.object({ ...messageRef, body: z.string(), intent: IntentSchema }),
  "sms.opted_out.v1": z.object({ ...messageRef, reason: z.string().optional() }),
  // G1 (DEC-070): the guided composer refused after its bounded retry — the
  // lead's enrollment paused, NOTHING was sent. Deliberately no messageId
  // (no Message row exists — DEC-064: the catalog payload matches reality).
  "sms.compose_refused.v1": z.object({
    stepNodeId: z.string(),
    reason: z.string(),
    detail: z.string().optional(),
  }),

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
  // P3.1 (DEC-078): the dial boundary refused BEFORE any call existed —
  // window/cap/suppression/allow-list rails (send-sms order, ported). No
  // callId on purpose: no Call row was created (DEC-064: the catalog payload
  // matches reality). This is the Logs row the acceptance demands.
  "call.refused.v1": z.object({
    reason: z.string(),
    detail: z.string().optional(),
    contactId: z.string().optional(),
  }),
  // P3.1 (DEC-078): a composed voice TURN tripped the deterministic per-turn
  // checks mid-call — the turn was replaced by the constant fallback line,
  // the call continued. The sms/email twins pause an enrollment; a live call
  // can't pause, so this event is the audit trail instead.
  "voice.compose_refused.v1": z.object({
    callId: z.string(),
    turn: z.number().int().nonnegative(),
    reason: z.string(),
    detail: z.string().optional(),
  }),

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
  // C2.9 (DEC-059): goal-completion transitions carry the completing
  // campaign's goal + its terminal label — ADDITIVE optional fields, no
  // version bump (legacy payloads stay valid); UIs render `label` verbatim.
  "lead.stage_changed.v1": z.object({
    fromStage: z.string(),
    toStage: z.string(),
    goalKey: z.string().optional(),
    label: z.string().optional(),
    /** P5 W3 (DEC-085): true for human moves (board drag / drawer move) — the
     * manual writers now publish through the bus, and validation must not
     * strip the flag their timeline copy renders. */
    manual: z.boolean().optional(),
  }),
  "lead.unsubscribed.v1": z.object({ channel: z.string().optional() }),

  // ── Lists (C2.8, docs/PLAN_CONTACT_LISTS.md) ───────────────────────────────
  // The Forms/Widget/Automations JOIN POINTS: integrations later subscribe to
  // these (and write memberships with their reserved origin) — no integration
  // UI in v1. `addedBy`: userId | "import" | "automation".
  "list.member.added.v1": z.object({
    listId: z.string(),
    listName: z.string(),
    addedBy: z.string(),
    origin: z.string(),
  }),
  "list.member.removed.v1": z.object({
    listId: z.string(),
    listName: z.string(),
    removedBy: z.string(),
  }),

  // ── Sender deliverability (P5 W1, DEC-083) ─────────────────────────────────
  // State TRANSITIONS of the ledger-derived health engine and the warmup
  // scheduler — emitted by the worker sweep / webhook fast path, never per
  // refused send (send-rail refusals stay uncataloged, the TENANT_SUSPENDED
  // precedent: they live on `Enrollment.meta.blocked`).
  "sender.health_collapsed.v1": z.object({
    senderId: z.string().min(1),
    /** The score that crossed the auto-pause line (0–100). */
    score: z.number(),
    windowDays: z.number().int(),
    bounceRate: z.number().optional(),
    spamRate: z.number().optional(),
  }),
  "sender.health_recovered.v1": z.object({
    senderId: z.string().min(1),
    windowDays: z.number().int(),
    /** Present on a scored recovery; absent when the window drained. */
    score: z.number().optional(),
    /** True when the gate cleared because the sample fell below the floor. */
    lowData: z.boolean().optional(),
  }),
  "sender.warmup_completed.v1": z.object({
    senderId: z.string().min(1),
    days: z.number().int(),
    /** The configured daily limit the ramp finished at. */
    target: z.number().int(),
  }),
  // P5 W2 (DEC-084): the pause/resume audit — the lead.stage_changed pattern
  // (typed from→to, written by the manage endpoint, rendered in the drawer
  // activity timeline). ACTIVE↔PAUSED only; DISABLED is not an owner toggle.
  "sender.status_changed.v1": z.object({
    senderId: z.string().min(1),
    from: z.string(),
    to: z.string(),
  }),
  // P5 W3 (DEC-085): a deliverability spike — a windowed complaint or
  // hard-bounce rate at/over its owner-locked DANGER bound. Edge-triggered
  // per signal (rising edge only, the collapse/recovery pattern); the same
  // predicate that holds a mid-warmup ramp. B1-W4's fleet view consumes these
  // straight off the ledger — no backoffice-specific emission path.
  "sender.spike_detected.v1": z.object({
    senderId: z.string().min(1),
    signal: z.enum(["bounce", "spam"]),
    rate: z.number(),
    threshold: z.number(),
    windowDays: z.number().int(),
  }),

  // ── List hygiene / email validation (LH1, DEC-087) ────────────────────────
  // The enrollment GATE refused a contact — typed, never silent. Unlike
  // send-rail refusals (which live on `Enrollment.meta.blocked`), a gate
  // refusal has NO enrollment row to carry it, so it is cataloged — the
  // G1/G2 compose_refused precedent. The Event row's campaignId/contactId
  // columns put it in the campaign Logs feed.
  "contact.enrollment_refused.v1": z.object({
    reason: z.string(), // CONTACT_INVALID
    detail: z.string().optional(),
    /** Enrollment provenance kind (manual | csv | list) or "drain". */
    origin: z.string().optional(),
  }),
  // One async validation run finished (all items resolved) — the batch's
  // Logs/metering twin: the B1-W2 usage rollup reads billed counts off the
  // verdict cache rows; this event is the timeline surface. Emitted once
  // per batch (guarded transition), never per chunk.
  "validation.batch_completed.v1": z.object({
    batchId: z.string().min(1),
    source: z.string(),
    total: z.number().int().nonnegative(),
    valid: z.number().int().nonnegative(),
    risky: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    skippedSuppressed: z.number().int().nonnegative(),
    /** Paid provider verifications (≤ total — free filters run first). */
    billed: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
  }),
  // Validation for a batch is HELD (workspace allowance / platform spend
  // ceiling / provider down) — the honest "validation queued" state. Rising
  // edge per batch-hold episode; contacts stay `unverified` + held at the
  // gate, NOTHING silently enrolls. The ceiling variant doubles as the
  // vendor-spine cost alert.
  "validation.paused.v1": z.object({
    batchId: z.string().min(1),
    reason: z.string(), // workspace_allowance | platform_spend_ceiling | provider_unavailable
    pendingCount: z.number().int().nonnegative(),
  }),

  // ── Billing ────────────────────────────────────────────────────────────────
  "payment.received.v1": z.object({ amount: z.number().int(), channel: z.string().optional() }),
  "credits.consumed.v1": z.object({ amount: z.number().int(), channel: z.string(), balance: z.number().int() }),
  "credits.low.v1": z.object({ balance: z.number().int() }),

  // ── Integrations ───────────────────────────────────────────────────────────
  // INT W1 (DEC-093): the connect/disconnect/health audit rides the ledger —
  // spine 1, no backoffice-specific emission path. `accountLabel` is an
  // ADDITIVE optional field on the pre-existing connected event (no version
  // bump); `sync_failed` stays the DELIVERY-failure row (a probe failure is a
  // status transition, not a sync).
  "integration.connected.v1": z.object({ provider: z.string(), accountLabel: z.string().optional() }),
  "integration.sync_failed.v1": z.object({ provider: z.string(), error: z.string().optional() }),
  // The user disconnected — the row is deleted; this ledger row is what
  // outlives it (the automation.deleted stance). W1 emits `reason: "user"`
  // ONLY: an out-of-band dead token KEEPS the row and rides
  // `integration.status_changed.v1` (to: "revoked") instead. The enum widens
  // additively in whichever wave adds a forced-disconnect emitter.
  "integration.disconnected.v1": z.object({
    provider: z.string(),
    reason: z.enum(["user"]).optional(),
  }),
  // Probe-backed status transitions ONLY (the sender.status_changed pattern —
  // written on an ACTUAL change, never per probe sweep).
  "integration.status_changed.v1": z.object({
    provider: z.string(),
    from: z.enum(["connected", "unhealthy", "revoked"]),
    to: z.enum(["connected", "unhealthy", "revoked"]),
  }),
  // One outbound notification delivered (Slack post, later webhook POST …) —
  // the drawer audit trail + Logs twin of an IntegrationDelivery row.
  // `kind`: new_reply | meeting_booked | goal_completed | notify_team (W1).
  "integration.notified.v1": z.object({
    provider: z.string(),
    kind: z.string(),
    /** Human-readable destination ("#clientforce-alerts") — never a secret. */
    target: z.string().optional(),
    /** The catalog event id that caused this delivery (redelivery dedupe key). */
    sourceEventId: z.string().optional(),
  }),
  // Rising-edge per hold episode when the per-workspace daily delivery
  // allowance trips — the vendor-spine cost-alert twin (validation.paused
  // precedent); deliveries resume silently next day.
  "integration.delivery_held.v1": z.object({
    provider: z.string(),
    reason: z.string(), // workspace_delivery_allowance
  }),

  // ── Automations (R1, DEC-074) ──────────────────────────────────────────────
  // One per-agent rule evaluation outcome — the `CampaignRuleRun` row's Logs
  // twin (fired · skipped_conflict · refused_depth · error, the core status
  // set). Emitted per run row, never instead of it: the row is the history,
  // this is the timeline surface. Mirrors how G1/G2 added compose_refused.
  "automation.rule.run.v1": z.object({
    ruleId: z.string().min(1),
    runId: z.string().min(1),
    status: z.string(),
    /** The rule's trigger kind (e.g. "reply_classified") — for log rendering. */
    trigger: z.string(),
    detail: z.string().optional(),
    /** R1-UI (DEC-091, additive): "account" = an `Automation` row's run
     * (`ruleId` carries the automation id, `runId` the AutomationRun id);
     * absent = a campaign rule's run — the pre-existing meaning, byte-compatible. */
    scope: z.enum(["campaign", "account"]).optional(),
  }),
  // R1-UI (DEC-091): the account-rules manage audit — enable/disable
  // (the sender.status_changed pattern: typed from→to, written by the manage
  // endpoint on an ACTUAL change only) and delete (the row is gone; this
  // ledger row is what outlives it). Fleet-visible off the ledger, no
  // backoffice-specific emission path (the spike_detected stance).
  "automation.status_changed.v1": z.object({
    automationId: z.string().min(1),
    from: z.enum(["enabled", "disabled"]),
    to: z.enum(["enabled", "disabled"]),
  }),
  "automation.deleted.v1": z.object({
    automationId: z.string().min(1),
    name: z.string(),
    /** The deleted rule's trigger kind — for log rendering after the row is gone. */
    trigger: z.string(),
  }),
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
  EMAIL_COMPOSE_REFUSED: "email.compose_refused.v1",
  SMS_SENT: "sms.sent.v1",
  SMS_DELIVERED: "sms.delivered.v1",
  SMS_FAILED: "sms.failed.v1",
  SMS_REPLIED: "sms.replied.v1",
  SMS_OPTED_OUT: "sms.opted_out.v1",
  SMS_COMPOSE_REFUSED: "sms.compose_refused.v1",
  WHATSAPP_SENT: "whatsapp.sent.v1",
  WHATSAPP_DELIVERED: "whatsapp.delivered.v1",
  WHATSAPP_REPLIED: "whatsapp.replied.v1",
  WHATSAPP_BUTTON_CLICKED: "whatsapp.button_clicked.v1",
  CALL_STARTED: "call.started.v1",
  CALL_COMPLETED: "call.completed.v1",
  CALL_FAILED: "call.failed.v1",
  CALL_BOOKED: "call.booked.v1",
  CALL_REFUSED: "call.refused.v1",
  VOICE_COMPOSE_REFUSED: "voice.compose_refused.v1",
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
  LIST_MEMBER_ADDED: "list.member.added.v1",
  LIST_MEMBER_REMOVED: "list.member.removed.v1",
  CONTACT_ENROLLMENT_REFUSED: "contact.enrollment_refused.v1",
  VALIDATION_BATCH_COMPLETED: "validation.batch_completed.v1",
  VALIDATION_PAUSED: "validation.paused.v1",
  SENDER_HEALTH_COLLAPSED: "sender.health_collapsed.v1",
  SENDER_HEALTH_RECOVERED: "sender.health_recovered.v1",
  SENDER_WARMUP_COMPLETED: "sender.warmup_completed.v1",
  SENDER_STATUS_CHANGED: "sender.status_changed.v1",
  SENDER_SPIKE_DETECTED: "sender.spike_detected.v1",
  PAYMENT_RECEIVED: "payment.received.v1",
  CREDITS_CONSUMED: "credits.consumed.v1",
  CREDITS_LOW: "credits.low.v1",
  INTEGRATION_CONNECTED: "integration.connected.v1",
  INTEGRATION_SYNC_FAILED: "integration.sync_failed.v1",
  INTEGRATION_DISCONNECTED: "integration.disconnected.v1",
  INTEGRATION_STATUS_CHANGED: "integration.status_changed.v1",
  INTEGRATION_NOTIFIED: "integration.notified.v1",
  INTEGRATION_DELIVERY_HELD: "integration.delivery_held.v1",
  AUTOMATION_RULE_RUN: "automation.rule.run.v1",
  AUTOMATION_STATUS_CHANGED: "automation.status_changed.v1",
  AUTOMATION_DELETED: "automation.deleted.v1",
} as const satisfies Record<string, EventType>;
