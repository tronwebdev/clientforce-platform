/**
 * R1 (DEC-074) engine fixtures against real Postgres (hermetic skip without
 * infra — the repo convention). The W1 acceptance set:
 *
 *   precedence   — a terminal rule action gates the graph continuation
 *                  (shouldContinueGraph false) and cancels the durable run
 *   conflicts    — row order, first terminal wins; later terminals no-op with
 *                  a skipped_conflict row; non-terminal actions still run
 *   depth guard  — evaluator refuses depth > 2 with a typed refusal row;
 *                  a self-referencing automation terminates, never loops
 *   idempotency  — unique (ruleId, eventId): redelivery can't double-fire
 *   honest-absence — missing/disabled automation = error row, never silent
 *   inertness    — PAUSED (and UNSUBSCRIBED) enrollments never fire rules
 *   sweep        — sequence_quiet fires once, ever, per (rule, enrollment)
 *
 * Workflow-engine deps are capturing fakes (the CapturingSender pattern);
 * `moveEnrollmentToNode` itself is covered in packages/workflows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CampaignRuleAction, CampaignRuleTrigger } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import type { BusEvent } from "@clientforce/events";
import { createPerAgentRules } from "../src/consumer";
import { evaluateEventForRules } from "../src/evaluate";
import { quietEventIdFor, runSequenceQuietSweep } from "../src/sweep";
import type { RuleEngineDeps } from "../src/types";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `r1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasInfra)("campaign-rules engine (R1 W1)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let campaignId: string;
  let contactId: string;
  let enrollmentId: string;
  let workflowId: string;

  const published: Array<{ type: string; payload: unknown }> = [];
  const cancelled: Array<{ enrollmentId: string; workflowId: string }> = [];
  const moved: Array<{ enrollmentId: string; targetNodeId: string; dedupeKey: string }> = [];
  const deps = (): RuleEngineDeps => ({
    prisma: app,
    publish: async (input) => {
      published.push({ type: input.type, payload: input.payload });
    },
    cancelWorkflow: async (params) => {
      cancelled.push({ enrollmentId: params.enrollmentId, workflowId: params.workflowId });
    },
    moveEnrollment: async (params) => {
      moved.push({
        enrollmentId: params.enrollmentId,
        targetNodeId: params.targetNodeId,
        dedupeKey: params.dedupeKey,
      });
    },
    log: () => undefined,
  });

  let eventSeq = 0;
  const replyEvent = (intent: string, over: Partial<BusEvent> = {}): BusEvent => ({
    id: `evt-${suffix}-${++eventSeq}`,
    workspaceId: ws,
    type: "email.replied.v1",
    contactId,
    enrollmentId,
    campaignId,
    payload: { messageId: `m-${suffix}`, intent },
    occurredAt: new Date().toISOString(),
    ...over,
  });

  const addRule = async (
    order: number,
    trigger: CampaignRuleTrigger,
    actions: CampaignRuleAction[],
    over: { enabled?: boolean; condition?: unknown } = {},
  ) => {
    return owner.campaignRule.create({
      data: {
        workspaceId: ws,
        campaignId,
        order,
        trigger: trigger as never,
        actions: actions as never,
        ...(over.condition !== undefined ? { condition: over.condition as never } : {}),
        ...(over.enabled !== undefined ? { enabled: over.enabled } : {}),
      },
    });
  };

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "r1", slug: suffix, settings: {} } })).id;
    const agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Rules", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({ data: { workspaceId: ws, agentId, name: "primary", graphId: "" } })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "test",
          optOut: {},
          tags: [],
          email: `lead-${suffix}@allowed.test`,
          phone: "+15550100200",
        },
      })
    ).id;
    workflowId = `enroll-test-${suffix}`;
    enrollmentId = (
      await owner.enrollment.create({
        data: {
          workspaceId: ws,
          campaignId,
          contactId,
          workflowId,
          pipelineStage: "new",
          meta: {},
        },
      })
    ).id;
  });

  beforeEach(async () => {
    published.length = 0;
    cancelled.length = 0;
    moved.length = 0;
    await owner.campaignRuleRun.deleteMany({ where: { workspaceId: ws } });
    await owner.campaignRule.deleteMany({ where: { workspaceId: ws } });
    await owner.automationRun.deleteMany({ where: { workspaceId: ws } });
    await owner.automation.deleteMany({ where: { workspaceId: ws } });
    await owner.suppression.deleteMany({ where: { workspaceId: ws } });
    await owner.enrollment.update({
      where: { id: enrollmentId },
      data: { status: "ACTIVE", pipelineStage: "new", workflowId, meta: {} },
    });
    await owner.contact.update({ where: { id: contactId }, data: { optOut: {}, tags: [] } });
  });

  afterAll(async () => {
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await app?.$disconnect();
  });

  it("PRECEDENCE: a terminal rule gates the graph continuation and cancels the run", async () => {
    const rule = await addRule(1, { kind: "reply_classified", intents: ["not_interested"] }, [
      { kind: "end_enrollment" },
    ]);
    const engine = createPerAgentRules(deps());
    const event = replyEvent("not_interested");
    // Both bus hooks race in Promise.all — exactly the production dispatch shape.
    const [, shouldContinue] = await Promise.all([
      engine.consumer.handle(event),
      engine.shouldContinueGraph(event),
    ]);
    expect(shouldContinue).toBe(false);

    const enrollment = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(enrollment.status).toBe("DONE");
    expect(cancelled).toEqual([{ enrollmentId, workflowId }]);

    const runs = await owner.campaignRuleRun.findMany({ where: { ruleId: rule.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("fired");
    expect((runs[0]!.detail as { terminal?: boolean }).terminal).toBe(true);
    expect(published.filter((p) => p.type === "automation.rule.run.v1")).toHaveLength(1);
  });

  it("PRECEDENCE: non-terminal rules leave the graph continuation alone", async () => {
    await addRule(1, { kind: "reply_classified", intents: ["interested"] }, [
      { kind: "notify_team", note: "hot" },
    ]);
    const engine = createPerAgentRules(deps());
    const event = replyEvent("interested");
    const [, shouldContinue] = await Promise.all([
      engine.consumer.handle(event),
      engine.shouldContinueGraph(event),
    ]);
    expect(shouldContinue).toBe(true);
    expect(cancelled).toHaveLength(0);
    expect((await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe(
      "ACTIVE",
    );
  });

  it("PRECEDENCE: a fresh evaluator (crash/redelivery) reads the terminal flag off the recorded run", async () => {
    await addRule(1, { kind: "reply_classified", intents: ["not_interested"] }, [
      { kind: "end_enrollment" },
    ]);
    const event = replyEvent("not_interested");
    await evaluateEventForRules(deps(), event);
    // New instance, empty memo — must reach the same answer from the rows.
    // (DONE stays fireable, so the recorded-run path is what answers here.)
    const fresh = createPerAgentRules(deps());
    expect(await fresh.shouldContinueGraph(event)).toBe(false);
  });

  it("CONFLICTS: row order — first terminal wins; the loser logs skipped_conflict but its non-terminals run", async () => {
    const winner = await addRule(1, { kind: "reply_classified", intents: ["interested"] }, [
      { kind: "move_to_node", targetNodeId: "branch-x" },
    ]);
    const loser = await addRule(2, { kind: "reply_classified", intents: ["interested"] }, [
      { kind: "notify_team", note: "still runs" },
      { kind: "move_to_node", targetNodeId: "branch-y" },
    ]);
    const summary = await evaluateEventForRules(deps(), replyEvent("interested"));
    expect(summary.terminalFired).toBe(true);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.targetNodeId).toBe("branch-x");

    const winnerRun = await owner.campaignRuleRun.findFirstOrThrow({ where: { ruleId: winner.id } });
    expect(winnerRun.status).toBe("fired");
    const loserRun = await owner.campaignRuleRun.findFirstOrThrow({ where: { ruleId: loser.id } });
    expect(loserRun.status).toBe("skipped_conflict");
    const outcomes = (loserRun.detail as { actions: Array<{ kind: string; outcome: string }> }).actions;
    expect(outcomes).toEqual([
      expect.objectContaining({ kind: "notify_team", outcome: "executed" }),
      expect.objectContaining({ kind: "move_to_node", outcome: "skipped_conflict" }),
    ]);
  });

  it("DEPTH GUARD: evaluation past MAX_RULE_CAUSATION_DEPTH refuses typed, executing nothing", async () => {
    const rule = await addRule(1, { kind: "reply_classified", intents: ["interested"] }, [
      { kind: "move_to_node", targetNodeId: "branch-x" },
    ]);
    const summary = await evaluateEventForRules(deps(), replyEvent("interested"), { depth: 3 });
    expect(summary.runs).toEqual([
      expect.objectContaining({ ruleId: rule.id, status: "refused_depth" }),
    ]);
    expect(moved).toHaveLength(0);
    const run = await owner.campaignRuleRun.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(run.status).toBe("refused_depth");
    expect(run.depth).toBe(3);
  });

  it("DEPTH GUARD: a self-referencing automation terminates with a typed refusal row — never an infinite loop", async () => {
    const automation = await owner.automation.create({
      data: {
        workspaceId: ws,
        name: "ouroboros",
        trigger: {},
        conditions: [],
        actions: [{ kind: "run_automation", automationId: "SELF" }],
      },
    });
    await owner.automation.update({
      where: { id: automation.id },
      data: { actions: [{ kind: "run_automation", automationId: automation.id }] },
    });
    await addRule(1, { kind: "reply_classified", intents: ["interested"] }, [
      { kind: "run_automation", automationId: automation.id },
    ]);
    const summary = await evaluateEventForRules(deps(), replyEvent("interested"));
    expect(summary.runs).toHaveLength(1);

    const automationRuns = await owner.automationRun.findMany({
      where: { automationId: automation.id },
      orderBy: { ranAt: "asc" },
    });
    // depth 1 + depth 2 execute (recorded as error — their nested call refused),
    // depth 3 is the typed refusal. Three rows, then silence.
    expect(automationRuns).toHaveLength(3);
    expect(automationRuns.map((r) => r.status).sort()).toEqual(["error", "error", "refused_depth"]);
  });

  it("IDEMPOTENCY: unique (ruleId, eventId) — a redelivery re-executes converged no-ops and records nothing new", async () => {
    const rule = await addRule(1, { kind: "reply_classified", intents: ["interested"] }, [
      { kind: "add_tag", tag: "hot" },
      { kind: "set_stage", stage: "interested" },
    ]);
    const event = replyEvent("interested");
    const first = await evaluateEventForRules(deps(), event);
    expect(first.runs).toEqual([expect.objectContaining({ ruleId: rule.id, status: "fired" })]);
    const publishesAfterFirst = published.length;

    const second = await evaluateEventForRules(deps(), event);
    expect(second.runs).toEqual([
      expect.objectContaining({ ruleId: rule.id, status: "already_recorded" }),
    ]);
    expect(await owner.campaignRuleRun.count({ where: { ruleId: rule.id } })).toBe(1);
    // No new rule.run event, no second stage_changed — nothing double-fired.
    expect(published.length).toBe(publishesAfterFirst);
    const contact = await owner.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.tags).toEqual(["hot"]);
  });

  it("HONEST ABSENCE: a rule pointing at a deleted or disabled automation records an error, never fires silently", async () => {
    const disabled = await owner.automation.create({
      data: {
        workspaceId: ws,
        name: "off",
        enabled: false,
        trigger: {},
        conditions: [],
        actions: [{ kind: "notify_team" }],
      },
    });
    const missingRule = await addRule(1, { kind: "reply_classified", intents: ["interested"] }, [
      { kind: "run_automation", automationId: "auto-that-was-deleted" },
    ]);
    const disabledRule = await addRule(2, { kind: "reply_classified", intents: ["interested"] }, [
      { kind: "run_automation", automationId: disabled.id },
    ]);
    await evaluateEventForRules(deps(), replyEvent("interested"));

    const missingRun = await owner.campaignRuleRun.findFirstOrThrow({
      where: { ruleId: missingRule.id },
    });
    expect(missingRun.status).toBe("error");
    expect(JSON.stringify(missingRun.detail)).toContain("MISSING_AUTOMATION");
    const disabledRun = await owner.campaignRuleRun.findFirstOrThrow({
      where: { ruleId: disabledRule.id },
    });
    expect(disabledRun.status).toBe("error");
    expect(JSON.stringify(disabledRun.detail)).toContain("AUTOMATION_DISABLED");
    // The failed rule fired nothing — and the run rows are the loud record.
    expect(await owner.automationRun.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it("INERTNESS: rules never fire for PAUSED (or UNSUBSCRIBED) enrollments — no rows, no actions, gate open", async () => {
    await addRule(1, { kind: "reply_classified", intents: ["not_interested"] }, [
      { kind: "end_enrollment" },
    ]);
    for (const status of ["PAUSED", "UNSUBSCRIBED"] as const) {
      await owner.enrollment.update({ where: { id: enrollmentId }, data: { status } });
      const engine = createPerAgentRules(deps());
      const event = replyEvent("not_interested");
      const [, shouldContinue] = await Promise.all([
        engine.consumer.handle(event),
        engine.shouldContinueGraph(event),
      ]);
      expect(shouldContinue).toBe(true);
      expect(cancelled).toHaveLength(0);
      expect(await owner.campaignRuleRun.count({ where: { workspaceId: ws } })).toBe(0);
      expect(
        (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status,
      ).toBe(status);
    }
  });

  it("CONDITION: keyword_contains refines a reply trigger via the inbound Message body", async () => {
    const message = await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        enrollmentId,
        channel: "email",
        direction: "INBOUND",
        body: "What does PRICING look like for 20 seats?",
        sentAt: new Date(),
      },
    });
    const hit = await addRule(1, { kind: "reply_classified", intents: ["info_request"] }, [
      { kind: "add_tag", tag: "pricing-question" },
    ], { condition: { kind: "keyword_contains", keywords: ["pricing"] } });
    const miss = await addRule(2, { kind: "reply_classified", intents: ["info_request"] }, [
      { kind: "add_tag", tag: "integration-question" },
    ], { condition: { kind: "keyword_contains", keywords: ["integration"] } });

    await evaluateEventForRules(
      deps(),
      replyEvent("info_request", { payload: { messageId: message.id, intent: "info_request" } }),
    );
    expect(await owner.campaignRuleRun.count({ where: { ruleId: hit.id } })).toBe(1);
    expect(await owner.campaignRuleRun.count({ where: { ruleId: miss.id } })).toBe(0);
    const contact = await owner.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.tags).toEqual(["pricing-question"]);
    await owner.message.delete({ where: { id: message.id } });
  });

  it("SUPPRESS: create-if-absent across channels; repeat suppression publishes nothing (cascade terminates)", async () => {
    const rule = await addRule(1, { kind: "reply_classified", intents: ["not_interested"] }, [
      { kind: "suppress_contact" },
    ]);
    await evaluateEventForRules(deps(), replyEvent("not_interested"));

    const suppressions = await owner.suppression.findMany({ where: { workspaceId: ws } });
    expect(suppressions.map((s) => s.channel).sort()).toEqual(["email", "sms"]);
    expect(suppressions.every((s) => s.reason === "MANUAL")).toBe(true);
    expect(suppressions.every((s) => s.source === `campaign-rule:${rule.id}`)).toBe(true);
    const contact = await owner.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.optOut).toMatchObject({ email: true, sms: true });
    expect(
      (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status,
    ).toBe("UNSUBSCRIBED");
    expect(cancelled).toHaveLength(1);
    const unsubEvents = published.filter((p) => p.type === "lead.unsubscribed.v1");
    expect(unsubEvents).toHaveLength(2); // one per channel CREATED

    // Second event, same contact: rows exist — nothing new published. (The
    // enrollment is UNSUBSCRIBED now, so re-fire against a fresh one.)
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { status: "ACTIVE" } });
    published.length = 0;
    await evaluateEventForRules(deps(), replyEvent("not_interested"));
    expect(published.filter((p) => p.type === "lead.unsubscribed.v1")).toHaveLength(0);
    expect(await owner.suppression.count({ where: { workspaceId: ws } })).toBe(2);
  });

  it("SET_STAGE: publishes lead.stage_changed.v1 only on an actual change (the loop terminator)", async () => {
    await addRule(1, { kind: "meeting_booked" }, [
      { kind: "set_stage", stage: "booked", label: "Meeting booked" },
    ]);
    const bookedEvent = (id: string): BusEvent => ({
      id,
      workspaceId: ws,
      type: "lead.stage_changed.v1",
      contactId,
      enrollmentId,
      campaignId,
      payload: { fromStage: "interested", toStage: "booked" },
      occurredAt: new Date().toISOString(),
    });
    await evaluateEventForRules(deps(), bookedEvent(`evt-${suffix}-stage-1`));
    const changes = published.filter((p) => p.type === "lead.stage_changed.v1");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.payload).toMatchObject({ toStage: "booked", label: "Meeting booked" });

    // The published change re-enters the bus and matches the same rule — the
    // stage no longer moves, so nothing republishes: the loop is closed.
    published.length = 0;
    await evaluateEventForRules(deps(), bookedEvent(`evt-${suffix}-stage-2`));
    expect(published.filter((p) => p.type === "lead.stage_changed.v1")).toHaveLength(0);
  });

  it("SWEEP: sequence_quiet fires once, ever, per (rule, enrollment) — hourly polls are no-ops after", async () => {
    const rule = await addRule(1, { kind: "sequence_quiet", days: 30 }, [
      { kind: "add_tag", tag: "re-engage" },
    ]);
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { status: "DONE" } });
    // Backdate the last touch past the 30-day quiet window (raw SQL — Prisma
    // would clobber updatedAt on update).
    await owner.$executeRaw`UPDATE "Enrollment" SET "updatedAt" = NOW() - INTERVAL '40 days' WHERE "id" = ${enrollmentId}`;

    const sweepDeps = { ...deps(), ownerPrisma: owner };
    const first = await runSequenceQuietSweep(sweepDeps);
    expect(first.fired).toBe(1);
    const run = await owner.campaignRuleRun.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(run.eventId).toBe(quietEventIdFor(enrollmentId));
    expect(run.status).toBe("fired");
    expect((await owner.contact.findUniqueOrThrow({ where: { id: contactId } })).tags).toEqual([
      "re-engage",
    ]);

    const second = await runSequenceQuietSweep(sweepDeps);
    expect(second.fired).toBe(0);
    expect(await owner.campaignRuleRun.count({ where: { ruleId: rule.id } })).toBe(1);
  });

  it("SWEEP: an enrollment inside its quiet window does not fire", async () => {
    await addRule(1, { kind: "sequence_quiet", days: 30 }, [{ kind: "add_tag", tag: "re-engage" }]);
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { status: "DONE" } });
    await owner.$executeRaw`UPDATE "Enrollment" SET "updatedAt" = NOW() - INTERVAL '10 days' WHERE "id" = ${enrollmentId}`;
    const result = await runSequenceQuietSweep({ ...deps(), ownerPrisma: owner });
    expect(result.fired).toBe(0);
    expect(await owner.campaignRuleRun.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it("DISABLED RULES never fire — flipping is instant, no re-plan", async () => {
    const rule = await addRule(
      1,
      { kind: "reply_classified", intents: ["interested"] },
      [{ kind: "add_tag", tag: "hot" }],
      { enabled: false },
    );
    const summary = await evaluateEventForRules(deps(), replyEvent("interested"));
    expect(summary.matched).toBe(0);
    expect(await owner.campaignRuleRun.count({ where: { ruleId: rule.id } })).toBe(0);
  });

  it("events without a campaignId never evaluate campaign rules", async () => {
    await addRule(1, { kind: "opted_out" }, [{ kind: "notify_team" }]);
    const summary = await evaluateEventForRules(deps(), {
      id: `evt-${suffix}-nocampaign`,
      workspaceId: ws,
      type: "lead.unsubscribed.v1",
      contactId,
      enrollmentId: null,
      campaignId: null,
      payload: { channel: "email" },
      occurredAt: new Date().toISOString(),
    });
    expect(summary.matched).toBe(0);
    expect(await owner.campaignRuleRun.count({ where: { workspaceId: ws } })).toBe(0);
  });
});
