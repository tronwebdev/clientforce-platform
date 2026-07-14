/**
 * W3-4 (DEC-076): the graph walk + deterministic mutation layer.
 *
 * Fixtures: the M1b playbook graph every planner emits today (six-intent
 * reply branch + strategy steps), a legacy pre-playbook graph, and a richer
 * multi-branch / multi-step-chain graph (the standing W3-4 shape) — proving
 * the persisted model already REPRESENTS the richer shape and the mutation
 * layer keeps every graph valid by construction.
 */
import { describe, expect, it } from "vitest";
import {
  addStep,
  branchChains,
  chainForCase,
  containerNodes,
  execute,
  freshNodeId,
  GraphMutationError,
  mainSequence,
  moveStep,
  removeStep,
  repairGraph,
  setStepMode,
  stepContainerOf,
  strategyChains,
  updateDelay,
  updateStepBrief,
  updateStepContent,
  validateGraph,
  type CampaignGraph,
  type StepBrief,
} from "../src/index";

/** The v4/M1b playbook shape (mirrors the planner fake in apps/api tests). */
const playbook = (): CampaignGraph => ({
  entry: "step-1",
  nodes: [
    { id: "step-1", type: "step", channel: "email", content: { subject: "Hello {{company}}", body: "Hi {{firstName}}, intro." } },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    { id: "step-2", type: "step", channel: "email", content: { subject: "Following up", body: "Hi {{firstName}}, value for {{company}}." } },
    { id: "delay-2", type: "delay", amount: 3, unit: "days" },
    { id: "step-3", type: "step", channel: "email", content: { subject: "Last note", body: "Door's open, {{firstName}}." } },
    {
      id: "branch-reply",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
        { when: { intent: "objection_price" }, goto: "step-reframe", pipeline: "replied" },
        { when: { intent: "objection_timing" }, goto: "step-ack", pipeline: "replied" },
        { when: { intent: "wrong_person" }, goto: "step-referral", pipeline: "replied" },
        { when: { intent: "info_request" }, goto: "step-answer", pipeline: "replied" },
        { when: { intent: "not_interested" }, goto: "step-close", pipeline: "lost" },
        { when: "default", goto: "end-lost" },
      ],
    },
    { id: "step-reframe", type: "step", channel: "email", content: { body: "Value first.", threaded: true } },
    { id: "step-ack", type: "step", channel: "email", content: { body: "Later then.", threaded: true } },
    { id: "step-referral", type: "step", channel: "email", content: { body: "Who instead?", threaded: true } },
    { id: "step-answer", type: "step", channel: "email", content: { body: "Answer.", threaded: true } },
    { id: "step-close", type: "step", channel: "email", content: { body: "All good.", threaded: true } },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "step-2" },
    { from: "step-2", to: "delay-2" },
    { from: "delay-2", to: "step-3" },
    { from: "step-3", to: "branch-reply" },
    { from: "step-reframe", to: "end-lost" },
    { from: "step-ack", to: "end-lost" },
    { from: "step-referral", to: "end-lost" },
    { from: "step-answer", to: "end-lost" },
    { from: "step-close", to: "end-lost" },
  ],
});

/** Richer W3-4 shape: multi-step chain in a case + a second (no_response) branch. */
const rich = (): CampaignGraph => ({
  entry: "s1",
  nodes: [
    { id: "s1", type: "step", channel: "email", content: { subject: "Hi", body: "Intro {{firstName}}" } },
    { id: "d1", type: "delay", amount: 2, unit: "days" },
    {
      id: "b1",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "c1-s1", pipeline: "booked" },
        { when: { intent: "objection_price" }, goto: "shared-s" },
        { when: { intent: "objection_timing" }, goto: "shared-s" },
        { when: "default", goto: "b2" },
      ],
    },
    // interested: a MULTI-STEP chain (step → delay → step) rejoining end.
    { id: "c1-s1", type: "step", channel: "email", content: { body: "Booking link", threaded: true } },
    { id: "c1-d1", type: "delay", amount: 1, unit: "days" },
    { id: "c1-s2", type: "step", channel: "email", content: { body: "Confirmed?", threaded: true } },
    // a tail SHARED by two cases.
    { id: "shared-s", type: "step", channel: "email", content: { body: "Objection handler", threaded: true } },
    // a SECOND branch (no_response) past the reply branch's default.
    {
      id: "b2",
      type: "branch",
      on: "no_response",
      cases: [
        { when: { intent: "interested" }, goto: "re-s1" },
        { when: "default", goto: "end1" },
      ],
    },
    { id: "re-s1", type: "step", channel: "email", content: { body: "Re-engage" } },
    { id: "end1", type: "end" },
  ],
  edges: [
    { from: "s1", to: "d1" },
    { from: "d1", to: "b1" },
    { from: "c1-s1", to: "c1-d1" },
    { from: "c1-d1", to: "c1-s2" },
    { from: "c1-s2", to: "end1" },
    { from: "shared-s", to: "end1" },
    { from: "re-s1", to: "end1" },
  ],
});

const brief: StepBrief = {
  objective: "Book the call",
  talkingPoints: ["point one", "point two", "point three"],
};

describe("W0 · richer shape is representable + executable (regression pins)", () => {
  it("validateGraph accepts multiple branches and multi-step chains", () => {
    expect(validateGraph(rich()).nodes).toHaveLength(10);
  });

  it("the executor walks a multi-step chain inside a branch case", () => {
    const actions = execute(rich(), { events: { b1: { intent: "interested" } } });
    const sends = actions.filter((a) => a.kind === "send").map((a) => a.nodeId);
    expect(sends).toEqual(["s1", "c1-s1", "c1-s2"]);
  });

  it("the executor routes the second branch (default → no_response default)", () => {
    const actions = execute(rich());
    expect(actions.map((a) => a.kind)).toContain("branch");
    expect(actions[actions.length - 1]).toEqual({ kind: "end", nodeId: "end1" });
  });

  it("legacy playbook graphs round-trip validateGraph byte-identical", () => {
    const input = playbook();
    expect(validateGraph(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });
});

describe("walk · mainSequence / branchChains / strategyChains", () => {
  it("mainSequence truncates at the reply branch (steps + delays only)", () => {
    expect(mainSequence(playbook()).map((n) => n.id)).toEqual([
      "step-1", "delay-1", "step-2", "delay-2", "step-3",
    ]);
  });

  it("branchChains surfaces multi-step chains, shared tails, and empty default chains", () => {
    const sets = branchChains(rich());
    expect(sets.map((s) => s.branch.id)).toEqual(["b1", "b2"]);
    const b1 = sets[0]!;
    expect(b1.cases.find((c) => c.key === "interested")?.chain.map((n) => n.id)).toEqual([
      "c1-s1", "c1-d1", "c1-s2",
    ]);
    expect(b1.cases.find((c) => c.key === "objection_price")?.chain.map((n) => n.id)).toEqual(["shared-s"]);
    expect(b1.sharedNodeIds).toEqual(["shared-s"]);
    // default's continuation IS the main path → empty chain.
    expect(b1.cases.find((c) => c.key === "default")?.chain).toEqual([]);
  });

  it("strategyChains generalizes the single-step convention (first step preserved)", () => {
    const chains = strategyChains(playbook());
    expect(chains.map((c) => c.intent)).toEqual([
      "interested", "objection_price", "objection_timing", "wrong_person", "info_request", "not_interested",
    ]);
    expect(chains.find((c) => c.intent === "objection_price")?.steps.map((s) => s.id)).toEqual(["step-reframe"]);
    // interested routes straight to end-won → empty chain, honest.
    expect(chains.find((c) => c.intent === "interested")?.chain).toEqual([]);
  });

  it("chainForCase walks one case; unknown case is undefined", () => {
    expect(chainForCase(rich(), "b1", "interested")?.map((n) => n.id)).toEqual(["c1-s1", "c1-d1", "c1-s2"]);
    expect(chainForCase(rich(), "b1", "nope")).toBeUndefined();
  });
});

describe("mutate · addStep", () => {
  it("appends delay + step at the main-sequence end, before the reply branch", () => {
    const { graph, stepId, delayId } = addStep(playbook(), { container: { kind: "main" }, channel: "email" });
    expect(stepId).toBe("step-added-1");
    expect(delayId).toBe("delay-added-1");
    expect(validateGraph(graph)).toBeTruthy();
    expect(mainSequence(graph).map((n) => n.id)).toEqual([
      "step-1", "delay-1", "step-2", "delay-2", "step-3", "delay-added-1", "step-added-1",
    ]);
    expect(graph.edges).toContainEqual({ from: "step-added-1", to: "branch-reply" });
  });

  it("appends within a branch case's chain (multi-step chains become authorable)", () => {
    const { graph, stepId } = addStep(rich(), {
      container: { kind: "case", branchId: "b1", caseKey: "interested" },
      channel: "email",
      content: { body: "One more nudge", threaded: true },
    });
    expect(validateGraph(graph)).toBeTruthy();
    expect(chainForCase(graph, "b1", "interested")?.map((n) => n.id)).toEqual([
      "c1-s1", "c1-d1", "c1-s2", "delay-added-1", stepId,
    ]);
  });

  it("a first step in an empty case chain takes no delay and retargets the case goto", () => {
    const base = playbook(); // interested → end-won (empty chain)
    const { graph, stepId, delayId } = addStep(base, {
      container: { kind: "case", branchId: "branch-reply", caseKey: "interested" },
      channel: "email",
      content: { body: "Grab a time", threaded: true },
    });
    expect(delayId).toBeUndefined();
    expect(validateGraph(graph)).toBeTruthy();
    const branch = graph.nodes.find((n) => n.id === "branch-reply");
    expect(branch?.type === "branch" && branch.cases[0]?.goto).toBe(stepId);
    expect(graph.edges).toContainEqual({ from: stepId, to: "end-won" });
  });

  it("adds a guided step carrying a brief; guided is email/sms-only", () => {
    const { graph, stepId } = addStep(playbook(), { container: { kind: "main" }, channel: "email", brief });
    const node = graph.nodes.find((n) => n.id === stepId);
    expect(node?.type === "step" && node.mode).toBe("guided");
    expect(validateGraph(graph)).toBeTruthy();
    expect(() =>
      addStep(playbook(), { container: { kind: "main" }, channel: "voice", brief }),
    ).toThrow(GraphMutationError);
  });

  it("fresh ids never collide after deletes", () => {
    let g = addStep(playbook(), { container: { kind: "main" }, channel: "email" }).graph;
    g = addStep(g, { container: { kind: "main" }, channel: "email" }).graph; // step-added-2
    g = removeStep(g, "step-added-1");
    expect(freshNodeId(g, "step-added")).toBe("step-added-1"); // freed, reusable
    const { graph, stepId } = addStep(g, { container: { kind: "main" }, channel: "email" });
    expect(stepId).toBe("step-added-1");
    expect(validateGraph(graph)).toBeTruthy();
  });
});

describe("mutate · removeStep", () => {
  it("splices a mid-sequence step with its gap delay", () => {
    const graph = removeStep(playbook(), "step-2");
    expect(validateGraph(graph)).toBeTruthy();
    expect(mainSequence(graph).map((n) => n.id)).toEqual(["step-1", "delay-2", "step-3"]);
  });

  it("removing the entry step moves the entry", () => {
    const graph = removeStep(playbook(), "step-1");
    expect(graph.entry).toBe("step-2");
    expect(validateGraph(graph)).toBeTruthy();
    // the head step's gap delay FOLLOWS it — absorbed with the step so the
    // sequence never starts with a leading wait.
    expect(mainSequence(graph).map((n) => n.id)).toEqual(["step-2", "delay-2", "step-3"]);
  });

  it("keeps the graph's last delay even when its step goes", () => {
    // Build a graph whose only delay gaps the removed step.
    let g = playbook();
    g = removeStep(g, "step-2"); // drops delay-1
    g = { ...g }; // main: step-1, delay-2, step-3
    const graph = removeStep(g, "step-3"); // delay-2 is the LAST delay → kept
    expect(graph.nodes.some((n) => n.type === "delay")).toBe(true);
    expect(validateGraph(graph)).toBeTruthy();
  });

  it("retargets branch cases that pointed at the removed step (chain splice)", () => {
    const graph = removeStep(rich(), "c1-s1");
    expect(validateGraph(graph)).toBeTruthy();
    const branch = graph.nodes.find((n) => n.id === "b1");
    // interested now routes to the chain's next surviving node.
    expect(branch?.type === "branch" && branch.cases[0]?.goto).toBe("c1-s2");
  });

  it("refuses to remove a strategy chain's only step (playbook contract)", () => {
    expect(() => removeStep(playbook(), "step-reframe")).toThrow(/at least one step/);
  });

  it("refuses to remove the last main-sequence step", () => {
    let g = removeStep(playbook(), "step-1");
    g = removeStep(g, "step-2");
    expect(() => removeStep(g, "step-3")).toThrow(/at least one step/);
  });
});

describe("mutate · moveStep", () => {
  it("swaps a step with its neighbour; delays keep their slots; entry follows the head", () => {
    const graph = moveStep(playbook(), "step-2", "up");
    expect(validateGraph(graph)).toBeTruthy();
    expect(graph.entry).toBe("step-2");
    expect(mainSequence(graph).map((n) => n.id)).toEqual([
      "step-2", "delay-1", "step-1", "delay-2", "step-3",
    ]);
    // ids stable — the send-idempotency / stats / rules contract.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(playbook().nodes.map((n) => n.id).sort());
  });

  it("moves within a branch chain without touching the main sequence", () => {
    const graph = moveStep(rich(), "c1-s2", "up");
    expect(validateGraph(graph)).toBeTruthy();
    expect(chainForCase(graph, "b1", "interested")?.map((n) => n.id)).toEqual(["c1-s2", "c1-d1", "c1-s1"]);
    expect(mainSequence(graph).map((n) => n.id)).toEqual(["s1", "d1"]);
  });

  it("throws at the container edges", () => {
    expect(() => moveStep(playbook(), "step-1", "up")).toThrow(/first step/);
    expect(() => moveStep(playbook(), "step-3", "down")).toThrow(/last step/);
  });
});

describe("mutate · content / brief / mode / delay", () => {
  it("updateStepContent edits scripted copy; guided steps refuse (brief owns them)", () => {
    const graph = updateStepContent(playbook(), "step-2", { subject: "New subject", body: "New body" });
    const node = graph.nodes.find((n) => n.id === "step-2");
    expect(node?.type === "step" && node.content.subject).toBe("New subject");
    const guided = setStepMode(playbook(), "step-2", { mode: "guided", brief });
    expect(() => updateStepContent(guided, "step-2", { body: "x" })).toThrow(/guided/);
  });

  it("setStepMode → guided strips copy, keeps threaded, carries the brief", () => {
    const base = updateStepContent(playbook(), "step-reframe", { body: "keep threaded" });
    const graph = setStepMode(base, "step-reframe", { mode: "guided", brief });
    const node = graph.nodes.find((n) => n.id === "step-reframe");
    expect(node?.type === "step" && node.mode).toBe("guided");
    expect(node?.type === "step" && node.content.body).toBeUndefined();
    expect(node?.type === "step" && node.content.threaded).toBe(true);
    expect(validateGraph(graph)).toBeTruthy();
  });

  it("setStepMode → scripted requires body copy and returns to the legacy shape", () => {
    const guided = setStepMode(playbook(), "step-2", { mode: "guided", brief });
    expect(() => setStepMode(guided, "step-2", { mode: "scripted", content: { body: " " } })).toThrow(
      /needs body copy/,
    );
    const back = setStepMode(guided, "step-2", {
      mode: "scripted",
      content: { subject: "Back", body: "Scripted again" },
    });
    const node = back.nodes.find((n) => n.id === "step-2");
    expect(node?.type === "step" && "mode" in node).toBe(false);
    expect(node?.type === "step" && "brief" in node).toBe(false);
    expect(validateGraph(back)).toBeTruthy();
  });

  it("guided flips are email/sms-only and subjectHint stays email-only", () => {
    const withVoice: CampaignGraph = {
      ...playbook(),
      nodes: playbook().nodes.map((n) =>
        n.id === "step-2" && n.type === "step" ? { ...n, channel: "voice" as const } : n,
      ),
    };
    expect(() => setStepMode(withVoice, "step-2", { mode: "guided", brief })).toThrow(/email\/sms-only/);
    const smsGraph: CampaignGraph = {
      ...playbook(),
      nodes: playbook().nodes.map((n) =>
        n.id === "step-2" && n.type === "step" ? { ...n, channel: "sms" as const } : n,
      ),
    };
    expect(() =>
      setStepMode(smsGraph, "step-2", { mode: "guided", brief: { ...brief, subjectHint: "no" } }),
    ).toThrow(/email-only/);
  });

  it("updateStepBrief edits a guided step's brief; updateDelay validates the amount", () => {
    const guided = setStepMode(playbook(), "step-2", { mode: "guided", brief });
    const edited = updateStepBrief(guided, "step-2", { ...brief, objective: "New objective" });
    const node = edited.nodes.find((n) => n.id === "step-2");
    expect(node?.type === "step" && node.brief?.objective).toBe("New objective");
    expect(() => updateStepBrief(playbook(), "step-2", brief)).toThrow(/scripted/);
    expect(updateDelay(playbook(), "delay-1", 5).nodes.find((n) => n.id === "delay-1")).toMatchObject({
      amount: 5,
    });
    expect(() => updateDelay(playbook(), "delay-1", 0)).toThrow(/at least 1/);
  });
});

describe("mutate · containers + repair", () => {
  it("stepContainerOf locates main vs case containers", () => {
    expect(stepContainerOf(playbook(), "step-2")).toEqual({ kind: "main" });
    expect(stepContainerOf(playbook(), "step-reframe")).toEqual({
      kind: "case",
      branchId: "branch-reply",
      caseKey: "objection_price",
    });
    expect(stepContainerOf(playbook(), "ghost")).toBeUndefined();
  });

  it("containerNodes throws on unknown cases", () => {
    expect(() => containerNodes(playbook(), { kind: "case", branchId: "branch-reply", caseKey: "nope" })).toThrow(
      GraphMutationError,
    );
  });

  it("repairGraph fixes only the unambiguous and reports every repair", () => {
    const messy: CampaignGraph = {
      ...playbook(),
      edges: [
        ...playbook().edges,
        { from: "step-1", to: "delay-1" }, // duplicate
        { from: "step-2", to: "step-3" }, // extra out-edge from a sequential node
        { from: "ghost", to: "step-1" }, // dangling
      ],
    };
    const { graph, repairs } = repairGraph(messy);
    expect(repairs).toHaveLength(3);
    expect(validateGraph(graph)).toBeTruthy();
  });

  it("repairGraph trims empty brief chip entries; a clean graph is returned as-is", () => {
    const guided = setStepMode(playbook(), "step-2", {
      mode: "guided",
      brief: { ...brief, talkingPoints: [...brief.talkingPoints], mustSay: ["keep"], neverSay: [] as string[] },
    });
    const dirty: CampaignGraph = {
      ...guided,
      nodes: guided.nodes.map((n) =>
        n.id === "step-2" && n.type === "step" && n.brief
          ? { ...n, brief: { ...n.brief, talkingPoints: [...n.brief.talkingPoints, "  "], neverSay: [" "] } }
          : n,
      ),
    };
    const { graph, repairs } = repairGraph(dirty);
    expect(repairs.length).toBeGreaterThan(0);
    const node = graph.nodes.find((n) => n.id === "step-2");
    expect(node?.type === "step" && node.brief?.talkingPoints).toEqual(brief.talkingPoints);
    expect(node?.type === "step" && node.brief?.neverSay).toBeUndefined();
    expect(validateGraph(graph)).toBeTruthy();

    const clean = playbook();
    expect(repairGraph(clean).graph).toBe(clean);
    expect(repairGraph(clean).repairs).toEqual([]);
  });

  it("every mutation leaves untouched nodes byte-identical", () => {
    const before = playbook();
    const after = moveStep(addStep(before, { container: { kind: "main" }, channel: "email" }).graph, "step-2", "up");
    for (const id of ["step-reframe", "step-ack", "branch-reply", "end-won"]) {
      expect(after.nodes.find((n) => n.id === id)).toEqual(before.nodes.find((n) => n.id === id));
    }
    expect(validateGraph(after)).toBeTruthy();
  });
});
