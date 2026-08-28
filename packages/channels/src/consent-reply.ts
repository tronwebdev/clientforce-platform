/**
 * B3d (DEC-120 expansion 1): the DETERMINISTIC affirmative check for Ada's
 * may-we-call ask. Mirrors the SMS STOP-word rail (sms-inbound.ts): a plain,
 * conservative word set checked BEFORE the LLM classifier ever runs — an
 * affirmative reply on a consent-ask thread flips `Contact.callConsent` to
 * granted with the message itself as provenance. Ambiguous is NEVER yes:
 * anything outside the set falls through to normal classification and flips
 * nothing. (An explicit deterministic "no" also flips nothing — DEC-120 rules
 * only the affirmative; a denial stays a staff/CSV decision.)
 */

const AFFIRMATIVE = new Set([
  "yes",
  "yep",
  "yeah",
  "sure",
  "ok",
  "okay",
  "fine",
  "of course",
  "absolutely",
  "sounds good",
  "go ahead",
  "please do",
  "yes please",
  "that's fine",
  "thats fine",
  "yes you can",
  "you can",
  "feel free",
  "sure thing",
  "y",
]);

/** Longest phrase in the set — anything longer carries qualifiers we must
 *  not guess about ("yes but only after 5" is not a plain yes). */
const MAX_AFFIRMATIVE_CHARS = 40;

export function isAffirmativeConsentReply(body: string): boolean {
  const normalized = body
    .trim()
    .toLowerCase()
    .replace(/[!.,🙂👍]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > MAX_AFFIRMATIVE_CHARS) return false;
  if (AFFIRMATIVE.has(normalized)) return true;
  // "yes -Sam" / "yes, that works": a leading bare yes-word followed by a
  // signature or pleasantry still reads as a plain yes when the REMAINDER
  // carries no negation.
  const lead = normalized.split(/[,\-—:;]/)[0]!.trim();
  if (!AFFIRMATIVE.has(lead)) return false;
  return !/\b(no|not|don't|dont|stop|never|unless|but)\b/.test(normalized);
}
