/**
 * Credit packs — the price list the buy flow quotes from (B7.6, DEC-148).
 *
 * WHY THIS FILE EXISTS. B7.5 shipped a buy screen with no prices on it. The
 * reasoning was an honesty gate: nothing in the system carried a pack price,
 * so $40 would have been invented. The owner's ruling (REDO §1.1) is that a
 * buy screen with no prices is not a fidelity nit but the revenue surface of
 * the product, and that the flow must either quote real prices or be an honest
 * deferral that says so. This is the price source that makes the first branch
 * possible.
 *
 * These are PLATFORM prices, not per-workspace data: the same three packs at
 * the same three prices for everyone, exactly as the prototype declares them
 * (Console Bold.dc.html:5090 — `PACKS = [[2000,40],[5000,90],[10000,180]]`).
 * That is why they live in `core` as a constant rather than in the database.
 * A per-agency price override is a later question (Q-136); when it arrives it
 * overrides THIS list rather than replacing it, so the shape stays.
 *
 * The rate and the days-of-sending line are DERIVED here, in one place, so the
 * modal cannot drift from the charge path: whatever bills the card multiplies
 * the same `priceUsd` this quotes.
 */

/** A pack, exactly as the prototype declares it. */
export interface CreditPack {
  credits: number;
  priceUsd: number;
  /** The prototype flags the 10,000 pack `best` (dc.html:5090). */
  best: boolean;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { credits: 2_000, priceUsd: 40, best: false },
  { credits: 5_000, priceUsd: 90, best: false },
  { credits: 10_000, priceUsd: 180, best: true },
];

/** The prototype pre-selects the middle pack (dc.html:5092). */
export const DEFAULT_PACK_CREDITS = 5_000;

/** The middle pack, as the fallback for an unrecognised size. */
const FALLBACK: CreditPack = { credits: 5_000, priceUsd: 90, best: false };

export function packFor(credits: number): CreditPack {
  return CREDIT_PACKS.find((p) => p.credits === credits) ?? CREDIT_PACKS[1] ?? FALLBACK;
}

/**
 * Dollars per 1,000 credits, rounded the way the prototype rounds it
 * (`(price / (credits/1000)).toFixed(0)`, dc.html:5140).
 */
export function ratePer1000(pack: CreditPack): number {
  return Math.round(pack.priceUsd / (pack.credits / 1000));
}

/** The `best rate` chip is a claim about a ratio, so derive it, never assert it. */
export function isBestRate(pack: CreditPack): boolean {
  const best = Math.min(...CREDIT_PACKS.map(ratePer1000));
  return ratePer1000(pack) === best;
}

/**
 * "about N days of sending".
 *
 * The prototype divides by a hard-coded 210 a day (dc.html:5140). We will not:
 * 210 is a design constant with no basis in the workspace looking at it, and
 * this is the same class of number the credits hero already refuses to draw.
 *
 * But the honest version is available without a projection. A workspace's
 * DAILY SENDING CEILING is configured data — the user typed it on the
 * Guardrails tab — and one email costs one credit, so `credits / dailyCap` is
 * arithmetic on two known numbers rather than a forecast from history. That is
 * why this takes the cap as an argument instead of guessing: the caller passes
 * the workspace's own ceiling, and the copy names it as the basis.
 *
 * Returns null when no ceiling is configured, so the caller drops the clause
 * rather than inventing a denominator.
 */
export function daysOfSending(pack: CreditPack, dailyCap: number | null | undefined): number | null {
  if (dailyCap == null || dailyCap <= 0) return null;
  return Math.max(1, Math.round(pack.credits / dailyCap));
}

/**
 * The pack sub-line. Prototype composition and order (dc.html:5140):
 * `$18 per 1,000 · about 48 days of sending`, with the days clause dropped —
 * not faked — when there is no ceiling to divide by.
 */
export function packSubLine(pack: CreditPack, dailyCap: number | null | undefined): string {
  const rate = `$${ratePer1000(pack)} per 1,000`;
  const days = daysOfSending(pack, dailyCap);
  return days == null ? rate : `${rate} · about ${days} days of sending`;
}
