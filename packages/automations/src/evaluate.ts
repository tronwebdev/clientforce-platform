/**
 * The rule evaluator (R1, DEC-074) — ONE evaluation pass per event: load the
 * campaign's enabled rules in row order, match trigger + condition, execute
 * actions through the shared executors, record one `CampaignRuleRun` per
 * matched rule, publish one `automation.rule.run.v1` per run row.
 *
 * Delivery semantics: at-least-once (T2's BullMQ default) with IDEMPOTENT
 * executors — actions run first, the run row (unique on ruleId+eventId)
 * records last. A redelivery re-executes converged no-ops and dedupes the
 * record; a crash mid-pass loses nothing (the next delivery finishes the
 * remaining rules, reading prior rules' terminal flags off their rows).
 *
 * Inertness: rules fire only for ACTIVE and DONE enrollments — PAUSED per
 * the unit prompt (a trap-paused contact stays inert), UNSUBSCRIBED/BOUNCED
 * as the documented default (a removed contact must not trigger campaign
 * bookkeeping). Suppression rails run upstream and are untouched.
 */
import {
  automationConditionsSchema,
  campaignRuleActionSchema,
  campaignRuleConditionSchema,
  campaignRuleTriggerSchema,
  MAX_RULE_CAUSATION_DEPTH,
  type CampaignRuleRunStatus,
} from "@clientforce/core";
import { Prisma, withTenant } from "@clientforce/db";
import type { BusEvent } from "@clientforce/events";
import { z } from "zod";
import { executeAction } from "./executors";
import { keywordHit, matchTrigger } from "./match";
import {
  EMPTY_SUMMARY,
  type ActionOutcomeRecord,
  type EvaluationSummary,
  type ParsedAccountRule,
  type ParsedRule,
  type RuleEngineDeps,
  type RunContext,
} from "./types";

const actionsSchema = z.array(campaignRuleActionSchema).min(1);

/** Enrollment statuses rules may fire for (DONE included — late replies + the quiet sweep). */
const FIREABLE_STATUSES = new Set(["ACTIVE", "DONE"]);

export async function loadEnabledRules(
  deps: RuleEngineDeps,
  workspaceId: string,
  campaignId: string,
): Promise<ParsedRule[]> {
  const log = deps.log ?? console.warn;
  const rows = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.campaignRule.findMany({
      where: { campaignId, enabled: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
  );
  const parsed: ParsedRule[] = [];
  for (const row of rows) {
    const trigger = campaignRuleTriggerSchema.safeParse(row.trigger);
    const condition =
      row.condition == null
        ? { success: true as const, data: null }
        : campaignRuleConditionSchema.safeParse(row.condition);
    const actions = actionsSchema.safeParse(row.actions);
    if (!trigger.success || !condition.success || !actions.success) {
      // An unparseable row can't even say what it triggers on — the UI
      // renders its error state from live resolution (B6); writing a run row
      // per passing event would flood the history. Loud log, never a fire.
      log(`[automations] campaign rule ${row.id} has an invalid shape — skipped (renders as error state)`);
      continue;
    }
    parsed.push({
      id: row.id,
      order: row.order,
      createdAt: row.createdAt,
      trigger: trigger.data,
      condition: condition.data ?? null,
      actions: actions.data,
    });
  }
  return parsed;
}

/**
 * Load the workspace's enabled ACCOUNT rules (`Automation` rows — R1-UI,
 * DEC-091) parsed through the SAME core unions, in creation order (the
 * account-scope evaluation order: `Automation` carries no `order` column;
 * createdAt asc is the deterministic default, documented in DEC-091).
 * An unparseable row is skipped loudly — it renders as an error state in
 * the Automations list (B6 live resolution), never fires silently.
 */
export async function loadEnabledAccountRules(
  deps: RuleEngineDeps,
  workspaceId: string,
): Promise<ParsedAccountRule[]> {
  const log = deps.log ?? console.warn;
  const rows = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.automation.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } }),
  );
  const parsed: ParsedAccountRule[] = [];
  for (const row of rows) {
    const trigger = campaignRuleTriggerSchema.safeParse(row.trigger);
    const conditions = automationConditionsSchema.safeParse(row.conditions);
    const actions = actionsSchema.safeParse(row.actions);
    if (!trigger.success || !conditions.success || !actions.success) {
      log(`[automations] automation ${row.id} has an invalid shape — skipped (renders as error state)`);
      continue;
    }
    parsed.push({
      id: row.id,
      createdAt: row.createdAt,
      trigger: trigger.data,
      condition: conditions.data[0] ?? null,
      actions: actions.data,
    });
  }
  return parsed;
}

/**
 * Evaluate one bus event: the campaign's rules first (more specific — row
 * order), then the workspace's ACCOUNT rules (R1-UI, DEC-091; creation
 * order) through the SAME match + executors with ONE shared terminal state —
 * first terminal wins ACROSS scopes, and an account terminal gates the graph
 * continuation through the same memoized summary. Events without a campaign
 * evaluate account rules only. Depth is the causation depth this evaluation
 * runs at (bus events start at 0; the evaluator refuses past
 * MAX_RULE_CAUSATION_DEPTH with typed refusal rows).
 */
export async function evaluateEventForRules(
  deps: RuleEngineDeps,
  event: BusEvent,
  opts: { depth?: number } = {},
): Promise<EvaluationSummary> {
  // automation.* events are ours (run rows, manage audit) — nothing triggers
  // on them, ever: the loop-safety guard, extended from the rule.run-only
  // check when account rules began evaluating campaign-less events (DEC-091).
  if (event.type.startsWith("automation.")) return EMPTY_SUMMARY;

  const rules = event.campaignId
    ? await loadEnabledRules(deps, event.workspaceId, event.campaignId)
    : [];
  const accountRules = await loadEnabledAccountRules(deps, event.workspaceId);
  if (rules.length === 0 && accountRules.length === 0) return EMPTY_SUMMARY;

  // Paused-enrollment inertness — checked ONCE, before any matching, for
  // both scopes (a trap-paused or removed contact stays inert everywhere).
  if (event.enrollmentId) {
    const enrollment = await withTenant(deps.prisma, { workspaceId: event.workspaceId }, (tx) =>
      tx.enrollment.findUnique({
        where: { id: event.enrollmentId! },
        select: { status: true },
      }),
    );
    if (!enrollment || !FIREABLE_STATUSES.has(enrollment.status)) return EMPTY_SUMMARY;
  }

  let replyText: string | null | undefined; // lazily loaded once per event
  const conditionMet = async (rule: ParsedRule | ParsedAccountRule): Promise<boolean> => {
    if (!rule.condition) return true;
    // keyword_contains refines reply triggers only — on any other trigger
    // (or an unresolvable body) the refinement is unmet and the rule
    // simply doesn't fire.
    if (rule.trigger.kind !== "reply_classified") return false;
    if (replyText === undefined) replyText = await loadReplyText(deps, event);
    return !!replyText && keywordHit(rule.condition.keywords, replyText);
  };

  const matched: ParsedRule[] = [];
  for (const rule of rules) {
    if (matchTrigger(rule.trigger, event) && (await conditionMet(rule))) matched.push(rule);
  }
  const matchedAccount: ParsedAccountRule[] = [];
  for (const rule of accountRules) {
    if (matchTrigger(rule.trigger, event) && (await conditionMet(rule))) matchedAccount.push(rule);
  }
  if (matched.length === 0 && matchedAccount.length === 0) return EMPTY_SUMMARY;

  const ctx: RunContext = {
    workspaceId: event.workspaceId,
    campaignId: event.campaignId,
    eventId: event.id,
    contactId: event.contactId,
    enrollmentId: event.enrollmentId,
    depth: opts.depth ?? 0,
    terminalState: { fired: false },
    // INT W3: payload-carrying actions (send_webhook) POST the real event.
    event: { type: event.type, payload: event.payload, occurredAt: event.occurredAt },
  };
  const summary = await executeMatchedRules(deps, ctx, matched);
  const accountSummary = await executeMatchedAccountRules(deps, ctx, matchedAccount);
  return {
    matched: summary.matched + accountSummary.matched,
    terminalFired: summary.terminalFired || accountSummary.terminalFired,
    runs: [...summary.runs, ...accountSummary.runs],
  };
}

/**
 * Execute already-matched rules in row order against one context. Shared by
 * the bus path (above) and the sequence-quiet sweep (which pre-matches by
 * quiet-day computation and passes a synthetic fire-once eventId).
 */
export async function executeMatchedRules(
  deps: RuleEngineDeps,
  ctx: RunContext,
  matched: ParsedRule[],
): Promise<EvaluationSummary> {
  const log = deps.log ?? console.warn;
  const summary: EvaluationSummary = { matched: matched.length, terminalFired: false, runs: [] };

  for (const rule of matched) {
    // Idempotency: unique (ruleId, eventId) — a redelivery reads the prior
    // row's terminal flag instead of re-firing.
    const existing = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
      tx.campaignRuleRun.findUnique({
        where: { ruleId_eventId: { ruleId: rule.id, eventId: ctx.eventId } },
      }),
    );
    if (existing) {
      const detail = existing.detail as { terminal?: boolean } | null;
      if (detail?.terminal) {
        ctx.terminalState.fired = true;
        summary.terminalFired = true;
      }
      summary.runs.push({ ruleId: rule.id, runId: existing.id, status: "already_recorded" });
      continue;
    }

    let status: CampaignRuleRunStatus;
    const outcomes: ActionOutcomeRecord[] = [];
    if (ctx.depth > MAX_RULE_CAUSATION_DEPTH) {
      // The G2 pattern: a typed refusal row, never a silent loop.
      status = "refused_depth";
    } else {
      for (const [i, action] of rule.actions.entries()) {
        outcomes.push(await executeAction(deps, ctx, rule.id, action, `#a:${i}`));
      }
      const anyConflict = outcomes.some((o) => o.outcome === "skipped_conflict");
      const anyRefused = outcomes.some((o) => o.outcome === "refused_depth");
      const anyError = outcomes.some((o) => o.outcome === "error");
      status = anyConflict ? "skipped_conflict" : anyRefused ? "refused_depth" : anyError ? "error" : "fired";
    }
    const ruleTerminal = outcomes.some((o) => o.terminal === true);
    if (ruleTerminal) summary.terminalFired = true;

    let runId: string | null = null;
    try {
      const row = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
        tx.campaignRuleRun.create({
          data: {
            workspaceId: ctx.workspaceId,
            ruleId: rule.id,
            enrollmentId: ctx.enrollmentId,
            contactId: ctx.contactId,
            eventId: ctx.eventId,
            status,
            depth: ctx.depth,
            detail: {
              trigger: rule.trigger.kind,
              terminal: ruleTerminal,
              actions: outcomes,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
      );
      runId = row.id;
    } catch (err) {
      // A concurrent redelivery raced us to the unique key — its row is the
      // record; executors are idempotent so nothing double-fired.
      if ((err as { code?: string }).code === "P2002") {
        summary.runs.push({ ruleId: rule.id, runId: null, status: "already_recorded" });
        continue;
      }
      throw err;
    }
    summary.runs.push({ ruleId: rule.id, runId, status });

    if (deps.publish) {
      try {
        await deps.publish({
          type: "automation.rule.run.v1",
          workspaceId: ctx.workspaceId,
          contactId: ctx.contactId,
          enrollmentId: ctx.enrollmentId,
          campaignId: ctx.campaignId,
          payload: {
            ruleId: rule.id,
            runId,
            status,
            trigger: rule.trigger.kind,
            ...(status === "fired"
              ? {}
              : { detail: outcomes.map((o) => `${o.kind}=${o.outcome}`).join(", ") || status }),
          },
        });
      } catch (err) {
        log(
          `[automations] automation.rule.run.v1 publish failed for run ${runId}: ` +
            `${err instanceof Error ? err.message : String(err)} — run row persisted regardless`,
        );
      }
    }
  }
  return summary;
}

/**
 * Execute already-matched ACCOUNT rules (R1-UI, DEC-091) against one context —
 * the `executeMatchedRules` twin with the account record sink: same shared
 * executors, same terminal state (campaign terminals recorded earlier in the
 * pass suppress account terminals — first wins across scopes), idempotency on
 * unique (automationId, eventId), one `AutomationRun` row per matched rule,
 * one `automation.rule.run.v1` (scope "account") per row. Shared by the bus
 * path and the sequence-quiet sweep's account pass.
 */
export async function executeMatchedAccountRules(
  deps: RuleEngineDeps,
  ctx: RunContext,
  matched: ParsedAccountRule[],
): Promise<EvaluationSummary> {
  const log = deps.log ?? console.warn;
  const summary: EvaluationSummary = { matched: matched.length, terminalFired: false, runs: [] };

  for (const rule of matched) {
    const existing = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
      tx.automationRun.findUnique({
        where: { automationId_eventId: { automationId: rule.id, eventId: ctx.eventId } },
      }),
    );
    if (existing) {
      const detail = existing.detail as { terminal?: boolean } | null;
      if (detail?.terminal) {
        ctx.terminalState.fired = true;
        summary.terminalFired = true;
      }
      summary.runs.push({ ruleId: rule.id, runId: existing.id, status: "already_recorded", scope: "account" });
      continue;
    }

    let status: CampaignRuleRunStatus;
    const outcomes: ActionOutcomeRecord[] = [];
    if (ctx.depth > MAX_RULE_CAUSATION_DEPTH) {
      status = "refused_depth";
    } else {
      for (const [i, action] of rule.actions.entries()) {
        outcomes.push(await executeAction(deps, ctx, rule.id, action, `#a:${i}`));
      }
      const anyConflict = outcomes.some((o) => o.outcome === "skipped_conflict");
      const anyRefused = outcomes.some((o) => o.outcome === "refused_depth");
      const anyError = outcomes.some((o) => o.outcome === "error");
      status = anyConflict ? "skipped_conflict" : anyRefused ? "refused_depth" : anyError ? "error" : "fired";
    }
    const ruleTerminal = outcomes.some((o) => o.terminal === true);
    if (ruleTerminal) summary.terminalFired = true;

    let runId: string | null = null;
    try {
      const row = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
        tx.automationRun.create({
          data: {
            workspaceId: ctx.workspaceId,
            automationId: rule.id,
            eventId: ctx.eventId,
            status,
            detail: {
              trigger: rule.trigger.kind,
              terminal: ruleTerminal,
              depth: ctx.depth,
              ...(ctx.contactId ? { contactId: ctx.contactId } : {}),
              ...(ctx.enrollmentId ? { enrollmentId: ctx.enrollmentId } : {}),
              actions: outcomes,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
      );
      runId = row.id;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        summary.runs.push({ ruleId: rule.id, runId: null, status: "already_recorded", scope: "account" });
        continue;
      }
      throw err;
    }
    summary.runs.push({ ruleId: rule.id, runId, status, scope: "account" });

    if (deps.publish) {
      try {
        await deps.publish({
          type: "automation.rule.run.v1",
          workspaceId: ctx.workspaceId,
          contactId: ctx.contactId,
          enrollmentId: ctx.enrollmentId,
          campaignId: ctx.campaignId,
          payload: {
            ruleId: rule.id,
            runId,
            status,
            trigger: rule.trigger.kind,
            scope: "account",
            ...(status === "fired"
              ? {}
              : { detail: outcomes.map((o) => `${o.kind}=${o.outcome}`).join(", ") || status }),
          },
        });
      } catch (err) {
        log(
          `[automations] automation.rule.run.v1 publish failed for account run ${runId}: ` +
            `${err instanceof Error ? err.message : String(err)} — run row persisted regardless`,
        );
      }
    }
  }
  return summary;
}

/** Reply text for the keyword refinement: sms carries it; email loads the inbound Message. */
async function loadReplyText(deps: RuleEngineDeps, event: BusEvent): Promise<string | null> {
  const payload = event.payload as { body?: unknown; messageId?: unknown };
  if (typeof payload.body === "string") return payload.body;
  if (typeof payload.messageId !== "string") return null;
  const message = await withTenant(deps.prisma, { workspaceId: event.workspaceId }, (tx) =>
    tx.message.findUnique({ where: { id: payload.messageId as string }, select: { body: true } }),
  );
  return message?.body ?? null;
}
