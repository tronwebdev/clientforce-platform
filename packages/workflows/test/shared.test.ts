import { describe, expect, it } from "vitest";
import type { BranchNode, CampaignGraph } from "@clientforce/core";
import { delayToMs, nextAfter, resolveReplyBranch, workflowIdFor } from "../src/shared";

describe("workflowIdFor", () => {
  it("is deterministic per enrollment (start-by-id dedupe)", () => {
    expect(workflowIdFor("abc-123")).toBe("enroll-abc-123");
    expect(workflowIdFor("abc-123")).toBe(workflowIdFor("abc-123"));
  });
});

describe("delayToMs", () => {
  it("converts each unit", () => {
    expect(delayToMs(2, "minutes")).toBe(120_000);
    expect(delayToMs(3, "hours")).toBe(10_800_000);
    expect(delayToMs(1, "days")).toBe(86_400_000);
  });

  it("scales without touching graph data — 1 day at 1/86400 ≈ 1s", () => {
    expect(delayToMs(1, "days", 1 / 86_400)).toBe(1000);
  });

  it("never returns less than 1ms so timers always fire", () => {
    expect(delayToMs(1, "minutes", 1e-9)).toBe(1);
  });
});

describe("nextAfter", () => {
  const graph: CampaignGraph = {
    entry: "a",
    nodes: [
      { id: "a", type: "step", channel: "email", content: {} },
      { id: "b", type: "end" },
    ],
    edges: [{ from: "a", to: "b" }],
  };

  it("follows the first outgoing edge and returns undefined at the tail", () => {
    expect(nextAfter(graph, "a")).toBe("b");
    expect(nextAfter(graph, "b")).toBeUndefined();
  });
});

describe("resolveReplyBranch (mirrors the T4 executor semantics)", () => {
  const node: BranchNode = {
    id: "br",
    type: "branch",
    on: "reply",
    cases: [
      { when: { intent: "interested" }, goto: "book", pipeline: "booked" },
      { when: "default", goto: "nudge" },
    ],
  };

  it("routes a matching intent to its case", () => {
    const r = resolveReplyBranch(node, "interested");
    expect(r).toMatchObject({ matched: "intent:interested", chosen: { goto: "book" } });
  });

  it("falls back to default for unknown intents and for no reply", () => {
    expect(resolveReplyBranch(node, "objection")?.chosen.goto).toBe("nudge");
    expect(resolveReplyBranch(node, undefined)?.matched).toBe("default");
  });

  it("returns undefined when nothing matches and there is no default", () => {
    const noDefault: BranchNode = {
      ...node,
      cases: [{ when: { intent: "interested" }, goto: "book" }],
    };
    expect(resolveReplyBranch(noDefault, "objection")).toBeUndefined();
  });

  // ── M1b (DEC-068): six-case routing + legacy back-compat ────────────────────
  const sixCase: BranchNode = {
    id: "br",
    type: "branch",
    on: "reply",
    cases: [
      { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
      { when: { intent: "objection_price" }, goto: "step-reframe-price", pipeline: "replied" },
      { when: { intent: "objection_timing" }, goto: "step-ack-timing", pipeline: "replied" },
      { when: { intent: "wrong_person" }, goto: "step-referral", pipeline: "replied" },
      { when: { intent: "info_request" }, goto: "step-answer", pipeline: "replied" },
      { when: { intent: "not_interested" }, goto: "step-close", pipeline: "lost" },
      { when: "default", goto: "step-followup" },
    ],
  };

  it("routes each of the six strategy intents to its own case (stage pin carried)", () => {
    const expected: Array<[string, string, string]> = [
      ["interested", "end-won", "booked"],
      ["objection_price", "step-reframe-price", "replied"],
      ["objection_timing", "step-ack-timing", "replied"],
      ["wrong_person", "step-referral", "replied"],
      ["info_request", "step-answer", "replied"],
      ["not_interested", "step-close", "lost"],
    ];
    for (const [intent, goto, pipeline] of expected) {
      const r = resolveReplyBranch(sixCase, intent);
      expect(r, intent).toMatchObject({ matched: `intent:${intent}`, chosen: { goto, pipeline } });
    }
  });

  it("routes the fallback label and unknown FUTURE intents to default (never a crash)", () => {
    expect(resolveReplyBranch(sixCase, "replied")?.matched).toBe("default");
    expect(resolveReplyBranch(sixCase, "some_future_intent")?.matched).toBe("default");
  });

  it("BACK-COMPAT: a legacy 1-branch graph routes NEW intents to its default case", () => {
    // `node` above is the pre-M1b planner shape (interested + default only).
    for (const intent of ["objection_price", "objection_timing", "wrong_person", "info_request", "not_interested"]) {
      const r = resolveReplyBranch(node, intent);
      expect(r, intent).toMatchObject({ matched: "default", chosen: { goto: "nudge" } });
    }
  });
});
