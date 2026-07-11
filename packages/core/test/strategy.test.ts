/**
 * M1a (DEC-065): the strategy registry — arc selection over the owner-approved
 * goal×category map (PR #63 plan comment), the guardrails strategy rider's
 * caps, and the legacy-row regression (absent block = defaults, parse
 * unchanged — the goalLabel precedent holds).
 */
import { describe, expect, it } from "vitest";
import {
  ARC_OVERRIDES,
  BANNED_OPENERS,
  BUSINESS_CATEGORIES,
  CATEGORY_TONE,
  DEFAULT_GUARDRAILS,
  GOAL_ARC,
  GOAL_KEYS,
  NEVER_SAY_MAX,
  OPENER_WORD_CAP,
  parseGuardrails,
  selectStrategy,
  STRATEGY_ARCS,
  STRATEGY_NOTES_MAX,
  strategyBlockSchema,
} from "../src";

describe("selectStrategy (goal×category map)", () => {
  it("maps every goal to a defined arc with breakup last", () => {
    for (const goal of GOAL_KEYS) {
      const { arc } = selectStrategy(goal, "Other");
      expect(arc, goal).toBeDefined();
      expect(arc.roles[0], goal).toMatch(/^OPENER/);
      expect(arc.roles[arc.roles.length - 1], goal).toMatch(/^BREAKUP/);
    }
  });

  it("covers every category with tone hints", () => {
    for (const cat of BUSINESS_CATEGORIES) {
      const { toneHints } = selectStrategy("book_appointments", cat);
      expect(toneHints).toBe(CATEGORY_TONE[cat]);
      expect(toneHints.length).toBeGreaterThan(0);
    }
  });

  it("applies the sparse overrides (the two approved cells)", () => {
    expect(selectStrategy("promote_offer", "Healthcare & Wellness").arc.key).toBe(
      "give_value_first",
    );
    expect(selectStrategy("upsell_clients", "SaaS & Technology").arc.key).toBe(
      "diagnose_prescribe",
    );
    // The same goals keep their default arc everywhere else.
    expect(selectStrategy("promote_offer", "Dental & Orthodontics").arc.key).toBe(
      "momentum_deadline",
    );
    expect(selectStrategy("upsell_clients", "Other").arc.key).toBe("earned_ask");
  });

  it("legacy agents (NULL/unknown category) get the goal's default arc with the neutral tone", () => {
    for (const category of [null, undefined, "", "Not A Category"]) {
      const s = selectStrategy("book_appointments", category);
      expect(s.arc.key).toBe(GOAL_ARC.book_appointments);
      expect(s.category).toBe("Other");
      expect(s.toneHints).toBe(CATEGORY_TONE.Other);
    }
  });

  it("unknown goal falls back to custom's consultative default", () => {
    expect(selectStrategy("not_a_goal", "Real Estate").arc.key).toBe(GOAL_ARC.custom);
    expect(selectStrategy(null, null).arc.key).toBe(GOAL_ARC.custom);
  });

  it("every override cell points at a real arc for a real goal/category", () => {
    for (const [goal, cells] of Object.entries(ARC_OVERRIDES)) {
      expect(GOAL_KEYS).toContain(goal);
      for (const [cat, arc] of Object.entries(cells ?? {})) {
        expect(BUSINESS_CATEGORIES).toContain(cat);
        expect(STRATEGY_ARCS[arc!]).toBeDefined();
      }
    }
  });

  it("opener constants are sane (prompt + tests share them)", () => {
    expect(OPENER_WORD_CAP).toBe(70);
    expect(BANNED_OPENERS.length).toBeGreaterThanOrEqual(8);
  });
});

describe("strategy block (guardrails rider)", () => {
  it("accepts notes ≤500 and up to 10 neverSay terms", () => {
    const ok = strategyBlockSchema.safeParse({
      strategyNotes: "n".repeat(STRATEGY_NOTES_MAX),
      neverSay: Array.from({ length: NEVER_SAY_MAX }, (_, i) => `term-${i}`),
    });
    expect(ok.success).toBe(true);
  });

  it("rejects 501-char notes and an 11th term", () => {
    expect(
      strategyBlockSchema.safeParse({ strategyNotes: "n".repeat(STRATEGY_NOTES_MAX + 1) }).success,
    ).toBe(false);
    expect(
      strategyBlockSchema.safeParse({
        neverSay: Array.from({ length: NEVER_SAY_MAX + 1 }, (_, i) => `term-${i}`),
      }).success,
    ).toBe(false);
    expect(strategyBlockSchema.safeParse({ neverSay: [""] }).success).toBe(false);
  });

  it("legacy guardrails rows parse unchanged (absent block = defaults)", () => {
    expect(parseGuardrails({})).toEqual(DEFAULT_GUARDRAILS);
    expect(parseGuardrails(null)).toEqual(DEFAULT_GUARDRAILS);
    const legacy = parseGuardrails({
      sendingWindow: { days: [1, 2], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 100 },
      consent: null,
      unsubscribeFooter: true,
      suppressionCheck: true,
    });
    expect(legacy.strategy).toBeUndefined();
  });

  it("strategy coexists with goalLabel and round-trips through parseGuardrails", () => {
    const parsed = parseGuardrails({
      sendingWindow: { days: [1], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 50 },
      consent: null,
      goalLabel: "Contract signed",
      strategy: { strategyNotes: "Lead with the audit.", neverSay: ["cheap", "guarantee"] },
      unsubscribeFooter: true,
      suppressionCheck: true,
    });
    expect(parsed.goalLabel).toBe("Contract signed");
    expect(parsed.strategy?.strategyNotes).toBe("Lead with the audit.");
    expect(parsed.strategy?.neverSay).toEqual(["cheap", "guarantee"]);
  });

  it("a PRESENT-yet-invalid strategy block throws (never silently widened)", () => {
    expect(() =>
      parseGuardrails({
        sendingWindow: { days: [1], start: "09:00", end: "17:00", timezone: "UTC" },
        dailyCap: { email: 50 },
        consent: null,
        strategy: { neverSay: "not-an-array" },
        unsubscribeFooter: true,
        suppressionCheck: true,
      }),
    ).toThrow();
  });
});

describe("composeMode (guardrails rider — G1, DEC-068)", () => {
  const base = {
    sendingWindow: { days: [1], start: "09:00", end: "17:00", timezone: "UTC" },
    dailyCap: { email: 50 },
    consent: null,
    unsubscribeFooter: true,
    suppressionCheck: true,
  };

  it("legacy rows parse unchanged — absent composeMode = scripted default", () => {
    expect(parseGuardrails(base).composeMode).toBeUndefined();
    expect(parseGuardrails({}).composeMode).toBeUndefined();
  });

  it("round-trips beside goalLabel and strategy (nothing clobbers anything)", () => {
    const parsed = parseGuardrails({
      ...base,
      goalLabel: "Contract signed",
      strategy: { neverSay: ["cheap"] },
      composeMode: "guided",
    });
    expect(parsed.composeMode).toBe("guided");
    expect(parsed.goalLabel).toBe("Contract signed");
    expect(parsed.strategy?.neverSay).toEqual(["cheap"]);
  });

  it("a PRESENT-yet-invalid composeMode throws (A8 discipline)", () => {
    expect(() => parseGuardrails({ ...base, composeMode: "freestyle" })).toThrow();
  });
});
