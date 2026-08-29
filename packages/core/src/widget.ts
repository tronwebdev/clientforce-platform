/**
 * Embeddable Agent Widget — the shared contract (WID2, DEC-101).
 *
 * ONE endpoint carries the whole widget: `POST /widget/v1/session`. Unit 27
 * (DEC-097) shipped these shapes client-side as the contract of record and ran
 * them against an honest stub; this file is the promotion the wiring unit owes
 * them — the same shapes, now zod, shared by the API, the embed and the web
 * builder. `contractVersion` is deliberately preserved at 1: nothing about the
 * wire format changed, only who validates it.
 *
 * Three rules are structural, not stylistic:
 *
 * 1 · THE PAGE CARRIES ONE CREDENTIAL, AND IT IS PUBLIC. A host page holds only
 *     the `wgt_…` public id. The server resolves it to workspace / agent /
 *     campaign, so **no tenant identifier ever reaches the host page** — the
 *     embed cannot leak a workspace id it never had. Everything the response
 *     carries is visitor-safe by construction.
 * 2 · BRANDING IS SERVER-AUTHORITATIVE. `platformAttribution` is the "Powered
 *     by Clientforce Ai" line: default-on, NOT workspace-configurable, and
 *     suppressible only where the owning agency's plan tier includes
 *     white-label (canon §7). It has no data-attribute and no init option by
 *     design — a page-level switch would hand every customer white-label for
 *     free — so this field is the only path, and the plan check behind it is
 *     the only thing that may set it false.
 * 3 · FLOWS ARE WORKSPACE CONFIGURATION, NOT A FIXED SET. Six flows, each
 *     independently enabled in widget setup because industries use different
 *     subsets. The panel renders only the active ones and never a placeholder
 *     for a disabled flow, so a flow whose provider is absent is simply off —
 *     the honest-absence rule, expressed in config rather than in UI.
 */
import { z } from "zod";

export const WIDGET_CONTRACT_VERSION = 1 as const;

/** The one documented endpoint. The embed builds its URL from this. */
export const WIDGET_SESSION_PATH = "/widget/v1/session";

/** Public widget-id prefix. The only credential a host page carries. */
export const WIDGET_PUBLIC_ID_PREFIX = "wgt_";

export const widgetPublicIdSchema = z
  .string()
  .regex(/^wgt_[a-z0-9]{8,32}$/, "widgetId must look like wgt_8fa3c21e");

// ── Flows ────────────────────────────────────────────────────────────────────
/**
 * The six flows, in panel order. Each is independently enabled per workspace.
 * `liveVoice` rides the composer mic rather than an entry chip, which is why
 * the quick-action union below has five members and this has six.
 */
export const WIDGET_FLOWS = [
  "bookVisit",
  "callMeBack",
  "scheduleCallback",
  "estimate",
  "liveVoice",
  "askQuestion",
] as const;

export type WidgetFlow = (typeof WIDGET_FLOWS)[number];
export const widgetFlowSchema = z.enum(WIDGET_FLOWS);

export const widgetFlowsSchema = z.object({
  bookVisit: z.boolean(),
  callMeBack: z.boolean(),
  scheduleCallback: z.boolean(),
  estimate: z.boolean(),
  liveVoice: z.boolean(),
  askQuestion: z.boolean(),
});
export type WidgetFlows = z.infer<typeof widgetFlowsSchema>;

/**
 * Flows whose SERVER HALF exists today. The ONE list both sides read: the API
 * intersects a workspace's toggles with it (a flow it cannot complete is never
 * advertised), and the widget config UI renders the difference as "enabled,
 * arrives with a later wave" rather than leaving a toggle that looks broken —
 * the owner's condition on the advertise-only-what-you-serve ruling
 * (2026-07-26). Keeping it here is what stops the two ends drifting: a wave
 * that lands a flow flips it in ONE place.
 *
 * WID2 W1 shipped `askQuestion` (no third-party provider needed). W2 adds
 * `scheduleCallback` — the capture flow that completes with no third party: it
 * writes a real Contact and a real `Meeting`, so the outcome card describes
 * something that exists. `callMeBack` needs live telephony and `estimate` needs
 * generation + delivery, so they stay off until their wave; booking waits on a
 * calendar provider (Q-058) and live voice on a transport (Q-057).
 */
export const WIDGET_SERVABLE_FLOWS: readonly WidgetFlow[] = ["askQuestion", "scheduleCallback"];

/** A configured flow that cannot be served yet — what the config UI explains
 *  instead of rendering a dead toggle. */
export const isWidgetFlowServable = (flow: WidgetFlow): boolean =>
  WIDGET_SERVABLE_FLOWS.includes(flow);

/**
 * Entry-chip flows — the five that surface as chips. Labels are server-offered
 * per tenant (industries word them differently); the client draws the icon from
 * the KIND, so a tenant label can never smuggle an emoji back into a shell that
 * retired them.
 */
export const WIDGET_QUICK_ACTION_KINDS = [
  "book_visit",
  "call_me_back",
  "schedule_callback",
  "estimate",
  "ask_question",
] as const;

export type WidgetQuickActionKind = (typeof WIDGET_QUICK_ACTION_KINDS)[number];
export const widgetQuickActionKindSchema = z.enum(WIDGET_QUICK_ACTION_KINDS);

/** Chip kind → the flow toggle that gates it. */
export const WIDGET_QUICK_ACTION_FLOW: Record<WidgetQuickActionKind, WidgetFlow> = {
  book_visit: "bookVisit",
  call_me_back: "callMeBack",
  schedule_callback: "scheduleCallback",
  estimate: "estimate",
  ask_question: "askQuestion",
};

// ── Agent states ─────────────────────────────────────────────────────────────
/**
 * The FOUR widget chat verbs (canon §6 forbids forcing a fifth). `@clientforce/
 * theme` owns the same union for the shell's motion states — core must not
 * depend on a UI package, so the two are pinned equal by test instead.
 */
export const WIDGET_AGENT_STATES = ["idle", "listening", "thinking", "replying"] as const;
export type WidgetAgentState = (typeof WIDGET_AGENT_STATES)[number];
export const widgetAgentStateSchema = z.enum(WIDGET_AGENT_STATES);

// ── Request ──────────────────────────────────────────────────────────────────
/**
 * Every visitor interaction is one request carrying a discriminated event.
 * `capture_submit` is how a flow collects a name/email/phone — it is a plain
 * field bag rather than a typed form, because which fields a flow asks for is
 * server-offered per tenant.
 */
export const widgetClientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boot") }),
  z.object({ type: z.literal("open") }),
  z.object({ type: z.literal("close") }),
  z.object({ type: z.literal("visitor_message"), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("quick_action"), action: widgetQuickActionKindSchema }),
  z.object({
    type: z.literal("capture_submit"),
    fields: z.record(z.string(), z.string().max(500)),
  }),
]);
export type WidgetClientEvent = z.infer<typeof widgetClientEventSchema>;

export const widgetSessionRequestSchema = z.object({
  contractVersion: z.literal(WIDGET_CONTRACT_VERSION),
  widgetId: widgetPublicIdSchema,
  /** null on the first (boot) call — the server mints and returns one. */
  sessionId: z.string().max(64).nullable(),
  /** Preview/dev overrides only; the server's widgetId mapping is authoritative. */
  agentId: z.string().max(64).nullish(),
  campaignId: z.string().max(64).nullish(),
  event: widgetClientEventSchema,
  context: z
    .object({
      pageUrl: z.string().max(2048).optional(),
      referrer: z.string().max(2048).optional(),
      locale: z.string().max(32).optional(),
    })
    .optional(),
});
export type WidgetSessionRequest = z.infer<typeof widgetSessionRequestSchema>;

// ── Capture + outcome (W2) ───────────────────────────────────────────────────
/**
 * What a capture flow asks for. Server-offered per tenant and per flow, because
 * a dentist booking a visit and a roofer quoting a job want different fields —
 * the panel renders the spec it is given rather than a hard-coded form, which
 * is the same stance the entry chips take with their labels.
 */
export const WIDGET_CAPTURE_FIELD_TYPES = ["text", "email", "tel", "datetime"] as const;
export type WidgetCaptureFieldType = (typeof WIDGET_CAPTURE_FIELD_TYPES)[number];

export const widgetCaptureFieldSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  type: z.enum(WIDGET_CAPTURE_FIELD_TYPES),
  required: z.boolean(),
  placeholder: z.string().max(80).optional(),
});
export type WidgetCaptureField = z.infer<typeof widgetCaptureFieldSchema>;

/**
 * Consent is CAPTURED here and ENFORCED at the send boundary — never both. The
 * widget records that a visitor ticked the box and when; whether a reminder may
 * actually be sent stays the channel rail's decision, because forking that
 * check is exactly how a compliance rail rots.
 */
export const widgetCaptureConsentSchema = z.object({
  key: z.string().min(1).max(40),
  text: z.string().min(1).max(240),
  required: z.boolean(),
});

export const widgetCaptureSpecSchema = z.object({
  flow: widgetFlowSchema,
  title: z.string().min(1).max(80),
  submitLabel: z.string().min(1).max(40),
  fields: z.array(widgetCaptureFieldSchema).min(1).max(6),
  consent: widgetCaptureConsentSchema.optional(),
  /**
   * B4 (DEC-120(2)): ADDITIVE second consent slot(s) — the call-consent ask
   * rides here when the workspace turns it on (default OFF). ContractVersion
   * stays 1: an older bundle that reads only `consent` simply doesn't render
   * these, which is acceptable for a default-off ask.
   */
  consents: z.array(widgetCaptureConsentSchema).max(3).optional(),
});
export type WidgetCaptureSpec = z.infer<typeof widgetCaptureSpecSchema>;

/**
 * The outcome card — the terminal surface of every capture flow. Canon §7's
 * SEMANTIC green: it is mint/forest on every panel, white-label or not, because
 * it means GOOD rather than meaning Clientforce (owner ruling 2026-07-26).
 *
 * It carries only what actually happened. There is no "pending" kind on
 * purpose: a card that says "Booked · Tue 10:30" when nothing was booked is the
 * fabricated receipt the repo forbids, so the server emits this ONLY after the
 * record exists.
 */
export const WIDGET_OUTCOME_KINDS = [
  "callback_scheduled",
  "call_requested",
  "estimate_sent",
  "booked",
] as const;
export type WidgetOutcomeKind = (typeof WIDGET_OUTCOME_KINDS)[number];

export const widgetOutcomeSchema = z.object({
  kind: z.enum(WIDGET_OUTCOME_KINDS),
  title: z.string().min(1).max(80),
  detail: z.string().max(160).optional(),
  /** ISO-8601 — the moment the outcome refers to (a callback time, say). */
  at: z.string().optional(),
});
export type WidgetOutcome = z.infer<typeof widgetOutcomeSchema>;

// ── Response ─────────────────────────────────────────────────────────────────
export const widgetMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["agent", "visitor"]),
  text: z.string(),
  /** ISO-8601 */
  at: z.string(),
});
export type WidgetMessage = z.infer<typeof widgetMessageSchema>;

export const widgetQuickActionSchema = z.object({
  kind: widgetQuickActionKindSchema,
  label: z.string().min(1).max(48),
});
export type WidgetQuickAction = z.infer<typeof widgetQuickActionSchema>;

export const widgetAgentDescriptorSchema = z.object({
  name: z.string(),
  subtitle: z.string(),
  state: widgetAgentStateSchema,
});
export type WidgetAgentDescriptor = z.infer<typeof widgetAgentDescriptorSchema>;

/**
 * SERVER-AUTHORITATIVE branding. See rule 2 in the file header: this is the
 * only path to suppressing the platform line, and absent ⇒ shown.
 */
export const widgetBrandingSchema = z.object({ platformAttribution: z.boolean() });
export type WidgetBranding = z.infer<typeof widgetBrandingSchema>;

export const widgetSessionResponseSchema = z.object({
  contractVersion: z.literal(WIDGET_CONTRACT_VERSION),
  sessionId: z.string(),
  agent: widgetAgentDescriptorSchema,
  /** Messages to APPEND (delta, not the full transcript). */
  messages: z.array(widgetMessageSchema),
  /**
   * Server-offered chips. An ABSENT field means "unchanged"; an EMPTY ARRAY is
   * a real instruction to clear them. The client honours that distinction, so a
   * server must not send `[]` when it means "no change".
   */
  quickActions: z.array(widgetQuickActionSchema).optional(),
  /** Server-resolved appearance; null until the builder writes one. */
  appearance: z.record(z.string(), z.unknown()).nullish(),
  branding: widgetBrandingSchema.optional(),
  /**
   * A form the panel should render now (a capture flow was chosen). Additive
   * and optional, so a pre-W2 client simply ignores it — which is why
   * `contractVersion` stays 1.
   */
  capture: widgetCaptureSpecSchema.nullish(),
  /** The terminal card, emitted only once the underlying record exists. */
  outcome: widgetOutcomeSchema.nullish(),
  meta: z.object({
    /** true ⇒ this response did not come from a live agent. */
    stub: z.boolean(),
  }),
});
export type WidgetSessionResponse = z.infer<typeof widgetSessionResponseSchema>;

/**
 * Typed refusal detail strings (the ACCOUNT_ACTION_REFUSAL convention). These
 * reach a PUBLIC surface, so each is written for a stranger on someone else's
 * website: no tenant names, no internal ids, nothing that hints at what exists.
 */
export const WIDGET_REFUSALS = {
  UNKNOWN_WIDGET: "This chat widget isn't available",
  CONTRACT_VERSION: "This chat widget needs to be updated — reload the page",
  ORIGIN_NOT_ALLOWED: "This chat widget isn't enabled for this website",
  RATE_LIMITED: "Too many messages just now — give it a moment and try again",
  FLOW_DISABLED: "That option isn't available here",
  AGENT_UNAVAILABLE: "The assistant is unavailable right now — please try again shortly",
} as const;

export type WidgetRefusalCode = keyof typeof WIDGET_REFUSALS;
