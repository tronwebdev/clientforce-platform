/**
 * Selling-strategy registry (M1a, DEC-065) — the internal constant map
 * f(goal × business category) → arc + tone hints, plus the optional
 * per-agent strategy block that rides the guardrails Json (goalLabel
 * precedent, DEC-059 — no migration).
 *
 * The arc is NEVER stored: it is a pure function of (goal, category), both
 * fixed at creation, so the Settings display can't drift from planning
 * behavior. NO UI selects it (owner rule: derive at creation, edit after).
 * The full map was owner-approved on the PR #63 plan comment.
 */
import { z } from "zod";
import { GOAL_META, type GoalKey } from "./context";

// ── Business categories (wizard step-1 picker vocabulary) ───────────────────
// Moved here from the wizard's local const so the arc-map keys and the picker
// can never fork. Persisted into the (previously dormant) `Agent.category`
// column at creation — supersedes DEC-038(6)'s visual-only note.
export const BUSINESS_CATEGORIES = [
  "Dental & Orthodontics",
  "Healthcare & Wellness",
  "Home Services",
  "Real Estate",
  "Marketing Agency",
  "SaaS & Technology",
  "Professional Services",
  "Other",
] as const;
export const businessCategorySchema = z.enum(BUSINESS_CATEGORIES);
export type BusinessCategory = z.infer<typeof businessCategorySchema>;

// ── Arcs ─────────────────────────────────────────────────────────────────────
export const ARC_KEYS = [
  "diagnose_prescribe",
  "give_value_first",
  "revive_relationship",
  "momentum_deadline",
  "earned_ask",
] as const;
export type ArcKey = (typeof ARC_KEYS)[number];

export interface StrategyArc {
  key: ArcKey;
  label: string;
  /** One-line method summary (Settings display + prompt). */
  description: string;
  /** The role ladder in step order — opener first, breakup ALWAYS last. */
  roles: readonly string[];
}

export const STRATEGY_ARCS: Record<ArcKey, StrategyArc> = {
  diagnose_prescribe: {
    key: "diagnose_prescribe",
    label: "Diagnose, then prescribe",
    description:
      "Open on a pain the ideal customer actually feels, prescribe the fix with one proof point, defuse the effort/cost objection, then close the loop politely.",
    roles: [
      "OPENER — name a pain this ideal customer actually feels, ask exactly one question about it",
      "VALUE/PROOF — prescribe the fix with ONE concrete proof point from the business context",
      "OBJECTION-PREEMPT — defuse the effort/cost hesitation (e.g. it starts with one short call)",
      "BREAKUP — shortest message; close the loop politely with an easy out",
    ],
  },
  give_value_first: {
    key: "give_value_first",
    label: "Give value before the ask",
    description:
      "Open with an observation and a question, give something genuinely useful outright, answer skepticism with proof, then close the loop politely.",
    roles: [
      "OPENER — a short, specific observation about the prospect's situation, exactly one question",
      "VALUE — give something genuinely useful outright (insight, resource, trial); keep the ask soft",
      "PROOF/OBJECTION-PREEMPT — answer the likely skepticism with ONE concrete proof point",
      "BREAKUP — shortest message; close the loop politely with an easy out",
    ],
  },
  revive_relationship: {
    key: "revive_relationship",
    label: "Revive the relationship",
    description:
      "Open by referencing the past relationship and what's changed since, carry the win-back offer, answer \"why come back now\", then close the loop politely.",
    roles: [
      "OPENER — reference the past relationship and what's changed since, exactly one question",
      "VALUE — the win-back offer, concrete and grounded in the business context",
      "OBJECTION-PREEMPT — answer \"why come back now\" in one or two sentences",
      "BREAKUP — shortest message; close the loop politely with an easy out",
    ],
  },
  momentum_deadline: {
    key: "momentum_deadline",
    label: "Momentum to a deadline",
    description:
      "Open by pairing the observation with the concrete offer/event fact, show real momentum, remind of the deadline once and honestly, then close for good when it passes.",
    roles: [
      "OPENER — pair a specific observation with the concrete offer/event fact, exactly one question",
      "VALUE/PROOF — show real momentum or proof from the business context; never manufactured scarcity",
      "OBJECTION-PREEMPT — defuse the hesitation and state the deadline ONCE, factually",
      "BREAKUP — shortest message; the deadline passing is a genuine close, no guilt",
    ],
  },
  earned_ask: {
    key: "earned_ask",
    label: "Earn the ask",
    description:
      "Open with specific gratitude or a success observation about the existing relationship, frame the ask as the natural next step and make it effortless, then close the loop politely.",
    roles: [
      "OPENER — specific gratitude or a success observation about the existing relationship, exactly one question",
      "VALUE — frame the ask as the natural next step and make it effortless (two minutes, one link)",
      "OBJECTION-PREEMPT — kill the time excuse; make doing it now the easy path",
      "BREAKUP — shortest message; close the loop politely with an easy out",
    ],
  },
};

// ── The map: goal → arc, category → tone, sparse goal×category overrides ────
export const GOAL_ARC: Record<GoalKey, ArcKey> = {
  book_appointments: "diagnose_prescribe",
  generate_leads: "give_value_first",
  reactivate_leads: "revive_relationship",
  drive_signups: "give_value_first",
  collect_reviews: "earned_ask",
  promote_offer: "momentum_deadline",
  fill_event: "momentum_deadline",
  upsell_clients: "earned_ask",
  custom: "diagnose_prescribe",
};

export const CATEGORY_TONE: Record<BusinessCategory, string> = {
  "Dental & Orthodontics":
    "Warm, plain-language, patient-outcome-first; no clinical jargon, no hard-sell pressure.",
  "Healthcare & Wellness":
    "Calm, trustworthy, benefit-led; never medical claims, never urgency pressure.",
  "Home Services":
    "Practical, neighborly, concrete about time and money saved; plain words.",
  "Real Estate":
    "Brisk, market-aware; concrete numbers only where the cited context has them.",
  "Marketing Agency":
    "Sharp, results-first, zero fluff — the reader writes copy for a living.",
  "SaaS & Technology":
    "Concise, technically credible, no superlatives; respect the reader's skepticism.",
  "Professional Services":
    "Measured, credible, discreet; formal-adjacent without being stiff.",
  Other: "Clear, friendly, specific; default professional tone.",
};

/** Sparse cells where the combination changes the arc itself (plan §1). */
export const ARC_OVERRIDES: Partial<Record<GoalKey, Partial<Record<BusinessCategory, ArcKey>>>> = {
  // Scarcity countdowns around health services erode trust — lead with the
  // benefit, state the deadline once, factually.
  promote_offer: { "Healthcare & Wellness": "give_value_first" },
  // Expansion sells as solving the next bottleneck, not a gratitude milestone.
  upsell_clients: { "SaaS & Technology": "diagnose_prescribe" },
};

export interface SelectedStrategy {
  arc: StrategyArc;
  toneHints: string;
  category: BusinessCategory;
}

/**
 * The derivation. Unknown/absent goal falls back to `custom`'s consultative
 * default; unknown/absent category (every pre-M1a agent) falls back to
 * "Other" — legacy agents get the goal's default arc with the neutral tone.
 */
export function selectStrategy(
  goal: string | null | undefined,
  category: string | null | undefined,
): SelectedStrategy {
  const goalKey: GoalKey = goal && goal in GOAL_META ? (goal as GoalKey) : "custom";
  const cat: BusinessCategory = businessCategorySchema.safeParse(category).success
    ? (category as BusinessCategory)
    : "Other";
  const arcKey = ARC_OVERRIDES[goalKey]?.[cat] ?? GOAL_ARC[goalKey];
  return { arc: STRATEGY_ARCS[arcKey], toneHints: CATEGORY_TONE[cat], category: cat };
}

// ── Opener discipline constants (prompt + tests share these) ────────────────
export const OPENER_WORD_CAP = 70;

/** Body-start phrases the opener may never use (prompt-enforced). */
export const BANNED_OPENERS = [
  "I hope this email finds you well",
  "I hope this finds you well",
  "Hope you're doing well",
  "My name is",
  "I wanted to reach out",
  "Just checking in",
  "Just following up",
  "Just touching base",
  "Allow me to introduce",
  "I know you're busy",
  "To whom it may concern",
] as const;

// ── Per-agent strategy block (rides guardrails Json — NO migration) ─────────
export const NEVER_SAY_MAX = 10;
export const STRATEGY_NOTES_MAX = 500;

export const strategyBlockSchema = z.object({
  /** Free-text owner guidance injected into the planning prompt. */
  strategyNotes: z.string().max(STRATEGY_NOTES_MAX).optional(),
  /**
   * Hard-banned strings — injected into the prompt AND deterministically
   * checked post-generation in the planner's validation gate (DEC-065).
   */
  neverSay: z.array(z.string().min(1).max(80)).max(NEVER_SAY_MAX).optional(),
});
export type StrategyBlock = z.infer<typeof strategyBlockSchema>;

// ── Guided compose credits (G1, DEC-070) ─────────────────────────────────────
/**
 * DISPLAY-ONLY at launch (Q-020 owns real metering): what one guided SMS
 * composition costs in credits. Rendered on guided step cards + the sample
 * preview; no `credits.consumed.v1` is emitted and no balance exists yet —
 * a billing event with no ledger would be dishonest.
 */
export const GUIDED_SMS_CREDITS = 3;
