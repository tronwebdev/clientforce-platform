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

  // ── G1 (DEC-070): guided steps — briefs composed at send, sms-only ─────────
  const asGuided = (over: object): CampaignGraph => ({
    ...sample,
    nodes: sample.nodes.map((n) =>
      n.id === "n2"
        ? {
            id: "n2",
            type: "step" as const,
            channel: "sms" as const,
            content: {},
            mode: "guided" as const,
            brief: { objective: "earn a reply", talkingPoints: ["a", "b", "c"] },
            ...over,
          }
        : n,
    ),
  });

  it("G1: accepts a guided sms step with a brief and empty content (legacy nodes untouched)", () => {
    const graph = validateGraph(asGuided({}));
    const step = graph.nodes.find((n) => n.id === "n2");
    expect(step).toMatchObject({ mode: "guided", brief: { objective: "earn a reply" } });
  });

  it("G1: rejects guided on any channel but sms (guided email is G2)", () => {
    expect(() => validateGraph(asGuided({ channel: "email" }))).toThrow(/sms-only/);
  });

  it("G1: rejects a guided step without a brief", () => {
    expect(() => validateGraph(asGuided({ brief: undefined }))).toThrow(/must carry a brief/);
  });

  it("G1: rejects a guided step carrying body/subject copy (one source of truth)", () => {
    expect(() => validateGraph(asGuided({ content: { body: "fixed copy" } }))).toThrow(
      /must not carry body\/subject copy/,
    );
  });

  it("G1: rejects a brief on a step that is not mode guided", () => {
    expect(() => validateGraph(asGuided({ mode: undefined }))).toThrow(/not mode:"guided"/);
  });

  it("G1: enforces the 3–6 talking-point bounds at the zod layer", () => {
    expect(() =>
      validateGraph(asGuided({ brief: { objective: "x", talkingPoints: ["a", "b"] } })),
    ).toThrow(GraphValidationError);
    expect(() =>
      validateGraph(
        asGuided({ brief: { objective: "x", talkingPoints: ["a", "b", "c", "d", "e", "f", "g"] } }),
      ),
    ).toThrow(GraphValidationError);
  });

  it("rejects a sequential node with no outgoing edge", () => {
    const bad = { ...sample, edges: sample.edges.filter((e) => e.from !== "n2") };
    expect(() => validateGraph(bad)).toThrow(/node "n2" \(step\) must have exactly one outgoing edge/);
  });

  // M1b (DEC-068): branch cases are keyed by intent — ambiguity is rejected.
  it("rejects duplicate intent cases within one branch", () => {
    const bad: CampaignGraph = {
      ...sample,
      nodes: sample.nodes.map((n) =>
        n.id === "b1" && n.type === "branch"
          ? {
              ...n,
              cases: [
                { when: { intent: "interested" }, goto: "win" },
                { when: { intent: "interested" }, goto: "d2" },
                { when: "default", goto: "end1" },
              ],
            }
          : n,
      ),
    };
    expect(() => validateGraph(bad)).toThrow(/duplicate cases for intent "interested"/);
  });

  it("rejects more than one default case within one branch", () => {
    const bad: CampaignGraph = {
      ...sample,
      nodes: sample.nodes.map((n) =>
        n.id === "b1" && n.type === "branch"
          ? {
              ...n,
              cases: [
                { when: "default", goto: "end1" },
                { when: "default", goto: "d2" },
              ],
            }
          : n,
      ),
    };
    expect(() => validateGraph(bad)).toThrow(/more than one default case/);
  });

  it("M1b six-case branch validates; a strategy path may rejoin the reply branch (loop-back edge)", () => {
    const sixCase: CampaignGraph = {
      entry: "s1",
      nodes: [
        { id: "s1", type: "step", channel: "email", content: { subject: "a", body: "b" } },
        { id: "br", type: "branch", on: "reply", cases: [
          { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
          { when: { intent: "objection_price" }, goto: "reframe", pipeline: "replied" },
          { when: { intent: "objection_timing" }, goto: "ack" },
          { when: { intent: "wrong_person" }, goto: "referral" },
          { when: { intent: "info_request" }, goto: "answer" },
          { when: { intent: "not_interested" }, goto: "close", pipeline: "lost" },
          { when: "default", goto: "end-lost" },
        ] },
        { id: "reframe", type: "step", channel: "email", content: { body: "value" } },
        { id: "ack", type: "step", channel: "email", content: { body: "later" } },
        { id: "referral", type: "step", channel: "email", content: { body: "who?" } },
        { id: "answer", type: "step", channel: "email", content: { body: "here" } },
        { id: "close", type: "step", channel: "email", content: { body: "bye" } },
        { id: "end-won", type: "end" },
        { id: "end-lost", type: "end" },
      ],
      edges: [
        { from: "s1", to: "br" },
        { from: "reframe", to: "br" }, // loop-back: await the NEXT reply
        { from: "ack", to: "br" },
        { from: "referral", to: "end-lost" },
        { from: "answer", to: "br" },
        { from: "close", to: "end-lost" },
      ],
    };
    expect(validateGraph(sixCase).entry).toBe("s1");
    // Dry-run the objection_price → reframe loop: the same event resolves the
    // branch each visit, so the executor's cycle guard bounds it — the
    // RUNTIME loop is safe because step sends are idempotent per node (P1.6).
    const actions = execute(sixCase, { events: { br: { intent: "interested" } } });
    expect(actions.find((a) => a.kind === "branch")).toMatchObject({ matched: "intent:interested" });
    expect(actions.find((a) => a.kind === "pipeline_move")).toMatchObject({ stage: "booked" });
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
