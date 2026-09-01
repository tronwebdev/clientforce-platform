/**
 * D1 (DEC-173): the deliverability RULE contract — the owner's ruling toggle
 * *"Pause if bounces exceed 2% — she stops rather than burn the domain."*
 * (`SURFACE_SPEC_SETTINGS` §6 Health tab, `Console Bold.dc.html` line 4537).
 *
 * It lives in core for the same reason the health BANDS do (DEC-084): the
 * engine that enforces it (`packages/channels`), the API that edits it, and
 * whichever surface eventually renders the toggle must import ONE definition
 * and agree by construction rather than by coincidence.
 *
 * The DEFAULTS are here, not in the database's column defaults, so that a
 * workspace with no row behaves identically to one with a row it never
 * touched — and so changing the platform default is a code change with a diff,
 * not a silent migration.
 */
import { z } from "zod";

/**
 * LOCKED to the prototype: the toggle ships ON at 2%. Two properties make an
 * on-by-default refusal safe rather than reckless:
 *
 *  - it reads the SAME persisted health snapshot the score gate reads, whose
 *    rates are `null` below the sample floor — so it cannot fire on a fresh
 *    or low-volume sender, only on a measured one; and
 *  - it is reversible: the rate is a rolling 7-day window, so a sender that
 *    stops bouncing sends again with no intervention.
 */
export const DELIVERABILITY_DEFAULTS = {
  /** The toggle. Off leaves score-only auto-pause (`SENDER_UNHEALTHY`) alone. */
  pauseOnBounceRate: true,
  /** Hard-bounce rate at/over which a sender refuses — the owner's 2%. */
  bounceRateThreshold: 0.02,
  /** DEC-171: soft-bounce strikes inside the window before suppression. */
  softBounceThreshold: 3,
  softBounceWindowDays: 30,
} as const;

export const deliverabilityRuleSchema = z.object({
  pauseOnBounceRate: z.boolean(),
  /**
   * A rate, not a percentage — 0.02 is 2%. Floored at 0.1%: below that a
   * single bounce in a 1,000-send window would pause a healthy sender, which
   * is a footgun rather than a setting. Ceiling 100% = "never pause on rate".
   */
  bounceRateThreshold: z.number().min(0.001).max(1),
  /** At least two strikes — one strike is a hard bounce by another name. */
  softBounceThreshold: z.number().int().min(2).max(20),
  softBounceWindowDays: z.number().int().min(1).max(365),
});
export type DeliverabilityRule = z.infer<typeof deliverabilityRuleSchema>;

/** PATCH shape — every field optional, at least one present. */
export const updateDeliverabilityRuleSchema = deliverabilityRuleSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one deliverability rule field",
  });
export type UpdateDeliverabilityRuleDto = z.infer<typeof updateDeliverabilityRuleSchema>;

/** A stored row (or its absence) resolved against the platform defaults. */
export function resolveDeliverabilityRule(
  row: Partial<DeliverabilityRule> | null | undefined,
): DeliverabilityRule {
  return {
    pauseOnBounceRate: row?.pauseOnBounceRate ?? DELIVERABILITY_DEFAULTS.pauseOnBounceRate,
    bounceRateThreshold: row?.bounceRateThreshold ?? DELIVERABILITY_DEFAULTS.bounceRateThreshold,
    softBounceThreshold: row?.softBounceThreshold ?? DELIVERABILITY_DEFAULTS.softBounceThreshold,
    softBounceWindowDays:
      row?.softBounceWindowDays ?? DELIVERABILITY_DEFAULTS.softBounceWindowDays,
  };
}

/**
 * THE predicate. One function so the boundary refusal, any future surface, and
 * the tests can never disagree about what "over the line" means.
 *
 * `measuredBounceRate` is the hard-bounce rate from the persisted health
 * snapshot, or `null` below the sample floor — and `null` NEVER breaches. The
 * comparison is `>=`, matching the health engine's own danger-bound convention
 * (`spikeSignals`), so "exceed 2%" and "at 2%" resolve the same way in both
 * places rather than differing by one hair.
 */
export function breachesBounceRate(
  rule: DeliverabilityRule,
  measuredBounceRate: number | null | undefined,
): boolean {
  if (!rule.pauseOnBounceRate) return false;
  if (measuredBounceRate === null || measuredBounceRate === undefined) return false;
  return measuredBounceRate >= rule.bounceRateThreshold;
}

/** Render a rate as the percentage the owner's copy speaks in ("2%", "2.5%"). */
export function formatBounceRatePct(rate: number): string {
  const pct = rate * 100;
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}
