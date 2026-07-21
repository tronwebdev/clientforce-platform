/**
 * P3.1 (DEC-078): the Twilio VOICE transport — transport ONLY, exactly like
 * TwilioSmsSender: the rails live in the `assertDialAllowed` boundary and the
 * call-session service, never here.
 *
 * `VOICE_SANDBOX` (default ON, the SMS_SANDBOX twin): in sandbox no network
 * call is made — a deterministic CallSid comes back so Call-row idempotency
 * and persistence behave identically to live mode. The from-number is the
 * platform `VOICE_FROM_NUMBER` env (KV `VOICE-FROM-NUMBER`) this unit —
 * per-tenant voice numbers are future work.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

/**
 * Media-stream access token for the DEPLOYED voice service (P3.1 deploy).
 * The service sits on a public FQDN; an ungated /twiml + /media would let
 * anyone run STT/LLM/TTS sessions on the platform's vendor keys. Both dial
 * sides already hold TWILIO_AUTH_TOKEN, so the gate derives a deterministic
 * token from it (no new secret; rotates with the credential): dialers append
 * `t=<token>` to the TwiML URL, the service refuses /twiml and /media
 * without it. No TWILIO_AUTH_TOKEN in the service env = gate off (local dev,
 * the cert harness, the runner rig).
 */
export function deriveVoiceMediaToken(twilioAuthToken: string): string {
  return createHmac("sha256", twilioAuthToken)
    .update("clientforce-voice-media")
    .digest("hex")
    .slice(0, 32);
}

/** Constant-time check; an unset expected token means the gate is off. */
export function voiceMediaTokenValid(
  expected: string | undefined,
  presented: string | null | undefined,
): boolean {
  if (!expected) return true;
  if (!presented || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

export interface PlaceCallParams {
  to: string;
  /** The HTTPS base of the voice service; Twilio fetches `${url}` for TwiML. */
  twimlUrl: string;
  /** Optional Twilio status-callback URL (call lifecycle → apps/api webhook). */
  statusCallbackUrl?: string;
}

export interface PlaceCallResult {
  providerCallSid: string;
  sandbox: boolean;
}

export interface VoiceDialer {
  placeCall(params: PlaceCallParams): Promise<PlaceCallResult>;
}

export class TwilioVoiceDialer implements VoiceDialer {
  constructor(
    private readonly accountSid = process.env.TWILIO_ACCOUNT_SID ?? "",
    private readonly authToken = process.env.TWILIO_AUTH_TOKEN ?? "",
    private readonly fromNumber = process.env.VOICE_FROM_NUMBER ?? "",
    private readonly sandbox = process.env.VOICE_SANDBOX !== "false",
  ) {}

  async placeCall(params: PlaceCallParams): Promise<PlaceCallResult> {
    if (this.sandbox) {
      // Deterministic sid so retries stay idempotent in tests/proofs.
      const hash = createHash("sha256")
        .update(`${params.to}:${params.twimlUrl}`)
        .digest("hex")
        .slice(0, 24);
      return { providerCallSid: `CA-sandbox-${hash}`, sandbox: true };
    }
    if (!this.accountSid || !this.authToken) {
      throw new Error("Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)");
    }
    if (!this.fromNumber) throw new Error("VOICE_FROM_NUMBER missing");
    const body = new URLSearchParams({
      To: params.to,
      From: this.fromNumber,
      Url: params.twimlUrl,
      Method: "POST",
    });
    if (params.statusCallbackUrl) {
      body.set("StatusCallback", params.statusCallbackUrl);
      body.set("StatusCallbackMethod", "POST");
      for (const ev of ["initiated", "ringing", "answered", "completed"]) {
        body.append("StatusCallbackEvent", ev);
      }
    }
    const res = await fetch(`${TWILIO_API}/Accounts/${this.accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio dial failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { sid: string };
    return { providerCallSid: data.sid, sandbox: false };
  }
}

/**
 * Map a Twilio call-status callback to the deterministic outcome set (D4).
 * Lifecycle statuses that aren't terminal return null — the Call row keeps
 * its current state.
 */
export function outcomeFromTwilioStatus(status: string): string | null {
  switch (status) {
    case "completed":
      return "completed";
    case "no-answer":
      return "no_answer";
    case "busy":
      return "busy";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return null;
  }
}
