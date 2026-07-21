/**
 * INT W2 (DEC-094): the Google Calendar adapter vs an injected fetch — every
 * status class + all typed refusals, no network (the slack.test.ts pattern).
 * The load-bearing pins: offline-access + prompt=consent + READONLY-only
 * scope on the authorize URL; {accessToken, refreshToken, expiresAt} out of
 * the exchange; invalid_grant → PROVIDER_AUTH (terminal).
 */
import { describe, expect, it } from "vitest";
import { GoogleCalendarAdapter } from "../src/gcal";
import { IntegrationDeliveryError, IntegrationProviderError } from "../src/types";
import { GCAL_SCOPES } from "../src/constants";

type FetchLike = NonNullable<NonNullable<ConstructorParameters<typeof GoogleCalendarAdapter>[0]>["fetchImpl"]>;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const adapterWith = (fetchImpl: FetchLike, extra?: { clientId?: string; clientSecret?: string }) =>
  new GoogleCalendarAdapter({
    clientId: extra?.clientId ?? "gcid",
    clientSecret: extra?.clientSecret ?? "gsecret",
    baseUrl: "https://gcal.test/calendar/v3",
    authorizeBaseUrl: "https://gcal.test/o/oauth2/v2/auth",
    tokenUrl: "https://gcal.test/oauth2/token",
    fetchImpl,
  });

const CREDS = {
  accessToken: "stubtok-gcal-access",
  refreshToken: "stubtok-gcal-refresh",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe("GoogleCalendarAdapter", () => {
  it("is unconfigured without platform app credentials and refuses authorizeUrl typed", () => {
    const adapter = new GoogleCalendarAdapter({
      clientId: undefined,
      clientSecret: undefined,
      fetchImpl: async () => jsonResponse({}),
    });
    expect(adapter.configured).toBe(false);
    expect(() => adapter.authorizeUrl({ redirectUri: "https://x/cb", state: "s" })).toThrowError(
      IntegrationProviderError,
    );
  });

  it("builds the authorize URL with offline access, forced consent, and the READONLY-only scope", () => {
    const url = new URL(
      adapterWith(async () => jsonResponse({})).authorizeUrl({
        redirectUri: "https://app/integrations/callback/gcal",
        state: "abc.def",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://gcal.test/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("gcid");
    expect(url.searchParams.get("response_type")).toBe("code");
    // Honest-minimal scope: readonly ONLY in W2 (no calendar.events scope theater).
    expect(url.searchParams.get("scope")).toBe(GCAL_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).not.toContain("calendar.events");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("abc.def");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app/integrations/callback/gcal");
  });

  it("exchanges a code into {accessToken, refreshToken, expiresAt} + granted scopes", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const adapter = adapterWith(async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return jsonResponse({
        access_token: "stubtok-new-access",
        refresh_token: "stubtok-new-refresh",
        expires_in: 3599,
        scope: GCAL_SCOPES.join(" "),
        token_type: "Bearer",
      });
    });
    const before = Date.now();
    const result = await adapter.exchangeCode({ code: "the-code", redirectUri: "https://app/cb" });
    expect(calls[0]?.url).toBe("https://gcal.test/oauth2/token");
    expect(calls[0]?.body).toContain("grant_type=authorization_code");
    expect(calls[0]?.body).toContain("code=the-code");
    expect(result.credentials.accessToken).toBe("stubtok-new-access");
    expect(result.credentials.refreshToken).toBe("stubtok-new-refresh");
    const expiresAt = Date.parse(String(result.credentials.expiresAt));
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3600_000);
    expect(result.scopes).toEqual([...GCAL_SCOPES]);
  });

  it("types an exchange with no access token as PROVIDER_AUTH", async () => {
    const adapter = adapterWith(async () => jsonResponse({}));
    await expect(adapter.exchangeCode({ code: "c", redirectUri: "r" })).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
      retryable: false,
    });
  });

  it("refresh swaps the access token, keeps the refresh token, and advances expiresAt", async () => {
    const adapter = adapterWith(async (url, init) => {
      expect(String(url)).toBe("https://gcal.test/oauth2/token");
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      expect(String(init?.body)).toContain("refresh_token=stubtok-gcal-refresh");
      return jsonResponse({ access_token: "stubtok-refreshed", expires_in: 3600 });
    });
    const next = await adapter.refresh(CREDS);
    expect(next.accessToken).toBe("stubtok-refreshed");
    expect(next.refreshToken).toBe("stubtok-gcal-refresh"); // carried forward when not rotated
    expect(Date.parse(String(next.expiresAt))).toBeGreaterThan(Date.now());
  });

  it("refresh invalid_grant → PROVIDER_AUTH (terminal — the dead-refresh-token state)", async () => {
    const adapter = adapterWith(async () => jsonResponse({ error: "invalid_grant", error_description: "expired" }, 400));
    await expect(adapter.refresh(CREDS)).rejects.toMatchObject({ code: "PROVIDER_AUTH", retryable: false });
  });

  it("refresh without a stored refresh token refuses PROVIDER_AUTH", async () => {
    const adapter = adapterWith(async () => jsonResponse({}));
    await expect(adapter.refresh({ accessToken: "x" })).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });

  it("probe lists calendarList and labels with the primary calendar id", async () => {
    const adapter = adapterWith(async () =>
      jsonResponse({
        items: [
          { id: "team@group.calendar.google.com", summary: "Team", timeZone: "UTC" },
          { id: "ada@example.test", summary: "Ada", primary: true, timeZone: "America/Chicago" },
        ],
      }),
    );
    const probe = await adapter.probe(CREDS);
    expect(probe.ok).toBe(true);
    expect(probe.accountLabel).toBe("ada@example.test");
    expect(probe.detail).toContain("ada@example.test");
  });

  it("classifies 401/403 as PROVIDER_AUTH, 429 as RATE_LIMITED, 5xx/network/non-JSON as UNAVAILABLE", async () => {
    await expect(adapterWith(async () => jsonResponse({ error: { code: 401, message: "Invalid Credentials" } }, 401)).probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_AUTH", retryable: false });
    await expect(adapterWith(async () => jsonResponse({ error: { code: 403, message: "forbidden" } }, 403)).probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    await expect(adapterWith(async () => jsonResponse({}, 429)).probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryable: true });
    await expect(adapterWith(async () => jsonResponse({}, 500)).probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    await expect(
      adapterWith(async () => {
        throw new Error("ECONNREFUSED");
      }).probe(CREDS),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    await expect(adapterWith(async () => new Response("<html>", { status: 200 })).probe(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("listCalendars follows the pageToken and sorts by name — never a partial picker", async () => {
    const requested: string[] = [];
    const adapter = adapterWith(async (url) => {
      requested.push(String(url));
      const token = new URL(String(url)).searchParams.get("pageToken");
      if (!token) {
        return jsonResponse({
          items: [{ id: "z@cal", summary: "Zeta", timeZone: "UTC" }],
          nextPageToken: "page2",
        });
      }
      return jsonResponse({ items: [{ id: "a@cal", summary: "Alerts", timeZone: "Europe/Berlin" }] });
    });
    expect(await adapter.listCalendars(CREDS)).toEqual([
      { id: "a@cal", name: "Alerts", timeZone: "Europe/Berlin" },
      { id: "z@cal", name: "Zeta", timeZone: "UTC" },
    ]);
    expect(requested).toHaveLength(2);
    expect(new URL(requested[1] as string).searchParams.get("pageToken")).toBe("page2");
  });

  it("freeBusy posts the window and returns the picked calendar's busy ranges", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const adapter = adapterWith(async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return jsonResponse({
        calendars: {
          "ada@example.test": {
            busy: [{ start: "2026-07-22T15:00:00Z", end: "2026-07-22T16:00:00Z" }, { start: "bad" }],
          },
        },
      });
    });
    const busy = await adapter.freeBusy(CREDS, {
      calendarId: "ada@example.test",
      timeMin: new Date("2026-07-22T00:00:00Z"),
      timeMax: new Date("2026-07-29T00:00:00Z"),
    });
    expect(calls[0]?.url).toBe("https://gcal.test/calendar/v3/freeBusy");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      timeMin: "2026-07-22T00:00:00.000Z",
      items: [{ id: "ada@example.test" }],
    });
    expect(busy).toEqual([{ start: "2026-07-22T15:00:00Z", end: "2026-07-22T16:00:00Z" }]);
  });

  it("types 4xx request refusals as IntegrationDeliveryError (never a raw throw)", async () => {
    const adapter = adapterWith(async () => jsonResponse({ error: { code: 404, message: "Not Found" } }, 404));
    await expect(adapter.listCalendars(CREDS)).rejects.toBeInstanceOf(IntegrationDeliveryError);
  });

  it("refuses to call the vendor without an access token", async () => {
    const adapter = adapterWith(async () => jsonResponse({}));
    await expect(adapter.probe({})).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });
});
