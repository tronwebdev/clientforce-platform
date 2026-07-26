/**
 * Spoken-form relative dates (SPEC A, DEC-099).
 *
 * Every fetched fact carries a "when", and the model SPEAKS it. An ISO date is
 * the wrong currency for that: the brain has no dependable notion of today, so
 * `2026-07-12` either gets recited digit by digit or silently mistranslated
 * into "last week". Resolving the arithmetic here — against a `now` the caller
 * passes in — keeps the phrasing correct and the function pure/testable.
 */

const DAY_MS = 86_400_000;

/**
 * Coarse on purpose. "About 2 months ago" is what a person says and is robust
 * to the row being a day off; "63 days ago" is both unnatural and falsely
 * precise about a timestamp the agent has no reason to vouch for.
 */
export function spokenWhen(at: Date, now: Date): string {
  const days = Math.floor((now.getTime() - at.getTime()) / DAY_MS);
  if (days < 0) return "scheduled ahead";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `about ${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `about ${Math.round(days / 30)} months ago`;
  const years = Math.round(days / 365);
  return years <= 1 ? "about a year ago" : `about ${years} years ago`;
}
