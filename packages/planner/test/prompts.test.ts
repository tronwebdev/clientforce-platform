/**
 * The prompt-layer before/after across the append-only registry (P1.1):
 * v5 (F1, DEC-069) layers the OBSERVED OUTCOMES section on v4's playbook;
 * v4 (M1b, DEC-068) carries the six-intent REPLY PLAYBOOK; v3 (M1a, DEC-065)
 * carries the selling craft + STRATEGY block but no playbook; v2 carries
 * neither. All stay registered. Pure, no infra.
 */
import { describe, expect, it } from "vitest";
import { renderPrompt } from "@clientforce/ai";
import { BANNED_OPENERS, OPENER_WORD_CAP, selectStrategy } from "@clientforce/core";
import {
  PLANNER_PROMPT_NAME,
  PLANNER_PROMPT_VERSION,
  PLANNER_PROMPT_VERSION_GUIDED,
  PLANNER_PROMPT_VERSION_GUIDED_LANGUAGE,
  PLANNER_PROMPT_VERSION_LANGUAGE,
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

function renderCurrent(strategyNotes = "(none)", neverSay = "(none)", outcomes = "") {
  return renderPlannerPrompt({
    ...baseVars,
    arcLabel: fixture.arc.label,
    arcDescription: fixture.arc.description,
    arcRoles: fixture.arc.roles.map((r, i) => `  ${i + 1}. ${r}`).join("\n"),
    toneHints: fixture.toneHints,
    strategyNotes,
    neverSay,
    outcomes,
  });
}

describe("planner prompt v5 (outcome-aware regen layered on the playbook)", () => {
  it("is pinned at version 5", () => {
    expect(PLANNER_PROMPT_VERSION).toBe(5);
  });

  it("renders the OBSERVED OUTCOMES block verbatim, between STRATEGY and GUARDRAILS, coexisting with the playbook", () => {
    const block =
      "OBSERVED OUTCOMES (live campaign data — confidence labeled per step):\n" +
      "- step-1 (email): 62 sent · reply rate 4.8% · positive-intent 1.6% · opt-out 0% — confidence: ok (≥50 sends)\n";
    const p = renderCurrent("(none)", "(none)", block);
    expect(p).toContain(block);
    expect(p.indexOf("OBSERVED OUTCOMES")).toBeGreaterThan(p.indexOf("STRATEGY"));
    expect(p.indexOf("OBSERVED OUTCOMES")).toBeLessThan(p.indexOf("GUARDRAILS"));
    // The layered prompt keeps the FULL v4 playbook contract intact.
    expect(p).toContain("REPLY PLAYBOOK (one case per classified intent — EXACTLY these six");
    expect(p).toContain('{"intent":"not_interested"}, "pipeline":"lost"');
  });

  it("an empty outcomes block leaves NO outcomes section (young campaigns plan exactly as v4 did)", () => {
    const p = renderCurrent();
    expect(p).not.toContain("OBSERVED OUTCOMES");
    expect(p).toContain("REPLY PLAYBOOK");
  });

  it("BEFORE/AFTER: v4 (still registered) has the playbook but no outcomes slot", () => {
    renderCurrent(); // ensure registration ran
    const v4 = renderPrompt(PLANNER_PROMPT_NAME, 4, {
      ...baseVars,
      arcLabel: fixture.arc.label,
      arcDescription: fixture.arc.description,
      arcRoles: "  1. OPENER",
      toneHints: fixture.toneHints,
      strategyNotes: "(none)",
      neverSay: "(none)",
    });
    expect(v4).toContain("REPLY PLAYBOOK");
    expect(v4).not.toContain("OBSERVED OUTCOMES");
    expect(v4).not.toContain("{{outcomes}}");
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

describe("planner prompt v6 — guided sms briefs (G1, DEC-070; layered on v5)", () => {
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
    outcomes: "",
  };

  it("is pinned at version 6, registered beside v2–v5 (append-only registry)", () => {
    expect(PLANNER_PROMPT_VERSION_GUIDED).toBe(6);
    expect(renderPlannerPrompt(guidedVars, true)).toContain('Sms steps: mode "guided"');
  });

  it("v6 instructs briefs for sms steps; email steps (main AND reply-strategy) stay scripted", () => {
    const v6 = renderPlannerPrompt(guidedVars, true);
    expect(v6).toContain('"brief" (objective + 3-6 talkingPoints + optional mustSay/neverSay)');
    expect(v6).toContain("EMPTY content — no subject, no body, no merge tokens");
    expect(v6).toContain('Email steps: content has "subject" and "body"');
    expect(v6).toContain("Reply-strategy steps stay scripted email.");
    // Everything ELSE is v5 verbatim (v6 derives from the same literal): the
    // STRATEGY block, the six-case REPLY PLAYBOOK, the outcomes slot.
    expect(v6).toContain("STRATEGY (the selling method for this agent — follow it):");
    expect(v6).toContain("REPLY PLAYBOOK (one case per classified intent — EXACTLY these six");
    const v5 = renderPlannerPrompt(guidedVars, false);
    expect(v6.replace(/- 3-4 "step" nodes in the MAIN sequence\.[^\n]*/, "")).toBe(
      v5.replace(/- 3-4 "step" nodes in the MAIN sequence;[^\n]*/, ""),
    );
  });

  it("SCRIPTED REGRESSION: v5 renders with ZERO guided material — byte-stable step bullet", () => {
    const v5 = renderPlannerPrompt(guidedVars, false);
    expect(v5).not.toContain("guided");
    expect(v5).not.toContain('"brief"');
    // The exact F1 step bullet (rendered), untouched by the v6 derivation.
    expect(v5).toContain(
      '- 3-4 "step" nodes in the MAIN sequence; each content has "subject" and "body"; use {{firstName}} and {{company}} in the body (and subject where natural).',
    );
  });

  it("the guided SYSTEM addendum extends the scripted system verbatim (prefix-stable)", () => {
    expect(PLANNER_SYSTEM_GUIDED.startsWith(PLANNER_SYSTEM)).toBe(true);
    expect(PLANNER_SYSTEM_GUIDED).toContain("GUIDED SMS BRIEFS");
    expect(PLANNER_SYSTEM_GUIDED).toContain("never write sms body text");
    // The scripted system itself carries none of it.
    expect(PLANNER_SYSTEM).not.toContain("GUIDED SMS BRIEFS");
  });
});

describe("planner prompt v7/v8 — output language (L1, DEC-071; layered on v5/v6)", () => {
  const vars = {
    ...baseVars,
    arcLabel: fixture.arc.label,
    arcDescription: fixture.arc.description,
    arcRoles: fixture.arc.roles.map((r, i) => `  ${i + 1}. ${r}`).join("\n"),
    toneHints: fixture.toneHints,
    strategyNotes: "(none)",
    neverSay: "(none)",
    outcomes: "",
  };
  const guidedVars = {
    ...vars,
    channels:
      '"email" or "sms" — mix channels where the sequence benefits; sms steps have NO subject, body ≤ 300 characters, one clear ask.',
  };

  it("is pinned at versions 7 (scripted) and 8 (guided), registered beside v2–v6", () => {
    expect(PLANNER_PROMPT_VERSION_LANGUAGE).toBe(7);
    expect(PLANNER_PROMPT_VERSION_GUIDED_LANGUAGE).toBe(8);
  });

  it("v7 carries the OUTPUT LANGUAGE section with the agent's language, before GUARDRAILS", () => {
    const p = renderPlannerPrompt(vars, false, "de");
    expect(p).toContain("OUTPUT LANGUAGE (the customer's language — non-negotiable):");
    expect(p).toContain("Write ALL human-visible copy in German (Deutsch)");
    expect(p).toContain(
      'Machine identifiers stay in English: node ids, "intent" values, "pipeline" values, channel names.',
    );
    // Merge tokens stay literal — the rule names the same token list the step
    // bullet documents, and the inert {{ }} braces render as-is.
    expect(p).toContain(
      "Merge tokens stay EXACTLY as given ({{firstName}} and {{company}}) — never translate the words inside {{ }} braces.",
    );
    expect(p).toContain(
      "the sending layer appends the compliant line in German (Deutsch) itself",
    );
    expect(p.indexOf("OUTPUT LANGUAGE")).toBeGreaterThan(p.indexOf("STRATEGY"));
    expect(p.indexOf("OUTPUT LANGUAGE")).toBeLessThan(p.indexOf("GUARDRAILS"));
    // Everything else is the v5 literal: playbook + strategy contract intact.
    expect(p).toContain("REPLY PLAYBOOK (one case per classified intent — EXACTLY these six");
    expect(p).toContain("STRATEGY (the selling method for this agent — follow it):");
  });

  it("v8 = v7 with the SAME guided bullet swap as v6 (derived, can't drift)", () => {
    const p = renderPlannerPrompt(guidedVars, true, "fr");
    expect(p).toContain('Sms steps: mode "guided"');
    expect(p).toContain("Write ALL human-visible copy in French (Français)");
    // Removing the one swapped bullet line makes v8 and v7 identical.
    const v7 = renderPlannerPrompt(guidedVars, false, "fr");
    expect(p.replace(/- 3-4 "step" nodes in the MAIN sequence\.[^\n]*/, "")).toBe(
      v7.replace(/- 3-4 "step" nodes in the MAIN sequence;[^\n]*/, ""),
    );
  });

  it("ENGLISH REGRESSION: en renders v5/v6 BYTE-IDENTICAL — no language material anywhere", () => {
    // The explicit-en render IS the registered v5/v6 render, byte for byte.
    expect(renderPlannerPrompt(vars, false, "en")).toBe(
      renderPrompt(PLANNER_PROMPT_NAME, PLANNER_PROMPT_VERSION, vars),
    );
    expect(renderPlannerPrompt(guidedVars, true, "en")).toBe(
      renderPrompt(PLANNER_PROMPT_NAME, PLANNER_PROMPT_VERSION_GUIDED, guidedVars),
    );
    // …and the default (language omitted) is the same English render.
    expect(renderPlannerPrompt(vars, false)).toBe(renderPlannerPrompt(vars, false, "en"));
    expect(renderPlannerPrompt(vars, false, "en")).not.toContain("OUTPUT LANGUAGE");
  });

  it("every launch language renders its own prompt label", () => {
    expect(renderPlannerPrompt(vars, false, "pl")).toContain("Polish (Polski)");
    expect(renderPlannerPrompt(vars, false, "pt")).toContain("Portuguese (Português)");
  });
});
