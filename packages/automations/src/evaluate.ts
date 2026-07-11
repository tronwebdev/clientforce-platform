/**
 * The rule evaluator (R1, DEC-073) — ONE evaluation pass per event: load the
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
 * Evaluate one bus event against its campaign's rules. Depth is the
 * causation depth this evaluation runs at (bus events start at 0; the
 * evaluator refuses past MAX_RULE_CAUSATION_DEPTH with typed refusal rows).
 */
export async function evaluateEventForRules(
  deps: RuleEngineDeps,
  event: BusEvent,
  opts: { depth?: number } = {},
): Promise<EvaluationSummary> {
  // Rules are per-campaign rows — events without a campaign never evaluate
  // (account-level rules are Phase 6, on this same core). Rule-run events
  // are ours; nothing triggers on them.
  if (!event.campaignId || event.type === "automation.rule.run.v1") return EMPTY_SUMMARY;

  const rules = await loadEnabledRules(deps, event.workspaceId, event.campaignId);
  if (rules.length === 0) return EMPTY_SUMMARY;

  // Paused-enrollment inertness — checked before any matching.
  if (event.enrollmentId) {
    const enrollment = await withTenant(deps.prisma, { workspaceId: event.workspaceId }, (tx) =>
      tx.enrollment.findUnique({
        where: { id: event.enrollmentId! },
        select: { status: true },
      }),
    );
    if (!enrollment || !FIREABLE_STATUSES.has(enrollment.status)) return EMPTY_SUMMARY;
  }

  const matched: ParsedRule[] = [];
  let replyText: string | null | undefined; // lazily loaded once per event
  for (const rule of rules) {
    if (!matchTrigger(rule.trigger, event)) continue;
    if (rule.condition) {
      // keyword_contains refines reply triggers only — on any other trigger
      // (or an unresolvable body) the refinement is unmet and the rule
      // simply doesn't fire.
      if (rule.trigger.kind !== "reply_classified") continue;
      if (replyText === undefined) replyText = await loadReplyText(deps, event);
      if (!replyText || !keywordHit(rule.condition.keywords, replyText)) continue;
    }
    matched.push(rule);
  }
  if (matched.length === 0) return EMPTY_SUMMARY;

  const ctx: RunContext = {
    workspaceId: event.workspaceId,
    campaignId: event.campaignId,
    eventId: event.id,
    contactId: event.contactId,
    enrollmentId: event.enrollmentId,
    depth: opts.depth ?? 0,
    terminalState: { fired: false },
  };
  return executeMatchedRules(deps, ctx, matched);
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
      for (const action of rule.actions) {
        outcomes.push(await executeAction(deps, ctx, rule.id, action));
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
