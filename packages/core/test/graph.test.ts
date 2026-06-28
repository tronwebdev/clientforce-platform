import { describe, expect, it } from "vitest";
import {
  execute,
  GraphExecutionError,
  GraphValidationError,
  validateGraph,
  type CampaignGraph,
} from "../src/index";

/**
 * Sample graph: email (→ contacted) → wait 2d → sms → branch on reply
 *   interested → win step (→ engaged) → end
 *   not_now    → wait 1d → end
 *   default    → end
 */
const sample: CampaignGraph = {
  entry: "n1",
  nodes: [
    { id: "n1", type: "step", channel: "email", content: { subject: "Hi", body: "..." }, pipelineOnSend: "contacted" },
    { id: "d1", type: "delay", amount: 2, unit: "days" },
    { id: "n2", type: "step", channel: "sms", content: { body: "still there?" } },
    {
      id: "b1",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "win", pipeline: "engaged" },
        { when: { intent: "not_now" }, goto: "d2" },
        { when: "default", goto: "end1" },
      ],
    },
    { id: "win", type: "step", channel: "email", content: { body: "great!" } },
    { id: "d2", type: "delay", amount: 1, unit: "days" },
    { id: "end1", type: "end" },
  ],
  edges: [
    { from: "n1", to: "d1" },
    { from: "d1", to: "n2" },
    { from: "n2", to: "b1" },
    { from: "win", to: "end1" },
    { from: "d2", to: "end1" },
  ],
};

describe("validateGraph", () => {
  it("accepts the sample graph", () => {
    expect(validateGraph(sample).entry).toBe("n1");
  });

  it("rejects a missing entry", () => {
    expect(() => validateGraph({ ...sample, entry: "ghost" })).toThrow(/entry "ghost" is not a known node/);
  });

  it("rejects an edge to an unknown node", () => {
    const bad = { ...sample, edges: [...sample.edges, { from: "n1", to: "nowhere" }] };
    expect(() => validateGraph(bad)).toThrow(/unknown node/);
  });

  it("rejects a branch goto to an unknown node", () => {
    const bad: CampaignGraph = {
      ...sample,
      nodes: sample.nodes.map((n) =>
        n.id === "b1" && n.type === "branch"
          ? { ...n, cases: [{ when: "default", goto: "missing" }] }
          : n,
      ),
    };
    expect(() => validateGraph(bad)).toThrow(/case goto "missing" is unknown/);
  });

  it("rejects an unknown channel (zod shape error)", () => {
    const bad = {
      ...sample,
      nodes: sample.nodes.map((n) => (n.id === "n1" ? { ...n, channel: "telegram" } : n)),
    };
    expect(() => validateGraph(bad)).toThrow(GraphValidationError);
  });

  it("rejects a duplicate node id", () => {
    const bad = { ...sample, nodes: [...sample.nodes, { id: "n1", type: "end" }] };
    expect(() => validateGraph(bad)).toThrow(/Duplicate node id "n1"/);
  });

  it("rejects a sequential node with no outgoing edge", () => {
    const bad = { ...sample, edges: sample.edges.filter((e) => e.from !== "n2") };
    expect(() => validateGraph(bad)).toThrow(/node "n2" \(step\) must have exactly one outgoing edge/);
  });
});

describe("execute", () => {
  it("runs the 'interested' path to the expected ordered actions", () => {
    const actions = execute(sample, { events: { b1: { intent: "interested" } } });
    expect(actions).toEqual([
      { kind: "send", nodeId: "n1", channel: "email", content: { subject: "Hi", body: "..." } },
      { kind: "pipeline_move", nodeId: "n1", stage: "contacted" },
      { kind: "wait", nodeId: "d1", amount: 2, unit: "days" },
      { kind: "send", nodeId: "n2", channel: "sms", content: { body: "still there?" } },
      { kind: "branch", nodeId: "b1", on: "reply", matched: "intent:interested", goto: "win" },
      { kind: "pipeline_move", nodeId: "b1", stage: "engaged" },
      { kind: "send", nodeId: "win", channel: "email", content: { body: "great!" } },
      { kind: "end", nodeId: "end1" },
    ]);
  });

  it("resolves the 'not_now' branch to the delay path", () => {
    const actions = execute(sample, { events: { b1: { intent: "not_now" } } });
    const tail = actions.slice(-3);
    expect(tail).toEqual([
      { kind: "branch", nodeId: "b1", on: "reply", matched: "intent:not_now", goto: "d2" },
      { kind: "wait", nodeId: "d2", amount: 1, unit: "days" },
      { kind: "end", nodeId: "end1" },
    ]);
  });

  it("falls through to the default branch for an unmatched intent", () => {
    const actions = execute(sample, { events: { b1: { intent: "angry" } } });
    const branch = actions.find((a) => a.kind === "branch");
    expect(branch).toMatchObject({ matched: "default", goto: "end1" });
    expect(actions.at(-1)).toEqual({ kind: "end", nodeId: "end1" });
    // default path skips the win step and the d2 delay
    expect(actions.some((a) => a.nodeId === "win")).toBe(false);
  });

  it("uses default when no event is supplied for the branch", () => {
    const actions = execute(sample);
    expect(actions.find((a) => a.kind === "branch")).toMatchObject({ matched: "default" });
  });

  it("emits an action and enters a subcampaign", () => {
    const graph: CampaignGraph = {
      entry: "a1",
      nodes: [
        { id: "a1", type: "action", action: "book_meeting", params: { calendar: "cal" } },
        { id: "s1", type: "subcampaign", ref: "nurture" },
      ],
      edges: [{ from: "a1", to: "s1" }],
    };
    expect(execute(graph)).toEqual([
      { kind: "action", nodeId: "a1", action: "book_meeting", params: { calendar: "cal" } },
      { kind: "enter_subcampaign", nodeId: "s1", ref: "nurture" },
    ]);
  });

  it("throws on a cycle past maxSteps", () => {
    const loop: CampaignGraph = {
      entry: "n1",
      nodes: [{ id: "n1", type: "step", channel: "email", content: {} }],
      edges: [{ from: "n1", to: "n1" }],
    };
    expect(() => execute(loop, { maxSteps: 10 })).toThrow(GraphExecutionError);
  });
});
