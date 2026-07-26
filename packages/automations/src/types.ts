/**
 * Engine dependency seams (R1, DEC-074). The package stays Temporal-free —
 * cancel/move are injected the same way the events package injects the
 * signal function (the DEC-035 precedent); callers bind them to a connected
 * client (`cancelWorkflowById` / `moveEnrollmentToNode` in
 * `@clientforce/workflows`).
 */
import type { PrismaClient } from "@clientforce/db";
import type { EventInput, EventType } from "@clientforce/events";
import type {
  CampaignRuleAction,
  CampaignRuleCondition,
  CampaignRuleRunStatus,
  CampaignRuleTrigger,
} from "@clientforce/core";

/** Publishes on the T2 bus (`automation.rule.run.v1`, stage/unsubscribe events). */
export type PublishFn = <T extends EventType>(input: EventInput<T>) => Promise<unknown>;

export interface RuleEngineDeps {
  /** RLS-subject app client — feature queries go through `withTenant`, never the owner client. */
  prisma: PrismaClient;
  /**
   * Optional (environments without Redis persist nothing extra — the
   * CampaignRuleRun row is the history either way; the event is the
   * timeline surface). Publish failures never block a run row.
   */
  publish?: PublishFn;
  /**
   * Cancel an enrollment's durable run by its STORED workflow id (end /
   * pause / suppress are terminal — the run must not continue later via the
   * branch default timeout). Absent or failing = the DB status still
   * persists; the failure is recorded on the run detail and logged, never
   * silent (the classify stopWorkflow precedent).
   */
  cancelWorkflow?: (params: {
    workspaceId: string;
    enrollmentId: string;
    workflowId: string;
  }) => Promise<void>;
  /**
   * The "move to sequence/branch" action: cancel + restart at the target
   * node under a deterministic workflow id (see `moveEnrollmentToNode`).
   * Absent = typed error outcome (MOVE_UNAVAILABLE), never a silent skip.
   */
  moveEnrollment?: (params: {
    workspaceId: string;
    enrollmentId: string;
    targetNodeId: string;
    dedupeKey: string;
  }) => Promise<unknown>;
  /**
   * INT W1 (DEC-093, Q-042): the real notify_team transport — Slack when the
   * workspace connected it. ABSENT keeps the pre-W1 behavior byte-identical
   * (the run row + Logs row stay the Phase-1 transport); failures never
   * change the run outcome, only its detail. `sourceKey` is the delivery
   * dedupe key (`<eventId>#rule:<ruleId>` — redelivery-safe per rule).
   */
  notifyTransport?: (params: {
    workspaceId: string;
    sourceKey: string;
    note?: string;
    contactId?: string | null;
  }) => Promise<{ delivered: boolean; target?: string; detail?: string }>;
  /**
   * INT W3 (DEC-095): the `send_webhook` delivery seam — the notifyTransport
   * twin (absent = the engine is byte-identical; the worker wires the real
   * guard+sign+ledger transport). Failure NEVER changes the run outcome.
   */
  webhookTransport?: (params: {
    workspaceId: string;
    /** Delivery dedupe key (`<eventId>#rule:<id>#a:<i>` — the action path). */
    sourceKey: string;
    /** The action's url override (absent → the integration default). */
    url?: string;
    event: { id: string; type: string; occurredAt: string; contactId?: string | null; payload: unknown };
    rule: { id: string; name?: string };
  }) => Promise<{ delivered: boolean; target?: string; detail?: string }>;
  log?: (msg: string) => void;
}

/** A CampaignRule row with its Json columns parsed through the core unions. */
export interface ParsedRule {
  id: string;
  order: number;
  createdAt: Date;
  trigger: CampaignRuleTrigger;
  condition: CampaignRuleCondition | null;
  actions: CampaignRuleAction[];
}

/**
 * An account-scope `Automation` row parsed through the SAME core unions
 * (R1-UI, DEC-091) — the stored `conditions` ARRAY (Phase-6 reserved shape)
 * normalizes to the evaluator's single-refinement semantics (≤1 entry, the
 * API-enforced bound), so matching is byte-identical across scopes.
 */
export interface ParsedAccountRule {
  id: string;
  createdAt: Date;
  trigger: CampaignRuleTrigger;
  condition: CampaignRuleCondition | null;
  actions: CampaignRuleAction[];
}

/**
 * Per-event terminal state, shared by top-level rules AND actions executed
 * inside `run_automation`: row order, first terminal wins; later terminal
 * actions no-op with a `skipped_conflict` outcome.
 */
export interface TerminalState {
  fired: boolean;
}

/** One evaluation pass's context (one event × one workspace's rules).
 *  `campaignId` is null on account-scope evaluations of campaign-less events
 *  (R1-UI, DEC-091) — campaign rules never evaluate without one. */
export interface RunContext {
  workspaceId: string;
  campaignId: string | null;
  /** Bus Event row id, or the sweep's fire-once key `quiet:<enrollmentId>`. */
  eventId: string;
  contactId: string | null;
  enrollmentId: string | null;
  /** Causation depth — the evaluator refuses depth > MAX_RULE_CAUSATION_DEPTH. */
  depth: number;
  terminalState: TerminalState;
  /**
   * INT W3 (DEC-095): the triggering event's content, for payload-carrying
   * actions (`send_webhook`). Sweep-fired contexts carry a synthetic
   * `sweep.*` type (their fire-once key is not an Event row). Optional so
   * pre-W3 constructions parse unchanged.
   */
  event?: { type: string; payload: unknown; occurredAt: string };
}

export interface ActionOutcomeRecord {
  kind: string;
  outcome: "executed" | "noop" | "skipped_conflict" | "refused_depth" | "error";
  detail?: string;
  /** True when this action (directly or via run_automation) fired a terminal effect. */
  terminal?: boolean;
}

export interface RuleRunRecord {
  ruleId: string;
  /** Null when this delivery found the run already recorded (bus redelivery). */
  runId: string | null;
  status: CampaignRuleRunStatus | "already_recorded";
  /** R1-UI (DEC-091): "account" = an `Automation` row's run (`ruleId` carries
   *  the automation id); absent = a campaign rule's run. */
  scope?: "account";
}

export interface EvaluationSummary {
  /** Rules whose trigger + condition matched this event. */
  matched: number;
  /** A terminal action fired (this delivery or a prior recorded one) — the graph continuation is skipped. */
  terminalFired: boolean;
  runs: RuleRunRecord[];
}

export const EMPTY_SUMMARY: EvaluationSummary = Object.freeze({
  matched: 0,
  terminalFired: false,
  runs: [],
});
