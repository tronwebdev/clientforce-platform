/**
 * validateAll unit tests — the P1.4 slice requirements on top of the T4
 * validator: email-only, ≥1 delay, branch on reply, merge tokens present.
 * Pure, no infra.
 */
import { describe, expect, it } from "vitest";
import { GraphValidationError, type CampaignGraph } from "@clientforce/core";
import { validateAll } from "../src/plan";

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
        { when: { intent: "interested" }, goto: "end-won" },
        { when: "default", goto: "end-lost" },
      ],
    },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "step-2" },
    { from: "step-2", to: "branch-reply" },
  ],
});

describe("validateAll (P1.4 slice requirements)", () => {
  it("accepts a well-formed email sequence", () => {
    expect(() => validateAll(goodGraph())).not.toThrow();
  });

  it("rejects non-email channels (Phase 1 is email-only)", () => {
    const g = goodGraph();
    (g.nodes[0] as { channel: string }).channel = "sms";
    expect(() => validateAll(g)).toThrow(/email-only/);
  });

  it("rejects a graph without a delay", () => {
    const g = goodGraph();
    g.nodes = g.nodes.filter((n) => n.type !== "delay");
    g.edges = [
      { from: "step-1", to: "step-2" },
      { from: "step-2", to: "branch-reply" },
    ];
    expect(() => validateAll(g)).toThrow(/delay/);
  });

  it('rejects a graph without a branch on "reply"', () => {
    const g = goodGraph();
    (g.nodes.find((n) => n.type === "branch") as { on: string }).on = "open";
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
    (g.nodes.find((n) => n.type === "branch") as { cases: { goto: string }[] }).cases[0]!.goto =
      "nowhere";
    expect(() => validateAll(g)).toThrow(GraphValidationError);
  });
});
