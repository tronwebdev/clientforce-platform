/**
 * B3c-2 (DEC-118(1)): the browser-mic voice leg's ACCESS TOKEN — a Twilio
 * Voice JS SDK credential minted server-side, hand-rolled JWT (the repo's
 * zero-Twilio-SDK posture: raw REST + hand-rolled signatures, twilio-voice.ts
 * precedent). The token authorizes ONE browser Device to place calls through
 * the platform TwiML Application, whose Voice URL is the apps/api bridge
 * webhook — the server decides who gets dialed, never the browser.
 *
 * Config posture mirrors VOICE_SANDBOX: the three browser secrets
 * (`TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` / `TWILIO_TWIML_APP_SID`,
 * KV twins TWILIO-API-KEY-SID / TWILIO-API-KEY-SECRET / TWILIO-TWIML-APP-SID)
 * are OPTIONAL — absent means browser calling runs keyless sandbox: no real
 * Device registration, the same Call-row lifecycle, honestly labeled.
 */
import { createHmac } from "node:crypto";

export interface BrowserVoiceConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
}

/** The live config, or null ⇒ keyless sandbox (any piece missing). */
export function browserVoiceConfig(env: NodeJS.ProcessEnv = process.env): BrowserVoiceConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID ?? "";
  const apiKeySid = env.TWILIO_API_KEY_SID ?? "";
  const apiKeySecret = env.TWILIO_API_KEY_SECRET ?? "";
  const twimlAppSid = env.TWILIO_TWIML_APP_SID ?? "";
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) return null;
  return { accountSid, apiKeySid, apiKeySecret, twimlAppSid };
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export interface MintedVoiceToken {
  token: string;
  identity: string;
  expiresAt: string;
}

/**
 * Mint a Twilio AccessToken (HS256, `cty: twilio-fpa;v=1`) with a VoiceGrant
 * for outgoing calls through the TwiML App. `identity` binds the device to
 * the authenticated user + workspace — the bridge webhook re-resolves the
 * Call row server-side regardless, so the token never carries authority over
 * WHO gets dialed, only permission to open the media leg.
 */
export function mintVoiceAccessToken(
  cfg: BrowserVoiceConfig,
  identity: string,
  ttlSec = 3600,
  now: Date = new Date(),
): MintedVoiceToken {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSec;
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${cfg.apiKeySid}-${iat}`,
    iss: cfg.apiKeySid,
    sub: cfg.accountSid,
    iat,
    exp,
    grants: {
      identity,
      voice: {
        outgoing: { application_sid: cfg.twimlAppSid },
        incoming: { allow: false },
      },
    },
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(createHmac("sha256", cfg.apiKeySecret).update(signingInput).digest());
  return { token: `${signingInput}.${signature}`, identity, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Escape a string for embedding in TwiML text/attribute position. */
export function twimlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
