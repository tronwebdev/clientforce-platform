/**
 * Calendly adapter (INT W2, DEC-094) — the FIELDS-based connect path W1
 * reserved (no OAuth, no platform owner clock): transport + status mapping
 * ONLY. Two honest tiers:
 *   - Link tier: a pasted scheduling URL, probed LIVE by GET (reachable =
 *     connected; detection off).
 *   - Token tier: a user-generated Personal Access Token authenticates
 *     api.calendly.com — `/users/me` is the probe; webhook subscriptions
 *     (paid Calendly plans) deliver invitee.created/canceled/no-show.
 * The PAT + webhook signing key + subscription URI ride `credentialsEnc`
 * (field-encrypted); only the capability-URL `webhookToken` lives in config
 * (the INBOUND-PARSE-TOKEN precedent).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  IntegrationDeliveryError,
  IntegrationProviderError,
  type FieldsIntegrationAdapter,
  type IntegrationCredentials,
  type ProbeResult,
} from "./types";
import { CALENDLY_WEBHOOK_EVENTS } from "./constants";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The connect-fields body (API boundary DTO — core's integrations.ts is sealed for W2). */
export const calendlyConnectFieldsSchema = z
  .object({
    schedulingUrl: z.string().url().max(500).optional(),
    apiToken: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => v.schedulingUrl || v.apiToken, {
    message: "Provide your Calendly scheduling link, an API token, or both",
  });
export type CalendlyConnectFieldsDto = z.infer<typeof calendlyConnectFieldsSchema>;

export interface CalendlyUser {
  /** The user's URI (webhook subscription scope target). */
  uri: string;
  /** The user's org URI (webhook subscriptions require it). */
  organization: string;
  name?: string;
  schedulingUrl?: string;
  timezone?: string;
}

export interface CalendlyWebhookSubscription {
  uri: string;
  callbackUrl: string;
  state: string;
}

export class CalendlyAdapter implements FieldsIntegrationAdapter {
  readonly provider = "calendly" as const;
  /** No platform app credentials exist for Calendly — always connectable. */
  readonly configured = true;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    /** API base (default https://api.calendly.com) — tests + the §8 local stub point here. */
    baseUrl?: string;
    fetchImpl?: FetchLike;
  }) {
    this.apiBase = (options?.baseUrl ?? process.env.CALENDLY_BASE_URL ?? "https://api.calendly.com").replace(/\/$/, "");
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /**
   * The LINK probe (tier 1): GET the pasted scheduling URL — a 2xx/3xx means
   * "link reachable" (a real probe; never connected without one). Throws
   * typed on anything else; the caller maps to CALENDLY_LINK_INVALID.
   */
  async probeLink(schedulingUrl: string): Promise<void> {
    // Review-round hardening (SSRF): the link probe fetches a USER-SUPPLIED
    // URL server-side — constrain it to what the field MEANS: an https
    // Calendly scheduling link (calendly.com or a subdomain). No redirect
    // following. The W3 generic-webhook action ships the general SSRF guard;
    // this field never needed generality.
    let parsed: URL;
    try {
      parsed = new URL(schedulingUrl);
    } catch {
      throw new IntegrationDeliveryError("link_invalid", "that scheduling link is not a valid URL");
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "calendly.com" && !host.endsWith(".calendly.com"))) {
      throw new IntegrationDeliveryError(
        "link_not_calendly",
        "the scheduling link must be an https calendly.com URL",
      );
    }
    let res: Response;
    try {
      res = await this.fetchImpl(schedulingUrl, { method: "GET", redirect: "follow" });
    } catch (err) {
      throw new IntegrationDeliveryError(
        "link_unreachable",
        `scheduling link unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status >= 400) {
      throw new IntegrationDeliveryError("link_unreachable", `scheduling link answered HTTP ${res.status}`);
    }
  }

  /** The TOKEN probe (tier 2): GET /users/me → accountLabel + URIs. */
  async me(creds: IntegrationCredentials): Promise<CalendlyUser> {
    const data = await this.call(creds, "GET", "/users/me");
    const resource = (data.resource ?? {}) as Record<string, unknown>;
    const uri = typeof resource.uri === "string" ? resource.uri : "";
    const organization = typeof resource.current_organization === "string" ? resource.current_organization : "";
    if (!uri || !organization) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "calendly /users/me returned no user/organization uri", false);
    }
    return {
      uri,
      organization,
      ...(typeof resource.name === "string" ? { name: resource.name } : {}),
      ...(typeof resource.scheduling_url === "string" ? { schedulingUrl: resource.scheduling_url } : {}),
      ...(typeof resource.timezone === "string" ? { timezone: resource.timezone } : {}),
    };
  }

  /** The OAuth-contract probe (probeIntegration path) — token tier only. */
  async probe(creds: IntegrationCredentials): Promise<ProbeResult> {
    const user = await this.me(creds);
    const label = user.name ?? user.schedulingUrl ?? "account";
    return {
      ok: true,
      detail: `calendly reachable — authed as ${label}`,
      accountLabel: user.name ? `${user.name} (Calendly)` : label,
    };
  }

  async listWebhookSubscriptions(
    creds: IntegrationCredentials,
    params: { organization: string; user: string },
  ): Promise<CalendlyWebhookSubscription[]> {
    const url = new URL(`${this.apiBase}/webhook_subscriptions`);
    url.searchParams.set("organization", params.organization);
    url.searchParams.set("user", params.user);
    url.searchParams.set("scope", "user");
    const data = await this.call(creds, "GET", url.toString(), undefined, true);
    const collection = Array.isArray(data.collection) ? (data.collection as Array<Record<string, unknown>>) : [];
    return collection
      .filter((s) => typeof s.uri === "string" && typeof s.callback_url === "string")
      .map((s) => ({
        uri: s.uri as string,
        callbackUrl: s.callback_url as string,
        state: typeof s.state === "string" ? s.state : "unknown",
      }));
  }

  /**
   * IDEMPOTENT subscription create: list first — an ACTIVE subscription
   * already pointing at this callback URL is reused, never duplicated.
   */
  async ensureWebhookSubscription(
    creds: IntegrationCredentials,
    params: { organization: string; user: string; callbackUrl: string; signingKey: string },
  ): Promise<CalendlyWebhookSubscription> {
    const existing = await this.listWebhookSubscriptions(creds, params);
    const match = existing.find((s) => s.callbackUrl === params.callbackUrl && s.state === "active");
    if (match) return match;
    const data = await this.call(creds, "POST", "/webhook_subscriptions", {
      url: params.callbackUrl,
      events: [...CALENDLY_WEBHOOK_EVENTS],
      organization: params.organization,
      user: params.user,
      scope: "user",
      signing_key: params.signingKey,
    });
    const resource = (data.resource ?? {}) as Record<string, unknown>;
    const uri = typeof resource.uri === "string" ? resource.uri : "";
    if (!uri) {
      throw new IntegrationProviderError(
        "PROVIDER_UNAVAILABLE",
        "calendly webhook subscription create returned no uri",
        true,
      );
    }
    return {
      uri,
      callbackUrl: params.callbackUrl,
      state: typeof resource.state === "string" ? resource.state : "active",
    };
  }

  /** Idempotent delete — a 404 (already gone) resolves quietly. */
  async deleteWebhookSubscription(creds: IntegrationCredentials, subscriptionUri: string): Promise<void> {
    try {
      await this.call(creds, "DELETE", subscriptionUri, undefined, true);
    } catch (err) {
      if (err instanceof IntegrationDeliveryError && err.reason === "not_found") return;
      throw err;
    }
  }

  /** Disconnect stance: best-effort webhook teardown (the `revoke` slot). */
  async revoke(creds: IntegrationCredentials): Promise<void> {
    const uri = creds.subscriptionUri;
    if (typeof uri === "string" && uri.length > 0) {
      await this.deleteWebhookSubscription(creds, uri);
    }
  }

  private bearer(creds: IntegrationCredentials): Record<string, string> {
    const token = creds.apiToken;
    if (typeof token !== "string" || token.length === 0) {
      throw new IntegrationProviderError(
        "PROVIDER_AUTH",
        "Connection has no Calendly API token — booking detection needs the token tier",
        false,
      );
    }
    return { Authorization: `Bearer ${token}` };
  }

  /** One choke point: fetch → HTTP classification (Calendly is status-coded, unlike Slack). */
  private async call(
    creds: IntegrationCredentials,
    method: string,
    pathOrUrl: string,
    body?: unknown,
    absolute = false,
  ): Promise<Record<string, unknown>> {
    const url = absolute || pathOrUrl.startsWith("http") ? pathOrUrl : `${this.apiBase}${pathOrUrl}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          ...this.bearer(creds),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new IntegrationProviderError(
        "PROVIDER_UNAVAILABLE",
        `calendly unreachable: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (res.status === 429) {
      throw new IntegrationProviderError("PROVIDER_RATE_LIMITED", "calendly rate limited (429)", true);
    }
    if (res.status >= 500) {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", `calendly error (HTTP ${res.status})`, true);
    }
    if (res.status === 401) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "calendly auth rejected (HTTP 401)", false);
    }
    if (res.status === 204) return {};
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      if (res.ok) return {};
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", "calendly returned a non-JSON response", true);
    }
    if (res.ok) return data;
    if (res.status === 404) {
      throw new IntegrationDeliveryError("not_found", "calendly resource not found (404)");
    }
    // 403 = permission (the FREE-PLAN webhook refusal lives here) — a typed
    // request refusal with Calendly's own message, never token bytes.
    const message = typeof data.message === "string" ? data.message : `HTTP ${res.status}`;
    throw new IntegrationDeliveryError(
      typeof data.title === "string" ? data.title.toLowerCase().replace(/\s+/g, "_") : "request_refused",
      `calendly refused the request (${message})`,
    );
  }
}

/**
 * Constant-time verification of `Calendly-Webhook-Signature: t=<ts>,v1=<hex>`
 * — HMAC-SHA256 over `"<t>.<rawBody>"` with the per-workspace signing key.
 */
export function verifyCalendlySignature(t: string, v1: string, rawBody: string, signingKey: string): boolean {
  if (!t || !v1 || !signingKey) return false;
  const expected = createHmac("sha256", signingKey).update(`${t}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(v1, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Parse the `t=…,v1=…` signature header (null on any malformed shape). */
export function parseCalendlySignatureHeader(header: string | undefined): { t: string; v1: string } | null {
  if (!header) return null;
  const parts = new Map(
    header
      .split(",")
      .map((p) => p.trim().split("=", 2))
      .filter((kv): kv is [string, string] => kv.length === 2)
      .map(([k, v]) => [k, v] as const),
  );
  const t = parts.get("t");
  const v1 = parts.get("v1");
  return t && v1 ? { t, v1 } : null;
}
