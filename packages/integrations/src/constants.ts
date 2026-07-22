/**
 * Integrations spine constants (INT W1, DEC-093). Env-tunable with owner-safe
 * defaults — the validation-constants pattern.
 */

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Per-workspace daily outbound-delivery allowance (Slack posts now, webhook
 * POSTs in W3). Slack's API is free — this is the STORM brake, not a spend
 * meter: a misconfigured rule must not flood a customer's channel. Tripping
 * it holds deliveries for the day (honest `held` rows + a rising-edge
 * `integration.delivery_held.v1` + the vendor-spine COST ALERT log line);
 * delivery resumes silently the next UTC day.
 */
export const INTEGRATION_DAILY_DELIVERY_ALLOWANCE = envInt(
  "INTEGRATION_DAILY_DELIVERY_ALLOWANCE",
  500,
);

/**
 * The Slack scopes Clientforce requests (drawer "Clientforce will be able to"
 * renders what was GRANTED, not this wish list): post to the picked channel
 * (public channels without a join via chat:write.public) + list channels for
 * the picker.
 */
export const SLACK_SCOPES = ["chat:write", "chat:write.public", "channels:read"] as const;

/**
 * INT W2 (DEC-094): Google Calendar scopes — READONLY ONLY, deliberately.
 * W2 never creates events (Calendly puts bookings on the connected calendar
 * natively); requesting `calendar.events` would be scope theater. The write
 * wave adds it via Google's incremental auth. Owner-flagged default.
 */
export const GCAL_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"] as const;

/**
 * INT W2: the Calendly webhook subscription's event set — booked, canceled,
 * and no-show (the canon's canceled + no-show fold into ONE trigger kind via
 * the `calendar.canceled.v1` payload reason).
 */
export const CALENDLY_WEBHOOK_EVENTS = [
  "invitee.created",
  "invitee.canceled",
  "invitee_no_show.created",
] as const;

/**
 * INT W3 (DEC-095): the Stripe webhook endpoint's event set — checkout
 * completion is the ONE payment moment this wave ingests (payment links
 * complete through Checkout; refunds/disputes/invoices stay out).
 */
export const STRIPE_WEBHOOK_EVENTS = ["checkout.session.completed"] as const;

/**
 * INT W3: the outbound `send_webhook` action's delivery constraints — the
 * general SSRF guard's port allowlist and response caps.
 */
export const WEBHOOK_ALLOWED_PORTS = [443, 8443] as const;
export const WEBHOOK_TIMEOUT_MS = 5_000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 4_096;

/** Refresh skew: tokens within this window of expiry refresh proactively. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

/** Freebusy-derived slots stay fresh this long; stale = the slots line is omitted. */
export const SLOTS_CACHE_TTL_MS = 15 * 60_000;

/** UTC day floor — the allowance window boundary. */
export const utcDayStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
