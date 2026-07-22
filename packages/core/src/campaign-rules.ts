/**
 * Per-agent automation rules (R1, DEC-074 — ARCHITECTURE.md §151).
 *
 * The typed When→If→Then vocabulary shared by campaign rules (per-agent, this
 * unit) and the Phase-6 standalone Automations (§152): ONE trigger union, ONE
 * action union, ONE run-record status set — never two evaluators, never two
 * vocabularies (the DEC-034 one-enum rule applied to rules).
 *
 * Intent values stay OPAQUE STRINGS here (the graph/types.ts precedent —
 * the classifier's `Intent` enum lives in `@clientforce/events`; core stays
 * dependency-light). The API boundary validates rule intents against
 * `IntentSchema`; the evaluator matches by set membership either way.
 *
 * Rules own BOOKKEEPING (statuses, notifications, moves, ending, timers);
 * the planner graph owns STRATEGY (what the agent says next). A rule is
 * stored by REFERENCE (automation/node ids resolved live — the B6 rule):
 * a dangling reference renders as an error state and never fires silently.
 */
import { z } from "zod";

// ── Triggers ─────────────────────────────────────────────────────────────────
// Every kind maps to EXISTING bus events (A9 — names ossify, no new trigger
// event kinds): reply_classified ⇒ `*.replied.v1` payload intent ·
// meeting_booked ⇒ `call.booked.v1` OR `lead.stage_changed.v1` toStage
// "booked" · opted_out ⇒ `lead.unsubscribed.v1`/`sms.opted_out.v1` ·
// email_opened/link_clicked ⇒ the SendGrid webhook events ·
// lead_captured ⇒ form/widget/linkedin capture events · sequence_quiet is
// the ONE timer trigger — evaluated by the deterministic worker sweep,
// never a bus subscription.

export const campaignRuleTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reply_classified"),
    /** Classified intents that fire the rule (validated against IntentSchema at the API boundary). */
    intents: z.array(z.string().min(1)).min(1),
  }),
  z.object({ kind: z.literal("meeting_booked") }),
  z.object({ kind: z.literal("opted_out") }),
  z.object({ kind: z.literal("email_opened") }),
  z.object({ kind: z.literal("link_clicked") }),
  z.object({ kind: z.literal("lead_captured") }),
  z.object({
    kind: z.literal("sequence_quiet"),
    /** Days of quiet after the sequence completed before the rule fires (once, ever, per enrollment). */
    days: z.number().int().min(1).max(365),
  }),
  /** INT W2 (DEC-094): a booked meeting MOVED — `calendar.rescheduled.v1`. */
  z.object({ kind: z.literal("meeting_rescheduled") }),
  /** INT W2: a booked meeting fell through — `calendar.canceled.v1` (payload
   *  reason folds the canon's canceled + no-show into ONE kind). */
  z.object({ kind: z.literal("meeting_canceled") }),
  /** INT W2: time-relative — fires when now >= startAt - hours for a booked
   *  Meeting row. NEVER a bus event: the meeting sweep evaluates it (the
   *  sequence_quiet pattern); fire-once per (meeting, startAt) — a reschedule
   *  re-arms it. */
  z.object({
    kind: z.literal("before_meeting"),
    hours: z.number().int().min(1).max(336),
  }),
  /** INT W3 (DEC-095): a payment landed — `payment.received.v1` (the Stripe
   *  detection tier's checkout ingest; canon literal "Payment succeeded"). */
  z.object({ kind: z.literal("payment_received") }),
]);
export type CampaignRuleTrigger = z.infer<typeof campaignRuleTriggerSchema>;
export type CampaignRuleTriggerKind = CampaignRuleTrigger["kind"];

// ── Conditions ───────────────────────────────────────────────────────────────
// Optional REFINEMENT on the trigger — never the primary match (keyword
// matching lost to intent classification in P1.7/DEC-034 and stays a
// refinement forever). Meaningful only on reply triggers (it reads the
// inbound body); on any other trigger it simply never matches.

export const campaignRuleConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("keyword_contains"),
    keywords: z.array(z.string().min(1).max(120)).min(1).max(10),
  }),
]);
export type CampaignRuleCondition = z.infer<typeof campaignRuleConditionSchema>;

// ── Actions ──────────────────────────────────────────────────────────────────
// All idempotent by construction (redelivery can never double-fire an
// observable effect): move dedupes on a deterministic workflow id ·
// suppress is create-if-absent · set_stage publishes only on an actual
// change · add_tag is set-union · end/pause converge on the same status.

export const campaignRuleActionSchema = z.discriminatedUnion("kind", [
  /** TERMINAL — restart the enrollment's run at a graph node (move to sequence/branch). */
  z.object({ kind: z.literal("move_to_node"), targetNodeId: z.string().min(1) }),
  /** TERMINAL — end the campaign for this contact (enrollment DONE, run cancelled). */
  z.object({ kind: z.literal("end_enrollment") }),
  /** TERMINAL — pause this contact (enrollment PAUSED + Logs amber row, run cancelled). */
  z.object({ kind: z.literal("pause_enrollment") }),
  /** TERMINAL — suppression-list add (email+sms where addresses exist) + opt-out + UNSUBSCRIBED. */
  z.object({ kind: z.literal("suppress_contact") }),
  /** Mark converted / set status — a pipeline-stage move (`lead.stage_changed.v1` on change). */
  z.object({
    kind: z.literal("set_stage"),
    stage: z.string().min(1).max(60),
    /** Optional human label for goal-completion moves (C2.9/DEC-059 payload rider). */
    label: z.string().min(1).max(60).optional(),
  }),
  /** Notify the team — the run row + `automation.rule.run.v1` Logs row ARE the
   *  Phase-1 notification surface (no notification transport exists yet — DEC-074
   *  documented default; real channels are Phase 6+). */
  z.object({ kind: z.literal("notify_team"), note: z.string().min(1).max(200).optional() }),
  z.object({ kind: z.literal("add_tag"), tag: z.string().min(1).max(60) }),
  /** INT W2 (DEC-094): NOT a send — flags the enrollment so the NEXT
   *  boundary-gated composed message carries the workspace booking link as a
   *  mustSay entry (grounded by construction; cleared on send). Sends stay
   *  out of rule actions BY DESIGN (Q-039); save-time 422 when no booking
   *  link is configured. */
  z.object({ kind: z.literal("send_booking_link") }),
  /** INT W3 (DEC-095): the send_booking_link twin for the Stripe payment link —
   *  a non-send FLAG (Q-039 stands); the next boundary-gated composed message
   *  carries the per-lead payment link as mustSay; save-time 422 when no
   *  payment link is configured. */
  z.object({ kind: z.literal("send_payment_link") }),
  /** INT W3: POST the triggering event to an external endpoint, signed with
   *  the workspace webhook secret. `url` optional — falls back to the Webhooks
   *  integration's default Payload URL (save-time 422 when neither exists).
   *  Delivery rides the SSRF guard + the IntegrationDelivery ledger; a
   *  delivery failure NEVER changes the run outcome (the notify_team stance). */
  z.object({ kind: z.literal("send_webhook"), url: z.string().url().max(500).optional() }),
  /** Run one of the account-level Automations for the contact (resolved LIVE —
   *  missing/disabled renders an error state and never fires silently). Executes
   *  the automation's actions through the SAME union at causation depth + 1. */
  z.object({ kind: z.literal("run_automation"), automationId: z.string().min(1) }),
]);
export type CampaignRuleAction = z.infer<typeof campaignRuleActionSchema>;
export type CampaignRuleActionKind = CampaignRuleAction["kind"];

/**
 * The terminal set (unit prompt: end / move / pause / suppress). A fired
 * terminal action SKIPS the graph strategy continuation for that event and
 * conflict-suppresses later terminal actions (row order, first wins).
 */
export const TERMINAL_ACTION_KINDS = [
  "move_to_node",
  "end_enrollment",
  "pause_enrollment",
  "suppress_contact",
] as const satisfies readonly CampaignRuleActionKind[];

export function isTerminalAction(action: CampaignRuleAction): boolean {
  return (TERMINAL_ACTION_KINDS as readonly string[]).includes(action.kind);
}

/**
 * The action kinds valid on ACCOUNT-scope rules (`Automation` rows, R1-UI /
 * DEC-091) — the ONE union minus `move_to_node`, whose target is a node in a
 * SPECIFIC campaign's graph: an account rule fires across campaigns, so a
 * pinned node id would be dangling everywhere but one. Campaign View owns
 * move rules (#90); the account CRUD refuses the kind with a typed 422.
 */
export const ACCOUNT_ACTION_KINDS = [
  "end_enrollment",
  "pause_enrollment",
  "suppress_contact",
  "set_stage",
  "notify_team",
  "add_tag",
  "send_booking_link",
  "send_payment_link",
  "send_webhook",
  "run_automation",
] as const satisfies readonly CampaignRuleActionKind[];

export function isAccountAction(action: CampaignRuleAction): boolean {
  return (ACCOUNT_ACTION_KINDS as readonly string[]).includes(action.kind);
}

/**
 * Trigger equality for the duplicate-rule refusal — the ONE definition, moved
 * here from the #90 sub-campaign creator (DEC-077 deferred "dup-check
 * placement moves to the rules layer"): same kind + same payload —
 * `reply_classified` intents compare as SETS, `sequence_quiet` by day count.
 * Overlapping-but-different triggers coexist (row order arbitrates multi-rule
 * events); only an EQUAL trigger is a duplicate. Exhaustive over the union —
 * a new trigger kind fails compilation here.
 */
export function sameTrigger(a: CampaignRuleTrigger, b: CampaignRuleTrigger): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "reply_classified": {
      const other = b as Extract<CampaignRuleTrigger, { kind: "reply_classified" }>;
      const setA = new Set(a.intents);
      const setB = new Set(other.intents);
      return setA.size === setB.size && [...setA].every((i) => setB.has(i));
    }
    case "sequence_quiet":
      return a.days === (b as Extract<CampaignRuleTrigger, { kind: "sequence_quiet" }>).days;
    case "before_meeting":
      return a.hours === (b as Extract<CampaignRuleTrigger, { kind: "before_meeting" }>).hours;
    case "meeting_booked":
    case "meeting_rescheduled":
    case "meeting_canceled":
    case "payment_received":
    case "opted_out":
    case "email_opened":
    case "link_clicked":
    case "lead_captured":
      return true;
  }
}

// ── Account rules (R1-UI, DEC-091) ──────────────────────────────────────────
// The workspace-scoped `Automation` row's Json contract — the SAME typed
// unions as `CampaignRule` (one vocabulary, one executor; scope is a field,
// never a fork). `conditions` is stored as an ARRAY (the DATA_MODEL §6 column
// is plural, reserved for Phase-6 multi-condition AND); this phase accepts at
// most ONE entry so the evaluator's single-refinement semantics stay
// byte-identical across scopes.

export const automationConditionsSchema = z.array(campaignRuleConditionSchema).max(1);

/** The `Automation.trigger/conditions/actions` Json contract + row DTO. */
export const automationRowSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  trigger: campaignRuleTriggerSchema,
  conditions: automationConditionsSchema,
  actions: z.array(campaignRuleActionSchema).min(1),
});
export type AutomationRow = z.infer<typeof automationRowSchema>;

/** Create/update DTO for the account-rules CRUD (`apps/api` automations).
 *  Conditions are legal on reply triggers ONLY — the evaluator's semantics
 *  (a conditioned non-reply rule never fires) enforced at the boundary so a
 *  never-firing rule can't be created quietly. */
export const automationWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    trigger: campaignRuleTriggerSchema,
    conditions: automationConditionsSchema.default([]),
    actions: z.array(campaignRuleActionSchema).min(1).max(10),
  })
  .superRefine((val, ctx) => {
    if (val.conditions.length > 0 && val.trigger.kind !== "reply_classified") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conditions"],
        message: "Keyword filters refine reply triggers only — this trigger would never fire with one",
      });
    }
  });
export type AutomationWrite = z.infer<typeof automationWriteSchema>;

/** Enable/disable DTO (`PATCH /automations/:id`). */
export const automationToggleSchema = z.object({ enabled: z.boolean() });

/** The typed 422 message for a campaign-scoped action on an account rule. */
export const ACCOUNT_ACTION_REFUSAL =
  "Move to a sequence node is campaign-scoped — create that rule from the agent's Campaign View";

/** The typed 422 message for an equal-trigger duplicate (never a silent overwrite). */
export const DUPLICATE_TRIGGER_REFUSAL =
  "An enabled automation already fires on this exact trigger — edit that one, or change the trigger";

// ── Rows ─────────────────────────────────────────────────────────────────────

/** The `CampaignRule.trigger/condition/actions` Json contract + row DTO. */
export const campaignRuleRowSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  campaignId: z.string().min(1),
  /** Evaluation order — rules run ascending; ties break on createdAt. */
  order: z.number().int(),
  trigger: campaignRuleTriggerSchema,
  condition: campaignRuleConditionSchema.nullish(),
  actions: z.array(campaignRuleActionSchema).min(1),
  /** Disabled rules never fire; flipping is instant, no re-plan. */
  enabled: z.boolean(),
  /** Goal-seed provenance (W2) — seeds are rows like any other. */
  seededFrom: z.string().nullish(),
});
export type CampaignRuleRow = z.infer<typeof campaignRuleRowSchema>;

/**
 * Run-record statuses (`CampaignRuleRun.status` — mirrors `AutomationRun`'s
 * plain-String column; the typed set lives here so the two run histories
 * can never fork):
 *   fired            — trigger matched, actions executed (detail lists each outcome)
 *   skipped_conflict — a terminal action was suppressed by an earlier terminal
 *                      (row order, first terminal wins; non-terminal actions still ran)
 *   refused_depth    — causation depth exceeded MAX_RULE_CAUSATION_DEPTH
 *                      (the G2 bounded-→-typed-refusal pattern; never a silent loop)
 *   error            — an action failed or referenced something that no longer
 *                      exists (honest absence — never a silent skip)
 */
export const CAMPAIGN_RULE_RUN_STATUSES = [
  "fired",
  "skipped_conflict",
  "refused_depth",
  "error",
] as const;
export type CampaignRuleRunStatus = (typeof CAMPAIGN_RULE_RUN_STATUSES)[number];

/**
 * Recursion guard: rule → run automation → (Phase 6) enroll → that campaign's
 * rules → … Runs carry a causation depth; the evaluator refuses depth > 2
 * with a typed refusal run row.
 */
export const MAX_RULE_CAUSATION_DEPTH = 2;
