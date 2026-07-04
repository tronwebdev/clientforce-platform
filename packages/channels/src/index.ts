/**
 * @clientforce/channels — the email channel adapter (P1.5).
 *
 * Provider-agnostic transport behind `EmailSender`; every send goes through
 * the `sendStep` boundary: A8 guardrails, suppression/opt-out, the three
 * owner send-time rules (from-name-or-fail · CAN-SPAM footer =
 * company_address verbatim · real threading, never a faux-"Re:"), then
 * `Message` persisted as rendered (A6). CF_MANAGED (SendGrid, sandbox until
 * P1.8) is the live tier; the others are designed-but-inert.
 */
export { sendStep, type SendDeps, type SendStepParams } from "./send";
export { SendGridSender, NotImplementedSender } from "./sendgrid";
export {
  MissingTokenError,
  hasThreadPrefix,
  renderTokens,
  stripThreadPrefix,
  withReplyPrefix,
} from "./render";
export {
  applyEmailEvent,
  normalizeSendGridEvents,
  normalizedEmailEventSchema,
  resolveEventWorkspace,
  verifySendGridSignature,
  type NormalizedEmailEvent,
} from "./webhooks";
export {
  SendBlockedError,
  type EmailSender,
  type RenderedEmail,
  type SendBlockReason,
} from "./types";
