/**
 * Integrations REST DTOs + the ONE provider registry (INT W1, DEC-093).
 *
 * One connection model: an `Integration` row per (workspace, provider), tokens
 * field-encrypted in the DB under FIELD-ENCRYPTION-KEY (the SenderConnection /
 * DEC-030 rule — per-tenant secrets never live in Key Vault, never plaintext),
 * status probe-backed (never "connected" without a live token probe). Every
 * provider is an adapter on the vendor spine (`@clientforce/integrations`);
 * this file is the vocabulary the API, web surface, and engine share — the
 * campaign-rules "one union" stance ported to providers.
 */
import { z } from "zod";

/**
 * Providers with a LIVE adapter. Wave-gated: slack (W1) · gcal + calendly (W2)
 * · stripe + webhook (W3) · hubspot (W4). The web card grid renders the wider
 * prototype canon; anything not in this list is honest-absent there and the
 * API refuses it typed — the picker↔vocabulary drift test pins the two ends.
 */
export const INTEGRATION_PROVIDERS = ["slack", "gcal", "calendly", "stripe", "webhooks", "hubspot"] as const;
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export const isIntegrationProvider = (value: string): value is IntegrationProvider =>
  (INTEGRATION_PROVIDERS as readonly string[]).includes(value);

/**
 * Probe-backed connection states (honest by construction):
 * - `connected`  — the last live token probe succeeded.
 * - `unhealthy`  — the probe failed retryably (vendor down / rate limited);
 *                  the token may still be good, we say so instead of guessing.
 * - `revoked`    — the probe failed PROVIDER_AUTH: the token is dead. The UI
 *                  renders this as disconnected-with-a-reason; reconnect is
 *                  the only repair.
 * A row that never probed successfully is never shown as connected; a
 * user-initiated disconnect DELETES the row (the ledger outlives it — the
 * automation.deleted precedent).
 */
export const INTEGRATION_STATUSES = ["connected", "unhealthy", "revoked"] as const;
export const integrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

/** Slack workspace-notification kinds (W1) — the three owner-facing moments. */
export const SLACK_NOTIFICATION_KINDS = ["new_reply", "meeting_booked", "goal_completed"] as const;
export type SlackNotificationKind = (typeof SLACK_NOTIFICATION_KINDS)[number];

/**
 * Per-provider user config (`Integration.config`). Secrets NEVER ride here —
 * config is returned verbatim by the list/detail endpoints.
 */
export const slackConfigSchema = z
  .object({
    /** The channel Clientforce posts to — picked per workspace (drawer step 2). */
    channel: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict().optional(),
    notifications: z
      .object({
        new_reply: z.boolean().optional(),
        meeting_booked: z.boolean().optional(),
        goal_completed: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  // Strict at every level (the contact-fields precedent + review-round pin):
  // a typo'd toggle key must refuse loudly at the boundary, never be
  // silently stripped into a config that "took" but does nothing.
  .strict();
export type SlackConfig = z.infer<typeof slackConfigSchema>;

/**
 * INT W2 (DEC-094): Google Calendar — the picked calendar (its OWN timeZone
 * from calendarList, stored at picker time) + whether composed copy may carry
 * a deterministic open-slots line.
 */
export const gcalConfigSchema = z
  .object({
    calendar: z.object({ id: z.string().min(1), name: z.string().min(1), timeZone: z.string().min(1) }).strict().optional(),
    offerSlots: z.boolean().optional(),
  })
  .strict();
export type GcalConfig = z.infer<typeof gcalConfigSchema>;

/**
 * INT W2: Calendly, two honest tiers — the scheduling LINK works day one
 * (config only); booking DETECTION additionally needs the API-token connect
 * (webhookToken = the per-workspace capability-URL token; detection reflects
 * a LIVE webhook subscription, never assumed).
 */
export const calendlyConfigSchema = z
  .object({
    schedulingUrl: z.string().url().max(500).optional(),
    webhookToken: z.string().min(1).optional(),
    detection: z.boolean().optional(),
  })
  .strict();
export type CalendlyConfig = z.infer<typeof calendlyConfigSchema>;

/**
 * INT W3 (DEC-095): Stripe, the Calendly two-tier anatomy — the PAYMENT LINK
 * works day one (config only, `?client_reference_id=<contactId>` per lead);
 * payment DETECTION additionally needs the restricted-key connect (Stripe
 * mints the endpoint signing secret; webhookToken = the per-workspace
 * capability-URL token; detection reflects a LIVE webhook endpoint).
 */
export const stripeConfigSchema = z
  .object({
    paymentLinkUrl: z.string().url().max(500).optional(),
    webhookToken: z.string().min(1).optional(),
    detection: z.boolean().optional(),
  })
  .strict();
export type StripeConfig = z.infer<typeof stripeConfigSchema>;

/**
 * INT W3: the outbound Webhooks integration (the DATA_MODEL §6 sketch's
 * url+secret half) — the workspace default Payload URL the `send_webhook`
 * action falls back to, plus the server-minted signing secret the receiver
 * verifies with. The secret rides config deliberately (the calendly
 * webhookToken capability precedent — redacted below OWNER/ADMIN); the
 * canon's events-pick stream half is NOT built (re-filed).
 */
export const webhooksConfigSchema = z
  .object({
    defaultUrl: z.string().url().max(500).optional(),
    signingSecret: z.string().min(1).optional(),
  })
  .strict();
export type WebhooksConfig = z.infer<typeof webhooksConfigSchema>;

/**
 * INT W4 (DEC-096): HubSpot one-way CRM push. The private-app token is a
 * CREDENTIAL (rides credentialsEnc, never config — the Calendly/Stripe token
 * precedent); config holds only the non-secret HubSpot portal id (for the
 * accountLabel) and the optional default pipeline the `create_crm_deal` action
 * lands new deals in. No two-way sync (recorded Q).
 */
export const hubspotConfigSchema = z
  .object({
    portalId: z.string().min(1).optional(),
    defaultPipeline: z.string().min(1).optional(),
  })
  .strict();
export type HubspotConfig = z.infer<typeof hubspotConfigSchema>;

export const integrationConfigSchemas: Record<IntegrationProvider, z.ZodTypeAny> = {
  slack: slackConfigSchema,
  gcal: gcalConfigSchema,
  calendly: calendlyConfigSchema,
  stripe: stripeConfigSchema,
  webhooks: webhooksConfigSchema,
  hubspot: hubspotConfigSchema,
};

export const updateIntegrationSchema = z.object({
  config: z.unknown(),
});
export type UpdateIntegrationDto = z.infer<typeof updateIntegrationSchema>;

/** OAuth completion (the web callback route forwards code+state verbatim). */
export const completeIntegrationSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type CompleteIntegrationDto = z.infer<typeof completeIntegrationSchema>;

/** One row of the list/detail response — never carries token material. */
export interface IntegrationDto {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  /** Vendor-side account display ("BrightPath workspace") — probe-sourced. */
  accountLabel: string | null;
  /** Scopes the vendor actually granted (drawer "Clientforce will be able to"). */
  scopes: string[];
  config: unknown;
  lastProbeAt: string | null;
  /** Newest successful outbound moment (delivery/sync) — drawer "Last sync". */
  lastSyncAt: string | null;
  connectedAt: string;
}

/** Typed refusal detail strings (the ACCOUNT_ACTION_REFUSAL convention). */
export const INTEGRATION_REFUSALS = {
  UNKNOWN_PROVIDER: "Unknown integration provider",
  NOT_CONFIGURED:
    "This integration's app credentials are not configured on the platform yet — connecting is disabled until the owner setup completes",
  NOT_CONNECTED: "This integration is not connected",
  STATE_INVALID: "The OAuth state token is invalid or expired — restart the connect flow",
  BOOKING_NOT_CONFIGURED:
    "No booking link is configured — connect Calendly (paste your scheduling link) first",
  CALENDLY_LINK_INVALID: "That scheduling link isn't reachable — check the URL and try again",
  CALENDLY_TOKEN_REQUIRED_FOR_DETECTION:
    "Booking detection needs a Calendly API token (available on paid Calendly plans) — the link keeps working without it",
  PAYMENT_NOT_CONFIGURED:
    "No payment link is configured — connect Stripe (paste your Payment Link) first",
  STRIPE_LINK_INVALID: "That payment link isn't reachable — check the URL and try again",
  STRIPE_TOKEN_REQUIRED_FOR_DETECTION:
    "Payment detection needs a restricted Stripe API key with Webhook Endpoints write — the link keeps working without it",
  WEBHOOK_URL_REQUIRED:
    "No destination URL — set a default Payload URL on the Webhooks integration, or put one on the action",
  WEBHOOK_URL_UNSAFE:
    "That destination was refused by the delivery guard — webhooks POST to public https endpoints only (no private or internal addresses, ports 443/8443)",
  // INT W4 (DEC-096): HubSpot one-way CRM push.
  HUBSPOT_TOKEN_INVALID:
    "That HubSpot private-app token was rejected — check it has the crm.objects.deals.write and crm.objects.contacts.write scopes",
  CRM_DEAL_MISSING:
    "No HubSpot deal on this contact yet — add a “Create CRM deal” step before “Update deal stage”",
  CRM_PUSH_REFUSED: "HubSpot refused the request — check the pipeline/stage names and the token scopes",
} as const;
