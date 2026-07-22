/**
 * Integrations display registry (INT W1-UI) — `lib/actions.ts`'s twin for the
 * Integrations surface: the canon 15-card catalog from `Integrations.dc.html`
 * as a DISPLAY LAYER ONLY over the ONE provider union in `@clientforce/core`
 * (never a parallel union — the DEC-034 one-enum rule ported to providers).
 *
 * Availability is DERIVED, never hand-listed:
 *   - "live"    — the id is in core `INTEGRATION_PROVIDERS` (W1: slack only).
 *                 When a wave lands in core, the card flips live here with
 *                 zero edits (the picker↔vocabulary drift test pins both ends).
 *   - "managed" — twilio: the REAL Twilio SMS channel already exists
 *                 platform-side (Settings → Phone & SMS senders, P2.1/DEC-061),
 *                 so the card deep-links there instead of faking a Connect.
 *                 Designed decision — one channel, one management surface.
 *   - "absent"  — everything else, with an owner-readable reason (the
 *                 automations honest-absent ledger phrasing) — never a
 *                 working "+ Connect" for a provider that doesn't exist.
 */
import {
  SLACK_NOTIFICATION_KINDS,
  calendlyConfigSchema,
  gcalConfigSchema,
  isIntegrationProvider,
  slackConfigSchema,
  stripeConfigSchema,
  webhooksConfigSchema,
  hubspotConfigSchema,
  type CalendlyConfig,
  type GcalConfig,
  type HubspotConfig,
  type IntegrationProvider,
  type IntegrationStatus,
  type SlackConfig,
  type SlackNotificationKind,
  type StripeConfig,
  type WebhooksConfig,
} from "@clientforce/core";

// ── canon atoms (Integrations.dc.html TILE + catLabels, verbatim) ───────────

/** Glyph-tile palette — the tiles are brand LETTER tiles, not lucide icons. */
export const TILE = {
  green: { tilebg: "rgba(53,232,52,.16)", tilefg: "#16A82A" },
  cyan: { tilebg: "rgba(54,215,237,.16)", tilefg: "#1192A6" },
  lime: { tilebg: "rgba(208,245,107,.4)", tilefg: "#6B7A1F" },
  ink: { tilebg: "#0C140F", tilefg: "#7FE8A0" },
  neutral: { tilebg: "#F2EEE4", tilefg: "#5C6B62" },
} as const;
export type TileKey = keyof typeof TILE;

export const CATEGORY_LABELS = {
  crm: "CRM",
  calendar: "Calendar",
  inbox: "Inbox",
  messaging: "Messaging",
  payments: "Payments",
  automation: "Automation",
} as const;
export type IntegrationCategory = keyof typeof CATEGORY_LABELS;
export const INTEGRATION_CATEGORIES = Object.keys(CATEGORY_LABELS) as readonly IntegrationCategory[];

// ── availability model ──────────────────────────────────────────────────────

export type CatalogAvailability =
  | { kind: "live"; provider: IntegrationProvider }
  | { kind: "managed"; note: string; href: string }
  | { kind: "absent"; reason: string };

/**
 * Where the managed Twilio card sends the owner. The Settings surface's SMS
 * section hash is `#phone` (SettingsView VALID_SECTIONS — there is no
 * `#channels` hash), so the deep link targets the REAL section.
 */
export const MANAGED_TWILIO_HREF = "/settings#phone";
export const MANAGED_TWILIO_NOTE = "Managed in Settings → Channels";

/** Owner-readable honest-absent reasons (the automations ledger phrasing).
 *  INT W2 (DEC-094): gcal + calendly left this map — they joined core
 *  `INTEGRATION_PROVIDERS`, so `availabilityFor` flips their cards live
 *  before this lookup is ever reached (availability derives from core). */
const ABSENT_REASONS: Record<string, string> = {
  // hubspot is LIVE (INT W4, DEC-096) — availabilityFor derives it from core
  // INTEGRATION_PROVIDERS, so no absent reason applies.
  salesforce: "Arrives with the Salesforce/Pipedrive integrations",
  pipedrive: "Arrives with the Salesforce/Pipedrive integrations",
  calcom: "Arrives with the Cal.com integration",
  gmail: "Arrives with bring-your-own inbox (v2)",
  outlook: "Arrives with bring-your-own inbox (v2)",
  smtp: "Arrives with bring-your-own inbox (v2)",
  whatsapp: "Arrives with the WhatsApp channel",
  zapier: "Arrives with the Zapier integration",
};

function availabilityFor(id: string): CatalogAvailability {
  if (isIntegrationProvider(id)) return { kind: "live", provider: id };
  if (id === "twilio") return { kind: "managed", note: MANAGED_TWILIO_NOTE, href: MANAGED_TWILIO_HREF };
  return { kind: "absent", reason: ABSENT_REASONS[id] ?? "" };
}

// ── the catalog (prototype base[] verbatim: id/name/cat/glyph/tile/desc) ────

export interface CatalogEntry {
  id: string;
  name: string;
  cat: IntegrationCategory;
  glyph: string;
  tile: TileKey;
  desc: string;
  availability: CatalogAvailability;
}

const BASE: ReadonlyArray<Omit<CatalogEntry, "availability">> = [
  { id: "hubspot", name: "HubSpot", cat: "crm", glyph: "H", tile: "cyan", desc: "Push leads into HubSpot as deals & move deal stages from your rules." },
  { id: "salesforce", name: "Salesforce", cat: "crm", glyph: "S", tile: "cyan", desc: "Push qualified leads & booked calls into Salesforce." },
  { id: "pipedrive", name: "Pipedrive", cat: "crm", glyph: "P", tile: "green", desc: "Create a deal automatically when a call is booked." },
  { id: "gcal", name: "Google Calendar", cat: "calendar", glyph: "G", tile: "green", desc: "Book calls straight onto your team calendar." },
  { id: "calendly", name: "Calendly", cat: "calendar", glyph: "C", tile: "cyan", desc: "Let leads self-book from any message or form." },
  { id: "calcom", name: "Cal.com", cat: "calendar", glyph: "◷", tile: "neutral", desc: "Open-source scheduling for your whole team." },
  { id: "gmail", name: "Gmail", cat: "inbox", glyph: "M", tile: "lime", desc: "Send & track outreach from your own inbox." },
  { id: "outlook", name: "Outlook", cat: "inbox", glyph: "O", tile: "cyan", desc: "Send from Microsoft 365 mailboxes." },
  { id: "smtp", name: "Custom SMTP", cat: "inbox", glyph: "✉", tile: "neutral", desc: "Connect any email provider via SMTP." },
  { id: "twilio", name: "Twilio SMS", cat: "messaging", glyph: "T", tile: "green", desc: "Power SMS outreach, replies & reminders." },
  { id: "whatsapp", name: "WhatsApp Business", cat: "messaging", glyph: "W", tile: "green", desc: "Message leads on WhatsApp with approved templates." },
  { id: "slack", name: "Slack", cat: "messaging", glyph: "#", tile: "ink", desc: "Get reply & booking alerts in your channels." },
  { id: "stripe", name: "Stripe", cat: "payments", glyph: "$", tile: "cyan", desc: "Collect payments and track closed revenue." },
  { id: "zapier", name: "Zapier", cat: "automation", glyph: "Z", tile: "lime", desc: "Automate workflows across 6,000+ apps." },
  { id: "webhooks", name: "Webhooks", cat: "automation", glyph: "⇄", tile: "neutral", desc: "POST every event to any endpoint you choose." },
];

export const INTEGRATION_CATALOG: readonly CatalogEntry[] = BASE.map((e) => ({
  ...e,
  availability: availabilityFor(e.id),
}));

export function catalogEntry(id: string): CatalogEntry | null {
  return INTEGRATION_CATALOG.find((e) => e.id === id) ?? null;
}

// ── per-provider drawer content (keyed by the ONE core union) ───────────────

/** Display labels for the engine's three notification kinds (drift-guarded). */
export const SLACK_NOTIFICATION_LABELS: Record<SlackNotificationKind, string> = {
  new_reply: "New reply alerts",
  meeting_booked: "Meeting booked alerts",
  goal_completed: "Goal completed alerts",
};

/** Everything provider-specific the detail drawer renders. */
export interface DrawerContent {
  /** INT W2: how the wizard connects — the W1 OAuth round-trip, or an
   *  in-drawer fields form (calendly's connect-fields path, canon `fields`
   *  step kind). */
  mode: "oauth" | "fields";
  /** Auth-step "Clientforce will be able to" list (dispatch-locked copy).
   *  Empty for fields-based providers — no vendor grant happens. */
  authPerms: readonly string[];
  /** The "What's syncing" rows. Slack's derive from the core notification
   *  union (never a fork); gcal/calendly rows are informational and describe
   *  what ACTUALLY syncs (honest copy — no invented toggles). */
  syncRows: ReadonlyArray<{ kind: string; label: string }>;
  /** Setup timeline copy (connected mode renders it all-✓ per the prototype). */
  setupSteps: ReadonlyArray<{ title: string; desc: string }>;
  /** Which option list the drawer's picker fetches (`GET …/options?kind=`);
   *  null = no vendor-backed picker (fields providers). */
  optionsKind: string | null;
  /** Honest platform-state line rendered on the auth step (gcal test-user
   *  mode while Google verification completes). */
  disclosure?: string;
}

/** INT W2 (DEC-094): the mandated gcal test-user-mode disclosure — rendered
 *  unconditionally on the auth step; never a fake connected state. */
export const GCAL_TEST_USER_DISCLOSURE =
  "Available to test accounts while Google verification completes — connecting requires your Google account to be on the app's test-user list.";

/**
 * Drawer content keyed by the core `IntegrationProvider` union via a
 * NON-Partial `Record` — when a wave adds a provider to core
 * `INTEGRATION_PROVIDERS` (W2's gcal, …), a missing entry here is a COMPILE
 * error, so the drawer can never silently render Slack copy for another
 * provider. A runtime drift pin in `test/integrations.test.ts` holds the
 * key set equal to the core union from the other direction.
 */
export const DRAWER_CONTENT = {
  slack: {
    mode: "oauth",
    authPerms: [
      "Post alerts to the channel you pick",
      "See your public channel list",
    ],
    syncRows: SLACK_NOTIFICATION_KINDS.map((kind) => ({ kind, label: SLACK_NOTIFICATION_LABELS[kind] })),
    setupSteps: [
      { title: "Sign in with Slack", desc: "Authorize Clientforce via secure OAuth." },
      { title: "Pick a channel", desc: "Where Clientforce posts updates." },
      { title: "Confirm & go live", desc: "Review and start syncing automatically." },
    ],
    optionsKind: "channels",
  },
  // INT W2 (DEC-094): Google Calendar — the W1 OAuth anatomy + the calendar
  // picker (options kind=calendars). syncRows say what ACTUALLY syncs:
  // availability feeds open slots in composed copy; Clientforce creates NO
  // events in W2 — Calendly puts booked meetings on the calendar natively.
  gcal: {
    mode: "oauth",
    authPerms: [
      "See when you're busy (read-only)",
      "List your calendars",
    ],
    syncRows: [
      { kind: "availability", label: "Availability — open slots can appear in composed copy" },
      { kind: "bookings", label: "Bookings — Calendly puts booked meetings on this calendar" },
    ],
    setupSteps: [
      { title: "Sign in with Google", desc: "Authorize read-only calendar access via secure OAuth." },
      { title: "Pick a calendar", desc: "Which calendar availability is read from." },
      { title: "Confirm & go live", desc: "Review and start syncing automatically." },
    ],
    optionsKind: "calendars",
    disclosure: GCAL_TEST_USER_DISCLOSURE,
  },
  // INT W2: Calendly — fields-based connect (no OAuth grant, so no perms
  // list), two honest tiers: the scheduling link works day one; booking
  // detection additionally needs the API token (paid Calendly plans).
  calendly: {
    mode: "fields",
    authPerms: [],
    syncRows: [
      { kind: "link", label: "Scheduling link — offered in composed messages" },
      { kind: "detection", label: "Booking detection — live only with an API token (paid Calendly plans)" },
    ],
    setupSteps: [
      { title: "Paste your scheduling link", desc: "Works day one — leads book on your real Calendly page." },
      { title: "Add your API token (optional)", desc: "Paid Calendly plans — turns on booking detection via webhooks." },
      { title: "Confirm & go live", desc: "Review and connect." },
    ],
    optionsKind: null,
  },
  // INT W3 (DEC-095): Stripe — the calendly two-tier anatomy on payments:
  // the Payment Link works day one; payment detection additionally needs a
  // restricted API key (Stripe mints the endpoint signing secret).
  stripe: {
    mode: "fields",
    authPerms: [],
    syncRows: [
      { kind: "link", label: "Payment link — offered in composed messages on request" },
      { kind: "detection", label: "Payment detection — live only with a restricted API key" },
    ],
    setupSteps: [
      { title: "Paste your Payment Link", desc: "Works day one — leads pay on your real Stripe checkout." },
      { title: "Add a restricted API key (optional)", desc: "Needs Webhook Endpoints write — turns on payment detection." },
      { title: "Confirm & go live", desc: "Review and connect." },
    ],
    optionsKind: null,
  },
  // INT W3: Webhooks — the outbound send_webhook action's config surface
  // (default Payload URL + the per-workspace signing secret). The canon's
  // events-pick stream half is honestly ABSENT (re-filed → Q-048).
  webhooks: {
    mode: "fields",
    authPerms: [],
    syncRows: [
      { kind: "action", label: "Send webhook action — POSTs rule events to your endpoint, signed" },
      { kind: "signature", label: "Signatures — t/v1 HMAC-SHA256 with your workspace secret" },
    ],
    setupSteps: [
      { title: "Enter your Payload URL", desc: "A public https endpoint you operate — checked by the delivery guard." },
      { title: "We send a signed test", desc: "A 2xx from your receiver confirms the connection." },
      { title: "Confirm & go live", desc: "Copy the signing secret into your receiver." },
    ],
    optionsKind: null,
  },
  // INT W4 (DEC-096): HubSpot one-way CRM push — the private-app token tier (no
  // OAuth clock). Two-way sync is honestly OUT (recorded Q).
  hubspot: {
    mode: "fields",
    authPerms: [],
    syncRows: [
      { kind: "deal", label: "Create CRM deal — pushes the lead to HubSpot as a deal" },
      { kind: "stage", label: "Update deal stage — moves the contact's deal (one-way)" },
    ],
    setupSteps: [
      { title: "Paste a private-app token", desc: "A HubSpot Private App with crm.objects.deals.write + contacts.write." },
      { title: "Confirm & go live", desc: "We verify the token against your HubSpot account." },
    ],
    optionsKind: null,
  },
} satisfies Record<IntegrationProvider, DrawerContent>;

// ── honest status display (probe-backed vocabulary → pill copy) ─────────────

export interface StatusPill {
  label: string;
  fg: string;
  bg: string;
  /** The green pulse dot renders ONLY for a probe-confirmed connection. */
  pulse: boolean;
}

/** Drawer status pill — honest from core `IntegrationStatus`, never inferred. */
export function statusPill(status: IntegrationStatus, providerName: string): StatusPill {
  switch (status) {
    case "connected":
      return { label: "Live · Connected", fg: "#16A82A", bg: "rgba(53,232,52,.12)", pulse: true };
    case "unhealthy":
      return {
        label: `Connection unhealthy — ${providerName} unreachable at the last probe`,
        fg: "#A87B16",
        bg: "rgba(232,196,91,.18)",
        pulse: false,
      };
    case "revoked":
      return {
        label: `Disconnected — ${providerName} revoked this token. Reconnect to resume.`,
        fg: "#C9543F",
        bg: "rgba(224,121,107,.12)",
        pulse: false,
      };
  }
}

/** Connection-card health line (the prototype's "● Healthy" slot, honest). */
export function healthLine(status: IntegrationStatus): { text: string; color: string } {
  switch (status) {
    case "connected":
      return { text: "● Healthy", color: "#16A82A" };
    case "unhealthy":
      return { text: "● Unhealthy", color: "#A87B16" };
    case "revoked":
      return { text: "● Revoked", color: "#C9543F" };
  }
}

// ── Slack config helpers (full-payload-preserving PATCH bodies) ─────────────

/** Parse the DTO's `config: unknown` through the REAL core schema; garbage → {}. */
export function parseSlackConfig(config: unknown): SlackConfig {
  const parsed = slackConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : {};
}

/** A notification kind is ON unless explicitly false (absent = ON). */
export function notificationOn(config: SlackConfig, kind: SlackNotificationKind): boolean {
  return config.notifications?.[kind] !== false;
}

/**
 * Build the FULL config payload for a PATCH: every notification kind explicit,
 * the channel preserved unless overridden — a toggle can never silently drop
 * the channel (or vice-versa).
 */
export function slackConfigPayload(
  config: SlackConfig,
  changes: {
    channel?: { id: string; name: string };
    notifications?: Partial<Record<SlackNotificationKind, boolean>>;
  } = {},
): SlackConfig {
  const notifications = Object.fromEntries(
    SLACK_NOTIFICATION_KINDS.map((k) => [k, changes.notifications?.[k] ?? notificationOn(config, k)]),
  ) as Record<SlackNotificationKind, boolean>;
  const channel = changes.channel ?? config.channel;
  return { ...(channel ? { channel } : {}), notifications };
}

// ── gcal config helpers (INT W2 — the Slack helpers' anatomy) ───────────────

/** Parse the DTO's `config: unknown` through the REAL core schema; garbage → {}. */
export function parseGcalConfig(config: unknown): GcalConfig {
  const parsed = gcalConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : {};
}

/** Slots-in-copy is OPT-IN — absent = OFF (nothing rides composed copy the
 *  owner didn't turn on; the honest default). */
export function offerSlotsOn(config: GcalConfig): boolean {
  return config.offerSlots === true;
}

/**
 * Full-payload-preserving PATCH body (the slackConfigPayload stance): a
 * slots toggle can never silently drop the picked calendar, or vice-versa.
 */
export function gcalConfigPayload(
  config: GcalConfig,
  changes: {
    calendar?: { id: string; name: string; timeZone: string };
    offerSlots?: boolean;
  } = {},
): GcalConfig {
  const calendar = changes.calendar ?? config.calendar;
  return {
    ...(calendar ? { calendar } : {}),
    offerSlots: changes.offerSlots ?? offerSlotsOn(config),
  };
}

// ── calendly config helpers (INT W2 — two honest tiers) ─────────────────────

/** Parse the DTO's `config: unknown` through the REAL core schema; garbage → {}. */
export function parseCalendlyConfig(config: unknown): CalendlyConfig {
  const parsed = calendlyConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : {};
}

export const CALENDLY_DETECTION_ON = "Booking detection live — webhook subscription active";
export const CALENDLY_DETECTION_OFF =
  "Link active — booking detection off. Add your Calendly API token (paid plans) to detect bookings.";
export const CALENDLY_NO_LINK = "No scheduling link saved yet — add one so leads can book.";

/**
 * The drawer's detection state line — HONEST from stored config, never
 * assumed: `detection: true` reflects a LIVE webhook subscription (the API
 * sets it only after the subscription is created); anything else says so.
 */
export function calendlyDetectionState(config: CalendlyConfig): {
  detection: boolean;
  line: string;
  /** true → render the add-token affordance (link works, detection doesn't). */
  offerToken: boolean;
} {
  if (!config.schedulingUrl) return { detection: false, line: CALENDLY_NO_LINK, offerToken: false };
  if (config.detection === true) return { detection: true, line: CALENDLY_DETECTION_ON, offerToken: false };
  return { detection: false, line: CALENDLY_DETECTION_OFF, offerToken: true };
}

/**
 * The webhook endpoint PATH the drawer displays — informational (the token is
 * a capability-URL secret created server-side; detection state is what
 * matters). Displayed as the path portion with a copy affordance, labeled
 * "Webhook endpoint (created automatically)".
 */
export function calendlyWebhookPath(webhookToken: string): string {
  return `/webhooks/calendly?token=${webhookToken}`;
}

// ── stripe config helpers (INT W3 — the calendly helpers' anatomy) ──────────

/** Parse the DTO's `config: unknown` through the REAL core schema; garbage → {}. */
export function parseStripeConfig(config: unknown): StripeConfig {
  const parsed = stripeConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : {};
}

export const STRIPE_DETECTION_ON = "Payment detection live — webhook endpoint active";
export const STRIPE_DETECTION_OFF =
  "Link active — payment detection off. Add a restricted API key (Webhook Endpoints write) to detect payments.";
export const STRIPE_NO_LINK = "No payment link saved yet — add one so leads can pay.";

/** The drawer's detection state line — HONEST from stored config (the calendly stance). */
export function stripeDetectionState(config: StripeConfig): {
  detection: boolean;
  line: string;
  offerKey: boolean;
} {
  if (!config.paymentLinkUrl && config.detection !== true)
    return { detection: false, line: STRIPE_NO_LINK, offerKey: false };
  if (config.detection === true) return { detection: true, line: STRIPE_DETECTION_ON, offerKey: false };
  return { detection: false, line: STRIPE_DETECTION_OFF, offerKey: true };
}

/** The webhook endpoint PATH the drawer displays (created automatically). */
export function stripeWebhookPath(webhookToken: string): string {
  return `/webhooks/stripe?token=${webhookToken}`;
}

// ── webhooks config helpers (INT W3) ────────────────────────────────────────

/** Parse the DTO's `config: unknown` through the REAL core schema; garbage → {}. */
export function parseWebhooksConfig(config: unknown): WebhooksConfig {
  const parsed = webhooksConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : {};
}

// ── hubspot config helpers (INT W4) ─────────────────────────────────────────

/** Parse the DTO's `config: unknown` through the REAL core schema; garbage → {}. */
export function parseHubspotConfig(config: unknown): HubspotConfig {
  const parsed = hubspotConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : {};
}
