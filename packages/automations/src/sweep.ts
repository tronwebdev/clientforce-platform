/**
 * The sequence-quiet sweep (R1, DEC-073) — the ONE trigger needing more than
 * a bus subscription ("sequence completed + N days quiet"). Deterministic
 * poll, NOT Temporal workflow surgery: DONE enrollments whose last touch
 * (enrollment update or any message) is ≥ N days old fire their campaign's
 * `sequence_quiet` rules through the SAME executor path as bus events.
 *
 * Fire-once semantics live in the run key, not the schedule: the synthetic
 * eventId `quiet:<enrollmentId>` under the (ruleId, eventId) unique means a
 * (rule, enrollment) pair fires AT MOST ONCE, EVER — the worker may poll
 * hourly (bounding latency) and every later pass is a no-op. Discovery reads
 * are cross-tenant on the OWNER client (the stranded-source-sweep precedent);
 * all writes go through the evaluator's RLS-subject tenant path.
 */
import type { PrismaClient } from "@clientforce/db";
import { executeMatchedRules } from "./evaluate";
import type { ParsedRule, RuleEngineDeps, RunContext } from "./types";
import { campaignRuleActionSchema, campaignRuleTriggerSchema } from "@clientforce/core";
import { z } from "zod";

const DAY_MS = 86_400_000;
const RULE_BATCH = 500;
const ENROLLMENT_BATCH = 200;

const actionsSchema = z.array(campaignRuleActionSchema).min(1);

export interface QuietSweepDeps extends RuleEngineDeps {
  /** Cross-tenant discovery read — owner client (never used for writes). */
  ownerPrisma: PrismaClient;
}

export function quietEventIdFor(enrollmentId: string): string {
  return `quiet:${enrollmentId}`;
}

export async function runSequenceQuietSweep(
  deps: QuietSweepDeps,
  now: Date = new Date(),
): Promise<{ checked: number; fired: number }> {
  const log = deps.log ?? console.warn;
  const rows = await deps.ownerPrisma.campaignRule.findMany({
    where: { enabled: true, trigger: { path: ["kind"], equals: "sequence_quiet" } },
    take: RULE_BATCH,
  });

  // Parse + group by campaign, keeping row order within each campaign.
  const byCampaign = new Map<string, { workspaceId: string; rules: Array<ParsedRule & { days: number }> }>();
  for (const row of rows) {
    const trigger = campaignRuleTriggerSchema.safeParse(row.trigger);
    const actions = actionsSchema.safeParse(row.actions);
    if (!trigger.success || trigger.data.kind !== "sequence_quiet" || !actions.success) {
      log(`[automations] quiet sweep: rule ${row.id} has an invalid shape — skipped`);
      continue;
    }
    const entry = byCampaign.get(row.campaignId) ?? { workspaceId: row.workspaceId, rules: [] };
    entry.rules.push({
      id: row.id,
      order: row.order,
      createdAt: row.createdAt,
      trigger: trigger.data,
      condition: null,
      actions: actions.data,
      days: trigger.data.days,
    });
    byCampaign.set(row.campaignId, entry);
  }

  let checked = 0;
  let fired = 0;
  for (const [campaignId, { workspaceId, rules }] of byCampaign) {
    rules.sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime());
    const minDays = Math.min(...rules.map((r) => r.days));
    const cutoff = new Date(now.getTime() - minDays * DAY_MS);
    const enrollments = await deps.ownerPrisma.enrollment.findMany({
      where: { campaignId, status: "DONE", updatedAt: { lte: cutoff } },
      select: { id: true, contactId: true, updatedAt: true },
      take: ENROLLMENT_BATCH,
    });
    for (const enrollment of enrollments) {
      checked += 1;
      const latest = await deps.ownerPrisma.message.findFirst({
        where: { workspaceId, enrollmentId: enrollment.id },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      });
      const lastTouch = Math.max(enrollment.updatedAt.getTime(), latest?.sentAt.getTime() ?? 0);
      const quietDays = (now.getTime() - lastTouch) / DAY_MS;
      const due = rules.filter((r) => quietDays >= r.days);
      if (due.length === 0) continue;
      const ctx: RunContext = {
        workspaceId,
        campaignId,
        eventId: quietEventIdFor(enrollment.id),
        contactId: enrollment.contactId,
        enrollmentId: enrollment.id,
        depth: 0,
        terminalState: { fired: false },
      };
      try {
        const summary = await executeMatchedRules(deps, ctx, due);
        fired += summary.runs.filter((r) => r.status === "fired").length;
      } catch (err) {
        log(
          `[automations] quiet sweep failed for enrollment ${enrollment.id}: ` +
            `${err instanceof Error ? err.message : String(err)} — next pass retries (idempotent)`,
        );
      }
    }
  }
  return { checked, fired };
}
