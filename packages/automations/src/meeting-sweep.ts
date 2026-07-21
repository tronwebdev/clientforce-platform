/**
 * The before-meeting sweep (INT W2, DEC-094) — `before_meeting { hours }` is
 * the SECOND timer trigger, and it rides the `sequence_quiet` pattern
 * verbatim: deterministic poll over `Meeting` rows (the additive W2 table —
 * the Event ledger can't be swept cheaply or represent reschedules as
 * current state), never a bus subscription.
 *
 * A rule fires when `now >= startAt − hours` for a Meeting with
 * `status = "booked"` and a FUTURE `startAt` — never for canceled or past
 * meetings. Fire-once semantics live in the run key, not the schedule: the
 * synthetic eventId `premeet:<meetingId>:<startAt epoch>` under the
 * (ruleId, eventId) unique fires AT MOST ONCE per (rule, meeting, startAt) —
 * a reschedule writes a NEW startAt, which is a NEW key, so the trigger
 * re-arms. The worker polls every 10 minutes (hour-granularity trigger);
 * every later pass is a no-op. Discovery reads are cross-tenant on the OWNER
 * client (the stranded-source-sweep precedent); all writes go through the
 * evaluator's RLS-subject tenant path.
 */
import { campaignRuleActionSchema, campaignRuleTriggerSchema } from "@clientforce/core";
import { z } from "zod";
import { executeMatchedAccountRules, executeMatchedRules } from "./evaluate";
import type { QuietSweepDeps } from "./sweep";
import type { ParsedAccountRule, ParsedRule, RunContext } from "./types";

const HOUR_MS = 3_600_000;
const RULE_BATCH = 500;
const MEETING_BATCH = 200;

const actionsSchema = z.array(campaignRuleActionSchema).min(1);

/** The deps ARE the quiet sweep's (owner discovery + tenant-scoped engine). */
export type MeetingSweepDeps = QuietSweepDeps;

export function premeetEventIdFor(meetingId: string, startAt: Date): string {
  return `premeet:${meetingId}:${Math.floor(startAt.getTime() / 1000)}`;
}

export async function runBeforeMeetingSweep(
  deps: MeetingSweepDeps,
  now: Date = new Date(),
): Promise<{ checked: number; fired: number }> {
  const log = deps.log ?? console.warn;
  let checked = 0;
  let fired = 0;

  // ── Campaign pass ──────────────────────────────────────────────────────────
  const rows = await deps.ownerPrisma.campaignRule.findMany({
    where: { enabled: true, trigger: { path: ["kind"], equals: "before_meeting" } },
    take: RULE_BATCH,
  });
  const byCampaign = new Map<string, { workspaceId: string; rules: Array<ParsedRule & { hours: number }> }>();
  for (const row of rows) {
    const trigger = campaignRuleTriggerSchema.safeParse(row.trigger);
    const actions = actionsSchema.safeParse(row.actions);
    if (!trigger.success || trigger.data.kind !== "before_meeting" || !actions.success) {
      log(`[automations] meeting sweep: rule ${row.id} has an invalid shape — skipped`);
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
      hours: trigger.data.hours,
    });
    byCampaign.set(row.campaignId, entry);
  }

  for (const [campaignId, { workspaceId, rules }] of byCampaign) {
    rules.sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime());
    const maxHours = Math.max(...rules.map((r) => r.hours));
    // Only meetings any of these rules COULD fire for: booked, still in the
    // future, and starting within the largest look-ahead.
    const meetings = await deps.ownerPrisma.meeting.findMany({
      where: {
        workspaceId,
        campaignId,
        status: "booked",
        startAt: { gt: now, lte: new Date(now.getTime() + maxHours * HOUR_MS) },
      },
      select: { id: true, contactId: true, enrollmentId: true, startAt: true },
      take: MEETING_BATCH,
    });
    for (const meeting of meetings) {
      checked += 1;
      const due = rules.filter((r) => now.getTime() >= meeting.startAt.getTime() - r.hours * HOUR_MS);
      if (due.length === 0) continue;
      const ctx: RunContext = {
        workspaceId,
        campaignId,
        eventId: premeetEventIdFor(meeting.id, meeting.startAt),
        contactId: meeting.contactId,
        enrollmentId: meeting.enrollmentId,
        depth: 0,
        terminalState: { fired: false },
      };
      try {
        const summary = await executeMatchedRules(deps, ctx, due);
        fired += summary.runs.filter((r) => r.status === "fired").length;
      } catch (err) {
        log(
          `[automations] meeting sweep failed for meeting ${meeting.id}: ` +
            `${err instanceof Error ? err.message : String(err)} — next pass retries (idempotent)`,
        );
      }
    }
  }

  // ── Account pass (R1-UI, DEC-091 — the quiet sweep's twin) ────────────────
  const accountRows = await deps.ownerPrisma.automation.findMany({
    where: { enabled: true, trigger: { path: ["kind"], equals: "before_meeting" } },
    take: RULE_BATCH,
  });
  const byWorkspace = new Map<string, Array<ParsedAccountRule & { hours: number }>>();
  for (const row of accountRows) {
    const trigger = campaignRuleTriggerSchema.safeParse(row.trigger);
    const actions = actionsSchema.safeParse(row.actions);
    if (!trigger.success || trigger.data.kind !== "before_meeting" || !actions.success) {
      log(`[automations] meeting sweep: automation ${row.id} has an invalid shape — skipped`);
      continue;
    }
    const entry = byWorkspace.get(row.workspaceId) ?? [];
    entry.push({
      id: row.id,
      createdAt: row.createdAt,
      trigger: trigger.data,
      condition: null,
      actions: actions.data,
      hours: trigger.data.hours,
    });
    byWorkspace.set(row.workspaceId, entry);
  }

  for (const [workspaceId, rules] of byWorkspace) {
    rules.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const maxHours = Math.max(...rules.map((r) => r.hours));
    const meetings = await deps.ownerPrisma.meeting.findMany({
      where: {
        workspaceId,
        status: "booked",
        startAt: { gt: now, lte: new Date(now.getTime() + maxHours * HOUR_MS) },
      },
      select: { id: true, contactId: true, enrollmentId: true, campaignId: true, startAt: true },
      take: MEETING_BATCH,
    });
    for (const meeting of meetings) {
      checked += 1;
      const due = rules.filter((r) => now.getTime() >= meeting.startAt.getTime() - r.hours * HOUR_MS);
      if (due.length === 0) continue;
      const ctx: RunContext = {
        workspaceId,
        campaignId: meeting.campaignId,
        eventId: premeetEventIdFor(meeting.id, meeting.startAt),
        contactId: meeting.contactId,
        enrollmentId: meeting.enrollmentId,
        depth: 0,
        terminalState: { fired: false },
      };
      try {
        const summary = await executeMatchedAccountRules(deps, ctx, due);
        fired += summary.runs.filter((r) => r.status === "fired").length;
      } catch (err) {
        log(
          `[automations] account meeting sweep failed for meeting ${meeting.id}: ` +
            `${err instanceof Error ? err.message : String(err)} — next pass retries (idempotent)`,
        );
      }
    }
  }
  return { checked, fired };
}
