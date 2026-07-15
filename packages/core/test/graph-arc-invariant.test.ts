/**
 * DEC-086 — the arc invariant, graph half: guided relaxes WORDING ONLY.
 * A mode flip is a wording-carrier swap — step order, node ids, timing
 * (delays), branch cases, edges and entry are byte-identical around it —
 * and every derived brief carries its M1a arc role, at exactly the slot
 * (`arcRoleAt`) its scripted twin would occupy. The prompt half lives in
 * the planner suite; the compose-time slot equivalence in channels.
 */
import { describe, expect, it } from "vitest";
import {
  arcRoleAt,
  deriveBriefSeed,
  selectStrategy,
  setStepMode,
  STRATEGY_ARCS,
  type CampaignGraph,
  type GraphNode,
  type StepBrief,
} from "../src/index";

type StepNode = Extract<GraphNode, { type: "step" }>;

/** The v4/M1b playbook shape (the graph-edit suite's fixture, verbatim). */
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

const brief: StepBrief = {
  objective: "Prescribe the fix with one concrete proof point",
  talkingPoints: ["one", "two", "three"],
};

describe("arc invariant — mode flips are wording-only (DEC-086)", () => {
  it("scripted→guided: order, ids, timing, branch cases, edges and entry are byte-identical; only the flipped node's carrier changes", () => {
    const before = playbook();
    const after = setStepMode(playbook(), "step-2", { mode: "guided", brief });

    expect(after.entry).toEqual(before.entry);
    expect(after.edges).toEqual(before.edges);
    expect(after.nodes.map((n) => n.id)).toEqual(before.nodes.map((n) => n.id));
    expect(after.nodes.map((n) => n.type)).toEqual(before.nodes.map((n) => n.type));
    // timing: every delay node byte-identical
    expect(after.nodes.filter((n) => n.type === "delay")).toEqual(before.nodes.filter((n) => n.type === "delay"));
    // routing: the reply branch byte-identical
    expect(after.nodes.find((n) => n.id === "branch-reply")).toEqual(before.nodes.find((n) => n.id === "branch-reply"));
    // every node EXCEPT the flipped one byte-identical
    for (const n of before.nodes) {
      if (n.id === "step-2") continue;
      expect(after.nodes.find((x) => x.id === n.id)).toEqual(n);
    }
    const flipped = after.nodes.find((x) => x.id === "step-2") as StepNode;
    expect(flipped.mode).toBe("guided");
    expect(flipped.brief).toEqual(brief);
  });

  it("guided→scripted: the inverse flip restores the scripted carrier with the same structural byte-identity", () => {
    const guided = setStepMode(playbook(), "step-2", { mode: "guided", brief });
    const back = setStepMode(guided, "step-2", { mode: "scripted", content: { subject: "Following up", body: "Hi {{firstName}}, value for {{company}}." } });
    expect(back.entry).toEqual(guided.entry);
    expect(back.edges).toEqual(guided.edges);
    expect(back.nodes.map((n) => n.id)).toEqual(guided.nodes.map((n) => n.id));
    expect(back.nodes.filter((n) => n.type === "delay")).toEqual(guided.nodes.filter((n) => n.type === "delay"));
    const restored = back.nodes.find((x) => x.id === "step-2") as StepNode;
    expect(restored.mode).toBeUndefined();
    expect(restored.brief).toBeUndefined();
    expect(restored.content.body).toBe("Hi {{firstName}}, value for {{company}}.");
  });

  it("a derived brief carries its arc role — the seed objective IS the role line of the slot the scripted twin occupies", () => {
    const arc = selectStrategy("reactivate_leads", "Dental & Orthodontics").arc;
    const g = playbook();
    const steps = g.nodes.filter((n): n is StepNode => n.type === "step" && !n.content.threaded);
    steps.forEach((s, i) => {
      const role = arcRoleAt(arc.roles, i + 1, steps.length);
      const seed = deriveBriefSeed(s, role);
      // detokenize only rewrites merge tokens — the role lines carry none,
      // so the objective is the role line verbatim.
      expect(role).toBeDefined();
      expect(seed.objective).toBe(role);
    });
  });

  it("arcRoleAt walks every registered arc with the planner's fold rule — first=OPENER, last=BREAKUP (never dropped), middle folds", () => {
    for (const arc of Object.values(STRATEGY_ARCS)) {
      const roles = arc.roles;
      for (let count = 1; count <= 8; count++) {
        for (let index = 1; index <= count; index++) {
          const got = arcRoleAt(roles, index, count);
          const want =
            index <= 1 ? roles[0] : index >= count ? roles[roles.length - 1] : roles[Math.min(index - 1, roles.length - 2)];
          expect(got, `${arc.key} index=${index} count=${count}`).toBe(want);
        }
      }
      // the invariant the fold rule guarantees: a sequence of ANY length ends on BREAKUP
      for (let count = 2; count <= 8; count++) {
        expect(arcRoleAt(roles, count, count)).toBe(roles[roles.length - 1]);
      }
    }
  });
});
