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
