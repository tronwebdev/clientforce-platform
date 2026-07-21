/**
 * P3.1 deploy (DEC-090) — the media URL carries the gate token in the PATH:
 * Twilio's <Stream> handshake is not guaranteed to preserve query strings
 * (the 2026-07-21 first deployed dial dropped at answer exactly that way).
 * Query form stays accepted for the rigs.
 */
import { describe, expect, it } from "vitest";
import { mediaStreamUrl, parseMediaRequest } from "../src/media-url";

describe("mediaStreamUrl", () => {
  it("path-form token when gated", () => {
    expect(mediaStreamUrl("h.example", "abc123")).toBe("wss://h.example/media/abc123");
  });

  it("bare /media when the gate is off", () => {
    expect(mediaStreamUrl("h.example", undefined)).toBe("wss://h.example/media");
  });
});

describe("parseMediaRequest", () => {
  it("extracts the path-segment token (the Twilio-safe form)", () => {
    expect(parseMediaRequest("/media/abc123")).toEqual({ isMedia: true, token: "abc123" });
  });

  it("falls back to the query token (rig/harness compat)", () => {
    expect(parseMediaRequest("/media?t=abc123")).toEqual({ isMedia: true, token: "abc123" });
  });

  it("bare /media = media with no token (valid only when the gate is off)", () => {
    expect(parseMediaRequest("/media")).toEqual({ isMedia: true, token: null });
  });

  it("refuses non-media paths and malformed segments", () => {
    expect(parseMediaRequest("/other").isMedia).toBe(false);
    expect(parseMediaRequest("/media/a/b")).toEqual({ isMedia: true, token: null });
    expect(parseMediaRequest("/media/")).toEqual({ isMedia: true, token: null });
    expect(parseMediaRequest("").isMedia).toBe(false);
  });
});
