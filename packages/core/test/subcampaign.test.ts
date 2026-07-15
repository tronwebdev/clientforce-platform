/**
 * #90 (DEC-077): sub-campaign creation at the mutation layer — a
 * SubcampaignNode-headed chain, disjoint from the main path, terminated by
 * its own end node, growable through the SAME container plumbing as every
 * other chain. Untouched nodes stay byte-identical (the standing W3-4 pin),
 * and the shared-chain refusal now spans container KINDS (case↔case across
 * branches, case↔sub-campaign, sub-campaign↔sub-campaign).
 */
import { describe, expect, it } from "vitest";
import {
  addStep,
  addSubcampaign,
  chainForCase,
  containerNodes,
  graftSubcampaigns,
  GraphMutationError,
  moveStep,
  removeStep,
  sharedContainerNodeIds,
  stepContainerOf,
  subcampaignChainOf,
  subcampaignChains,
  validateGraph,
  type CampaignGraph,
  type StepBrief,
} from "../src/index";

/** Compact playbook-ish stored graph (mirrors the planner-test fixture). */
const stored = (): CampaignGraph => ({
  entry: "step-1",
  nodes: [
    { id: "step-1", type: "step", channel: "email", content: { subject: "Hello {{company}}", body: "Hi {{firstName}}, intro." } },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    { id: "step-2", type: "step", channel: "email", content: { subject: "Following up", body: "Value." } },
    {
      id: "branch-reply",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
        { when: { intent: "objection_price" }, goto: "step-reframe", pipeline: "replied" },
        { when: "default", goto: "end-lost" },
      ],
    },
    { id: "step-reframe", type: "step", channel: "email", content: { body: "Value first.", threaded: true } },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "step-2" },
    { from: "step-2", to: "branch-reply" },
    { from: "step-reframe", to: "end-lost" },
  ],
});

const brief: StepBrief = { objective: "Book it", talkingPoints: ["a", "b", "c"] };

describe("addSubcampaign — the branch-creation mutation", () => {
  it("creates a named container + own end node under the stable node-id policy, seeded chain in flow order", () => {
    const prev = stored();
    const { graph, subcampaignId, stepIds } = addSubcampaign(prev, {
      name: "Interested follow-up",
      seed: [
        { channel: "email", content: { subject: "Booking?", body: "Hi {{firstName}}, grab a slot." } },
        { channel: "email", content: { body: "Still open.", threaded: true }, delayDays: 3 },
      ],
    });
    expect(subcampaignId).toBe("subcampaign-added-1");
    expect(stepIds).toEqual(["step-added-1", "step-added-2"]);

    const head = graph.nodes.find((n) => n.id === subcampaignId);
    expect(head).toMatchObject({ type: "subcampaign", ref: "Interested follow-up" });
    // Chain: step → (gap delay) → step, exiting into the container's OWN end.
    const chain = subcampaignChainOf(graph, subcampaignId)!;
    expect(chain.map((n) => n.id)).toEqual(["step-added-1", "delay-added-1", "step-added-2"]);
    const tailExit = graph.edges.find((e) => e.from === "step-added-2")?.to;
    expect(graph.nodes.find((n) => n.id === tailExit)).toMatchObject({ id: "end-added-1", type: "end" });
    // The whole thing still validates, and the container is OFF the main path.
    expect(() => validateGraph(graph)).not.toThrow();
    expect(graph.entry).toBe(prev.entry);
  });

  it("keeps every untouched node byte-identical (the W3-4 pin, extended)", () => {
    const prev = stored();
    const { graph } = addSubcampaign(prev, { name: "Re-engage", seed: [{ channel: "email" }] });
    // Original nodes/edges survive BYTE-identical, in the same order (the
    // standing serialization pin — branch objects may be rebuilt reference-
    // wise by the container plumbing, but never differ by a byte).
    expect(JSON.stringify(graph.nodes.slice(0, prev.nodes.length))).toBe(
      JSON.stringify(stored().nodes),
    );
    expect(JSON.stringify(graph.edges.slice(0, prev.edges.length))).toBe(
      JSON.stringify(stored().edges),
    );
    expect(graph.entry).toBe(stored().entry);
  });

  it("builds an EMPTY container from scratch (no seed) — sub node wired straight to its end", () => {
    const { graph, subcampaignId } = addSubcampaign(stored(), { name: "Build from scratch" });
    expect(subcampaignChainOf(graph, subcampaignId)).toEqual([]);
    expect(graph.edges.find((e) => e.from === subcampaignId)?.to).toBe("end-added-1");
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it("seeds guided steps (brief, never copy) and validates", () => {
    const { graph, stepIds } = addSubcampaign(stored(), {
      name: "Guided branch",
      seed: [{ channel: "email", brief }],
    });
    const step = graph.nodes.find((n) => n.id === stepIds[0]);
    expect(step).toMatchObject({ type: "step", mode: "guided", brief });
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it("refuses a blank name and a guided seed on a non-composable channel", () => {
    expect(() => addSubcampaign(stored(), { name: "   " })).toThrow(GraphMutationError);
    expect(() =>
      addSubcampaign(stored(), { name: "Voice", seed: [{ channel: "voice" as never, brief }] }),
    ).toThrow(/email\/sms-only/);
  });

  it("fresh container ids never collide across repeated creations", () => {
    const one = addSubcampaign(stored(), { name: "One" });
    const two = addSubcampaign(one.graph, { name: "Two", seed: [{ channel: "email" }] });
    expect(two.subcampaignId).toBe("subcampaign-added-2");
    const ends = two.graph.nodes.filter((n) => n.id.startsWith("end-added"));
    expect(ends.map((n) => n.id).sort()).toEqual(["end-added-1", "end-added-2"]);
    expect(() => validateGraph(two.graph)).not.toThrow();
  });
});

describe("sub-campaign chains — ordinary container plumbing", () => {
  const withSub = () => {
    const r = addSubcampaign(stored(), {
      name: "Interested follow-up",
      seed: [
        { channel: "email", content: { subject: "Booking?", body: "Grab a slot." } },
        { channel: "email", content: { body: "Still open.", threaded: true } },
      ],
    });
    return { graph: r.graph, id: r.subcampaignId };
  };

  it("containerNodes / stepContainerOf resolve the subcampaign container", () => {
    const { graph, id } = withSub();
    const container = { kind: "subcampaign", subcampaignId: id } as const;
    expect(containerNodes(graph, container).map((n) => n.id)).toEqual([
      "step-added-1",
      "delay-added-1",
      "step-added-2",
    ]);
    expect(stepContainerOf(graph, "step-added-2")).toEqual(container);
    expect(() => containerNodes(graph, { kind: "subcampaign", subcampaignId: "nope" })).toThrow(
      /Unknown sub-campaign/,
    );
  });

  it("addStep appends inside the container; moveStep reorders; the head edge follows", () => {
    const { graph, id } = withSub();
    const container = { kind: "subcampaign", subcampaignId: id } as const;
    const added = addStep(graph, { container, channel: "email", content: { body: "Third note." } });
    expect(subcampaignChainOf(added.graph, id)!.filter((n) => n.type === "step")).toHaveLength(3);
    expect(() => validateGraph(added.graph)).not.toThrow();

    const moved = moveStep(added.graph, added.stepId, "up");
    expect(() => validateGraph(moved)).not.toThrow();
    const headTarget = moved.edges.find((e) => e.from === id)?.to;
    expect(headTarget).toBe("step-added-1"); // head unchanged by a mid-chain swap
  });

  it("removeStep splices the chain — and emptying the container is legal (the scaffold state)", () => {
    const { graph, id } = withSub();
    const one = removeStep(graph, "step-added-2");
    expect(subcampaignChainOf(one, id)!.map((n) => n.id)).toEqual(["step-added-1"]);
    const none = removeStep(one, "step-added-1");
    expect(subcampaignChainOf(none, id)).toEqual([]);
    // The container node exits straight into its end again.
    const exit = none.edges.find((e) => e.from === id)?.to;
    expect(none.nodes.find((n) => n.id === exit)?.type).toBe("end");
    expect(() => validateGraph(none)).not.toThrow();
  });
});

describe("shared-chain refusal — across container kinds", () => {
  /** A case chain and a sub-campaign chain converging on ONE shared step. */
  const crossShared = (): CampaignGraph => {
    const base = stored();
    return {
      ...base,
      nodes: [
        ...base.nodes,
        { id: "sub-1", type: "subcampaign", ref: "Shared tail" },
        { id: "sub-s1", type: "step", channel: "email", content: { body: "Sub step." } },
        { id: "end-sub", type: "end" },
      ],
      edges: [
        ...base.edges.filter((e) => e.from !== "step-reframe"),
        // the CASE chain's step now flows into the sub-campaign's step…
        { from: "step-reframe", to: "sub-s1" },
        // …which is ALSO the sub-campaign's chain.
        { from: "sub-1", to: "sub-s1" },
        { from: "sub-s1", to: "end-sub" },
      ],
    };
  };

  it("computes cross-container sharing", () => {
    const graph = crossShared();
    expect(sharedContainerNodeIds(graph)).toEqual(new Set(["sub-s1"]));
    expect(subcampaignChains(graph)).toHaveLength(1);
  });

  it("refuses mutating the shared chain from EITHER container, loudly", () => {
    const graph = crossShared();
    expect(() =>
      addStep(graph, { container: { kind: "subcampaign", subcampaignId: "sub-1" }, channel: "email" }),
    ).toThrow(/shares steps with another path/);
    expect(() =>
      addStep(graph, {
        container: { kind: "case", branchId: "branch-reply", caseKey: "objection_price" },
        channel: "email",
      }),
    ).toThrow(/shares steps with another reply path/);
    expect(() => removeStep(graph, "sub-s1")).toThrow(/shares steps/);
  });

  it("leaves non-shared containers editable on the same graph", () => {
    const graph = crossShared();
    const { graph: next } = addSubcampaign(graph, { name: "Fresh", seed: [{ channel: "email" }] });
    expect(() => validateGraph(next)).not.toThrow();
  });
});

describe("review-round pins (#92)", () => {
  it("a present-but-blank seed content takes the sendable defaults; riders survive", () => {
    const { graph, stepIds } = addSubcampaign(stored(), {
      name: "Blanks",
      seed: [
        { channel: "email", content: {} },
        { channel: "email", content: { threaded: true } },
        { channel: "email", content: { subject: "Custom subject", body: "  " } },
      ],
    });
    const [s1, s2, s3] = stepIds.map((id) => graph.nodes.find((n) => n.id === id));
    expect(s1?.type === "step" && s1.content.body?.trim()).toBeTruthy();
    expect(s2?.type === "step" && s2.content.body?.trim()).toBeTruthy();
    expect(s2?.type === "step" && s2.content.threaded).toBe(true);
    expect(s3?.type === "step" && s3.content.body?.trim()).toBeTruthy();
    expect(s3?.type === "step" && s3.content.subject).toBe("Custom subject");
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it("a case chain STOPS at a sub-campaign head — case mutations never rewire the container", () => {
    const base = stored();
    const withSub = addSubcampaign(base, { name: "Target", seed: [] });
    // Point a reply case's goto at the container head (a malformed shape the
    // gate refuses to persist — the mutation layer must still not corrupt it).
    const graph: CampaignGraph = {
      ...withSub.graph,
      nodes: withSub.graph.nodes.map((n) =>
        n.type === "branch" && n.id === "branch-reply"
          ? {
              ...n,
              cases: n.cases.map((c) =>
                c.when !== "default" && c.when.intent === "objection_price"
                  ? { ...c, goto: withSub.subcampaignId }
                  : c,
              ),
            }
          : n,
      ),
    };
    // The case chain is EMPTY (stops at the head, exclusive)…
    expect(chainForCase(graph, "branch-reply", "objection_price")).toEqual([]);
    // …so adding a step to the case grows the CASE, and the container's own
    // out-edge (head → its end node) survives byte-identical.
    const before = graph.edges.find((e) => e.from === withSub.subcampaignId);
    const added = addStep(graph, {
      container: { kind: "case", branchId: "branch-reply", caseKey: "objection_price" },
      channel: "email",
      content: { body: "Case step.", threaded: true },
    });
    const after = added.graph.edges.find((e) => e.from === withSub.subcampaignId);
    expect(after).toEqual(before);
  });
});

describe("graftSubcampaigns — regenerate carries containers (#92 review round)", () => {
  const fresh = (): CampaignGraph => stored();

  it("carries every container (head + chain + own end) onto the fresh graph, ids verbatim", () => {
    const prev = addSubcampaign(stored(), {
      name: "Interested follow-up",
      seed: [{ channel: "email", content: { subject: "Booking?", body: "Grab a slot." } }],
    });
    const { graph, grafted, renamedFreshIds } = graftSubcampaigns(fresh(), prev.graph);
    expect(grafted).toEqual([prev.subcampaignId]);
    expect(renamedFreshIds).toEqual({});
    expect(graph.nodes.find((n) => n.id === prev.subcampaignId)).toMatchObject({
      type: "subcampaign",
      ref: "Interested follow-up",
    });
    expect(subcampaignChainOf(graph, prev.subcampaignId)!.map((n) => n.id)).toEqual(["step-added-1"]);
    expect(graph.nodes.some((n) => n.id === "end-added-1")).toBe(true);
    expect(() => validateGraph(graph)).not.toThrow();
    // The fresh main path is untouched.
    expect(graph.entry).toBe("step-1");
  });

  it("renames COLLIDING fresh ids (container ids are load-bearing rule targets)", () => {
    const prev = addSubcampaign(stored(), { name: "Keep my id", seed: [{ channel: "email" }] });
    // A fresh graph that (pathologically) reuses the container's step id.
    const freshWithCollision: CampaignGraph = {
      entry: "step-added-1",
      nodes: [
        { id: "step-added-1", type: "step", channel: "email", content: { subject: "Hi", body: "Fresh intro." } },
        { id: "delay-1", type: "delay", amount: 2, unit: "days" },
        {
          id: "branch-reply",
          type: "branch",
          on: "reply",
          cases: [
            { when: { intent: "interested" }, goto: "step-added-1", pipeline: "booked" },
            { when: "default", goto: "end-1" },
          ],
        },
        { id: "end-1", type: "end" },
      ],
      edges: [
        { from: "step-added-1", to: "delay-1" },
        { from: "delay-1", to: "branch-reply" },
      ],
    };
    const { graph, renamedFreshIds } = graftSubcampaigns(freshWithCollision, prev.graph);
    const renamed = renamedFreshIds["step-added-1"]!;
    expect(renamed).toBeTruthy();
    // Entry, edges and branch gotos all follow the rename…
    expect(graph.entry).toBe(renamed);
    expect(graph.edges.some((e) => e.from === renamed && e.to === "delay-1")).toBe(true);
    const branch = graph.nodes.find((n) => n.type === "branch" && n.id === "branch-reply");
    expect(branch?.type === "branch" && branch.cases[0]!.goto).toBe(renamed);
    // …while the CONTAINER keeps its load-bearing ids verbatim.
    expect(subcampaignChainOf(graph, prev.subcampaignId)!.map((n) => n.id)).toEqual(["step-added-1"]);
    expect(() => validateGraph(graph)).not.toThrow();
  });

  it("is a no-op passthrough when the stored graph has no containers", () => {
    const f = fresh();
    const { graph, grafted } = graftSubcampaigns(f, stored());
    expect(grafted).toEqual([]);
    expect(graph).toBe(f);
  });

  it("carries EMPTY containers and multiple containers", () => {
    let prevGraph = addSubcampaign(stored(), { name: "One", seed: [] }).graph;
    prevGraph = addSubcampaign(prevGraph, { name: "Two", seed: [{ channel: "email" }] }).graph;
    const { graph, grafted } = graftSubcampaigns(fresh(), prevGraph);
    expect(grafted).toEqual(["subcampaign-added-1", "subcampaign-added-2"]);
    expect(() => validateGraph(graph)).not.toThrow();
  });
});
