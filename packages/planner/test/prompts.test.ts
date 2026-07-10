/**
 * The prompt-layer before/after across the append-only registry (P1.1):
 * v4 (M1b, DEC-066) carries the six-intent REPLY PLAYBOOK; v3 (M1a, DEC-065)
 * carries the selling craft + STRATEGY block but no playbook; v2 carries
 * neither. All stay registered. Pure, no infra.
 */
import { describe, expect, it } from "vitest";
import { renderPrompt } from "@clientforce/ai";
import { BANNED_OPENERS, OPENER_WORD_CAP, selectStrategy } from "@clientforce/core";
import {
  PLANNER_PROMPT_NAME,
  PLANNER_PROMPT_VERSION,
  PLANNER_SYSTEM,
  renderPlannerPrompt,
} from "../src/prompts";

const fixture = selectStrategy("book_appointments", "Dental & Orthodontics");

const baseVars = {
  goal: "book_appointments",
  context: "- offer: dental growth audits",
  guardrails: "(none set yet — assume conservative defaults)",
  stepCount: "3-4",
  tokens: "{{firstName}} and {{company}}",
  channels: '"email" ONLY.',
};

function renderCurrent(strategyNotes = "(none)", neverSay = "(none)") {
  return renderPlannerPrompt({
    ...baseVars,
    arcLabel: fixture.arc.label,
    arcDescription: fixture.arc.description,
    arcRoles: fixture.arc.roles.map((r, i) => `  ${i + 1}. ${r}`).join("\n"),
    toneHints: fixture.toneHints,
    strategyNotes,
    neverSay,
  });
}

describe("planner prompt v4 (reply playbook)", () => {
  it("is pinned at version 4", () => {
    expect(PLANNER_PROMPT_VERSION).toBe(4);
  });

  it("template carries the six-intent REPLY PLAYBOOK with stage pins and rejoin routes", () => {
    const p = renderCurrent();
    expect(p).toContain("REPLY PLAYBOOK (one case per classified intent — EXACTLY these six");
    expect(p).toContain('{"intent":"interested"}, "pipeline":"booked"');
    expect(p).toContain('{"intent":"objection_price"}, "pipeline":"replied" → a VALUE-REFRAME "step"');
    expect(p).toContain("NEVER offer a discount, a lower price, or flexible pricing — unless the business context itself contains such an offer");
    expect(p).toContain('{"intent":"objection_timing"}, "pipeline":"replied" → an ACKNOWLEDGE "step"');
    expect(p).toContain('a "delay" node of 14-45 days');
    expect(p).toContain('{"intent":"wrong_person"}, "pipeline":"replied" → a REFERRAL-ASK "step"');
    expect(p).toContain('{"intent":"info_request"}, "pipeline":"replied" → an ANSWER "step"');
    expect(p).toContain('{"intent":"not_interested"}, "pipeline":"lost" → a GRACEFUL-CLOSE "step"');
    expect(p).toContain("never mention unsubscribing");
    expect(p).toContain("BACK to the branch node");
  });

  it("system prompt carries the REPLY CRAFT rules (strategy steps exempt from the length ladder)", () => {
    expect(PLANNER_SYSTEM).toContain("REPLY CRAFT");
    expect(PLANNER_SYSTEM).toContain("exempt from the decreasing-length ladder");
    expect(PLANNER_SYSTEM).toContain("A price objection is answered with VALUE, never money");
    expect(PLANNER_SYSTEM).toContain("never mention unsubscribing");
  });

  it("BEFORE/AFTER: v3 (still registered) carries the STRATEGY block but no REPLY PLAYBOOK", () => {
    renderCurrent(); // ensure registration ran
    const v3 = renderPrompt(PLANNER_PROMPT_NAME, 3, {
      ...baseVars,
      arcLabel: fixture.arc.label,
      arcDescription: fixture.arc.description,
      arcRoles: "  1. OPENER",
      toneHints: fixture.toneHints,
      strategyNotes: "(none)",
      neverSay: "(none)",
    });
    expect(v3).toContain("STRATEGY (the selling method");
    expect(v3).not.toContain("REPLY PLAYBOOK");
    expect(v3).toContain('a case for {"intent":"interested"}');
  });
});

describe("planner prompt v3 (selling craft — carried into v4)", () => {
  it("system prompt carries the role ladder, opener discipline and banned openers", () => {
    expect(PLANNER_SYSTEM).toContain("SELLING CRAFT");
    expect(PLANNER_SYSTEM).toContain(`At most ${OPENER_WORD_CAP} words`);
    expect(PLANNER_SYSTEM).toContain("Ask EXACTLY ONE question and END the body with that question");
    expect(PLANNER_SYSTEM).toContain("ONE call-to-action per message");
    expect(PLANNER_SYSTEM).toContain("Each message is SHORTER than the previous one");
    expect(PLANNER_SYSTEM).toContain("BREAKUP (always the LAST step");
    for (const phrase of BANNED_OPENERS) {
      expect(PLANNER_SYSTEM).toContain(`"${phrase}"`);
    }
  });

  it("template carries the STRATEGY block with arc, tone, notes and neverSay", () => {
    const p = renderCurrent("Lead with the audit.", '"cheap", "guarantee"');
    expect(p).toContain(`Arc: ${fixture.arc.label}`);
    expect(p).toContain(fixture.arc.roles[0]!);
    expect(p).toContain(fixture.arc.roles[fixture.arc.roles.length - 1]!);
    expect(p).toContain(`Tone: ${fixture.toneHints}`);
    expect(p).toContain("Owner strategy notes: Lead with the audit.");
    expect(p).toContain('NEVER SAY (hard ban — these strings must not appear anywhere in any subject or body, in any casing): "cheap", "guarantee"');
  });

  it("absent strategy renders the '(none)' defaults", () => {
    const p = renderCurrent();
    expect(p).toContain("Owner strategy notes: (none)");
    expect(p).toMatch(/NEVER SAY .*: \(none\)/);
  });

  it("BEFORE/AFTER: v2 (still registered) carries no craft and no STRATEGY block", () => {
    renderCurrent(); // ensure registration ran
    const v2 = renderPrompt(PLANNER_PROMPT_NAME, 2, baseVars);
    expect(v2).not.toContain("STRATEGY");
    expect(v2).not.toContain("Arc:");
    expect(v2).not.toContain("NEVER SAY");
    // …while the graph contract both versions share is intact.
    expect(v2).toContain("GRAPH REQUIREMENTS:");
  });
});
