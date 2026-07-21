/**
 * P3.1 deploy (DEC-090) — the deployed voice service's /twiml + /media access
 * gate. The token derives deterministically from the shared Twilio credential
 * so BOTH dial sides (the api's product path, the demo rig's place-call)
 * compute the value the service expects, with no new secret to provision.
 */
import { describe, expect, it } from "vitest";
import { deriveVoiceMediaToken, voiceMediaTokenValid } from "../src/twilio-voice";

describe("deriveVoiceMediaToken", () => {
  it("is deterministic for the same credential", () => {
    expect(deriveVoiceMediaToken("tok-a")).toBe(deriveVoiceMediaToken("tok-a"));
  });

  it("rotates with the credential", () => {
    expect(deriveVoiceMediaToken("tok-a")).not.toBe(deriveVoiceMediaToken("tok-b"));
  });

  it("is URL-safe hex, 32 chars", () => {
    expect(deriveVoiceMediaToken("tok-a")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("voiceMediaTokenValid", () => {
  const expected = deriveVoiceMediaToken("tok-a");

  it("accepts the derived token", () => {
    expect(voiceMediaTokenValid(expected, expected)).toBe(true);
  });

  it("refuses a missing or wrong token when the gate is on", () => {
    expect(voiceMediaTokenValid(expected, null)).toBe(false);
    expect(voiceMediaTokenValid(expected, "")).toBe(false);
    expect(voiceMediaTokenValid(expected, deriveVoiceMediaToken("tok-b"))).toBe(false);
    expect(voiceMediaTokenValid(expected, expected.slice(0, 31))).toBe(false);
  });

  it("gate off (no expected token) accepts anything — local dev / cert harness", () => {
    expect(voiceMediaTokenValid(undefined, null)).toBe(true);
    expect(voiceMediaTokenValid(undefined, "whatever")).toBe(true);
  });
});
