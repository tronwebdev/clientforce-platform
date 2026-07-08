/**
 * P2.1 (DEC-061): the Twilio SMS transport — transport ONLY, exactly like
 * SendGridSender: guardrails, suppression, opt-out language and rendering
 * live in the `sendSmsStep` boundary, never here.
 *
 * `SMS_SANDBOX` (default ON, same discipline as SENDGRID_SANDBOX/DEC-060a):
 * in sandbox no network call is made — a deterministic provider id comes back
 * so persistence/threading/idempotency behave identically to live mode.
 */
import { createHmac, createHash } from "node:crypto";
import { decryptField, type SenderConnection } from "@clientforce/db";
import type { RenderedSms, SmsSender, SmsSendResult } from "./types";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

/** Per-sender config, field-encrypted in `credentialsEnc` (DEC-061). */
export interface TwilioSenderConfig {
  messagingServiceSid: string;
  /** Optional per-tenant credentials; platform env creds are the default. */
  accountSid?: string;
  authToken?: string;
}

export function parseTwilioConfig(sender: SenderConnection): TwilioSenderConfig {
  if (!sender.credentialsEnc) throw new Error(`TWILIO_SMS sender ${sender.id} has no config`);
  return JSON.parse(decryptField(sender.credentialsEnc)) as TwilioSenderConfig;
}

/**
 * GSM-7 vs UCS-2 segment estimate — persisted into `Message.meta.segments`.
 * 160/153 for GSM-7, 70/67 for UCS-2 (concatenated headers eat capacity).
 */
export function smsSegmentCount(body: string): number {
  // Basic GSM-7 set + extension chars; anything else forces UCS-2.
  const gsm7 = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
  const isGsm = gsm7.test(body);
  const len = body.length;
  if (len === 0) return 0;
  if (isGsm) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

export class TwilioSmsSender implements SmsSender {
  constructor(
    private readonly accountSid = process.env.TWILIO_ACCOUNT_SID ?? "",
    private readonly authToken = process.env.TWILIO_AUTH_TOKEN ?? "",
    private readonly sandbox = process.env.SMS_SANDBOX !== "false",
  ) {}

  async send(sms: RenderedSms, sender: SenderConnection): Promise<SmsSendResult> {
    const segments = smsSegmentCount(sms.body);
    if (this.sandbox) {
      // Deterministic id so retries stay idempotent in tests/proofs.
      const hash = createHash("sha256").update(`${sms.to}:${sms.body}`).digest("hex").slice(0, 24);
      return { providerMessageId: `SM-sandbox-${hash}`, segments };
    }
    const cfg = parseTwilioConfig(sender);
    const sid = cfg.accountSid ?? this.accountSid;
    const token = cfg.authToken ?? this.authToken;
    if (!sid || !token) throw new Error("Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)");
    const res = await fetch(`${TWILIO_API}/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: sms.to,
        MessagingServiceSid: cfg.messagingServiceSid,
        Body: sms.body,
      }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio send failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { sid: string; num_segments?: string };
    return {
      providerMessageId: data.sid,
      segments: data.num_segments ? Number(data.num_segments) : segments,
    };
  }
}

/**
 * Twilio webhook signature validation (X-Twilio-Signature): HMAC-SHA1 over
 * the full URL + the POST params concatenated key-sorted, base64. Constant
 * public recipe — the auth token is the secret.
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
