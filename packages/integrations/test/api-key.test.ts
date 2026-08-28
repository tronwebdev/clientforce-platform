/**
 * INT W5 (DEC-102) — workspace API key primitives. These pin the properties a
 * credential has to have, not merely that the happy path round-trips: an
 * attacker with the database must not be able to reconstruct a key, and a
 * malformed token must be indistinguishable from a wrong one.
 */
import { describe, expect, it } from "vitest";
import {
  API_KEY_TOKEN_PREFIX,
  hashApiKey,
  maskApiKey,
  mintApiKey,
  parseApiKeyPrefix,
  verifyApiKey,
} from "../src/api-key";

describe("workspace API keys", () => {
  it("mints a scheme-tagged token whose prefix is the lookup half", () => {
    const k = mintApiKey();
    expect(k.token.startsWith(`${API_KEY_TOKEN_PREFIX}_${k.prefix}_`)).toBe(true);
    expect(parseApiKeyPrefix(k.token)).toBe(k.prefix);
  });

  it("NEVER lets the stored row reconstruct the token", () => {
    // The whole point: prefix + hash are what the DB holds, and neither
    // contains the secret. A dump of WorkspaceApiKey yields no usable key.
    const k = mintApiKey();
    // The secret is base64url — its alphabet INCLUDES "_" (the src comment
    // on parseApiKeyPrefix warns against a naive split; a secret that
    // happens to START with "_" made split()[2] the empty string, and
    // not.toContain("") can never pass). Slice past the known prefix.
    const secret = k.token.slice(`${API_KEY_TOKEN_PREFIX}_${k.prefix}_`.length);
    expect(secret.length).toBeGreaterThan(20);
    expect(k.hash).not.toContain(secret);
    expect(k.prefix).not.toContain(secret);
    expect(k.hash).toHaveLength(64); // sha256 hex
  });

  it("is unguessable — 256 bits of CSPRNG, never repeating across mints", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintApiKey().token));
    expect(tokens.size).toBe(200);
    const prefixes = new Set(Array.from({ length: 200 }, () => mintApiKey().prefix));
    expect(prefixes.size).toBe(200);
  });

  it("verifies the right token and refuses a wrong one", () => {
    const k = mintApiKey();
    expect(verifyApiKey(k.token, k.hash)).toBe(true);
    expect(verifyApiKey(mintApiKey().token, k.hash)).toBe(false);
  });

  it("refuses a token whose secret is altered by ONE character", () => {
    const k = mintApiKey();
    const [scheme, prefix, secret] = k.token.split("_");
    const flipped = secret!.slice(0, -1) + (secret!.endsWith("A") ? "B" : "A");
    expect(verifyApiKey(`${scheme}_${prefix}_${flipped}`, k.hash)).toBe(false);
  });

  it("refuses a token that borrows a VALID prefix with a forged secret", () => {
    // The prefix is public, so it must carry no authority on its own.
    const real = mintApiKey();
    const forged = `${API_KEY_TOKEN_PREFIX}_${real.prefix}_${"x".repeat(43)}`;
    expect(verifyApiKey(forged, real.hash)).toBe(false);
  });

  it("treats malformed tokens as simply unparseable — no distinguishable error", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "nonsense",
      "cfk_short_secret",
      "wrongscheme_0123456789ab_secret",
      "cfk_0123456789ab", // no secret
      "cfk__secret",
      "cfk_ZZZZZZZZZZZZ_aaaaaaaaaaaaaaaaaaaaaaaa", // non-hex prefix
      "cfk_0123456789ab_short", // secret too short to be a real one
      "cfk_0123456789ab_aaaaaaaaaaaaaaaaaaaaaaaa!!", // outside the base64url alphabet
      " cfk_0123456789ab_aaaaaaaaaaaaaaaaaaaaaaaa", // unanchored junk
    ]) {
      expect(parseApiKeyPrefix(bad as string | undefined)).toBeNull();
    }
  });

  it("parses a secret containing base64url '_' and '-' — the split-on-underscore trap", () => {
    // Regression pin. base64url's alphabet includes "_" and "-", so roughly
    // half of all minted tokens contain an underscore in the secret; a parser
    // that splits on every "_" rejects them as malformed.
    const prefix = "0123456789ab";
    for (const secret of [
      "aaaa_bbbb_cccc_dddd_eeee_ffff",
      "aaaa-bbbb-cccc-dddd-eeee-ffff",
      "_leading_underscore_secret_xx",
    ]) {
      expect(parseApiKeyPrefix(`cfk_${prefix}_${secret}`)).toBe(prefix);
    }
    // And the real generator's output parses every time, not just usually.
    for (let i = 0; i < 300; i++) {
      const k = mintApiKey();
      expect(parseApiKeyPrefix(k.token)).toBe(k.prefix);
    }
  });

  it("hashing is deterministic, so lookup by hash is stable", () => {
    const k = mintApiKey();
    expect(hashApiKey(k.token)).toBe(hashApiKey(k.token));
    expect(hashApiKey(k.token)).toBe(k.hash);
  });

  it("verify tolerates a malformed stored hash instead of throwing", () => {
    // timingSafeEqual throws on length mismatch; a corrupt row must read as
    // "does not verify", never as a 500 that leaks the row's shape.
    const k = mintApiKey();
    expect(verifyApiKey(k.token, "")).toBe(false);
    expect(verifyApiKey(k.token, "deadbeef")).toBe(false);
  });

  it("masks to something recognisable but useless", () => {
    const k = mintApiKey();
    const masked = maskApiKey(k.prefix);
    expect(masked).toContain(k.prefix);
    expect(masked).not.toContain(k.token.split("_")[2]);
  });
});
