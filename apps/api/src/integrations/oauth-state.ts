/**
 * Signed OAuth state (INT W1, DEC-093). Stateless HMAC-SHA256 over
 * {workspaceId, provider, nonce, exp} under AUTH_DEV_SECRET (present in every
 * environment — the preflight-required Key Vault secret AUTH-DEV-SECRET), so
 * a callback can prove the flow started HERE, for THIS workspace, recently.
 * 10-minute expiry; constant-time comparison.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  w: string; // workspaceId
  p: string; // provider
  n: string; // nonce
  exp: number;
}

function secret(): string {
  const value = process.env.AUTH_DEV_SECRET;
  if (!value) throw new Error("AUTH_DEV_SECRET is required — it resolves from Key Vault secret AUTH-DEV-SECRET");
  return value;
}

const sign = (data: string): string =>
  createHmac("sha256", secret()).update(data).digest("base64url");

export function mintOAuthState(workspaceId: string, provider: string, now = Date.now()): string {
  const payload: StatePayload = {
    w: workspaceId,
    p: provider,
    n: randomBytes(12).toString("base64url"),
    exp: now + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Returns the payload when valid for this workspace+provider, else null. */
export function verifyOAuthState(
  state: string,
  expect: { workspaceId: string; provider: string },
  now = Date.now(),
): StatePayload | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = sign(body);
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (macBuf.length !== expectedBuf.length || !timingSafeEqual(macBuf, expectedBuf)) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
  if (payload.w !== expect.workspaceId || payload.p !== expect.provider) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload;
}
