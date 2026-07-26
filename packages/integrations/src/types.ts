/**
 * The integrations vendor spine (INT W1, DEC-093) — the LH1/ZeroBounce seam
 * ported to OAuth providers. The invariant holds: adapters do TRANSPORT +
 * status mapping ONLY; gating, allowance rails, persistence, and event
 * emission live in the service/notifier so a vendor is swappable by
 * replacing one class.
 */
import type { Prisma, PrismaClient } from "@clientforce/db";
import type { EventInput, EventType } from "@clientforce/events";
import type { IntegrationProvider } from "@clientforce/core";

/** Publishes on the T2 bus — the automations PublishFn shape, verbatim. */
export type PublishFn = <T extends EventType>(input: EventInput<T>) => Promise<unknown>;

/**
 * Vendor-failure taxonomy (the ValidationProviderError codes, verbatim):
 * AUTH is terminal for the token (→ status `revoked`), the other two are
 * transient (→ status `unhealthy`).
 */
export type IntegrationProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_AUTH";

/** Typed refusal for vendor failures — never a silent partial result. */
export class IntegrationProviderError extends Error {
  constructor(
    public readonly code: IntegrationProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "IntegrationProviderError";
  }
}

/**
 * Typed refusal for a single delivery the VENDOR is fine with but the
 * request isn't (channel_not_found, msg_too_long, missing_scope …) — a
 * config problem surfaced honestly on the delivery row, never an outage.
 */
export class IntegrationDeliveryError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationDeliveryError";
  }
}

/** Decrypted per-connection credential blob (adapter-shaped, never logged). */
export type IntegrationCredentials = Record<string, unknown>;

export interface ProbeResult {
  ok: boolean;
  detail: string;
  /** Vendor-side account display, refreshed on every successful probe. */
  accountLabel?: string;
}

export interface ExchangeResult {
  /** Goes straight to encryptField — the service never inspects secrets. */
  credentials: IntegrationCredentials;
  /** Scopes the vendor actually granted (drawer "Clientforce will be able to"). */
  scopes: string[];
  accountLabel?: string;
}

/**
 * The OAuth adapter contract (W1). `configured` is the honest-absence gate:
 * without platform app credentials the connect endpoint refuses typed
 * (INTEGRATION_REFUSALS.NOT_CONFIGURED) and the UI says so — never a broken
 * redirect. Non-OAuth adapters (W3 webhook) get their own connect path.
 */
/**
 * INT W2 (DEC-094): the shared adapter base BOTH connect shapes implement.
 * W1's OAuth contract extends it unchanged; the fields shape (Calendly) is
 * the non-OAuth connect path W1 reserved ("Non-OAuth adapters … get their
 * own connect path").
 */
export interface IntegrationAdapter {
  readonly provider: IntegrationProvider;
  readonly configured: boolean;
  /** The live token probe — connection status is never asserted without it. */
  probe(creds: IntegrationCredentials): Promise<ProbeResult>;
  /** Best-effort vendor-side revoke on disconnect (failures logged, not thrown). */
  revoke?(creds: IntegrationCredentials): Promise<void>;
  /**
   * INT W2 (DEC-094, ADDITIVE): providers whose access tokens expire (Google)
   * implement this — the service's `withFreshCredentials` refreshes, re-encrypts
   * and persists before vendor calls. Slack has NO refresh method and stays
   * byte-identical (regression-pinned). `invalid_grant` throws PROVIDER_AUTH —
   * the refresh token is dead, the row flips to the honest `revoked` state.
   */
  refresh?(creds: IntegrationCredentials): Promise<IntegrationCredentials>;
}

/** The OAuth adapter contract (W1) — unchanged members, now on the shared base. */
export interface OAuthIntegrationAdapter extends IntegrationAdapter {
  authorizeUrl(params: { redirectUri: string; state: string }): string;
  exchangeCode(params: { code: string; redirectUri: string }): Promise<ExchangeResult>;
}

/**
 * A fields adapter connects from user-pasted fields (Calendly: scheduling
 * link + optional API token) — the connect is still PROBE-BACKED (the
 * service's `connectCalendlyFields` performs the live probes and refuses
 * typed on failure; the row is never "connected" without one).
 */
export interface FieldsIntegrationAdapter extends IntegrationAdapter {
  /** Marker: fields adapters carry no platform app credentials (`configured` is always true). */
  readonly configured: true;
}

export interface IntegrationsDeps {
  /** RLS-subject app client — reads/writes go through `withTenant`. */
  prisma: PrismaClient;
  /** Optional (the delivery row is the history either way — the R1 stance). */
  publish?: PublishFn;
  adapters: Partial<Record<IntegrationProvider, IntegrationAdapter>>;
  log?: (msg: string) => void;
  now?: () => Date;
  config?: {
    /** Per-workspace daily outbound delivery allowance (storm brake). */
    dailyDeliveryAllowance?: number;
  };
}

/** Prisma row alias so service/notifier signatures stay readable. */
export type IntegrationRow = Prisma.IntegrationGetPayload<Record<string, never>>;
