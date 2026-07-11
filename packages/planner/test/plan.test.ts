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

describe("validateAll guided steps (G1, DEC-068)", () => {
  const guided = (): CampaignGraph => {
    const g = goodGraph();
    g.nodes = g.nodes.map((n) =>
      n.id === "step-2" && n.type === "step"
        ? {
            id: "step-2",
            type: "step" as const,
            channel: "sms" as const,
            mode: "guided" as const,
            content: {},
            brief: {
              objective: "Earn a reply about the audit",
              talkingPoints: ["free growth audit", "results in 7 days", "no commitment"],
            },
          }
        : n,
    );
    return g;
  };

  it("accepts a guided sms step for a guided agent (allowGuided=true)", () => {
    expect(() => validateAll(guided(), ["email", "sms"], [], true)).not.toThrow();
  });

  it("REJECTS guided steps for a scripted agent — regression protection", () => {
    expect(() => validateAll(guided(), ["email", "sms"], [], false)).toThrow(
      /composes scripted/,
    );
  });

  it("the merge-token rule applies to SCRIPTED copy only — an all-guided graph passes without tokens", () => {
    const g = guided();
    // Strip the scripted email step so ONLY the guided sms step sends.
    g.entry = "step-2";
    g.nodes = g.nodes.filter((n) => n.id !== "step-1" && n.id !== "delay-1");
    g.nodes.push({ id: "delay-2", type: "delay", amount: 1, unit: "days" });
    g.edges = [
      { from: "step-2", to: "delay-2" },
      { from: "delay-2", to: "branch-reply" },
    ];
    expect(() => validateAll(g, ["email", "sms"], [], true)).not.toThrow();
    // …while a scripted step missing tokens still fails exactly as before.
    const scripted = goodGraph();
    (scripted.nodes[0] as { content: { subject: string; body: string } }).content = {
      subject: "no tokens",
      body: "no tokens here",
    };
    (scripted.nodes[2] as { content: { subject: string; body: string } }).content = {
      subject: "none",
      body: "none",
    };
    expect(() => validateAll(scripted, ["email"], [], false)).toThrow(/merge token/);
  });

  it("the neverSay scan covers BRIEF text (objective + talking points + mustSay)", () => {
    const g = guided();
    const step = g.nodes.find((n) => n.id === "step-2");
    if (step?.type === "step" && step.brief) {
      step.brief.talkingPoints = ["free growth audit", "rock-bottom prices pitch", "no commitment"];
    }
    expect(() => validateAll(g, ["email", "sms"], ["rock-bottom prices"], true)).toThrow(
      /"rock-bottom prices" in step-2/,
    );
  });
});
