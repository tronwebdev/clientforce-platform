/**
 * B3d (DEC-120 expansion 1): the deterministic affirmative set. The whole
 * point is what does NOT flip: ambiguous, qualified, negated, and long
 * replies are never yes — they fall through to normal classification.
 */
import { describe, expect, it } from "vitest";
import { isAffirmativeConsentReply } from "../src/consent-reply";

describe("isAffirmativeConsentReply", () => {
  it("plain affirmatives flip", () => {
    for (const t of [
      "yes",
      "Yes",
      "YES",
      "yes!",
      "Yep",
      "sure",
      "ok",
      "Okay.",
      "sounds good",
      "go ahead",
      "Yes please",
      "of course",
      "y",
    ]) {
      expect(isAffirmativeConsentReply(t), t).toBe(true);
    }
  });

  it("a leading yes with a harmless tail still reads yes", () => {
    expect(isAffirmativeConsentReply("Yes, that works")).toBe(true);
    expect(isAffirmativeConsentReply("Sure - Sam")).toBe(true);
  });

  it("ambiguous is NEVER yes", () => {
    for (const t of [
      "maybe",
      "who is this?",
      "what would the call be about?",
      "call my office instead",
      "I guess",
      "possibly next week",
      "",
      "   ",
    ]) {
      expect(isAffirmativeConsentReply(t), t).toBe(false);
    }
  });

  it("negation and qualifiers never flip — even after a yes-word", () => {
    for (const t of [
      "no",
      "no thanks",
      "yes but not this week",
      "sure, unless it's about billing",
      "ok stop contacting me",
      "yes don't call after 5",
    ]) {
      expect(isAffirmativeConsentReply(t), t).toBe(false);
    }
  });

  it("long replies never flip — qualifiers we must not guess about", () => {
    expect(
      isAffirmativeConsentReply(
        "yes I think that would probably be fine as long as it is after my shift ends",
      ),
    ).toBe(false);
  });
});
