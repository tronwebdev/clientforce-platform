import type { SenderConnection } from "@clientforce/db";

/** A fully rendered outbound email — everything the provider needs, nothing it decides. */
export interface RenderedEmail {
  to: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  /** Plain-text body INCLUDING the compliance footer (appended by the boundary). */
  body: string;
  /** RFC 5322 Message-IDs for real threading (owner rule 3); absent on fresh threads. */
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
}

/**
 * What a transport reports back. The two ids serve DIFFERENT protocols and
 * must never be conflated (found by the P1.6 live-proof header gate):
 * `providerMessageId` is the provider's own id (SendGrid X-Message-Id) —
 * webhook events correlate on it; `rfcMessageId` is the RFC 5322 Message-ID
 * actually on the wire — In-Reply-To/References (owner rule 3) MUST use it,
 * or real mail clients won't thread.
 */
export interface SendResult {
  providerMessageId: string;
  /** Absent only for transports that don't control the Message-ID header. */
  rfcMessageId?: string;
}

/**
 * The provider-agnostic adapter (P1.5 acceptance: adding a provider changes
 * nothing in the workflow/executor). Implementations do transport ONLY —
 * guardrails, suppression, rendering, and compliance live in the boundary.
 */
export interface EmailSender {
  send(email: RenderedEmail, sender: SenderConnection): Promise<SendResult>;
}

/** P2.1 (DEC-061): a fully rendered outbound SMS — body already carries the
 *  opt-out line when the boundary decided it must. */
export interface RenderedSms {
  to: string;
  body: string;
}

export interface SmsSendResult {
  providerMessageId: string;
  /** GSM-7/UCS-2 segment count — persisted into Message.meta (DEC-061). */
  segments: number;
}

/** The provider-agnostic SMS adapter — transport only, same contract as EmailSender. */
export interface SmsSender {
  send(sms: RenderedSms, sender: SenderConnection): Promise<SmsSendResult>;
}

/** Typed refusals from the send boundary — recorded, never silently dropped. */
export type SendBlockReason =
  | "SUPPRESSED"
  | "OPTED_OUT"
  | "SENDER_NO_FROM_NAME"
  | "NO_COMPANY_ADDRESS"
  | "OUTSIDE_SENDING_WINDOW"
  | "DAILY_CAP_REACHED"
  | "SENDER_DISABLED"
  | "RECIPIENT_NOT_ALLOWLISTED"
  // P2.1 (DEC-061): SMS-boundary extensions.
  | "CONTACT_NO_PHONE"
  | "SENDER_NOT_SMS"
  // B1 W1 (DEC-079): platform suspension. A SUSPENDED workspace — or its
  // SUSPENDED agency — refuses every send at the boundary; reactivation
  // restores it. The kill switch reuses this same machinery (W4 extends the
  // detail, never forks the path).
  | "TENANT_SUSPENDED"
  // B1 W4 (DEC-082): the per-agency/per-channel kill switch — same boundary
  // machinery as TENANT_SUSPENDED, one more typed reason. Reversible.
  | "CHANNEL_KILLED";

export class SendBlockedError extends Error {
  constructor(
    readonly reason: SendBlockReason,
    detail?: string,
  ) {
    super(`Send blocked (${reason})${detail ? `: ${detail}` : ""}`);
    this.name = "SendBlockedError";
  }
}
