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

export const icpProfileSchema = z.object({
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
  if (
    profile.headcountBand &&
    typeof facts.headcount === "number" &&
    bandContains(profile.headcountBand, facts.headcount)
  ) {
    fit += 15;
    reasons.push(`headcount in your ${profile.headcountBand} band`);
  }
  if (profile.location && facts.location?.toLowerCase().includes(profile.location.toLowerCase())) {
    fit += 12;
    reasons.push("inside your target area");
  }
  if (
    profile.titles?.length &&
    facts.title &&
    profile.titles.some((t) => facts.title!.toLowerCase().includes(t.toLowerCase()))
  ) {
    fit += 12;
    reasons.push("a decision-maker title you target");
  }
  if (profile.ownerRun && facts.ownerRun) {
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
  if (typeof facts.daysSinceLastTouch === "number" && facts.daysSinceLastTouch > 60) {
    reasons.push(`quiet for ${facts.daysSinceLastTouch} days`);
  }
  return { fit: Math.max(1, Math.min(99, fit)), reasons };
}
