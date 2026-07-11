/**
 * M1a (DEC-065): the prompt-layer before/after — v3 carries the selling-craft
 * playbook + STRATEGY block; v2 (still registered, P1.1 append-only registry)
 * carries none of it. Pure, no infra.
 */
import { describe, expect, it } from "vitest";
import { renderPrompt } from "@clientforce/ai";
import { BANNED_OPENERS, OPENER_WORD_CAP, selectStrategy } from "@clientforce/core";
import {
  PLANNER_PROMPT_NAME,
  PLANNER_PROMPT_VERSION,
  PLANNER_PROMPT_VERSION_GUIDED,
  PLANNER_SYSTEM,
  PLANNER_SYSTEM_GUIDED,
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

function renderV3(strategyNotes = "(none)", neverSay = "(none)") {
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

describe("planner prompt v3 (selling craft)", () => {
  it("is pinned at version 3", () => {
    expect(PLANNER_PROMPT_VERSION).toBe(3);
  });

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
    const p = renderV3("Lead with the audit.", '"cheap", "guarantee"');
    expect(p).toContain(`Arc: ${fixture.arc.label}`);
    expect(p).toContain(fixture.arc.roles[0]!);
    expect(p).toContain(fixture.arc.roles[fixture.arc.roles.length - 1]!);
    expect(p).toContain(`Tone: ${fixture.toneHints}`);
    expect(p).toContain("Owner strategy notes: Lead with the audit.");
    expect(p).toContain('NEVER SAY (hard ban — these strings must not appear anywhere in any subject or body, in any casing): "cheap", "guarantee"');
  });

  it("absent strategy renders the '(none)' defaults", () => {
    const p = renderV3();
    expect(p).toContain("Owner strategy notes: (none)");
    expect(p).toMatch(/NEVER SAY .*: \(none\)/);
  });

  it("BEFORE/AFTER: v2 (still registered) carries no craft and no STRATEGY block", () => {
    renderV3(); // ensure registration ran
    const v2 = renderPrompt(PLANNER_PROMPT_NAME, 2, baseVars);
    expect(v2).not.toContain("STRATEGY");
    expect(v2).not.toContain("Arc:");
    expect(v2).not.toContain("NEVER SAY");
    // …while the graph contract both versions share is intact.
    expect(v2).toContain("GRAPH REQUIREMENTS:");
  });
});

describe("planner prompt v4 — guided sms briefs (G1, DEC-068)", () => {
  const guidedVars = {
    ...baseVars,
    channels:
      '"email" or "sms" — mix channels where the sequence benefits; sms steps have NO subject, body ≤ 300 characters, one clear ask.',
    arcLabel: fixture.arc.label,
    arcDescription: fixture.arc.description,
    arcRoles: fixture.arc.roles.map((r, i) => `  ${i + 1}. ${r}`).join("\n"),
    toneHints: fixture.toneHints,
    strategyNotes: "(none)",
    neverSay: "(none)",
  };

  it("is pinned at version 4, registered beside v2/v3 (append-only registry)", () => {
    expect(PLANNER_PROMPT_VERSION_GUIDED).toBe(4);
    expect(renderPlannerPrompt(guidedVars, true)).toContain('Sms steps: mode "guided"');
  });

  it("v4 instructs briefs for sms steps and scripted copy for email steps", () => {
    const v4 = renderPlannerPrompt(guidedVars, true);
    expect(v4).toContain('"brief" (objective + 3-6 talkingPoints + optional mustSay/neverSay)');
    expect(v4).toContain("EMPTY content — no subject, no body, no merge tokens");
    expect(v4).toContain('Email steps: content has "subject" and "body"');
    // The shared head/tail is intact — STRATEGY block + graph contract.
    expect(v4).toContain("STRATEGY (the selling method for this agent — follow it):");
    expect(v4).toContain("GRAPH REQUIREMENTS:");
  });

  it("SCRIPTED REGRESSION: v3 renders with ZERO guided material — byte-stable step bullet", () => {
    const v3 = renderPlannerPrompt(guidedVars, false);
    expect(v3).not.toContain("guided");
    expect(v3).not.toContain("brief");
    // The exact M1a step bullet (rendered), untouched by the shared-head refactor.
    expect(v3).toContain(
      '- 3-4 "step" nodes; each content has "subject" and "body"; use {{firstName}} and {{company}} in the body (and subject where natural).',
    );
  });

  it("the guided SYSTEM addendum extends the scripted system verbatim (prefix-stable)", () => {
    expect(PLANNER_SYSTEM_GUIDED.startsWith(PLANNER_SYSTEM)).toBe(true);
    expect(PLANNER_SYSTEM_GUIDED).toContain("GUIDED SMS BRIEFS");
    expect(PLANNER_SYSTEM_GUIDED).toContain("never write sms body text");
    // The scripted system itself carries none of it.
    expect(PLANNER_SYSTEM).not.toContain("GUIDED");
  });
});
