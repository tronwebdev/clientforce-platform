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
export {
  resolveEventMessage,
  toBusEvents,
  type BusEventInput,
} from "./webhooks";
export {
  INBOUND_CLASSIFY_QUEUE,
  MalformedInboundError,
  createClassifyQueue,
  extractReferencedIds,
  ingestInboundEmail,
  normalizeInboundParse,
  parseAddress,
  resolveInboundThread,
  type ClassifyJobData,
  type InboundEmail,
  type IngestInboundDeps,
  type ThreadResolution,
} from "./inbound";
export {
  applyUnsubscribeReply,
  classifyReply,
  createClassifyWorker,
  CLASSIFY_EMISSION_LABELS,
  CLASSIFY_PROMPT_NAME,
  CLASSIFY_PROMPT_VERSION,
  type ClassifyContext,
  type ClassifyWorkerDeps,
} from "./classify";
// M1b (DEC-066): pinned reply→intent fixtures — the classification contract.
export { REPLY_INTENT_FIXTURES, fixtureFor, type ReplyIntentFixture } from "./classify-fixtures";
// ── P2.1 (DEC-061/062): the SMS channel ──────────────────────────────────────
export { sendSmsStep, SMS_OPT_OUT_LINE, DEFAULT_SMS_DAILY_CAP, type SendSmsDeps, type SendSmsStepParams } from "./send-sms";
export { TwilioSmsSender, parseTwilioConfig, smsSegmentCount, validateTwilioSignature, type TwilioSenderConfig } from "./twilio";
export {
  applySmsStop,
  ingestInboundSms,
  isStopMessage,
  normalizeTwilioInbound,
  resolveInboundSmsThread,
  resolveSmsStopFallback,
  type InboundSms,
  type IngestInboundSmsDeps,
  type SmsStopFallbackTarget,
  type SmsThreadResolution,
} from "./sms-inbound";
export type { RenderedSms, SmsSender, SmsSendResult } from "./types";
