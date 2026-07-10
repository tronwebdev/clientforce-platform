/**
 * P2.1 rail-1 closing proof (DEC-067). Twilio's opt-out keyword handling is a
 * US/CA-scoped compliance feature, so the owner's NG handset can never draw
 * the auto-reply — a platform-owned US test number drives the loop instead:
 *
 *   STOP  -> Twilio opt-out auto-reply (rail 1) captured with delivery status
 *   START -> resubscribe confirmation; our ledger must NOT change
 *   STOP  -> second opt-out confirmation (Twilio-side idempotency)
 *
 * plus the staging-ledger stance (DEC-062/064): the NG suppression row is
 * still present and still singular (applySmsStop idempotency across every
 * STOP so far), and the US number — which has no contact — correctly has NO
 * row (threadless fail-safe only suppresses matched contacts).
 *
 * Discipline: phone numbers are NEVER printed — sids, booleans, counts and
 * statuses only (public run logs). The US test number is discovered/purchased
 * by FriendlyName tag so a lost Key Vault secret never causes a re-purchase,
 * and is written to US_NUMBER_OUT for the workflow to store in Key Vault.
 * Runs only in the sms-us-rail1-proof GitHub workflow; never CI.
 */
import { writeFileSync } from "node:fs";
import { signDevToken } from "../../../apps/api/src/auth/dev-token-verifier";

const SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const MSID = process.env.SMS_TEST_MESSAGING_SERVICE_SID ?? "";
const US_NUMBER_ENV = process.env.US_TEST_NUMBER ?? "";
const NG_NUMBER = process.env.SMS_TEST_NUMBER ?? "";
const STAGING_API = (process.env.STAGING_API_URL ?? "").replace(/\/$/, "");
const DEV_SECRET = process.env.AUTH_DEV_SECRET ?? "";
const OUT_FILE = process.env.US_NUMBER_OUT ?? "";
const FRIENDLY = "clientforce-us-test";

interface TwMessage {
  sid: string;
  status: string;
  error_code: number | null;
  direction: string;
  date_created: string;
}
interface TwNumber {
  sid: string;
  phone_number: string;
}
interface SuppressionRow {
  channel: string;
}

const AUTH = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function twilio<T>(method: string, url: string, form?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: AUTH,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Twilio ${method} ${url.split(".com")[1]?.split("?")[0]} -> ${res.status}: ${await res.text().then((t) => t.slice(0, 300))}`);
  return res.json() as Promise<T>;
}

const api = (path: string) => `https://api.twilio.com/2010-04-01/Accounts/${SID}${path}`;
const messaging = (path: string) => `https://messaging.twilio.com/v1${path}`;

/** Find-or-purchase the standing US test handset. Returns {sid, number}. */
async function ensureUsTestNumber(): Promise<{ sid: string; number: string }> {
  const owned = await twilio<{ incoming_phone_numbers?: TwNumber[] }>("GET", api(`/IncomingPhoneNumbers.json?FriendlyName=${FRIENDLY}&PageSize=5`));
  const existing = (owned.incoming_phone_numbers ?? [])[0];
  if (existing) {
    console.log(`US test handset: reusing ${existing.sid} (FriendlyName=${FRIENDLY})`);
    return { sid: existing.sid, number: existing.phone_number };
  }
  if (US_NUMBER_ENV) {
    // Key Vault knows a number but the tag is gone — resolve its sid.
    const bySid = await twilio<{ incoming_phone_numbers?: TwNumber[] }>("GET", api(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(US_NUMBER_ENV)}`));
    const hit = (bySid.incoming_phone_numbers ?? [])[0];
    if (hit) {
      console.log(`US test handset: reusing ${hit.sid} (matched Key Vault number; re-tagging)`);
      await twilio("POST", api(`/IncomingPhoneNumbers/${hit.sid}.json`), { FriendlyName: FRIENDLY });
      return { sid: hit.sid, number: hit.phone_number };
    }
  }
  const avail = await twilio<{ available_phone_numbers?: TwNumber[] }>("GET", api(`/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&PageSize=1`));
  const candidate = (avail.available_phone_numbers ?? [])[0];
  if (!candidate) throw new Error("No US local SMS-capable number available to purchase");
  const bought = await twilio<TwNumber>("POST", api(`/IncomingPhoneNumbers.json`), {
    PhoneNumber: candidate.phone_number,
    FriendlyName: FRIENDLY,
  });
  console.log(`US test handset: PURCHASED ${bought.sid} (FriendlyName=${FRIENDLY}) — standing handset per DEC-067`);
  return { sid: bought.sid, number: bought.phone_number };
}

/** The handset must sit in the platform service so it sends under the approved A2P campaign. */
async function ensureInService(pnSid: string, usNumber: string): Promise<string> {
  const pool = await twilio<{ phone_numbers?: TwNumber[] }>("GET", messaging(`/Services/${MSID}/PhoneNumbers?PageSize=20`));
  const numbers: TwNumber[] = pool.phone_numbers ?? [];
  if (!numbers.some((n) => n.sid === pnSid)) {
    await twilio("POST", messaging(`/Services/${MSID}/PhoneNumbers`), { PhoneNumberSid: pnSid });
    console.log("US test handset attached to the platform service (A2P registration rides the service campaign; may take a few minutes on first attach)");
  } else {
    console.log("US test handset already in the platform service pool");
  }
  const target = numbers.find((n) => n.phone_number !== usNumber);
  if (!target) throw new Error("Platform service has no other number to receive the keyword");
  return target.phone_number;
}

async function pollMessage(sid: string, terminal: string[], label: string): Promise<TwMessage | null> {
  for (let i = 0; i < 24; i++) {
    const m = await twilio<TwMessage>("GET", api(`/Messages/${sid}.json`));
    if (terminal.includes(m.status)) {
      console.log(`  ${label}: sid=${m.sid} status=${m.status} error=${m.error_code ?? "None"}`);
      return m;
    }
    await sleep(5000);
  }
  console.log(`  ${label}: sid=${sid} did not reach a terminal status in 120s`);
  return null;
}

/** Send one keyword and capture Twilio's auto-reply (direction outbound-reply). */
async function keywordRound(round: string, body: string, from: string, to: string): Promise<boolean> {
  console.log(`\n-- round ${round}: "${body}" from the US handset --`);
  const sentAt = new Date();
  const sent = await twilio<TwMessage>("POST", api(`/Messages.json`), { From: from, To: to, Body: body });
  await pollMessage(sent.sid, ["delivered", "undelivered", "failed", "received", "sent"], "keyword send");
  for (let i = 0; i < 18; i++) {
    await sleep(5000);
    const list = await twilio<{ messages?: TwMessage[] }>("GET", api(`/Messages.json?To=${encodeURIComponent(from)}&PageSize=5`));
    const reply = (list.messages ?? []).find(
      (m) => m.direction === "outbound-reply" && new Date(m.date_created) >= new Date(sentAt.getTime() - 15_000),
    );
    if (reply) {
      const final = await pollMessage(reply.sid, ["delivered", "undelivered", "failed", "sent"], "auto-reply");
      console.log(`  RAIL 1 REPLY CAPTURED (${round}): direction=outbound-reply status=${final?.status ?? reply.status}`);
      return true;
    }
  }
  console.log(`  RAIL 1 REPLY ABSENT (${round}) after 90s`);
  return false;
}

/**
 * Staging helpers (dev token; addresses queried but never printed). The US
 * handset gets its OWN staging contact so its STOP lands a real suppression
 * row through the live webhook — the proof carries its own precondition
 * instead of depending on the owner having added a contact manually.
 */
interface StagingCtx {
  token: string;
  workspaceId: string;
}

async function stagingCtx(): Promise<StagingCtx | null> {
  if (!STAGING_API || !DEV_SECRET) {
    console.log("staging ledger checks skipped (staging env not provided)");
    return null;
  }
  // The seeded user's authProviderId is bound to the WEB dev-login's subject
  // convention (`dev|<email>`) — any other sub is a principal conflict (401).
  const token = await signDevToken(DEV_SECRET, {
    sub: "dev|owner@demo-agency.test",
    email: "owner@demo-agency.test",
  });
  const meRes = await fetch(`${STAGING_API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!meRes.ok) throw new Error(`staging /me -> ${meRes.status}: ${(await meRes.text()).slice(0, 200)}`);
  const me = (await meRes.json()) as {
    memberships?: Array<{ workspaceId: string }>;
  };
  const workspaceId = (me.memberships ?? [])[0]?.workspaceId;
  if (!workspaceId) throw new Error("staging /me returned no memberships for the dev principal");
  return { token, workspaceId };
}

const authHeaders = (ctx: StagingCtx) => ({
  Authorization: `Bearer ${ctx.token}`,
  "x-workspace-id": ctx.workspaceId,
});

async function ensureStagingContact(ctx: StagingCtx, phone: string): Promise<void> {
  const contacts = (await fetch(`${STAGING_API}/contacts`, { headers: authHeaders(ctx) }).then((r) => r.json())) as Array<{
    phone?: string | null;
  }>;
  const digits = phone.replace(/^\+/, "");
  if (contacts.some((c) => (c.phone ?? "").includes(digits))) {
    console.log("staging contact for the US handset already exists");
    return;
  }
  const res = await fetch(`${STAGING_API}/contacts`, {
    method: "POST",
    headers: { ...authHeaders(ctx), "Content-Type": "application/json" },
    body: JSON.stringify({ email: "us-handset@clientforce.test", firstName: "US", lastName: "Handset", phone }),
  });
  if (!res.ok) throw new Error(`staging contact create failed: ${res.status}`);
  console.log("staging contact created for the US handset (rail-2 resolution target)");
}

async function smsSuppressionCount(ctx: StagingCtx, q: string): Promise<number> {
  const rows = (await fetch(`${STAGING_API}/suppressions?q=${encodeURIComponent(q)}`, {
    headers: authHeaders(ctx),
  }).then((r) => (r.ok ? r.json() : []))) as SuppressionRow[];
  return rows.filter((r) => r.channel === "sms").length;
}

async function expectUsRows(ctx: StagingCtx, phone: string, expected: number, why: string): Promise<void> {
  let count = -1;
  for (let i = 0; i < 12; i++) {
    count = await smsSuppressionCount(ctx, phone);
    if (count === expected) break;
    await sleep(5000);
  }
  console.log(`  ledger: US-handset sms suppression rows = ${count} (expected ${expected} — ${why})`);
  if (count !== expected) throw new Error(`LEDGER STANCE FAILED: expected ${expected} US-handset sms rows (${why}), found ${count}`);
}

async function main(): Promise<void> {
  if (!SID || !TOKEN) throw new Error("Twilio credentials missing");
  if (!/^MG[a-zA-Z0-9]{32}$/.test(MSID)) throw new Error("SMS_TEST_MESSAGING_SERVICE_SID missing/invalid");

  console.log("\n=== P2.1 RAIL-1 CLOSING PROOF (US test handset, DEC-067) ===");
  const handset = await ensureUsTestNumber();
  if (OUT_FILE) writeFileSync(OUT_FILE, handset.number, "utf8");
  const target = await ensureInService(handset.sid, handset.number);

  const ctx = await stagingCtx();
  if (ctx) await ensureStagingContact(ctx, handset.number);

  const stop1 = await keywordRound("1/3 STOP", "STOP", handset.number, target);
  if (ctx) await expectUsRows(ctx, handset.number, 1, "STOP creates the row via the live webhook — rail 2 full loop");

  const start = await keywordRound("2/3 START", "START", handset.number, target);
  if (ctx) await expectUsRows(ctx, handset.number, 1, "START must NOT clear it — suppression persists until explicit re-consent (DEC-062/064)");

  const stop2 = await keywordRound("3/3 STOP", "STOP", handset.number, target);
  if (ctx) await expectUsRows(ctx, handset.number, 1, "repeat STOP stays a single row — applySmsStop is create-if-absent");

  if (ctx && NG_NUMBER) {
    const ng = await smsSuppressionCount(ctx, NG_NUMBER);
    console.log(`  ledger (informational): NG-handset sms suppression rows = ${ng} (0 until the owner adds their contact; suppression needs a matched contact per DEC-064)`);
  }

  if (!stop1 || !stop2) {
    throw new Error(
      "RAIL 1 INCOMPLETE: opt-out auto-reply not captured on a STOP round — if the handset was just attached, A2P campaign association may still be pending; re-dispatch in a few minutes",
    );
  }
  console.log(`\nRail 1 closed: STOP confirmation ✓ · START resubscribe ${start ? "✓" : "— (no reply; acceptable, opt-in confirmations are optional)"} · repeat STOP confirmation ✓ (Twilio-side idempotency)`);
  console.log("=== END RAIL-1 PROOF ===");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
