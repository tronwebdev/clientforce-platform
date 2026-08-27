/**
 * The B2.6 signal vocabulary (DEC-110), extracted so every reader of the same
 * facts — the sweep AND the contact drawer's ✦ footer (DEC-112(7)) — shares
 * ONE definition and can never drift.
 */

export const QUIET_DAYS = 60;

/** NON-BLOCKING threshold defaults (Q-076 — owner tuning pending). */
export const THRESHOLDS = { winback_stalled: 1, quiet_contacts: 3, collect_reviews: 2 } as const;

export const NOT_NOW_INTENTS = ["not_interested", "objection_price", "objection_timing", "not"];

/** Enrollment stages the collect_reviews signal counts as a happy outcome. */
export const HAPPY_STAGES = ["booked", "won"];
