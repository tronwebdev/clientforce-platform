import { z } from "zod";

/**
 * B6 (DEC-131): the ICP PROFILE + deterministic fit scorer — "ICP scoring is
 * ours", run over the workspace's closed business, never a provider's black
 * box. Ruling 3 makes the profile SHAPE-first: `company` / `local_business` /
 * `consumer` — and every downstream surface (filters, signal eligibility,
 * watch-topic suggestions, receipts) resolves from registries keyed by shape
 * (+ vertical), the GOAL_META pattern. A hard-coded B2B noun in a shared
 * surface is a review defect (the standing acceptance rule).
 *
 * The profile's interim home is `Workspace.settings.icpProfile` (Json,
 * additive) — the prose `icp` context field stays the narrative source; the
 * structured home + distillation from prose is Q-107.
 */
export const ICP_SHAPES = ["company", "local_business", "consumer"] as const;
export type IcpShape = (typeof ICP_SHAPES)[number];

/**
 * B6.7 — THE SHAPE-FACET RULING.
 *
 * A qualifier only means something for the shapes that can have it. Company
 * size and a decision-maker title are facts about an ORGANISATION; a
 * consumer-shape brief — a dentist's patients, a gym's members — has neither,
 * and a profile carrying them describes two different businesses at once.
 *
 * The demo made the failure visible: `local_business` + `dental` rendered as
 * "Patients in Austin, 5–25 in size, reached through Owner, Practice
 * Manager" — a consumer noun wearing company qualifiers (Q-164). It was not
 * only ugly. It SET THE SCORER'S CEILING: the title rule is worth 12 points,
 * so the only rows that could reach the 90+ band were ones carrying a title,
 * which a patient never has. A vocabulary bug had quietly become a scoring
 * bug.
 *
 * So the facets a shape may carry are declared here, once, and enforced in
 * three places that must agree: parsing (below — an invalid facet is
 * STRIPPED, never stored), the brief sentence (it cannot render a facet that
 * is not there), and the scorer (it refuses the points even if handed one
 * directly, since a profile can be built in code without passing through
 * this schema).
 *
 * Stripping rather than rejecting is deliberate. `profile()` falls back to
 * DEFAULT_ICP_PROFILE when a parse fails, so a strict schema would have
 * silently wiped the brief of every workspace already holding a mismatched
 * profile — a data-loss bug dressed as a validation fix.
 */
export const ICP_FACETS = ["headcountBand", "radiusMiles", "location", "titles", "ownerRun"] as const;
export type IcpFacet = (typeof ICP_FACETS)[number];

export const SHAPE_FACETS: Record<IcpShape, readonly IcpFacet[]> = {
  // Sells to organisations: their size, who decides, whether it is owner-run.
  company: ["headcountBand", "titles", "ownerRun", "location"],
  // Also organisations, but ones with a doorstep — so a radius applies too.
  local_business: ["headcountBand", "titles", "ownerRun", "location", "radiusMiles"],
  // Sells to PEOPLE. A person has no headcount, no seniority and no owner.
  // Nothing is added in their place here: an age band is the obvious
  // candidate and it is personal data whose basis is unsettled (Q-161).
  consumer: ["location", "radiusMiles"],
};

export const shapeAllows = (shape: IcpShape, facet: IcpFacet): boolean =>
  SHAPE_FACETS[shape].includes(facet);

const icpProfileShape = z.object({
  shape: z.enum(ICP_SHAPES),
  /** The DEC-129 vocabulary key (dental, saas, salon, …) — free-form. */
  vertical: z.string().max(40).optional(),
  /** Shape-appropriate bands — all optional; absent = no preference. */
  headcountBand: z.string().max(40).optional(),
  radiusMiles: z.number().int().min(1).max(500).optional(),
  location: z.string().max(120).optional(),
  titles: z.array(z.string().max(60)).max(10).optional(),
  ownerRun: z.boolean().optional(),
});

/** Drop every facet this shape cannot have. Idempotent; never throws. */
export function stripInvalidFacets<T extends { shape: IcpShape }>(profile: T): T {
  const out = { ...profile } as Record<string, unknown>;
  for (const facet of ICP_FACETS) {
    if (!shapeAllows(profile.shape, facet)) delete out[facet];
  }
  return out as T;
}

export const icpProfileSchema = icpProfileShape.transform(stripInvalidFacets);
export type IcpProfile = z.infer<typeof icpProfileSchema>;

export const DEFAULT_ICP_PROFILE: IcpProfile = { shape: "company" };

export interface LeadCandidateFacts {
  /** Provider- or own-data-supplied. */
  title?: string | null;
  company?: string | null;
  location?: string | null;
  headcount?: number | null;
  ownerRun?: boolean | null;
  /** Own-data engagement facts (absent for provider candidates). */
  repliedBefore?: boolean;
  bookedBefore?: boolean;
  daysSinceLastTouch?: number | null;
  /** B6 review fix 2: real own-book differentiators. */
  callConsentGranted?: boolean;
}

export interface FitResult {
  fit: number;
  /** Plain factual reasons — the receipts a row shows. Never invented. */
  reasons: string[];
}

const bandContains = (band: string, n: number): boolean => {
  const m = band.match(/(\d+)\s*[–-]\s*(\d+)/);
  if (m) return n >= Number(m[1]) && n <= Number(m[2]);
  const plus = band.match(/(\d+)\+/);
  if (plus) return n >= Number(plus[1]);
  return false;
};

/**
 * Deterministic, explainable fit: a base plus additive band matches, capped.
 * Every point has a stated reason; a candidate with no matching facts scores
 * low honestly instead of being dressed up.
 */
export function scoreCandidate(profile: IcpProfile, facts: LeadCandidateFacts): FitResult {
  let fit = 50;
  const reasons: string[] = [];
  // B6.7 (the shape-facet ruling): a facet this shape cannot have earns
  // NOTHING, even when a caller hands one over — a profile can be built in
  // code without passing through `icpProfileSchema`, and the ceiling this
  // sets is a scoring fact, not a cosmetic one.
  const allows = (facet: IcpFacet) => shapeAllows(profile.shape, facet);
  if (
    allows("headcountBand") &&
    profile.headcountBand &&
    typeof facts.headcount === "number" &&
    bandContains(profile.headcountBand, facts.headcount)
  ) {
    fit += 15;
    reasons.push(`headcount in your ${profile.headcountBand} band`);
  }
  if (
    allows("location") &&
    profile.location &&
    facts.location?.toLowerCase().includes(profile.location.toLowerCase())
  ) {
    fit += 12;
    reasons.push("inside your target area");
  }
  if (
    allows("titles") &&
    profile.titles?.length &&
    facts.title &&
    profile.titles.some((t) => facts.title!.toLowerCase().includes(t.toLowerCase()))
  ) {
    fit += 12;
    reasons.push("a decision-maker title you target");
  }
  if (allows("ownerRun") && profile.ownerRun && facts.ownerRun) {
    fit += 8;
    reasons.push("owner-run");
  }
  if (facts.bookedBefore) {
    fit += 10;
    reasons.push("booked with you before");
  }
  if (facts.repliedBefore) {
    fit += 6;
    reasons.push("has replied to you before");
  }
  if (facts.callConsentGranted) {
    fit += 5;
    reasons.push("said you may call");
  }
  // B6 review fix 2: recency BANDS, not a flat note — a fresh lapse is worth
  // more than an ancient one, and the score says so.
  if (typeof facts.daysSinceLastTouch === "number" && facts.daysSinceLastTouch >= 60) {
    if (facts.daysSinceLastTouch <= 150) {
      fit += 8;
      reasons.push(`went quiet ${facts.daysSinceLastTouch} days ago — still warm`);
    } else {
      fit += 3;
      reasons.push(`quiet for ${facts.daysSinceLastTouch} days`);
    }
  }
  return { fit: Math.max(1, Math.min(99, fit)), reasons };
}
