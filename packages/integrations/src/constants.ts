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

/** UTC day floor — the allowance window boundary. */
export const utcDayStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
