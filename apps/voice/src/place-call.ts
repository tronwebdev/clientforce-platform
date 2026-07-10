/**
 * Place ONE outbound call via the Twilio REST API for the demo-call mode. On
 * answer, Twilio fetches TwiML from `${PUBLIC_URL}/twiml`, which returns a
 * <Connect><Stream> that bridges the call to this app's /media WebSocket.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (a Voice-capable
 *      number), TWILIO_TO (owner test number), PUBLIC_URL (https base of the
 *      tunnel). Numbers are never printed.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main(): Promise<void> {
  const sid = requireEnv("TWILIO_ACCOUNT_SID");
  const token = requireEnv("TWILIO_AUTH_TOKEN");
  const from = requireEnv("TWILIO_FROM");
  const to = requireEnv("TWILIO_TO");
  const publicUrl = requireEnv("PUBLIC_URL").replace(/\/$/, "");

  const body = new URLSearchParams({
    To: to,
    From: from,
    Url: `${publicUrl}/twiml`,
    Method: "POST",
    Record: "true",
    RecordingChannels: "dual",
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as { sid?: string; status?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio call failed: ${res.status} ${json.message ?? ""}`);
  console.log(`[place-call] callSid=${json.sid} status=${json.status} (recording enabled)`);
}

void main().catch((err) => {
  console.error("[place-call] failed:", (err as Error).message);
  process.exitCode = 1;
});
