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
 * The provider-agnostic adapter (P1.5 acceptance: adding a provider changes
 * nothing in the workflow/executor). Implementations do transport ONLY —
 * guardrails, suppression, rendering, and compliance live in the boundary.
 */
export interface EmailSender {
  send(email: RenderedEmail, sender: SenderConnection): Promise<{ providerMessageId: string }>;
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
  | "RECIPIENT_NOT_ALLOWLISTED";

export class SendBlockedError extends Error {
  constructor(
    readonly reason: SendBlockReason,
    detail?: string,
  ) {
    super(`Send blocked (${reason})${detail ? `: ${detail}` : ""}`);
    this.name = "SendBlockedError";
  }
}
