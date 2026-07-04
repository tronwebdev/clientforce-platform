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
});
