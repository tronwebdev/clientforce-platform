/**
 * Google Calendar adapter (INT W2, DEC-094) — the SlackAdapter anatomy on
 * Google's OAuth: transport + status mapping ONLY. Platform app credentials
 * resolve from Key Vault (GOOGLE-CLIENT-ID / GOOGLE-CLIENT-SECRET → env);
 * per-connection tokens are handed in decrypted by the service and never
 * touch this module's state.
 *
 * Google's quirk vs Slack: ACCESS TOKENS EXPIRE (~1h). `exchangeCode` stores
 * `{accessToken, refreshToken, expiresAt}`; the service's
 * `withFreshCredentials` calls `refresh()` before vendor calls and
 * re-encrypts. `invalid_grant` (dead/revoked refresh token) classifies as
 * PROVIDER_AUTH — terminal, the row flips to the honest `revoked` state.
 */
import {
  IntegrationDeliveryError,
  IntegrationProviderError,
  type ExchangeResult,
  type IntegrationCredentials,
  type OAuthIntegrationAdapter,
  type ProbeResult,
} from "./types";
import { GCAL_SCOPES } from "./constants";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GcalCalendarOption {
  id: string;
  name: string;
  timeZone: string;
}

export interface GcalBusyInterval {
  start: string;
  end: string;
}

const MISSING_CREDS_MESSAGE =
  "Google app credentials missing — they resolve from Key Vault secrets GOOGLE-CLIENT-ID / GOOGLE-CLIENT-SECRET.";

export class GoogleCalendarAdapter implements OAuthIntegrationAdapter {
  readonly provider = "gcal" as const;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly apiBase: string;
  private readonly authorizeBase: string;
  private readonly tokenUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    clientId?: string;
    clientSecret?: string;
    /** Calendar API base (default https://www.googleapis.com/calendar/v3) — tests + the §8 local stub point here. */
    baseUrl?: string;
    authorizeBaseUrl?: string;
    tokenUrl?: string;
    fetchImpl?: FetchLike;
  }) {
    this.clientId = options?.clientId ?? process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = options?.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
    this.apiBase = (
      options?.baseUrl ??
      process.env.GCAL_BASE_URL ??
      "https://www.googleapis.com/calendar/v3"
    ).replace(/\/$/, "");
    this.authorizeBase =
      options?.authorizeBaseUrl ??
      process.env.GCAL_AUTHORIZE_URL ??
      "https://accounts.google.com/o/oauth2/v2/auth";
    this.tokenUrl = options?.tokenUrl ?? process.env.GCAL_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  authorizeUrl(params: { redirectUri: string; state: string }): string {
    if (!this.configured) {
      throw new IntegrationProviderError("PROVIDER_AUTH", MISSING_CREDS_MESSAGE, false);
    }
    const url = new URL(this.authorizeBase);
    url.searchParams.set("client_id", this.clientId as string);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GCAL_SCOPES.join(" "));
    // Offline access + forced consent: without BOTH, Google omits the refresh
    // token on re-auth and the connection would die within the hour.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", params.state);
    return url.toString();
  }

  async exchangeCode(params: { code: string; redirectUri: string }): Promise<ExchangeResult> {
    if (!this.configured) {
      throw new IntegrationProviderError("PROVIDER_AUTH", MISSING_CREDS_MESSAGE, false);
    }
    const body = new URLSearchParams({
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    });
    const data = await this.call(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const accessToken = data.access_token;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "google token exchange returned no access token", false);
    }
    return {
      credentials: {
        accessToken,
        refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
        expiresAt: this.expiresAtFrom(data.expires_in),
      },
      scopes: typeof data.scope === "string" ? data.scope.split(" ").filter(Boolean) : [...GCAL_SCOPES],
    };
  }

  /**
   * Refresh the expiring access token off the stored refresh token. Returns
   * the FULL replacement credential blob (refresh token carried forward, or
   * rotated when Google returns a new one) — the service re-encrypts it.
   */
  async refresh(creds: IntegrationCredentials): Promise<IntegrationCredentials> {
    if (!this.configured) {
      throw new IntegrationProviderError("PROVIDER_AUTH", MISSING_CREDS_MESSAGE, false);
    }
    const refreshToken = creds.refreshToken;
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      throw new IntegrationProviderError(
        "PROVIDER_AUTH",
        "connection has no refresh token — reconnect to grant offline access",
        false,
      );
    }
    const body = new URLSearchParams({
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const data = await this.call(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const accessToken = data.access_token;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "google token refresh returned no access token", false);
    }
    return {
      ...creds,
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
      expiresAt: this.expiresAtFrom(data.expires_in),
    };
  }

  /** The live token probe: calendarList page 1; accountLabel = the primary calendar's id (the account email). */
  async probe(creds: IntegrationCredentials): Promise<ProbeResult> {
    const url = new URL(`${this.apiBase}/users/me/calendarList`);
    url.searchParams.set("maxResults", "50");
    const data = await this.call(url.toString(), { method: "GET", headers: this.bearer(creds) });
    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
    const primary = items.find((c) => c.primary === true);
    const label = typeof primary?.id === "string" ? primary.id : undefined;
    return {
      ok: true,
      detail: `google calendar reachable — authed as ${label ?? "account"}`,
      ...(label ? { accountLabel: label } : {}),
    };
  }

  /** The calendar picker listing (options endpoint, kind=calendars). */
  async listCalendars(creds: IntegrationCredentials): Promise<GcalCalendarOption[]> {
    const collected: GcalCalendarOption[] = [];
    let pageToken: string | undefined;
    // Bounded pagination (the listChannels stance): refuse typed rather than
    // silently truncate a pathological account.
    for (let page = 0; page < 10; page += 1) {
      const url = new URL(`${this.apiBase}/users/me/calendarList`);
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await this.call(url.toString(), { method: "GET", headers: this.bearer(creds) });
      const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
      for (const c of items) {
        if (typeof c.id === "string" && typeof c.summary === "string") {
          collected.push({
            id: c.id,
            name: c.summary,
            timeZone: typeof c.timeZone === "string" ? c.timeZone : "UTC",
          });
        }
      }
      const next = data.nextPageToken;
      if (typeof next !== "string" || next.length === 0) {
        return collected.sort((a, b) => a.name.localeCompare(b.name));
      }
      pageToken = next;
    }
    throw new IntegrationProviderError(
      "PROVIDER_UNAVAILABLE",
      "google calendar list exceeded 2,500 entries — refusing to return a partial list",
      true,
    );
  }

  /** Busy ranges for the picked calendar over [timeMin, timeMax). */
  async freeBusy(
    creds: IntegrationCredentials,
    params: { calendarId: string; timeMin: Date; timeMax: Date },
  ): Promise<GcalBusyInterval[]> {
    const data = await this.call(`${this.apiBase}/freeBusy`, {
      method: "POST",
      headers: { ...this.bearer(creds), "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        timeMin: params.timeMin.toISOString(),
        timeMax: params.timeMax.toISOString(),
        items: [{ id: params.calendarId }],
      }),
    });
    const calendars = (data.calendars ?? {}) as Record<string, { busy?: Array<{ start?: string; end?: string }> }>;
    const busy = calendars[params.calendarId]?.busy ?? [];
    return busy
      .filter((b): b is { start: string; end: string } => typeof b.start === "string" && typeof b.end === "string")
      .map((b) => ({ start: b.start, end: b.end }));
  }

  /** Best-effort revoke of the whole grant (refresh token revokes the chain). */
  async revoke(creds: IntegrationCredentials): Promise<void> {
    const token =
      typeof creds.refreshToken === "string" && creds.refreshToken
        ? creds.refreshToken
        : typeof creds.accessToken === "string"
          ? creds.accessToken
          : "";
    if (!token) return;
    const revokeUrl = this.tokenUrl.replace(/\/token$/, "/revoke");
    await this.call(revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  }

  private bearer(creds: IntegrationCredentials): Record<string, string> {
    const token = creds.accessToken;
    if (typeof token !== "string" || token.length === 0) {
      throw new IntegrationProviderError("PROVIDER_AUTH", "Connection has no access token", false);
    }
    return { Authorization: `Bearer ${token}` };
  }

  private expiresAtFrom(expiresIn: unknown): string {
    const seconds = typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : 3600;
    return new Date(Date.now() + seconds * 1000).toISOString();
  }

  /** One choke point: fetch → HTTP classification → error-body classification. */
  private async call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw new IntegrationProviderError(
        "PROVIDER_UNAVAILABLE",
        `google unreachable: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (res.status === 429) {
      throw new IntegrationProviderError("PROVIDER_RATE_LIMITED", "google rate limited (429)", true);
    }
    if (res.status >= 500) {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", `google error (HTTP ${res.status})`, true);
    }
    const text = await res.text();
    if (res.ok && text.trim() === "") return {}; // the empty revoke response body
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new IntegrationProviderError("PROVIDER_UNAVAILABLE", "google returned a non-JSON response", true);
    }
    if (res.ok) return data;

    // Error bodies: the token endpoint sends {error: "invalid_grant", …};
    // the Calendar API sends {error: {code, message, errors: [{reason}]}}.
    const flat = typeof data.error === "string" ? data.error : undefined;
    const nested = data.error && typeof data.error === "object" ? (data.error as Record<string, unknown>) : undefined;
    const nestedMessage = typeof nested?.message === "string" ? nested.message : undefined;
    const name = flat ?? nestedMessage ?? `HTTP ${res.status}`;

    // invalid_grant = the refresh token is dead (revoked / password change /
    // expired test-user grant) — TERMINAL for the connection, never retried.
    if (flat === "invalid_grant") {
      throw new IntegrationProviderError("PROVIDER_AUTH", `google auth rejected (${name})`, false);
    }
    if (res.status === 401 || res.status === 403) {
      throw new IntegrationProviderError("PROVIDER_AUTH", `google auth rejected (${name})`, false);
    }
    // Everything else 4xx is a request/config refusal — typed, non-retryable,
    // never token bytes in the message.
    throw new IntegrationDeliveryError(flat ?? "request_failed", `google refused the request (${name})`);
  }
}
