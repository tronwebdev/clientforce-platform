/**
 * Action executors (R1, DEC-074). ALL idempotent — bus redelivery re-executes
 * and every observable effect converges:
 *   move        — deterministic workflow id per (enrollment, event); replays dedupe
 *   end/pause   — status update converges; cancel is idempotent
 *   suppress    — create-if-absent (the applyUnsubscribeReply pattern);
 *                 `lead.unsubscribed.v1` publishes only when a row was CREATED,
 *                 which also terminates the suppress → opted_out-rule cascade
 *   set_stage   — publishes `lead.stage_changed.v1` only on an ACTUAL change,
 *                 which terminates the set_stage("booked") → meeting_booked loop
 *   add_tag     — set-union
 *   notify_team — the run row + `automation.rule.run.v1` Event row ARE the
 *                 Phase-1 notification surface (no transport exists yet)
 *   run_automation — resolves the Automation LIVE (B6): missing/disabled is a
 *                 typed error outcome, never silent; executes its actions
 *                 through this SAME union at depth + 1 (the Phase-6 shared
 *                 core), refusing past MAX_RULE_CAUSATION_DEPTH with a typed
 *                 refusal row (the G2 pattern).
 *
 * Terminal actions also CANCEL the enrollment's durable run — skipping the
 * reply signal alone is not enough (a reply branch with a default case would
 * continue via its 72h timeout). A cancel failure is recorded on the outcome
 * detail and logged, never silent; the status update persists regardless.
 */
import {
  campaignRuleActionSchema,
  isTerminalAction,
  MAX_RULE_CAUSATION_DEPTH,
  type CampaignRuleAction,
} from "@clientforce/core";
import { Prisma, withTenant } from "@clientforce/db";
import type { EventInput, EventType } from "@clientforce/events";
import { z } from "zod";
import type { ActionOutcomeRecord, RuleEngineDeps, RunContext } from "./types";

const automationActionsSchema = z.array(campaignRuleActionSchema).min(1);

/** Temporal workflow-id-safe slug of an idempotency key (e.g. `quiet:<id>`). */
export function dedupeKeyFor(eventId: string): string {
  return eventId.replace(/[^A-Za-z0-9_-]/g, "-");
}

export async function executeAction(
  deps: RuleEngineDeps,
  ctx: RunContext,
  ruleId: string,
  action: CampaignRuleAction,
  // INT W1 review round: the action's position path ("#a:0", nested
  // "#a:1#auto:<id>#a:0") — deterministic from STORED rule content, so a
  // redelivered event regenerates the same keys, while two notify_team
  // actions under one rule (direct or via run_automation) get DISTINCT
  // transport dedupe keys instead of silently collapsing to one delivery.
  actionPath = "",
): Promise<ActionOutcomeRecord> {
  // Row order, first terminal wins — later terminal actions no-op with a
  // logged outcome; non-terminal actions still run (unit semantics §2).
  if (isTerminalAction(action) && ctx.terminalState.fired) {
    return { kind: action.kind, outcome: "skipped_conflict" };
  }
  try {
    const outcome = await run(deps, ctx, ruleId, action, actionPath);
    if (isTerminalAction(action) && outcome.outcome === "executed") {
      ctx.terminalState.fired = true;
      outcome.terminal = true;
    }
    return outcome;
  } catch (err) {
    return {
      kind: action.kind,
      outcome: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function run(
  deps: RuleEngineDeps,
  ctx: RunContext,
  ruleId: string,
  action: CampaignRuleAction,
  actionPath: string,
): Promise<ActionOutcomeRecord> {
  const log = deps.log ?? console.warn;
  switch (action.kind) {
    case "move_to_node": {
      if (!ctx.enrollmentId) return { kind: action.kind, outcome: "error", detail: "NO_ENROLLMENT" };
      if (!deps.moveEnrollment) {
        return {
          kind: action.kind,
          outcome: "error",
          detail: "MOVE_UNAVAILABLE: no workflow engine wired",
        };
      }
      await deps.moveEnrollment({
        workspaceId: ctx.workspaceId,
        enrollmentId: ctx.enrollmentId,
        targetNodeId: action.targetNodeId,
        dedupeKey: dedupeKeyFor(ctx.eventId),
      });
      return { kind: action.kind, outcome: "executed", detail: `→ ${action.targetNodeId}` };
    }

    case "end_enrollment": {
      if (!ctx.enrollmentId) return { kind: action.kind, outcome: "error", detail: "NO_ENROLLMENT" };
      const cancelNote = await setStatusAndCancel(deps, ctx, "DONE", undefined);
      return { kind: action.kind, outcome: "executed", ...(cancelNote ? { detail: cancelNote } : {}) };
    }

    case "pause_enrollment": {
      if (!ctx.enrollmentId) return { kind: action.kind, outcome: "error", detail: "NO_ENROLLMENT" };
      // The Logs tab renders `meta.blocked` as the amber row — same shape as
      // the boundary/composer refusals (P1.6 run audit).
      const cancelNote = await setStatusAndCancel(deps, ctx, "PAUSED", {
        reason: "PAUSED_BY_RULE",
        detail: `campaign rule ${ruleId}`,
      });
      return { kind: action.kind, outcome: "executed", ...(cancelNote ? { detail: cancelNote } : {}) };
    }

    case "suppress_contact": {
      if (!ctx.contactId) return { kind: action.kind, outcome: "error", detail: "NO_CONTACT" };
      const created: string[] = [];
      await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, async (tx) => {
        const contact = await tx.contact.findUnique({ where: { id: ctx.contactId! } });
        if (!contact) throw new Error(`MISSING_CONTACT: ${ctx.contactId}`);
        const optOut = { ...((contact.optOut ?? {}) as Record<string, unknown>) };
        const addresses: Array<{ channel: string; address: string }> = [
          // P5 W3 (DEC-085): email suppression addresses are stored lowercase.
          ...(contact.email ? [{ channel: "email", address: contact.email.toLowerCase() }] : []),
          ...(contact.phone ? [{ channel: "sms", address: contact.phone }] : []),
        ];
        for (const { channel, address } of addresses) {
          const existing = await tx.suppression.findFirst({
            where: { workspaceId: ctx.workspaceId, channel, address },
          });
          if (!existing) {
            await tx.suppression.create({
              data: {
                workspaceId: ctx.workspaceId,
                channel,
                address,
                reason: "MANUAL",
                source: `campaign-rule:${ruleId}`,
              },
            });
            created.push(channel);
          }
          optOut[channel] = true;
        }
        if (addresses.length > 0) {
          await tx.contact.update({
            where: { id: contact.id },
            data: { optOut: optOut as Prisma.InputJsonValue },
          });
        }
        if (ctx.enrollmentId) {
          await tx.enrollment.update({
            where: { id: ctx.enrollmentId },
            data: { status: "UNSUBSCRIBED" },
          });
        }
      });
      let note: string | undefined;
      if (ctx.enrollmentId) note = await cancelRun(deps, ctx);
      // Publish only for channels whose suppression row was CREATED — a
      // repeat suppress is a no-op end to the opted_out-rule cascade.
      for (const channel of created) {
        await publishSafely(deps, log, {
          type: "lead.unsubscribed.v1",
          workspaceId: ctx.workspaceId,
          contactId: ctx.contactId,
          ...(ctx.enrollmentId ? { enrollmentId: ctx.enrollmentId } : {}),
          payload: { channel },
        });
      }
      return {
        kind: action.kind,
        outcome: "executed",
        detail: [created.length ? `suppressed: ${created.join("+")}` : "already suppressed", note]
          .filter(Boolean)
          .join("; "),
      };
    }

    case "set_stage": {
      if (!ctx.enrollmentId) return { kind: action.kind, outcome: "error", detail: "NO_ENROLLMENT" };
      const fromStage = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, async (tx) => {
        const enrollment = await tx.enrollment.findUnique({ where: { id: ctx.enrollmentId! } });
        if (!enrollment) throw new Error(`MISSING_ENROLLMENT: ${ctx.enrollmentId}`);
        if (enrollment.pipelineStage === action.stage) return null;
        await tx.enrollment.update({
          where: { id: enrollment.id },
          data: { pipelineStage: action.stage },
        });
        return enrollment.pipelineStage;
      });
      if (fromStage === null) {
        return { kind: action.kind, outcome: "noop", detail: `already at "${action.stage}"` };
      }
      await publishSafely(deps, log, {
        type: "lead.stage_changed.v1",
        workspaceId: ctx.workspaceId,
        contactId: ctx.contactId,
        enrollmentId: ctx.enrollmentId,
        campaignId: ctx.campaignId,
        payload: {
          fromStage,
          toStage: action.stage,
          ...(action.label ? { label: action.label } : {}),
        },
      });
      return { kind: action.kind, outcome: "executed", detail: `${fromStage} → ${action.stage}` };
    }

    case "notify_team": {
      // The run row + Logs row remain the transport of record (Q-042's
      // documented default); a wired Slack transport (INT W1) is ADDITIVE —
      // delivery evidence rides the detail, and a transport failure never
      // changes the outcome (a flaky vendor must not fail the rule).
      if (!deps.notifyTransport) {
        return {
          kind: action.kind,
          outcome: "executed",
          ...(action.note ? { detail: action.note } : {}),
        };
      }
      let suffix: string;
      try {
        const res = await deps.notifyTransport({
          workspaceId: ctx.workspaceId,
          sourceKey: `${ctx.eventId}#rule:${ruleId}${actionPath}`,
          ...(action.note ? { note: action.note } : {}),
          contactId: ctx.contactId,
        });
        // A delivered:true WITH a detail is the dedupe pre-check path (a
        // genuine redelivery skip) — surface it so the run row never reads
        // as a fresh delivery that didn't happen.
        suffix = res.delivered
          ? `delivered to Slack${res.target ? ` ${res.target}` : ""}${res.detail ? ` (${res.detail})` : ""}`
          : `Slack delivery skipped${res.detail ? ` (${res.detail})` : ""}`;
      } catch (err) {
        suffix = `Slack delivery failed (${err instanceof Error ? err.message : String(err)})`;
      }
      return {
        kind: action.kind,
        outcome: "executed",
        detail: [action.note, suffix].filter(Boolean).join(" · "),
      };
    }

    case "add_tag": {
      if (!ctx.contactId) return { kind: action.kind, outcome: "error", detail: "NO_CONTACT" };
      const added = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, async (tx) => {
        const contact = await tx.contact.findUnique({ where: { id: ctx.contactId! } });
        if (!contact) throw new Error(`MISSING_CONTACT: ${ctx.contactId}`);
        if (contact.tags.includes(action.tag)) return false;
        await tx.contact.update({
          where: { id: contact.id },
          data: { tags: [...contact.tags, action.tag] },
        });
        return true;
      });
      return added
        ? { kind: action.kind, outcome: "executed", detail: action.tag }
        : { kind: action.kind, outcome: "noop", detail: `already tagged "${action.tag}"` };
    }

    case "send_booking_link": {
      // INT W2 (DEC-094): NOT a send — sends stay out of rule actions BY
      // DESIGN (Q-039). Flags the enrollment so the NEXT boundary-gated
      // composed message carries the workspace booking link as a mustSay
      // entry (grounded by construction); the send boundary clears the flag
      // once a sent message actually carried the link. Idempotent: setting
      // an already-set flag converges to a noop.
      if (!ctx.enrollmentId) {
        return {
          kind: action.kind,
          outcome: "noop",
          detail: "no enrollment on this event — nothing to queue the booking link on",
        };
      }
      const flagged = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, async (tx) => {
        const enrollment = await tx.enrollment.findUnique({ where: { id: ctx.enrollmentId! } });
        if (!enrollment) throw new Error(`MISSING_ENROLLMENT: ${ctx.enrollmentId}`);
        const meta = { ...((enrollment.meta ?? {}) as Record<string, unknown>) };
        if (meta.bookingLinkRequested === true) return false;
        meta.bookingLinkRequested = true;
        await tx.enrollment.update({
          where: { id: enrollment.id },
          data: { meta: meta as Prisma.InputJsonValue },
        });
        return true;
      });
      return flagged
        ? {
            kind: action.kind,
            outcome: "executed",
            detail: "booking link queued for the next composed message",
          }
        : { kind: action.kind, outcome: "noop", detail: "booking link already queued" };
    }

    case "send_payment_link": {
      // INT W3 (DEC-095): the send_booking_link twin — NOT a send (Q-039
      // stands). Flags the enrollment so the NEXT boundary-gated composed
      // message carries the workspace payment link as mustSay; the send
      // boundary clears the flag once a sent message actually carried it.
      if (!ctx.enrollmentId) {
        return {
          kind: action.kind,
          outcome: "noop",
          detail: "no enrollment on this event — nothing to queue the payment link on",
        };
      }
      const flagged = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, async (tx) => {
        const enrollment = await tx.enrollment.findUnique({ where: { id: ctx.enrollmentId! } });
        if (!enrollment) throw new Error(`MISSING_ENROLLMENT: ${ctx.enrollmentId}`);
        const meta = { ...((enrollment.meta ?? {}) as Record<string, unknown>) };
        if (meta.paymentLinkRequested === true) return false;
        meta.paymentLinkRequested = true;
        await tx.enrollment.update({
          where: { id: enrollment.id },
          data: { meta: meta as Prisma.InputJsonValue },
        });
        return true;
      });
      return flagged
        ? {
            kind: action.kind,
            outcome: "executed",
            detail: "payment link queued for the next composed message",
          }
        : { kind: action.kind, outcome: "noop", detail: "payment link already queued" };
    }

    case "send_webhook": {
      // INT W3: delivery rides the worker-wired transport seam (guard + sign
      // + ledger). Absent transport = the honest recorded absence; a delivery
      // failure NEVER changes the run outcome (the notify_team stance).
      if (!deps.webhookTransport) {
        return {
          kind: action.kind,
          outcome: "executed",
          detail: "webhook delivery not wired on this worker — recorded only",
        };
      }
      let suffix: string;
      try {
        const res = await deps.webhookTransport({
          workspaceId: ctx.workspaceId,
          sourceKey: `${ctx.eventId}#rule:${ruleId}${actionPath}`,
          ...(action.url ? { url: action.url } : {}),
          event: {
            id: ctx.eventId,
            type: ctx.event?.type ?? "unknown",
            occurredAt: ctx.event?.occurredAt ?? new Date().toISOString(),
            contactId: ctx.contactId,
            payload: ctx.event?.payload ?? {},
          },
          rule: { id: ruleId },
        });
        suffix = res.delivered
          ? `delivered${res.target ? ` to ${res.target}` : ""}${res.detail ? ` (${res.detail})` : ""}`
          : `webhook delivery skipped${res.detail ? ` (${res.detail})` : ""}`;
      } catch (err) {
        suffix = `webhook delivery failed (${err instanceof Error ? err.message : String(err)})`;
      }
      return { kind: action.kind, outcome: "executed", detail: suffix };
    }

    case "create_crm_deal": {
      // INT W4 (DEC-096): one-way push. Absent transport = recorded only; a
      // push failure NEVER changes the run outcome (the send_webhook stance).
      if (!ctx.contactId) {
        return { kind: action.kind, outcome: "noop", detail: "no contact on this event — nothing to push to the CRM" };
      }
      if (!deps.crmTransport) {
        return { kind: action.kind, outcome: "executed", detail: "CRM push not wired on this worker — recorded only" };
      }
      const contact = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
        tx.contact.findUnique({ where: { id: ctx.contactId! }, select: { email: true, firstName: true, lastName: true } }),
      );
      if (!contact?.email) {
        return { kind: action.kind, outcome: "noop", detail: "contact has no email — HubSpot needs one to upsert" };
      }
      const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
      let suffix: string;
      let newDealId: string | undefined;
      try {
        const res = await deps.crmTransport({
          workspaceId: ctx.workspaceId,
          sourceKey: `${ctx.eventId}#rule:${ruleId}${actionPath}`,
          op: "create_deal",
          contact: { email: contact.email, firstName: contact.firstName, lastName: contact.lastName },
          dealname: name || contact.email,
          ...(action.stage ? { stage: action.stage } : {}),
        });
        newDealId = res.dealId;
        suffix = res.delivered
          ? `delivered${res.detail ? ` (${res.detail})` : ""}`
          : `CRM push skipped${res.detail ? ` (${res.detail})` : ""}`;
      } catch (err) {
        suffix = `CRM push failed (${err instanceof Error ? err.message : String(err)})`;
      }
      // Store the created deal id so a later update_deal_stage can find it.
      if (newDealId && ctx.enrollmentId) {
        await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, async (tx) => {
          const enrollment = await tx.enrollment.findUnique({ where: { id: ctx.enrollmentId! } });
          if (!enrollment) return;
          const meta = { ...((enrollment.meta ?? {}) as Record<string, unknown>) };
          meta.crmDealId = newDealId;
          await tx.enrollment.update({ where: { id: enrollment.id }, data: { meta: meta as Prisma.InputJsonValue } });
        });
      }
      return { kind: action.kind, outcome: "executed", detail: suffix };
    }

    case "update_deal_stage": {
      if (!ctx.contactId) {
        return { kind: action.kind, outcome: "noop", detail: "no contact on this event — nothing to update in the CRM" };
      }
      if (!deps.crmTransport) {
        return { kind: action.kind, outcome: "executed", detail: "CRM push not wired on this worker — recorded only" };
      }
      const enrollment = ctx.enrollmentId
        ? await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
            tx.enrollment.findUnique({ where: { id: ctx.enrollmentId! }, select: { meta: true } }),
          )
        : null;
      const dealId = ((enrollment?.meta ?? {}) as { crmDealId?: unknown }).crmDealId;
      if (typeof dealId !== "string") {
        // The typed refusal, recorded on the run row (never a silent no-op).
        return {
          kind: action.kind,
          outcome: "executed",
          detail: "no HubSpot deal on this contact yet — add a Create CRM deal step first",
        };
      }
      let suffix: string;
      try {
        const res = await deps.crmTransport({
          workspaceId: ctx.workspaceId,
          sourceKey: `${ctx.eventId}#rule:${ruleId}${actionPath}`,
          op: "update_stage",
          dealId,
          stage: action.stage,
        });
        suffix = res.delivered
          ? `delivered${res.detail ? ` (${res.detail})` : ""}`
          : `CRM push skipped${res.detail ? ` (${res.detail})` : ""}`;
      } catch (err) {
        suffix = `CRM push failed (${err instanceof Error ? err.message : String(err)})`;
      }
      return { kind: action.kind, outcome: "executed", detail: suffix };
    }

    case "run_automation": {
      const automation = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
        tx.automation.findUnique({ where: { id: action.automationId } }),
      );
      // Honest absence (B6 live resolution): a deleted or disabled automation
      // is an ERROR state the UI can render — never a silent skip.
      if (!automation) {
        return { kind: action.kind, outcome: "error", detail: `MISSING_AUTOMATION: ${action.automationId}` };
      }
      if (!automation.enabled) {
        return { kind: action.kind, outcome: "error", detail: `AUTOMATION_DISABLED: ${action.automationId}` };
      }
      const depth = ctx.depth + 1;
      const causedBy = { ruleId, eventId: ctx.eventId, depth };
      if (depth > MAX_RULE_CAUSATION_DEPTH) {
        // Typed refusal, recorded on the automation's OWN run history too —
        // never a silent loop, never an infinite one.
        await recordAutomationRun(deps, ctx, automation.id, "refused_depth", { causedBy });
        return {
          kind: action.kind,
          outcome: "refused_depth",
          detail: `causation depth ${depth} > ${MAX_RULE_CAUSATION_DEPTH}`,
        };
      }
      const parsed = automationActionsSchema.safeParse(automation.actions);
      if (!parsed.success) {
        await recordAutomationRun(deps, ctx, automation.id, "error", {
          causedBy,
          detail: "INVALID_ACTIONS",
        });
        return { kind: action.kind, outcome: "error", detail: `INVALID_ACTIONS: ${automation.id}` };
      }
      const nested: ActionOutcomeRecord[] = [];
      const nestedCtx: RunContext = { ...ctx, depth };
      for (const [i, nestedAction] of parsed.data.entries()) {
        nested.push(
          await executeAction(deps, nestedCtx, ruleId, nestedAction, `${actionPath}#auto:${automation.id}#a:${i}`),
        );
      }
      const anyError = nested.some((o) => o.outcome === "error" || o.outcome === "refused_depth");
      await recordAutomationRun(deps, ctx, automation.id, anyError ? "error" : "fired", {
        causedBy,
        actions: nested,
      });
      return {
        kind: action.kind,
        outcome: anyError ? "error" : "executed",
        detail: `automation "${automation.name}": ${nested.map((o) => `${o.kind}=${o.outcome}`).join(", ")}`,
        ...(nested.some((o) => o.terminal) ? { terminal: true } : {}),
      };
    }
  }
}

/** DONE/PAUSED terminal writes + the cooperative cancel; returns a note on cancel failure. */
async function setStatusAndCancel(
  deps: RuleEngineDeps,
  ctx: RunContext,
  status: "DONE" | "PAUSED",
  blocked: { reason: string; detail: string } | undefined,
): Promise<string | undefined> {
  await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, async (tx) => {
    const enrollment = await tx.enrollment.findUnique({ where: { id: ctx.enrollmentId! } });
    if (!enrollment) throw new Error(`MISSING_ENROLLMENT: ${ctx.enrollmentId}`);
    const meta = (enrollment.meta ?? {}) as Record<string, unknown>;
    await tx.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status,
        ...(blocked
          ? {
              meta: {
                ...meta,
                blocked: {
                  nodeId: enrollment.currentNode ?? "",
                  reason: blocked.reason,
                  detail: blocked.detail,
                  at: new Date().toISOString(),
                },
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
  });
  return cancelRun(deps, ctx);
}

/** Cancel the enrollment's stored run; failure returns a note (logged, never thrown). */
async function cancelRun(deps: RuleEngineDeps, ctx: RunContext): Promise<string | undefined> {
  const log = deps.log ?? console.warn;
  if (!deps.cancelWorkflow) {
    log(`[automations] no workflow engine wired — status persisted for ${ctx.enrollmentId}, run not cancelled`);
    return "WORKFLOW_CANCEL_UNAVAILABLE";
  }
  try {
    const enrollment = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
      tx.enrollment.findUnique({ where: { id: ctx.enrollmentId! }, select: { workflowId: true } }),
    );
    if (!enrollment) return "MISSING_ENROLLMENT";
    await deps.cancelWorkflow({
      workspaceId: ctx.workspaceId,
      enrollmentId: ctx.enrollmentId!,
      workflowId: enrollment.workflowId,
    });
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(
      `[automations] workflow cancel failed for enrollment ${ctx.enrollmentId} (${msg}) — ` +
        `status persisted regardless`,
    );
    return `WORKFLOW_CANCEL_FAILED: ${msg}`;
  }
}

async function recordAutomationRun(
  deps: RuleEngineDeps,
  ctx: RunContext,
  automationId: string,
  status: "fired" | "error" | "refused_depth",
  detail: Record<string, unknown>,
): Promise<void> {
  const log = deps.log ?? console.warn;
  // eventId stays NULL on nested rows — the OUTER rule's (ruleId, eventId)
  // unique already dedupes the whole pass on redelivery (DEC-091).
  const row = await withTenant(deps.prisma, { workspaceId: ctx.workspaceId }, (tx) =>
    tx.automationRun.create({
      data: {
        workspaceId: ctx.workspaceId,
        automationId,
        status,
        detail: detail as Prisma.InputJsonValue,
      },
    }),
  );
  // R1-UI (DEC-091): every AutomationRun row gets its ledger twin — nested
  // runs emit with trigger "run_automation" (what CAUSED this run; the
  // automation's own trigger did not fire). Publish failure never blocks
  // the row (the rule.run precedent).
  if (deps.publish) {
    try {
      await deps.publish({
        type: "automation.rule.run.v1",
        workspaceId: ctx.workspaceId,
        contactId: ctx.contactId,
        enrollmentId: ctx.enrollmentId,
        campaignId: ctx.campaignId,
        payload: {
          ruleId: automationId,
          runId: row.id,
          status,
          trigger: "run_automation",
          scope: "account",
          ...(status === "fired" ? {} : { detail: JSON.stringify(detail.detail ?? status) }),
        },
      });
    } catch (err) {
      log(
        `[automations] automation.rule.run.v1 publish failed for nested run ${row.id}: ` +
          `${err instanceof Error ? err.message : String(err)} — run row persisted regardless`,
      );
    }
  }
}

async function publishSafely<T extends EventType>(
  deps: RuleEngineDeps,
  log: (msg: string) => void,
  input: EventInput<T>,
): Promise<void> {
  if (!deps.publish) return;
  try {
    await deps.publish(input);
  } catch (err) {
    log(
      `[automations] event publish failed (${input.type}): ` +
        `${err instanceof Error ? err.message : String(err)} — state persisted regardless`,
    );
  }
}
