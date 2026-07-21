/**
 * Slack adapter (INT W1, DEC-093) — transport + status mapping ONLY, the
 * ZeroBounce adapter stance. Platform app credentials resolve from Key Vault
 * (SLACK-CLIENT-ID / SLACK-CLIENT-SECRET → env); per-connection tokens are
 * handed in decrypted by the service and never touch this module's state.
 *
 * Slack's API quirk: errors usually arrive as HTTP 200 + `{ ok: false,
 * error: "invalid_auth" }` — classification is by error string first, HTTP
 * status second.
 */
import {
  IntegrationDeliveryError,
  IntegrationProviderError,
  type ExchangeResult,
  type IntegrationCredentials,
  type OAuthIntegrationAdapter,
  type ProbeResult,
} from "./types";
import { SLACK_SCOPES } from "./constants";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Token-is-dead error strings → PROVIDER_AUTH (status `revoked`). */
const AUTH_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "no_permission",
  "org_login_required",
]);

export interface SlackChannel {
  id: string;
  name: string;
}

export class SlackAdapter implements OAuthIntegrationAdapter {
  readonly provider = "slack" as const;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly apiBase: string;
  private readonly authorizeBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    clientId?: string;
    clientSecret?: string;
    /** API base (default https://slack.com/api) — tests + the §8 local stub point here. */
    baseUrl?: string;
    authorizeBaseUrl?: string;
    fetchImpl?: FetchLike;
  }) {
    this.clientId = options?.clientId ?? process.env.SLACK_CLIENT_ID;
    this.clientSecret = options?.clientSecret ?? process.env.SLACK_CLIENT_SECRET;
    this.apiBase = (options?.baseUrl ?? process.env.SLACK_BASE_URL ?? "https://slack.com/api").replace(/\/$/, "");
    this.authorizeBase =
      options?.authorizeBaseUrl ??
      process.env.SLACK_AUTHORIZE_URL ??
      "https://slack.com/oauth/v2/authorize";
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  authorizeUrl(params: { redirectUri: string; state: string }): string {
    if (!this.configured) {
      throw new IntegrationProviderError(
        "PROVIDER_AUTH",
        "Slack app credentials missing — they resolve from Key Vault secrets SLACK-CLIENT-ID / SLACK-CLIENT-SECRET.",
        false,
      );
    }
    const url = new URL(this.authorizeBase);
    url.searchParams.set("client_id", this.clientId as string);
    url.searchParams.set("scope", SLACK_SCOPES.join(","));
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("state", params.state);
    return url.toString();
  }

  async exchangeCode(params: { code: string; redirectUri: string }): Promise<ExchangeResult> {
    if (!this.configured) {
      throw new IntegrationProviderError(
        "PROVIDER_AUTH",
        "Slack app credentials missing — they resolve from Key Vault secrets SLACK-CLIENT-ID / SLACK-CLIENT-SECRET.",
        false,
      );
    }
    const body = new URLSearchParams({
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
      code: params.code,
      redirect_uri: params.redirectUri,
    });
    const data = await this.call("oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const accessToken = data.access_token;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "Slack token exchange returned no access token", false);
    }
    const team = (data.team ?? {}) as { id?: string; name?: string };
    return {
      credentials: { accessToken, teamId: team.id ?? null, botUserId: data.bot_user_id ?? null },
      scopes: typeof data.scope === "string" ? data.scope.split(",").filter(Boolean) : [],
      ...(team.name ? { accountLabel: `${team.name} workspace` } : {}),
    };
  }

  async probe(creds: IntegrationCredentials): Promise<ProbeResult> {
    const data = await this.call("auth.test", {
      method: "POST",
      headers: this.bearer(creds),
    });
    const team = typeof data.team === "string" ? data.team : undefined;
    return {
      ok: true,
      detail: `slack reachable — authed to ${team ?? "workspace"}`,
      ...(team ? { accountLabel: `${team} workspace` } : {}),
    };
  }

  async listChannels(creds: IntegrationCredentials): Promise<SlackChannel[]> {
    // Follow the cursor to completion (review-round hardening): a workspace
    // past one page must never get a silently partial picker. Bounded at 25
    // pages (5,000 channels) — beyond that we refuse typed, never truncate.
    const collected: SlackChannel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 25; page += 1) {
      const url = new URL(`${this.apiBase}/conversations.list`);
      url.searchParams.set("types", "public_channel");
      url.searchParams.set("exclude_archived", "true");
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const data = await this.call(url.toString(), { method: "GET", headers: this.bearer(creds) }, true);
      const channels = Array.isArray(data.channels) ? (data.channels as Array<{ id?: string; name?: string }>) : [];
      for (const c of channels) {
        if (typeof c.id === "string" && typeof c.name === "string") collected.push({ id: c.id, name: c.name });
      }
      const next = (data.response_metadata as { next_cursor?: string } | undefined)?.next_cursor;
      if (!next) return collected.sort((a, b) => a.name.localeCompare(b.name));
      cursor = next;
    }
    throw new IntegrationProviderError(
      "PROVIDER_UNAVAILABLE",
      "slack channel list exceeded 5,000 entries — refusing to return a partial list",
      true,
    );
  }

  async postMessage(creds: IntegrationCredentials, params: { channelId: string; text: string }): Promise<void> {
    await this.call("chat.postMessage", {
      method: "POST",
      headers: { ...this.bearer(creds), "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: params.channelId, text: params.text }),
    });
  }

  async revoke(creds: IntegrationCredentials): Promise<void> {
    await this.call("auth.revoke", { method: "POST", headers: this.bearer(creds) });
  }

  private bearer(creds: IntegrationCredentials): Record<string, string> {
    const token = creds.accessToken;
    if (typeof token !== "string" || token.length === 0) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "Connection has no access token", false);
    }
    return { Authorization: `Bearer ${token}` };
  }

  /** One choke point: fetch → HTTP classification → `ok:false` classification. */
  private async call(
    method: string,
    init: RequestInit,
    absolute = false,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(absolute ? method : `${this.apiBase}/${method}`, init);
    } catch (err) {
      throw new IntegrationProviderError(
        "PROVIDER_UNAVAILABLE",
        `slack unreachable: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (res.status === 429) {
      throw new IntegrationProviderError("PROVIDER_RATE_LIMITED", "slack rate limited (429)", true);
    }
    if (res.status >= 500) {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", `slack error (HTTP ${res.status})`, true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new IntegrationProviderError("PROVIDER_AUTH", `slack auth rejected (HTTP ${res.status})`, false);
    }
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", "slack returned a non-JSON response", true);
    }
    if (data.ok === true) return data;
    const error = typeof data.error === "string" ? data.error : "unknown_error";
    if (AUTH_ERRORS.has(error)) {
      throw new IntegrationProviderError("PROVIDER_AUTH", `slack auth rejected (${error})`, false);
    }
    if (error === "ratelimited" || error === "rate_limited") {
      throw new IntegrationProviderError("PROVIDER_RATE_LIMITED", `slack rate limited (${error})`, true);
    }
    if (error === "internal_error" || error === "fatal_error" || error === "service_unavailable") {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", `slack error (${error})`, true);
    }
    // Everything else is a request/config refusal (channel_not_found,
    // missing_scope, is_archived, msg_too_long …) — typed, non-retryable,
    // surfaced on the delivery row.
    throw new IntegrationDeliveryError(error, `slack refused the request (${error})`);
  }
}
