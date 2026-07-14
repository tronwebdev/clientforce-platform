/**
 * W3-4 (DEC-076): validateEditedGraph — the manual-edit policy gate. Policy is
 * RELATIVE to the stored version (guarantees never regress; legacy graphs stay
 * editable) and the generation-only copy rails (merge tokens, neverSay,
 * language) deliberately do NOT apply to the owner's typed words.
 */
import { describe, expect, it } from "vitest";
import { addStep, GraphValidationError, setStepMode, updateStepContent, type CampaignGraph, type StepBrief } from "@clientforce/core";
import { validateEditedGraph } from "../src/edit";

const playbook = (): CampaignGraph => ({
  entry: "step-1",
  nodes: [
    { id: "step-1", type: "step", channel: "email", content: { subject: "Hello {{company}}", body: "Hi {{firstName}}, intro." } },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    { id: "step-2", type: "step", channel: "email", content: { subject: "Following up", body: "Hi {{firstName}}, value." } },
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
    { from: "step-2", to: "branch-reply" },
    { from: "step-reframe", to: "end-lost" },
    { from: "step-ack", to: "end-lost" },
    { from: "step-referral", to: "end-lost" },
    { from: "step-answer", to: "end-lost" },
    { from: "step-close", to: "end-lost" },
  ],
});

/** Pre-playbook legacy shape: one branch, two cases, a non-canonical intent. */
const legacy = (): CampaignGraph => ({
  entry: "n1",
  nodes: [
    { id: "n1", type: "step", channel: "email", content: { subject: "Hi", body: "Legacy intro" } },
    { id: "d1", type: "delay", amount: 1, unit: "days" },
    {
      id: "b1",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "not_now" }, goto: "d1" }, // pre-M1b label, not in IntentSchema
        { when: "default", goto: "end1" },
      ],
    },
    { id: "end1", type: "end" },
  ],
  edges: [
    { from: "n1", to: "d1" },
    { from: "d1", to: "b1" },
  ],
});

const brief: StepBrief = { objective: "Book it", talkingPoints: ["a", "b", "c"] };
const emailOnly = { allowedChannels: ["email"] };
const withSms = { allowedChannels: ["email", "sms"] };

describe("validateEditedGraph — accepts honest edits", () => {
  it("accepts a copy edit, an added step, and a mode flip on a playbook graph", () => {
    const prev = playbook();
    expect(validateEditedGraph(prev, updateStepContent(prev, "step-2", { body: "New copy" }), emailOnly)).toBeTruthy();
    expect(validateEditedGraph(prev, addStep(prev, { container: { kind: "main" }, channel: "email" }).graph, emailOnly)).toBeTruthy();
    expect(validateEditedGraph(prev, setStepMode(prev, "step-2", { mode: "guided", brief }), emailOnly)).toBeTruthy();
  });

  it("accepts edits to a LEGACY graph — non-canonical intents it already carried stay legal", () => {
    const prev = legacy();
    const edited = updateStepContent(prev, "n1", { body: "Edited legacy copy" });
    expect(validateEditedGraph(prev, edited, emailOnly)).toBeTruthy();
  });

  it("does NOT re-apply the generation-only copy rails to owner-typed words", () => {
    const prev = playbook();
    // no merge tokens, would fail validateAll — legal as a manual edit (M1a stance).
    const edited = updateStepContent(prev, "step-1", { subject: "Plain", body: "No tokens at all." });
    expect(validateEditedGraph(prev, edited, emailOnly)).toBeTruthy();
  });

  it("accepts a within-branch chain extension (multi-step chains authorable)", () => {
    const prev = playbook();
    const { graph } = addStep(prev, {
      container: { kind: "case", branchId: "branch-reply", caseKey: "objection_price" },
      channel: "email",
      content: { body: "One more angle", threaded: true },
    });
    expect(validateEditedGraph(prev, graph, emailOnly)).toBeTruthy();
  });

  it("accepts an sms step when the workspace can send sms; channels the stored graph already used stay legal", () => {
    const prev = playbook();
    const withSmsStep = addStep(prev, { container: { kind: "main" }, channel: "sms" }).graph;
    expect(validateEditedGraph(prev, withSmsStep, withSms)).toBeTruthy();
    // sender later deactivated: editing the graph that already has sms still works.
    const laterEdit = updateStepContent(withSmsStep, "step-1", { body: "tweak" });
    expect(validateEditedGraph(withSmsStep, laterEdit, emailOnly)).toBeTruthy();
  });
});

describe("validateEditedGraph — rejects regressions loudly", () => {
  it("rejects structural breakage (layer 2 still runs)", () => {
    const prev = playbook();
    const broken = { ...prev, edges: prev.edges.filter((e) => e.from !== "step-1") };
    expect(() => validateEditedGraph(prev, broken, emailOnly)).toThrow(GraphValidationError);
  });

  it("rejects a NEW channel the workspace can't send on", () => {
    const prev = playbook();
    const withSmsStep = addStep(prev, { container: { kind: "main" }, channel: "sms" }).graph;
    expect(() => validateEditedGraph(prev, withSmsStep, emailOnly)).toThrow(/can't send on yet/);
  });

  it("rejects a scripted step with no body copy (unless the stored version already had it)", () => {
    const prev = playbook();
    const blanked = updateStepContent(prev, "step-2", { body: "  " });
    expect(() => validateEditedGraph(prev, blanked, emailOnly)).toThrow(/no body copy/);
    // legacy tolerance: the same empty body already stored ≠ a new regression.
    expect(validateEditedGraph(blanked, blanked, emailOnly)).toBeTruthy();
  });

  it("rejects losing the last delay", () => {
    const prev = playbook();
    const noDelay: CampaignGraph = {
      ...prev,
      nodes: prev.nodes.filter((n) => n.type !== "delay"),
      edges: prev.edges.flatMap((e) => {
        if (e.to === "delay-1") return [{ from: e.from, to: "step-2" }];
        if (e.from === "delay-1") return [];
        return [e];
      }),
    };
    expect(() => validateEditedGraph(prev, noDelay, emailOnly)).toThrow(/at least one delay/);
  });

  it("rejects adding or removing reply branches (branch structure is not the step editor's)", () => {
    const prev = playbook();
    const extra: CampaignGraph = {
      ...prev,
      nodes: [
        ...prev.nodes,
        { id: "b2", type: "branch", on: "reply", cases: [{ when: "default", goto: "end-lost" }] },
      ],
    };
    expect(() => validateEditedGraph(prev, extra, emailOnly)).toThrow(/reply branch/);
  });

  it("rejects dropping a playbook case, changing its stage pin, or unrouting its step", () => {
    const prev = playbook();
    const branch = prev.nodes.find((n) => n.id === "branch-reply");
    if (branch?.type !== "branch") throw new Error("fixture");

    const dropCase: CampaignGraph = {
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === "branch-reply" && n.type === "branch"
          ? { ...n, cases: n.cases.filter((c) => c.when === "default" || c.when.intent !== "info_request") }
          : n,
      ),
    };
    expect(() => validateEditedGraph(prev, dropCase, emailOnly)).toThrow(/lost its case/);

    const rePin: CampaignGraph = {
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === "branch-reply" && n.type === "branch"
          ? { ...n, cases: n.cases.map((c) => (c.when !== "default" && c.when.intent === "not_interested" ? { ...c, pipeline: "booked" } : c)) }
          : n,
      ),
    };
    expect(() => validateEditedGraph(prev, rePin, emailOnly)).toThrow(/must keep "pipeline"/);

    const unroute: CampaignGraph = {
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === "branch-reply" && n.type === "branch"
          ? { ...n, cases: n.cases.map((c) => (c.when !== "default" && c.when.intent === "objection_price" ? { ...c, goto: "end-lost" } : c)) }
          : n,
      ),
    };
    expect(() => validateEditedGraph(prev, unroute, emailOnly)).toThrow(/keep routing to a step/);
  });

  it("rejects a NEW case intent outside the bounded taxonomy", () => {
    const prev = legacy();
    const invented: CampaignGraph = {
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === "b1" && n.type === "branch"
          ? { ...n, cases: [...n.cases, { when: { intent: "vibes" }, goto: "n1" }] }
          : n,
      ),
    };
    expect(() => validateEditedGraph(prev, invented, emailOnly)).toThrow(/not a known intent/);
  });

  it("rejects losing the default case", () => {
    const prev = legacy();
    const noDefault: CampaignGraph = {
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === "b1" && n.type === "branch" ? { ...n, cases: n.cases.filter((c) => c.when !== "default") } : n,
      ),
    };
    expect(() => validateEditedGraph(prev, noDefault, emailOnly)).toThrow(/default/);
  });
});
