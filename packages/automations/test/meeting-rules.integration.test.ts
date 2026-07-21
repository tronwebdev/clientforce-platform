/**
 * INT W2 (DEC-094) meeting rules vs real Postgres (hermetic skip without
 * infra — the engine.integration convention):
 *
 *   before-meeting sweep — fires when now >= startAt − hours for a BOOKED,
 *     future meeting; fire-once under the synthetic
 *     `premeet:<meetingId>:<startAt epoch>` key; RE-ARMS on reschedule (new
 *     startAt = new key); canceled and past meetings never fire; the account
 *     pass mirrors it under (automationId, eventId).
 *
 *   send_booking_link executor — NON-terminal bookkeeping: flags
 *     `Enrollment.meta.bookingLinkRequested` (idempotent — a second fire
 *     noops); no enrollment → honest noop detail; NEVER a send.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CampaignRuleAction, CampaignRuleTrigger } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { executeAction } from "../src/executors";
import { premeetEventIdFor, runBeforeMeetingSweep } from "../src/meeting-sweep";
import type { MeetingSweepDeps } from "../src/meeting-sweep";
import type { RuleEngineDeps, RunContext } from "../src/types";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `mw2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const NOW = new Date("2026-07-20T12:00:00Z");
const hoursFromNow = (h: number): Date => new Date(NOW.getTime() + h * 3_600_000);

describe.skipIf(!hasInfra)("meeting rules (INT W2)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let campaignId: string;
  let contactId: string;
  let enrollmentId: string;

  const published: Array<{ type: string; payload: unknown }> = [];
  const engineDeps = (): RuleEngineDeps => ({
    prisma: app,
    publish: async (input) => {
      published.push({ type: input.type, payload: input.payload });
    },
    log: () => undefined,
  });
  const sweepDeps = (): MeetingSweepDeps => ({ ...engineDeps(), ownerPrisma: owner });

  const addRule = (order: number, trigger: CampaignRuleTrigger, actions: CampaignRuleAction[]) =>
    owner.campaignRule.create({
      data: { workspaceId: ws, campaignId, order, trigger: trigger as never, actions: actions as never },
    });

  const addMeeting = (over: Record<string, unknown> = {}) =>
    owner.meeting.create({
      data: {
        workspaceId: ws,
        contactId,
        enrollmentId,
        campaignId,
        provider: "calendly",
        externalId: `ext-${suffix}-${Math.random().toString(36).slice(2)}`,
        status: "booked",
        startAt: hoursFromNow(20),
        inviteeEmail: `lead-${suffix}@t.test`,
        ...over,
      },
    });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "mw2", slug: suffix, settings: {} } })).id;
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
        data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `lead-${suffix}@t.test` },
      })
    ).id;
    enrollmentId = (
      await owner.enrollment.create({
        data: {
          workspaceId: ws,
          campaignId,
          contactId,
          workflowId: `enroll-${suffix}`,
          pipelineStage: "new",
          meta: {},
        },
      })
    ).id;
  });

  beforeEach(async () => {
    published.length = 0;
    await owner.campaignRuleRun.deleteMany({ where: { workspaceId: ws } });
    await owner.campaignRule.deleteMany({ where: { workspaceId: ws } });
    await owner.automationRun.deleteMany({ where: { workspaceId: ws } });
    await owner.automation.deleteMany({ where: { workspaceId: ws } });
    await owner.meeting.deleteMany({ where: { workspaceId: ws } });
    await owner.enrollment.update({
      where: { id: enrollmentId },
      data: { status: "ACTIVE", pipelineStage: "new", meta: {} },
    });
    await owner.contact.update({ where: { id: contactId }, data: { tags: [] } });
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  describe("runBeforeMeetingSweep", () => {
    it("fires once inside the window, under the premeet run key — later passes are no-ops", async () => {
      const rule = await addRule(0, { kind: "before_meeting", hours: 24 }, [
        { kind: "add_tag", tag: "pre-meeting" },
      ]);
      const meeting = await addMeeting({ startAt: hoursFromNow(20) }); // 20h out, 24h rule → due

      const first = await runBeforeMeetingSweep(sweepDeps(), NOW);
      expect(first.fired).toBe(1);
      const runs = await owner.campaignRuleRun.findMany({ where: { ruleId: rule.id } });
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: "fired",
        eventId: premeetEventIdFor(meeting.id, meeting.startAt),
        contactId,
        enrollmentId,
      });
      const contact = await owner.contact.findUniqueOrThrow({ where: { id: contactId } });
      expect(contact.tags).toContain("pre-meeting");

      // Redelivery/no-op: the same pass an hour later fires nothing new.
      const second = await runBeforeMeetingSweep(sweepDeps(), new Date(NOW.getTime() + 3_600_000));
      expect(second.fired).toBe(0);
      expect(await owner.campaignRuleRun.count({ where: { ruleId: rule.id } })).toBe(1);
    });

    it("never fires outside the window, for canceled meetings, or for past meetings", async () => {
      const rule = await addRule(0, { kind: "before_meeting", hours: 24 }, [
        { kind: "add_tag", tag: "pre-meeting" },
      ]);
      await addMeeting({ startAt: hoursFromNow(30) }); // too far out
      await addMeeting({ startAt: hoursFromNow(5), status: "canceled" }); // canceled
      await addMeeting({ startAt: hoursFromNow(-2) }); // already started
      const result = await runBeforeMeetingSweep(sweepDeps(), NOW);
      expect(result.fired).toBe(0);
      expect(await owner.campaignRuleRun.count({ where: { ruleId: rule.id } })).toBe(0);
    });

    it("RE-ARMS on reschedule: a new startAt is a new fire-once key", async () => {
      const rule = await addRule(0, { kind: "before_meeting", hours: 24 }, [
        { kind: "add_tag", tag: "pre-meeting" },
      ]);
      const meeting = await addMeeting({ startAt: hoursFromNow(20) });
      expect((await runBeforeMeetingSweep(sweepDeps(), NOW)).fired).toBe(1);

      // Reschedule to 3 days out — outside the window: nothing new fires…
      const newStart = hoursFromNow(72);
      await owner.meeting.update({ where: { id: meeting.id }, data: { startAt: newStart } });
      expect((await runBeforeMeetingSweep(sweepDeps(), NOW)).fired).toBe(0);

      // …until the clock walks into the NEW window: the NEW key fires once more.
      const later = new Date(newStart.getTime() - 10 * 3_600_000);
      expect((await runBeforeMeetingSweep(sweepDeps(), later)).fired).toBe(1);
      const runs = await owner.campaignRuleRun.findMany({ where: { ruleId: rule.id }, orderBy: { ranAt: "asc" } });
      expect(runs).toHaveLength(2);
      expect(new Set(runs.map((r) => r.eventId)).size).toBe(2);
      expect(runs[1]?.eventId).toBe(premeetEventIdFor(meeting.id, newStart));
    });

    it("hour thresholds are per rule: a 2h rule waits while a 24h rule fires", async () => {
      const early = await addRule(0, { kind: "before_meeting", hours: 24 }, [
        { kind: "add_tag", tag: "t-24h" },
      ]);
      const late = await addRule(1, { kind: "before_meeting", hours: 2 }, [
        { kind: "add_tag", tag: "t-2h" },
      ]);
      const meeting = await addMeeting({ startAt: hoursFromNow(20) });
      await runBeforeMeetingSweep(sweepDeps(), NOW);
      expect(await owner.campaignRuleRun.count({ where: { ruleId: early.id } })).toBe(1);
      expect(await owner.campaignRuleRun.count({ where: { ruleId: late.id } })).toBe(0);

      // 19h later the 2h rule's threshold passes — it fires under the SAME
      // meeting key for ITS OWN (ruleId, eventId) row.
      await runBeforeMeetingSweep(sweepDeps(), new Date(meeting.startAt.getTime() - 3_600_000));
      expect(await owner.campaignRuleRun.count({ where: { ruleId: late.id } })).toBe(1);
      expect(await owner.campaignRuleRun.count({ where: { ruleId: early.id } })).toBe(1);
    });

    it("account pass: an Automation before_meeting rule fires once per (automation, meeting, startAt)", async () => {
      const automation = await owner.automation.create({
        data: {
          workspaceId: ws,
          name: "Pre-meeting prep",
          enabled: true,
          trigger: { kind: "before_meeting", hours: 24 } as never,
          conditions: [] as never,
          actions: [{ kind: "add_tag", tag: "account-pre-meeting" }] as never,
        },
      });
      const meeting = await addMeeting({ startAt: hoursFromNow(10) });
      expect((await runBeforeMeetingSweep(sweepDeps(), NOW)).fired).toBe(1);
      const runs = await owner.automationRun.findMany({ where: { automationId: automation.id } });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.eventId).toBe(premeetEventIdFor(meeting.id, meeting.startAt));
      expect((await runBeforeMeetingSweep(sweepDeps(), NOW)).fired).toBe(0);
      expect((await owner.contact.findUniqueOrThrow({ where: { id: contactId } })).tags).toContain(
        "account-pre-meeting",
      );
    });
  });

  describe("send_booking_link executor", () => {
    const ctx = (over: Partial<RunContext> = {}): RunContext => ({
      workspaceId: ws,
      campaignId,
      eventId: `evt-${suffix}-${Math.random().toString(36).slice(2)}`,
      contactId,
      enrollmentId,
      depth: 0,
      terminalState: { fired: false },
      ...over,
    });

    it("flags Enrollment.meta.bookingLinkRequested — NON-terminal, idempotent, never a send", async () => {
      const outcome = await executeAction(engineDeps(), ctx(), "rule-x", { kind: "send_booking_link" });
      expect(outcome).toMatchObject({ kind: "send_booking_link", outcome: "executed" });
      expect(outcome.terminal).toBeUndefined(); // never gates the graph continuation
      expect(outcome.detail).toContain("queued for the next composed message");
      const enrollment = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect((enrollment.meta as Record<string, unknown>).bookingLinkRequested).toBe(true);
      // No Message row, no send-shaped side effect — the flag IS the effect.
      expect(await owner.message.count({ where: { workspaceId: ws } })).toBe(0);

      const again = await executeAction(engineDeps(), ctx(), "rule-x", { kind: "send_booking_link" });
      expect(again).toMatchObject({ outcome: "noop", detail: "booking link already queued" });
    });

    it("no enrollment on the event → honest noop, never an error row", async () => {
      const outcome = await executeAction(engineDeps(), ctx({ enrollmentId: null }), "rule-x", {
        kind: "send_booking_link",
      });
      expect(outcome).toMatchObject({ kind: "send_booking_link", outcome: "noop" });
      expect(outcome.detail).toContain("no enrollment");
    });

    it("preserves the rest of Enrollment.meta when flagging", async () => {
      await owner.enrollment.update({
        where: { id: enrollmentId },
        data: { meta: { events: [{ nodeId: "n1", kind: "note", detail: "keep me", at: "2026-07-01T00:00:00Z" }] } },
      });
      await executeAction(engineDeps(), ctx(), "rule-x", { kind: "send_booking_link" });
      const meta = (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } }))
        .meta as Record<string, unknown>;
      expect(meta.bookingLinkRequested).toBe(true);
      expect(Array.isArray(meta.events)).toBe(true);
    });
  });
});
