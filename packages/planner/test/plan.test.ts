/**
 * validateAll unit tests — the P1.4 slice requirements on top of the T4
 * validator: email-only, ≥1 delay, branch on reply, merge tokens present.
 * M1b (DEC-068): the six-intent REPLY PLAYBOOK — the generated reply branch
 * must case all six strategy intents (+ default), intents come from the
 * shared enum only, the interested/not_interested stage pins are enforced,
 * and strategy cases route to real strategy steps. Pure, no infra.
 */
import { describe, expect, it } from "vitest";
import { GraphValidationError, type BranchNode, type CampaignGraph } from "@clientforce/core";
import { REQUIRED_BRANCH_INTENTS, validateAll } from "../src/plan";

/** A v4-shaped graph: main sequence + six-case reply branch + strategy steps. */
const goodGraph = (): CampaignGraph => ({
  entry: "step-1",
  nodes: [
    {
      id: "step-1",
      type: "step",
      channel: "email",
      content: {
        subject: "Free audit for {{company}}",
        body: "Hi {{firstName}}, we offer a free growth audit at 99 dollars per booked appointment.",
      },
    },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    {
      id: "step-2",
      type: "step",
      channel: "email",
      content: { subject: "Quick follow-up", body: "Hi {{firstName}} — still interested?" },
    },
    {
      id: "branch-reply",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
        { when: { intent: "objection_price" }, goto: "step-reframe-price", pipeline: "replied" },
        { when: { intent: "objection_timing" }, goto: "step-ack-timing", pipeline: "replied" },
        { when: { intent: "wrong_person" }, goto: "step-referral", pipeline: "replied" },
        { when: { intent: "info_request" }, goto: "step-answer", pipeline: "replied" },
        { when: { intent: "not_interested" }, goto: "step-close", pipeline: "lost" },
        { when: "default", goto: "end-lost" },
      ],
    },
    // Reply-strategy steps (M1b): price/info rejoin the branch; timing waits
    // long then rejoins; wrong_person and not_interested close out.
    { id: "step-reframe-price", type: "step", channel: "email", content: { body: "The audit pays for itself — one number says it.", threaded: true } },
    { id: "step-ack-timing", type: "step", channel: "email", content: { body: "Understood — circling back later.", threaded: true } },
    { id: "delay-timing", type: "delay", amount: 30, unit: "days" },
    { id: "step-timing-follow", type: "step", channel: "email", content: { body: "Circling back as promised.", threaded: true } },
    { id: "step-referral", type: "step", channel: "email", content: { body: "Who is the right person?", threaded: true } },
    { id: "step-answer", type: "step", channel: "email", content: { body: "Here is the answer.", threaded: true } },
    { id: "step-close", type: "step", channel: "email", content: { body: "No worries — door stays open.", threaded: true } },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "step-2" },
    { from: "step-2", to: "branch-reply" },
    { from: "step-reframe-price", to: "branch-reply" },
    { from: "step-ack-timing", to: "delay-timing" },
    { from: "delay-timing", to: "step-timing-follow" },
    { from: "step-timing-follow", to: "branch-reply" },
    { from: "step-referral", to: "end-lost" },
    { from: "step-answer", to: "branch-reply" },
    { from: "step-close", to: "end-lost" },
  ],
});

const replyBranchOf = (g: CampaignGraph): BranchNode =>
  g.nodes.find((n): n is BranchNode => n.type === "branch")!;

describe("validateAll (P1.4 slice requirements)", () => {
  it("accepts a well-formed v4 sequence (six-case playbook + rejoin edges)", () => {
    expect(() => validateAll(goodGraph())).not.toThrow();
  });

  it("rejects non-email channels (Phase 1 is email-only)", () => {
    const g = goodGraph();
    (g.nodes[0] as { channel: string }).channel = "sms";
    expect(() => validateAll(g)).toThrow(/email-only/);
  });

  it("rejects a graph without a delay", () => {
    const g = goodGraph();
    // Splice every delay node out of its path.
    const next = new Map(g.edges.map((e) => [e.from, e.to]));
    const delays = new Set(g.nodes.filter((n) => n.type === "delay").map((n) => n.id));
    g.nodes = g.nodes.filter((n) => !delays.has(n.id));
    g.edges = g.edges
      .filter((e) => !delays.has(e.from))
      .map((e) => (delays.has(e.to) ? { ...e, to: next.get(e.to)! } : e));
    expect(() => validateAll(g)).toThrow(/delay/);
  });

  it('rejects a graph without a branch on "reply"', () => {
    const g = goodGraph();
    replyBranchOf(g).on = "open" as BranchNode["on"];
    expect(() => validateAll(g)).toThrow(/on="reply"/);
  });

  it("rejects copy missing the merge tokens", () => {
    const g = goodGraph();
    for (const n of g.nodes) {
      if (n.type === "step") n.content.body = n.content.body?.replaceAll("{{firstName}}", "friend");
    }
    expect(() => validateAll(g)).toThrow(/\{\{firstName\}\}/);
  });

  it("still runs the T4 semantic pass (dangling branch goto)", () => {
    const g = goodGraph();
    replyBranchOf(g).cases[0]!.goto = "nowhere";
    expect(() => validateAll(g)).toThrow(GraphValidationError);
  });
});

describe("validateAll REPLY PLAYBOOK gate (M1b, DEC-068)", () => {
  it("pins the six strategy intents with their stage effects (the acceptance contract)", () => {
    expect(REQUIRED_BRANCH_INTENTS).toEqual([
      { intent: "interested", pipeline: "booked" },
      { intent: "objection_price", pipeline: "replied" },
      { intent: "objection_timing", pipeline: "replied" },
      { intent: "wrong_person", pipeline: "replied" },
      { intent: "info_request", pipeline: "replied" },
      { intent: "not_interested", pipeline: "lost" },
    ]);
  });

  it("names the missing intent when a playbook case is absent", () => {
    const g = goodGraph();
    const b = replyBranchOf(g);
    b.cases = b.cases.filter((c) => c.when === "default" || c.when.intent !== "not_interested");
    expect(() => validateAll(g)).toThrow(/missing a case for intent "not_interested"/);
  });

  it("rejects a case intent outside the shared enum (bounded taxonomy), naming it", () => {
    const g = goodGraph();
    const b = replyBranchOf(g);
    b.cases = [...b.cases, { when: { intent: "angry" }, goto: "end-lost" }];
    expect(() => validateAll(g)).toThrow(/"angry" is not a known intent/);
  });

  it("legacy enum values are legal case KEYS (additive rule) — the playbook cases must still all exist", () => {
    const g = goodGraph();
    const b = replyBranchOf(g);
    // "question" is legacy-but-known: allowed as an extra case, not a substitute.
    b.cases = [...b.cases, { when: { intent: "question" }, goto: "step-answer" }];
    expect(() => validateAll(g)).not.toThrow();
  });

  it("enforces the interested → booked stage pin", () => {
    const g = goodGraph();
    const c = replyBranchOf(g).cases.find((x) => x.when !== "default" && x.when.intent === "interested")!;
    delete c.pipeline;
    expect(() => validateAll(g)).toThrow(/"interested" must set "pipeline":"booked"/);
  });

  it("enforces the not_interested → lost stage pin (found value named)", () => {
    const g = goodGraph();
    const c = replyBranchOf(g).cases.find(
      (x) => x.when !== "default" && x.when.intent === "not_interested",
    )!;
    c.pipeline = "booked";
    expect(() => validateAll(g)).toThrow(/"not_interested" must set "pipeline":"lost" \(found "booked"\)/);
  });

  it("requires a default case", () => {
    const g = goodGraph();
    const b = replyBranchOf(g);
    b.cases = b.cases.filter((c) => c.when !== "default");
    expect(() => validateAll(g)).toThrow(/must carry a "default" case/);
  });

  it("a strategy case must route to a strategy STEP (never straight to an end)", () => {
    const g = goodGraph();
    const c = replyBranchOf(g).cases.find(
      (x) => x.when !== "default" && x.when.intent === "objection_price",
    )!;
    c.goto = "end-lost";
    expect(() => validateAll(g)).toThrow(/"objection_price" must route to its strategy "step"/);
  });

  it("rejects a second reply branch (exactly one)", () => {
    const g = goodGraph();
    g.nodes = [
      ...g.nodes,
      {
        id: "branch-2",
        type: "branch",
        on: "reply",
        cases: [{ when: "default", goto: "end-lost" }],
      },
    ];
    expect(() => validateAll(g)).toThrow(/exactly ONE branch node with on="reply", found 2/);
  });
});

describe("validateAll neverSay gate (M1a, DEC-065 — the deterministic rail)", () => {
  it("passes a clean graph against a ban list", () => {
    expect(() => validateAll(goodGraph(), ["email"], ["cheap", "guarantee"])).not.toThrow();
  });

  it("catches a banned phrase in a BODY, naming term and step", () => {
    expect(() => validateAll(goodGraph(), ["email"], ["free growth audit"])).toThrow(
      /"free growth audit" in step-1/,
    );
  });

  it("catches a banned phrase in a SUBJECT", () => {
    expect(() => validateAll(goodGraph(), ["email"], ["Quick follow-up"])).toThrow(
      /"Quick follow-up" in step-2/,
    );
  });

  it("scans reply-STRATEGY steps too (M1b — the rail covers the whole graph)", () => {
    expect(() => validateAll(goodGraph(), ["email"], ["pays for itself"])).toThrow(
      /"pays for itself" in step-reframe-price/,
    );
  });

  it("matches case-insensitively in both directions", () => {
    expect(() => validateAll(goodGraph(), ["email"], ["FREE GROWTH AUDIT"])).toThrow(
      GraphValidationError,
    );
    const g = goodGraph();
    (g.nodes[0] as { content: { body: string } }).content.body += " Absolutely GUARANTEED.";
    expect(() => validateAll(g, ["email"], ["guaranteed"])).toThrow(/"guaranteed" in step-1/);
  });

  it("names every hit across steps in one error (repair sees the full list)", () => {
    expect(() => validateAll(goodGraph(), ["email"], ["audit", "interested"])).toThrow(
      /"audit" in step-1.*"interested" in step-2/s,
    );
  });

  it("empty/whitespace ban entries never match (no accidental ban-everything)", () => {
    expect(() => validateAll(goodGraph(), ["email"], ["", "   "])).not.toThrow();
  });

  it("REGRESSION: omitting the parameter is byte-identical to today's gate", () => {
    expect(() => validateAll(goodGraph())).not.toThrow();
    expect(() => validateAll(goodGraph(), ["email"])).not.toThrow();
  });
});
