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
// B1 W1 (DEC-079): platform-suspension gate shared by the email + SMS boundaries.
export { assertTenantActive } from "./tenant-status";
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
// M1b (DEC-068): pinned reply→intent fixtures — the classification contract.
// L1 (DEC-072): + the multilingual pins (German/French replies, same intents).
export {
  MULTILINGUAL_REPLY_FIXTURES,
  REPLY_INTENT_FIXTURES,
  fixtureFor,
  type MultilingualReplyFixture,
  type ReplyIntentFixture,
} from "./classify-fixtures";
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
// ── G1 (DEC-070): guided SMS composer — briefs → per-lead copy at send time ──
export {
  checkComposedSms,
  ComposeRefusedError,
  composeSampleSms,
  composeSms,
  COMPOSER_PROMPT_NAME,
  COMPOSER_PROMPT_VERSION,
  COMPOSER_PROMPT_VERSION_LANGUAGE,
  COMPOSER_SYSTEM,
  COMPOSER_VERSION,
  composerVersionFor,
  createSmsStepComposer,
  SAMPLE_LEAD,
  SMS_COMPOSE_MAX_CHARS,
  SMS_COMPOSE_TARGET_CHARS,
  type ComposedSms,
  type ComposeHistoryLine,
  type ComposeLead,
  type ComposeRefusalReason,
  type ComposeSmsInputs,
  type ComposeStepParams,
  type ComposeViolation,
  type SmsStepComposer,
} from "./compose-sms";
// ── G2 (DEC-071): guided EMAIL composer — subject + body, arc-role aware ─────
export {
  arcRoleFor,
  checkComposedEmail,
  composeEmail,
  composeSampleEmail,
  COMPOSED_FOOTER_PATTERNS,
  COMPOSER_EMAIL_PROMPT_NAME,
  COMPOSER_EMAIL_PROMPT_VERSION,
  COMPOSER_EMAIL_PROMPT_VERSION_LANGUAGE,
  COMPOSER_EMAIL_SYSTEM,
  COMPOSER_EMAIL_VERSION,
  composerEmailVersionFor,
  createEmailStepComposer,
  EMAIL_COMPOSE_MAX_WORDS,
  EMAIL_COMPOSE_TARGET_WORDS,
  EMAIL_SUBJECT_MAX_CHARS,
  type ComposeArcRole,
  type ComposedEmail,
  type ComposeEmailInputs,
  type ComposeEmailStepParams,
  type EmailStepComposer,
} from "./compose-email";
// ── P3.1 (DEC-078): the voice channel — dial rails, dialer, live composer ────
// (buildCachedContext/strategyOf were package-internal until the voice
// runtime needed them — same G1/G2 shared plumbing, now on the surface.)
export { buildCachedContext, strategyOf } from "./compose-shared";
export {
  assertDialAllowed,
  assertInsideCallingWindow,
  DEFAULT_VOICE_DAILY_CAP,
  DEFAULT_VOICE_WORKSPACE_DAILY_CAP,
  type DialClearance,
  type DialVoiceDeps,
  type DialVoiceParams,
} from "./dial-voice";
export {
  outcomeFromTwilioStatus,
  TwilioVoiceDialer,
  type PlaceCallParams,
  type PlaceCallResult,
  type VoiceDialer,
} from "./twilio-voice";
export {
  buildVoiceSystemPrompt,
  checkComposedVoiceTurn,
  COMPOSER_VOICE_PROMPT_NAME,
  COMPOSER_VOICE_PROMPT_VERSION,
  COMPOSER_VOICE_SYSTEM,
  COMPOSER_VOICE_VERSION,
  deriveCallBrief,
  mustSayCoverage,
  VOICE_FAILURE_GOODBYE,
  VOICE_FALLBACK_LINE,
  VOICE_TURN_MAX_CHARS,
  type ComposeVoiceInputs,
} from "./compose-voice";
