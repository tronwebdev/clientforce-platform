/**
 * Place ONE outbound call for the demo-call rig (P3.1) — through the
 * PRODUCTION dialer transport (`TwilioVoiceDialer`, VOICE_SANDBOX=false on
 * the runner) to the owner's test number. On answer, Twilio fetches TwiML
 * from `${PUBLIC_URL}/twiml`, which bridges to this service's /media socket.
 * Product dials go through the api's rails; this CLI exists for the CI rig
 * where the full api isn't running. Numbers are never printed.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VOICE_FROM_NUMBER, TWILIO_TO,
 *      PUBLIC_URL. Recording stays OFF (the owner-locked default) — the
 *      transcript is the record.
 */
import { deriveVoiceMediaToken, TwilioVoiceDialer } from "@clientforce/channels";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main(): Promise<void> {
  const to = requireEnv("TWILIO_TO");
  const publicUrl = requireEnv("PUBLIC_URL").replace(/\/$/, "");
  // Deployed-service gate + per-call demo variant (P3.1 deploy) — both ride
  // the TwiML URL; the token derives from the same credential the dial uses.
  const qs = new URLSearchParams();
  if (process.env.TWILIO_AUTH_TOKEN) {
    qs.set("t", deriveVoiceMediaToken(process.env.TWILIO_AUTH_TOKEN));
  }
  if (process.env.DEMO_VARIANT) qs.set("demoVariant", process.env.DEMO_VARIANT);
  const query = qs.size > 0 ? `?${qs.toString()}` : "";
  const dialer = new TwilioVoiceDialer();
  const result = await dialer.placeCall({
    to,
    twimlUrl: `${publicUrl}/twiml${query}`,
    // DEC-092 loopback diagnostic only (owner-consented recording).
    ...(process.env.RECORD_CALL === "1" ? { record: true } : {}),
  });
  console.log(`[place-call] callSid=${result.providerCallSid} sandbox=${result.sandbox}`);
}

void main().catch((err) => {
  console.error("[place-call] failed:", (err as Error).message);
  process.exitCode = 1;
});
