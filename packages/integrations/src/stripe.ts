/**
 * Stripe adapter (INT W3, DEC-095) — the Calendly two-tier anatomy on
 * payments: transport + status mapping ONLY.
 *   - Link tier: a pasted Payment Link URL, probed LIVE by GET (reachable =
 *     connected; detection off). The per-lead correlation rider is
 *     `?client_reference_id=<contactId>` — Stripe's official passthrough
 *     into checkout.session.completed.
 *   - Key tier: a user-generated RESTRICTED API key (needs Webhook Endpoints
 *     write) authenticates api.stripe.com — `/v1/account` is the probe;
 *     `POST /v1/webhook_endpoints` registers checkout.session.completed and
 *     STRIPE MINTS THE SIGNING SECRET in the create response.
 * The key + endpoint signing secret + endpoint id ride `credentialsEnc`
 * (field-encrypted); only the capability-URL `webhookToken` lives in config
 * (the calendly precedent). Stripe-Signature verifies with the SAME
 * `t=…,v1=HMAC-SHA256(secret, "t.rawBody")` scheme as Calendly — the one
 * constant-time comparator is shared.
 */
import { z } from "zod";
import {
  IntegrationDeliveryError,
  IntegrationProviderError,
  type FieldsIntegrationAdapter,
  type IntegrationCredentials,
  type ProbeResult,
} from "./types";
import { STRIPE_WEBHOOK_EVENTS } from "./constants";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The connect-fields body (API boundary DTO — the calendly twin). */
export const stripeConnectFieldsSchema = z
  .object({
    paymentLinkUrl: z.string().url().max(500).optional(),
    apiKey: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => v.paymentLinkUrl || v.apiKey, {
    message: "Provide your Stripe Payment Link, a restricted API key, or both",
  });
export type StripeConnectFieldsDto = z.infer<typeof stripeConnectFieldsSchema>;

export interface StripeAccount {
  id: string;
  businessName?: string;
}

export interface StripeWebhookEndpoint {
  id: string;
  url: string;
  /** Present ONLY on create — Stripe never re-shows it. */
  secret?: string;
  status: string;
}

export class StripeAdapter implements FieldsIntegrationAdapter {
  readonly provider = "stripe" as const;
  /** No platform app credentials exist for Stripe — always connectable. */
  readonly configured = true;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    /** API base (default https://api.stripe.com) — tests + the §8 local stub point here. */
    baseUrl?: string;
    fetchImpl?: FetchLike;
  }) {
    this.apiBase = (options?.baseUrl ?? process.env.STRIPE_BASE_URL ?? "https://api.stripe.com").replace(/\/$/, "");
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /**
   * The LINK probe (tier 1): GET the pasted Payment Link — 2xx/3xx means
   * "link reachable". SSRF stance identical to the Calendly link probe: the
   * field MEANS a Stripe payment link, so the host is pinned to
   * buy.stripe.com / stripe.com (subdomains included), https only.
   */
  async probeLink(paymentLinkUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(paymentLinkUrl);
    } catch {
      throw new IntegrationDeliveryError("link_invalid", "that payment link is not a valid URL");
    }
    const host = parsed.hostname.toLowerCase();
    const stripeHost = host === "stripe.com" || host.endsWith(".stripe.com");
    if (parsed.protocol !== "https:" || !stripeHost) {
      throw new IntegrationDeliveryError(
        "link_not_stripe",
        "the payment link must be an https stripe.com URL (buy.stripe.com payment links)",
      );
    }
    let res: Response;
    try {
      res = await this.fetchImpl(paymentLinkUrl, { method: "GET", redirect: "follow" });
    } catch (err) {
      throw new IntegrationDeliveryError(
        "link_unreachable",
        `payment link unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status >= 400) {
      throw new IntegrationDeliveryError("link_unreachable", `payment link answered HTTP ${res.status}`);
    }
  }

  /** The KEY probe (tier 2): GET /v1/account → accountLabel "Business (acct_…)". */
  async account(creds: IntegrationCredentials): Promise<StripeAccount> {
    const data = await this.call(creds, "GET", "/v1/account");
    const id = typeof data.id === "string" ? data.id : "";
    if (!id) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "stripe /v1/account returned no account id", false);
    }
    const settings = (data.settings ?? {}) as { dashboard?: { display_name?: unknown } };
    const displayName =
      typeof settings.dashboard?.display_name === "string" ? settings.dashboard.display_name : undefined;
    const businessProfile = (data.business_profile ?? {}) as { name?: unknown };
    const businessName =
      typeof businessProfile.name === "string" ? businessProfile.name : displayName;
    return { id, ...(businessName ? { businessName } : {}) };
  }

  async probe(creds: IntegrationCredentials): Promise<ProbeResult> {
    const account = await this.account(creds);
    const label = account.businessName ? `${account.businessName} (${account.id})` : account.id;
    return { ok: true, detail: `stripe reachable — authed as ${label}`, accountLabel: label };
  }

  async listWebhookEndpoints(creds: IntegrationCredentials): Promise<StripeWebhookEndpoint[]> {
    const data = await this.call(creds, "GET", "/v1/webhook_endpoints?limit=100");
    const rows = Array.isArray(data.data) ? (data.data as Array<Record<string, unknown>>) : [];
    return rows
      .filter((e) => typeof e.id === "string" && typeof e.url === "string")
      .map((e) => ({
        id: e.id as string,
        url: e.url as string,
        status: typeof e.status === "string" ? e.status : "unknown",
      }));
  }

  /**
   * IDEMPOTENT endpoint create: an ENABLED endpoint already pointing at this
   * callback URL is reused — but Stripe only reveals the signing secret at
   * create time, so reuse WITHOUT a stored secret is a typed refusal (the
   * caller deletes + recreates, or the owner removes the stale endpoint).
   */
  async ensureWebhookEndpoint(
    creds: IntegrationCredentials,
    params: { callbackUrl: string },
  ): Promise<StripeWebhookEndpoint> {
    const existing = await this.listWebhookEndpoints(creds);
    const match = existing.find((e) => e.url === params.callbackUrl && e.status === "enabled");
    if (match) return match; // secret ABSENT — the caller decides (stored vs refuse)
    const body = new URLSearchParams();
    body.set("url", params.callbackUrl);
    for (const [i, ev] of STRIPE_WEBHOOK_EVENTS.entries()) body.set(`enabled_events[${i}]`, ev);
    const data = await this.call(creds, "POST", "/v1/webhook_endpoints", body);
    const id = typeof data.id === "string" ? data.id : "";
    if (!id) {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", "stripe webhook endpoint create returned no id", true);
    }
    return {
      id,
      url: params.callbackUrl,
      ...(typeof data.secret === "string" ? { secret: data.secret } : {}),
      status: typeof data.status === "string" ? data.status : "enabled",
    };
  }

  /** Idempotent delete — a 404/resource_missing resolves quietly. */
  async deleteWebhookEndpoint(creds: IntegrationCredentials, endpointId: string): Promise<void> {
    try {
      await this.call(creds, "DELETE", `/v1/webhook_endpoints/${endpointId}`);
    } catch (err) {
      if (err instanceof IntegrationDeliveryError && err.reason === "resource_missing") return;
      throw err;
    }
  }

  /** Disconnect stance: best-effort endpoint teardown (the `revoke` slot). */
  async revoke(creds: IntegrationCredentials): Promise<void> {
    const id = creds.webhookEndpointId;
    if (typeof id === "string" && id.length > 0) {
      await this.deleteWebhookEndpoint(creds, id);
    }
  }

  private bearer(creds: IntegrationCredentials): Record<string, string> {
    const key = creds.apiKey;
    if (typeof key !== "string" || key.length === 0) {
      throw new IntegrationProviderError(
        "PROVIDER_AUTH",
        "Connection has no Stripe API key — payment detection needs the key tier",
        false,
      );
    }
    return { Authorization: `Bearer ${key}` };
  }

  /** One choke point: fetch → HTTP classification (Stripe error bodies carry {error:{type,code}}). */
  private async call(
    creds: IntegrationCredentials,
    method: string,
    path: string,
    body?: URLSearchParams,
  ): Promise<Record<string, unknown>> {
    // Bearer resolution OUTSIDE the network try — a missing key is
    // PROVIDER_AUTH, never "stripe unreachable".
    const headers = {
      ...this.bearer(creds),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers,
        ...(body ? { body: body.toString() } : {}),
      });
    } catch (err) {
      throw new IntegrationProviderError(
        "PROVIDER_UNAVAILABLE",
        `stripe unreachable: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (res.status === 429) {
      throw new IntegrationProviderError("PROVIDER_RATE_LIMITED", "stripe rate limited (429)", true);
    }
    if (res.status >= 500) {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", `stripe error (HTTP ${res.status})`, true);
    }
    if (res.status === 401) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "stripe auth rejected (HTTP 401)", false);
    }
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", "stripe returned a non-JSON response", true);
    }
    if (res.ok) return data;
    const error = (data.error ?? {}) as { type?: unknown; code?: unknown; message?: unknown };
    const code = typeof error.code === "string" ? error.code : "request_failed";
    const message = typeof error.message === "string" ? error.message : `HTTP ${res.status}`;
    // 403 = a restricted key missing the needed permission — a CONFIG refusal
    // the connect flow renders typed (never token death, never vendor-down).
    throw new IntegrationDeliveryError(code, `stripe refused the request (${message})`);
  }
}
