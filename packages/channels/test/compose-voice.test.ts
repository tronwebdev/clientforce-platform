/**
 * P3.1 (DEC-078) voice composer unit tests — pure, no infra. The per-turn
 * checks are string operations proven one by one (G1 discipline); the system
 * prompt carries the brief + register rules + the resolved identity, and the
 * brief derivation is deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  buildVoiceSystemPrompt,
  checkComposedVoiceTurn,
  COMPOSER_VOICE_VERSION,
  deriveCallBrief,
  mustSayCoverage,
  VOICE_TURN_MAX_CHARS,
  type ComposeVoiceInputs,
} from "../src/compose-voice";

const inputs = (over: Partial<ComposeVoiceInputs> = {}): ComposeVoiceInputs => ({
  brief: {
    objective: "Gauge interest in a product demo and offer to book a follow-up",
    talkingPoints: [
      "we manage sender health end to end",
      "setup takes under a day",
      "over two hundred practices use it",
    ],
    mustSay: ["free growth audit"],
    neverSay: ["limited time"],
  },
  cachedContext:
    "BUSINESS CONTEXT:\n- offer: We book dental appointments with a free growth audit.",
  neverSay: ["rock-bottom prices", "limited time"],
  lead: { firstName: "Jane", lastName: "Doe", company: "Acme Dental" },
  businessName: "Acme Dental",
  spokenName: "Ava",
  ...over,
});

describe("checkComposedVoiceTurn (deterministic — every check is a string operation)", () => {
  it("passes clean spoken copy", () => {
    expect(
      checkComposedVoiceTurn("That makes sense. What's the biggest headache day to day?", inputs()),
    ).toEqual([]);
  });

  it("names banned phrases from BOTH lists, any casing", () => {
    const v = checkComposedVoiceTurn("It's a LIMITED TIME offer with rock-bottom prices.", inputs());
    const hit = v.find((x) => x.reason === "NEVER_SAY_VIOLATION");
    expect(hit).toBeDefined();
    expect(hit!.detail).toContain('"limited time"');
    expect(hit!.detail).toContain('"rock-bottom prices"');
  });

  it("rejects merge-token syntax — spoken text is finished speech", () => {
    const v = checkComposedVoiceTurn("Thanks {{firstName}}, great to chat.", inputs());
    expect(v.map((x) => x.reason)).toContain("TOKEN_SYNTAX");
  });

  it("SPOKEN_REGISTER: a URL is never read aloud — grounded or not", () => {
    const v = checkComposedVoiceTurn("You can book at https://clientforce.io/audit today.", inputs());
    const hit = v.find((x) => x.reason === "SPOKEN_REGISTER");
    expect(hit).toBeDefined();
    expect(hit!.detail).toContain("https://clientforce.io/audit");
  });

  it("SPOKEN_REGISTER: markdown, list formatting, and emoji never reach TTS", () => {
    expect(
      checkComposedVoiceTurn("Here's why:\n- speed\n- price", inputs()).map((x) => x.reason),
    ).toContain("SPOKEN_REGISTER");
    expect(
      checkComposedVoiceTurn("This is **really** important.", inputs()).map((x) => x.reason),
    ).toContain("SPOKEN_REGISTER");
    expect(
      checkComposedVoiceTurn("Sounds great 🎉 let's do it.", inputs()).map((x) => x.reason),
    ).toContain("SPOKEN_REGISTER");
  });

  it(`enforces the ${VOICE_TURN_MAX_CHARS}-char spoken-turn backstop`, () => {
    const v = checkComposedVoiceTurn(`well ${"x".repeat(VOICE_TURN_MAX_CHARS)}`, inputs());
    expect(v.map((x) => x.reason)).toContain("TOO_LONG");
  });
});

describe("mustSayCoverage (call-level, never a mid-call refusal)", () => {
  it("finds required strings across the whole call, case-insensitive", () => {
    const { said, missing } = mustSayCoverage(
      ["Happy to explain.", "We include a FREE GROWTH AUDIT with setup."],
      { mustSay: ["free growth audit"] },
    );
    expect(said).toEqual(["free growth audit"]);
    expect(missing).toEqual([]);
  });

  it("reports what was never said", () => {
    const { said, missing } = mustSayCoverage(["Short call."], {
      mustSay: ["free growth audit", "no obligation"],
    });
    expect(said).toEqual([]);
    expect(missing).toEqual(["free growth audit", "no obligation"]);
  });
});

describe("buildVoiceSystemPrompt (composer.voice@v1)", () => {
  it("carries the register rules, the brief, the context, and the NAMED identity", () => {
    const sys = buildVoiceSystemPrompt(inputs());
    expect(sys).toContain("LIVE PHONE CALL");
    expect(sys).toContain("Your name on this call is Ava.");
    expect(sys).toContain("on behalf of Acme Dental");
    expect(sys).toContain("Gauge interest in a product demo");
    expect(sys).toContain("we manage sender health end to end");
    expect(sys).toContain('"free growth audit"');
    expect(sys).toContain('"rock-bottom prices"');
    expect(sys).toContain("BUSINESS CONTEXT");
    expect(sys).toContain("ALREADY been spoken");
  });

  it("the DEFAULT identity has no personal name — and never invents one", () => {
    const sys = buildVoiceSystemPrompt(inputs({ spokenName: null }));
    expect(sys).toContain("You have no personal name on this call");
    expect(sys).not.toContain("Your name on this call");
  });

  it("stamps composer.voice@v1", () => {
    expect(COMPOSER_VOICE_VERSION).toBe("composer.voice@v1");
  });
});

describe("deriveCallBrief (deterministic — same agent state, same brief)", () => {
  it("builds objective from the goal label and talking points from context facts", () => {
    const brief = deriveCallBrief({
      goal: "book_appointments",
      goalLabel: "Book appointments",
      contextFacts: [
        "We book dental appointments with a free growth audit",
        "Setup takes under a day",
        "Over two hundred practices trust the product",
        "short", // dropped: under 10 chars
      ],
      neverSay: ["limited time"],
    });
    expect(brief.objective).toBe("Book appointments");
    expect(brief.talkingPoints).toHaveLength(3);
    expect(brief.neverSay).toEqual(["limited time"]);
  });

  it("pads thin context to the zod minimum with honest generics — never invented facts", () => {
    const brief = deriveCallBrief({ goal: "generate_leads", contextFacts: [] });
    expect(brief.talkingPoints.length).toBeGreaterThanOrEqual(3);
    expect(brief.talkingPoints[0]).toContain("Ask what the caller is working on");
  });

  it("dedupes and truncates overlong facts", () => {
    const long = `a fact ${"y".repeat(300)}`;
    const brief = deriveCallBrief({
      goal: "g",
      goalLabel: "Goal",
      contextFacts: [long, long, "another usable fact here"],
    });
    expect(brief.talkingPoints[0]!.length).toBeLessThanOrEqual(200);
    expect(new Set(brief.talkingPoints).size).toBe(brief.talkingPoints.length);
  });
});
