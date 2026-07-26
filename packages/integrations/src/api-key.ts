/**
 * INT W5 (DEC-101) — workspace API keys: mint, parse, verify.
 *
 * v1 auth for the Zapier private app (owner ruling: an API key, not OAuth).
 * The design rule is that a leak of the DATABASE must not yield working keys:
 *
 *  - the token is `cfk_<prefix>_<secret>`; only `prefix` is stored in the clear,
 *    purely as a lookup handle, and it is safe to display and to log;
 *  - `hash` is SHA-256 of the WHOLE token, compared in CONSTANT TIME. SHA-256 is
 *    the right primitive here (not bcrypt/argon): the secret is 256 bits of CSPRNG
 *    output, so there is no dictionary to slow down — the reason to stretch a
 *    password is low entropy, which does not apply;
 *  - the plaintext is returned EXACTLY ONCE, at mint. A lost key is re-minted,
 *    never recovered, so there is no path that can hand an attacker (or a
 *    support engineer) a working credential after the fact.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Recognisable, greppable, and unambiguous in a secret scanner. */
export const API_KEY_TOKEN_PREFIX = "cfk";
const PREFIX_BYTES = 6; // 12 hex chars — collision-safe as a lookup handle
const SECRET_BYTES = 32; // 256 bits

export interface MintedApiKey {
  /** Show ONCE, store never. */
  token: string;
  prefix: string;
  hash: string;
}

export const hashApiKey = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/** Mint a new token. The caller persists `prefix` + `hash` and shows `token` once. */
export function mintApiKey(): MintedApiKey {
  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const token = `${API_KEY_TOKEN_PREFIX}_${prefix}_${secret}`;
  return { token, prefix, hash: hashApiKey(token) };
}

/**
 * Pull the lookup half out of a presented token. Returns null for anything
 * malformed, so the caller answers a garbage token the same way it answers a
 * wrong one — never a distinguishable error.
 */
export function parseApiKeyPrefix(token: string | undefined | null): string | null {
  if (!token) return null;
  // Matched as a whole, NOT split on "_": the secret is base64url, whose
  // alphabet includes "_", so a naive three-way split rejects perfectly valid
  // tokens roughly half the time. Anchored so trailing junk cannot ride along.
  const m = /^cfk_([0-9a-f]{12})_([A-Za-z0-9_-]{20,})$/.exec(token);
  return m ? m[1]! : null;
}

/**
 * Constant-time verification. Length is compared first because
 * `timingSafeEqual` throws on a length mismatch — and both branches return the
 * same boolean, so a caller cannot learn anything from how the check failed.
 */
export function verifyApiKey(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashApiKey(token), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

/** Display form for a key the user can no longer read in full. */
export const maskApiKey = (prefix: string): string => `${API_KEY_TOKEN_PREFIX}_${prefix}_…`;
