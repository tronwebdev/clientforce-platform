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
