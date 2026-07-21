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
  isIntegrationProvider,
  slackConfigSchema,
  type IntegrationProvider,
  type IntegrationStatus,
  type SlackConfig,
  type SlackNotificationKind,
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

/** Owner-readable honest-absent reasons (the automations ledger phrasing). */
const ABSENT_REASONS: Record<string, string> = {
  hubspot: "Arrives with the CRM sync wave (this unit, W4)",
  gcal: "Arrives with the calendar & booking wave (this unit, W2)",
  calendly: "Arrives with the calendar & booking wave (this unit, W2)",
  stripe: "Arrives with the payments wave (this unit, W3)",
  webhooks: "Arrives with the webhooks wave (this unit, W3)",
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
  { id: "hubspot", name: "HubSpot", cat: "crm", glyph: "H", tile: "cyan", desc: "Two-way sync of contacts, deals & lifecycle stages." },
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

// ── Slack drawer canon content ──────────────────────────────────────────────

/** Display labels for the engine's three notification kinds (drift-guarded). */
export const SLACK_NOTIFICATION_LABELS: Record<SlackNotificationKind, string> = {
  new_reply: "New reply alerts",
  meeting_booked: "Meeting booked alerts",
  goal_completed: "Goal completed alerts",
};

/** The "What's syncing" rows — derived from the core union, never a fork. */
export const SLACK_SYNC_ROWS: ReadonlyArray<{ kind: SlackNotificationKind; label: string }> =
  SLACK_NOTIFICATION_KINDS.map((kind) => ({ kind, label: SLACK_NOTIFICATION_LABELS[kind] }));

/** Auth-step "Clientforce will be able to" list (dispatch-locked copy). */
export const SLACK_AUTH_PERMS: readonly string[] = [
  "Post alerts to the channel you pick",
  "See your public channel list",
];

/** Setup timeline copy (connected mode renders it all-✓ per the prototype). */
export const SLACK_SETUP_STEPS: ReadonlyArray<{ title: string; desc: string }> = [
  { title: "Sign in with Slack", desc: "Authorize Clientforce via secure OAuth." },
  { title: "Pick a channel", desc: "Where Clientforce posts updates." },
  { title: "Confirm & go live", desc: "Review and start syncing automatically." },
];

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
