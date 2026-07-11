import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_RULES,
  computeOutcomes,
  DELIVERY_TRACKED_CHANNELS,
  outcomeSignal,
  POSITIVE_INTENTS,
  REPLY_EXCLUDED_INTENTS,
  SIGNAL_MIN_SENDS,
  type ComputeOutcomesInput,
  type OutcomeEventRow,
  type OutcomeInboundRow,
  type OutcomeOutboundRow,
} from "../src";

/**
 * F1 (DEC-068) — statistical-honesty gates + attribution edges. These pin the
 * charter's constants and rules; a change here is a product decision, not a
 * refactor.
 */

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

let seq = 0;
const out = (o: Partial<OutcomeOutboundRow> & { stepNodeId: string | null }): OutcomeOutboundRow => ({
  id: o.id ?? `out-${++seq}`,
  stepNodeId: o.stepNodeId,
  contactId: o.contactId ?? "c1",
  enrollmentId: o.enrollmentId ?? "e1",
  sentAt: o.sentAt ?? at(seq),
});
const inb = (o: Partial<OutcomeInboundRow>): OutcomeInboundRow => ({
  id: o.id ?? `in-${++seq}`,
  inReplyToId: o.inReplyToId ?? null,
  intent: o.intent ?? "replied",
  contactId: o.contactId ?? "c1",
  enrollmentId: o.enrollmentId ?? "e1",
  sentAt: o.sentAt ?? at(1000 + seq),
});
const evt = (o: Partial<OutcomeEventRow> & { type: string }): OutcomeEventRow => ({
  id: o.id ?? `ev-${++seq}`,
  type: o.type,
  payload: o.payload ?? {},
  contactId: o.contactId ?? "c1",
  enrollmentId: o.enrollmentId ?? "e1",
  occurredAt: o.occurredAt ?? at(2000 + seq),
});
const replyEvt = (messageId: string, extra: Partial<OutcomeEventRow> = {}) =>
  evt({ type: "email.replied.v1", payload: { messageId }, ...extra });

const TWO_STEPS = [
  { stepNodeId: "step-1", channel: "email" },
  { stepNodeId: "step-2", channel: "email" },
];

function compute(partial: Partial<ComputeOutcomesInput>) {
  return computeOutcomes({
    steps: partial.steps ?? TWO_STEPS,
    outbound: partial.outbound ?? [],
    inbound: partial.inbound ?? [],
    events: partial.events ?? [],
  });
}

describe("outcomeSignal (min-n gates — constants, boundary-tested)", () => {
  it("pins the thresholds", () => {
    expect(SIGNAL_MIN_SENDS).toEqual({ low: 20, ok: 50 });
  });
  it("gates exactly at the boundaries", () => {
    expect(outcomeSignal(0)).toBe("none");
    expect(outcomeSignal(19)).toBe("none");
    expect(outcomeSignal(20)).toBe("low");
    expect(outcomeSignal(49)).toBe("low");
    expect(outcomeSignal(50)).toBe("ok");
    expect(outcomeSignal(500)).toBe("ok");
  });
});

describe("attribution rules (charter constants)", () => {
  it("pins reply → last-sent step, goal → sequence", () => {
    expect(ATTRIBUTION_RULES).toEqual({ reply: "last-sent-step", goal: "sequence" });
  });
  it("pins the counting vocabulary defaults (F1 plan veto points)", () => {
    expect([...POSITIVE_INTENTS]).toEqual(["interested", "booked"]);
    expect([...REPLY_EXCLUDED_INTENTS]).toEqual(["unsubscribe"]);
    expect([...DELIVERY_TRACKED_CHANNELS]).toEqual(["email"]);
  });
});

describe("computeOutcomes — sent + min-n honesty", () => {
  it("zero-fills every current-graph step and reports honest zeros", () => {
    const { steps, totals } = compute({});
    expect(steps.map((s) => s.stepNodeId)).toEqual(["step-1", "step-2"]);
    for (const s of steps) {
      expect(s.sent).toBe(0);
      expect(s.signal).toBe("none");
      expect(s.replyRatePct).toBeNull();
      expect(s.positiveRatePct).toBeNull();
      expect(s.optOutRatePct).toBeNull();
    }
    expect(totals.sent).toBe(0);
    expect(totals.signal).toBe("none");
    expect(totals.goalCompletions).toBe(0);
  });

  it("reports NO rates below 20 sends even when replies exist", () => {
    const outbound = Array.from({ length: 19 }, (_, i) =>
      out({ stepNodeId: "step-1", contactId: `c${i}`, enrollmentId: `e${i}`, sentAt: at(i) }),
    );
    const reply = inb({ inReplyToId: outbound[0]!.id, contactId: "c0", enrollmentId: "e0", intent: "interested" });
    const { steps } = compute({ outbound, inbound: [reply], events: [replyEvt(reply.id, { contactId: "c0", enrollmentId: "e0" })] });
    const step1 = steps[0]!;
    expect(step1.sent).toBe(19);
    expect(step1.signal).toBe("none");
    expect(step1.replies).toBe(1); // raw counts stay honest…
    expect(step1.replyRatePct).toBeNull(); // …rates are refused below the floor
  });

  it("reports 1-decimal rates from 20 sends (low) and full signal at 50 (ok)", () => {
    const mk = (step: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        out({ stepNodeId: step, contactId: `${step}-c${i}`, enrollmentId: `${step}-e${i}`, sentAt: at(i) }),
      );
    const outbound = [...mk("step-1", 62), ...mk("step-2", 20)];
    // 3 distinct repliers on step-1: 3/62 = 4.8387… → 4.8
    const inbound = [0, 1, 2].map((i) =>
      inb({ inReplyToId: outbound[i]!.id, contactId: `step-1-c${i}`, enrollmentId: `step-1-e${i}`, intent: i === 0 ? "interested" : "replied" }),
    );
    const events = inbound.map((r) => replyEvt(r.id, { contactId: r.contactId, enrollmentId: r.enrollmentId }));
    const { steps, totals } = compute({ outbound, inbound, events });
    const [s1, s2] = [steps[0]!, steps[1]!];
    expect(s1.signal).toBe("ok");
    expect(s1.replyRatePct).toBe(4.8);
    expect(s1.positiveRatePct).toBe(1.6); // 1/62 = 1.61…
    expect(s1.optOutRatePct).toBe(0);
    expect(s2.signal).toBe("low");
    expect(s2.replyRatePct).toBe(0);
    expect(totals.sent).toBe(82);
    expect(totals.signal).toBe("ok");
    expect(totals.replies).toBe(3);
  });
});

describe("computeOutcomes — reply attribution (LAST-SENT step)", () => {
  it("a reply after two steps attributes to step 2 via the thread pointer, never step 1", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0) });
    const m2 = out({ stepNodeId: "step-2", sentAt: at(60) });
    const reply = inb({ inReplyToId: m2.id, sentAt: at(90) });
    const { steps } = compute({ outbound: [m1, m2], inbound: [reply], events: [replyEvt(reply.id)] });
    expect(steps[0]!.replies).toBe(0);
    expect(steps[1]!.replies).toBe(1);
  });

  it("falls back to the latest outbound in the enrollment when the thread pointer is missing", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0) });
    const m2 = out({ stepNodeId: "step-2", sentAt: at(60) });
    const reply = inb({ inReplyToId: null, sentAt: at(90) });
    const { steps } = compute({ outbound: [m1, m2], inbound: [reply], events: [replyEvt(reply.id)] });
    expect(steps[1]!.replies).toBe(1);
  });

  it("falls back by contact when the reply has no enrollment", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0), enrollmentId: null });
    const reply = inb({ inReplyToId: null, enrollmentId: null, sentAt: at(30) });
    const { steps } = compute({ outbound: [m1], inbound: [reply], events: [replyEvt(reply.id, { enrollmentId: null })] });
    expect(steps[0]!.replies).toBe(1);
  });

  it("a threaded outbound without a stepNodeId falls back to the timestamp rule", () => {
    const legacy = out({ id: "legacy", stepNodeId: null, sentAt: at(0) });
    const m2 = out({ stepNodeId: "step-2", sentAt: at(60) });
    const reply = inb({ inReplyToId: "legacy", sentAt: at(90) });
    const { steps } = compute({ outbound: [legacy, m2], inbound: [reply], events: [replyEvt(reply.id)] });
    expect(steps[1]!.replies).toBe(1);
  });

  it("dedupes repliers per step (a thread's back-and-forth is one lead)", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0) });
    const r1 = inb({ inReplyToId: m1.id, sentAt: at(10) });
    const r2 = inb({ inReplyToId: m1.id, sentAt: at(20) });
    const { steps, totals } = compute({ outbound: [m1], inbound: [r1, r2], events: [replyEvt(r1.id), replyEvt(r2.id)] });
    expect(steps[0]!.replies).toBe(1);
    expect(totals.replies).toBe(1);
  });

  it("totals count a lead once even when they replied to two different steps", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0) });
    const m2 = out({ stepNodeId: "step-2", sentAt: at(60) });
    const r1 = inb({ inReplyToId: m1.id, sentAt: at(10) });
    const r2 = inb({ inReplyToId: m2.id, sentAt: at(70) });
    const { steps, totals } = compute({ outbound: [m1, m2], inbound: [r1, r2], events: [replyEvt(r1.id), replyEvt(r2.id)] });
    expect(steps[0]!.replies).toBe(1);
    expect(steps[1]!.replies).toBe(1);
    expect(totals.replies).toBe(1);
  });

  it("ignores a reply event whose message is not in the ledger", () => {
    const m1 = out({ stepNodeId: "step-1" });
    const { steps } = compute({ outbound: [m1], events: [replyEvt("ghost")] });
    expect(steps[0]!.replies).toBe(0);
  });

  it("an unattributable reply (no thread pointer, no prior send) counts in totals only", () => {
    // The only outbound was sent AFTER the reply — last-sent-before finds nothing.
    const m1 = out({ stepNodeId: "step-1", sentAt: at(100) });
    const reply = inb({ inReplyToId: null, sentAt: at(10) });
    const { steps, totals } = compute({ outbound: [m1], inbound: [reply], events: [replyEvt(reply.id)] });
    expect(steps.every((s) => s.replies === 0)).toBe(true);
    expect(totals.replies).toBe(1);
  });

  it("excludes unsubscribe-intent replies from reply counts (DEC-034: side-effect label)", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0) });
    const reply = inb({ inReplyToId: m1.id, intent: "unsubscribe", sentAt: at(10) });
    const { steps } = compute({
      outbound: [m1],
      inbound: [reply],
      events: [replyEvt(reply.id), evt({ type: "lead.unsubscribed.v1", occurredAt: at(11) })],
    });
    expect(steps[0]!.replies).toBe(0);
    expect(steps[0]!.optOuts).toBe(1); // the signal lands in the opt-out column instead
  });
});

describe("computeOutcomes — delivered + opt-out attribution", () => {
  it("attributes delivered events through messageId → outbound stepNodeId", () => {
    const m1 = out({ stepNodeId: "step-1" });
    const { steps } = compute({
      outbound: [m1],
      events: [evt({ type: "email.delivered.v1", payload: { messageId: m1.id } })],
    });
    expect(steps[0]!.delivered).toBe(1);
  });

  it("counts delivered per MESSAGE, not per event — an at-least-once webhook retry can never report delivered > sent", () => {
    const m1 = out({ stepNodeId: "step-1" });
    const { steps, totals } = compute({
      outbound: [m1],
      events: [
        evt({ type: "email.delivered.v1", payload: { messageId: m1.id } }),
        evt({ type: "email.delivered.v1", payload: { messageId: m1.id } }), // provider retry, new event row
      ],
    });
    expect(steps[0]!.delivered).toBe(1);
    expect(totals.delivered).toBe(1);
  });

  it("reports delivered: null for channels without delivery telemetry (sms)", () => {
    const stepRefs = [
      { stepNodeId: "step-1", channel: "email" },
      { stepNodeId: "step-sms", channel: "sms" },
    ];
    const { steps } = compute({ steps: stepRefs, outbound: [out({ stepNodeId: "step-sms" })] });
    expect(steps[1]!.delivered).toBeNull(); // never a fake 0
    expect(steps[0]!.delivered).toBe(0);
  });

  it("attributes an opt-out to the last-sent step before it and dedupes per contact", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0) });
    const m2 = out({ stepNodeId: "step-2", sentAt: at(60) });
    const { steps } = compute({
      outbound: [m1, m2],
      events: [
        evt({ type: "lead.unsubscribed.v1", occurredAt: at(90) }),
        evt({ type: "lead.unsubscribed.v1", occurredAt: at(95) }), // same contact again (email + bulk)
      ],
    });
    expect(steps[0]!.optOuts).toBe(0);
    expect(steps[1]!.optOuts).toBe(1);
  });

  it("an opt-out with no attributable send still counts in totals", () => {
    const { steps, totals } = compute({
      events: [evt({ type: "lead.unsubscribed.v1", enrollmentId: null })],
    });
    expect(steps.every((s) => s.optOuts === 0)).toBe(true);
    expect(totals.optOuts).toBe(1);
  });

  it("dedupes events fetched twice (campaign OR enrollment overlap)", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0) });
    const e = evt({ type: "lead.unsubscribed.v1", occurredAt: at(10) });
    const { totals } = compute({ outbound: [m1], events: [e, { ...e }] });
    expect(totals.optOuts).toBe(1);
  });
});

describe("computeOutcomes — goal completion attributes to the SEQUENCE only", () => {
  it("a goal after N touches lands in totals.goalCompletions and on NO step row", () => {
    const m1 = out({ stepNodeId: "step-1", sentAt: at(0) });
    const m2 = out({ stepNodeId: "step-2", sentAt: at(60) });
    const { steps, totals } = compute({
      outbound: [m1, m2],
      events: [
        evt({
          type: "lead.stage_changed.v1",
          payload: { fromStage: "replied", toStage: "booked", goalKey: "book_appointments", label: "Meeting booked" },
          occurredAt: at(120),
        }),
      ],
    });
    expect(totals.goalCompletions).toBe(1);
    for (const s of steps) {
      expect(s).not.toHaveProperty("goalCompletions");
      expect(s.replies + s.optOuts).toBe(0); // the goal event touched no step counter
    }
  });

  it("dedupes goal completion per enrollment (manual + automated double event)", () => {
    const { totals } = compute({
      events: [
        evt({ type: "lead.stage_changed.v1", payload: { fromStage: "new", toStage: "booked" }, occurredAt: at(1) }),
        evt({ type: "lead.stage_changed.v1", payload: { fromStage: "new", toStage: "booked", goalKey: "book_appointments" }, occurredAt: at(2) }),
      ],
    });
    expect(totals.goalCompletions).toBe(1);
  });

  it("ignores non-goal stage moves", () => {
    const { totals } = compute({
      events: [evt({ type: "lead.stage_changed.v1", payload: { fromStage: "new", toStage: "replied" } })],
    });
    expect(totals.goalCompletions).toBe(0);
  });
});

describe("computeOutcomes — removed steps fold into totals only", () => {
  it("sends on a stepNodeId no longer in the graph count toward totals, not steps", () => {
    const outbound = [out({ stepNodeId: "step-removed", sentAt: at(0) }), out({ stepNodeId: "step-1", contactId: "c2", enrollmentId: "e2", sentAt: at(1) })];
    const { steps, totals } = compute({ outbound });
    expect(steps.find((s) => s.stepNodeId === "step-removed")).toBeUndefined();
    expect(steps[0]!.sent).toBe(1);
    expect(totals.sent).toBe(2);
  });
});
