/**
 * Pinned reply→intent fixtures (M1b, DEC-068) — one verbatim reply per label
 * the v2 classifier may emit. These are a CONTRACT artifact, not test-local
 * data: the CI integration suite drives its deterministic fake with them, and
 * the live proof asserts the REAL model classifies each one to its pin — the
 * same fixture proves both the plumbing and the model.
 *
 * Append-only: editing a pinned reply text or its label is a taxonomy change
 * and needs an owner-signed DEC (the plan-comment rule that added them).
 */
import type { Intent } from "@clientforce/events";

export interface ReplyIntentFixture {
  intent: Intent;
  reply: string;
}

export const REPLY_INTENT_FIXTURES: readonly ReplyIntentFixture[] = [
  {
    intent: "interested",
    reply: "This sounds interesting — how do we book a call this week?",
  },
  {
    intent: "objection_price",
    reply:
      "Thanks, but this looks too expensive for us — there's no budget for something like this right now.",
  },
  {
    intent: "objection_timing",
    reply:
      "Can you get back to me in March? We're mid-renovation until then and can't take on anything new.",
  },
  {
    intent: "wrong_person",
    reply:
      "I'm not the right person for this — I don't handle purchasing. You'd want our operations manager.",
  },
  {
    intent: "info_request",
    reply:
      "Before we go any further — does this integrate with our existing booking system, and what does onboarding look like?",
  },
  {
    intent: "not_interested",
    reply: "Thanks, but we're not interested. We're happy with our current setup.",
  },
  {
    intent: "replied",
    reply: "Thanks, noted.",
  },
  {
    intent: "ooo",
    reply:
      "I'm away until the 28th with limited access to email. For urgent matters please contact reception.",
  },
  {
    intent: "unsubscribe",
    reply: "Remove me from your list and stop emailing me.",
  },
] as const;

/** The pinned fixture for one intent (throws on a label without a pin). */
export function fixtureFor(intent: Intent): ReplyIntentFixture {
  const hit = REPLY_INTENT_FIXTURES.find((f) => f.intent === intent);
  if (!hit) throw new Error(`No pinned reply fixture for intent "${intent}"`);
  return hit;
}

/**
 * L1 (DEC-072): pinned MULTILINGUAL replies — proof the understanding side of
 * the loop is language-agnostic with ZERO classifier code change: a German
 * and a French inbound reply classify to the right intent and branch/stage
 * exactly like their English siblings. A SEPARATE constant on purpose — the
 * M1b matrix above pins exactly one reply per emission label (length-pinned
 * in the classify suite), so these append beside it, not into it.
 *
 * Same contract discipline: the CI integration suites drive the deterministic
 * fake with them, and the live proof asserts the REAL model classifies each
 * one to its pin. Append-only — editing a pinned reply or label needs an
 * owner-signed DEC.
 */
export interface MultilingualReplyFixture extends ReplyIntentFixture {
  /** Launch-language code the reply is written in (display/log only). */
  language: "de" | "fr";
}

export const MULTILINGUAL_REPLY_FIXTURES: readonly MultilingualReplyFixture[] = [
  {
    language: "de",
    intent: "interested",
    reply:
      "Das klingt spannend — wie können wir diese Woche einen Termin vereinbaren?",
  },
  {
    language: "fr",
    intent: "objection_price",
    reply:
      "Merci, mais c'est trop cher pour nous — nous n'avons pas de budget pour ce genre de solution en ce moment.",
  },
] as const;
