/**
 * INT W1 (DEC-093): the Slack adapter vs an injected fetch — every status
 * class + all typed refusals, no network (the zerobounce.test.ts pattern).
 */
import { describe, expect, it } from "vitest";
import { SlackAdapter } from "../src/slack";
import { IntegrationDeliveryError, IntegrationProviderError } from "../src/types";
import { SLACK_SCOPES } from "../src/constants";

type FetchLike = ConstructorParameters<typeof SlackAdapter>[0] extends infer O
  ? O extends { fetchImpl?: infer F }
    ? NonNullable<F>
    : never
  : never;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const adapterWith = (fetchImpl: FetchLike, extra?: { clientId?: string; clientSecret?: string }) =>
  new SlackAdapter({
    clientId: extra?.clientId ?? "client-id",
    clientSecret: extra?.clientSecret ?? "client-secret",
    baseUrl: "https://slack.test/api",
    authorizeBaseUrl: "https://slack.test/oauth/v2/authorize",
    fetchImpl,
  });

const CREDS = { accessToken: "stubtok-test-token" };

describe("SlackAdapter", () => {
  it("is unconfigured without platform app credentials and refuses authorizeUrl typed", () => {
    const adapter = new SlackAdapter({ clientId: undefined, clientSecret: undefined, fetchImpl: async () => jsonResponse({}) });
    expect(adapter.configured).toBe(false);
    expect(() => adapter.authorizeUrl({ redirectUri: "https://x/cb", state: "s" })).toThrowError(
      IntegrationProviderError,
    );
  });

  it("builds the authorize URL with scopes, state and redirect", () => {
    const url = new URL(adapterWith(async () => jsonResponse({})).authorizeUrl({ redirectUri: "https://app/integrations/callback/slack", state: "abc.def" }));
    expect(url.origin + url.pathname).toBe("https://slack.test/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("scope")).toBe(SLACK_SCOPES.join(","));
    expect(url.searchParams.get("state")).toBe("abc.def");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app/integrations/callback/slack");
  });

  it("exchanges a code into credentials + granted scopes + account label", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const adapter = adapterWith(async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return jsonResponse({
        ok: true,
        access_token: "stubtok-new",
        scope: "chat:write,channels:read",
        bot_user_id: "B123",
        team: { id: "T1", name: "BrightPath" },
      });
    });
    const result = await adapter.exchangeCode({ code: "the-code", redirectUri: "https://app/cb" });
    expect(calls[0]?.url).toBe("https://slack.test/api/oauth.v2.access");
    expect(calls[0]?.body).toContain("code=the-code");
    expect(result.credentials.accessToken).toBe("stubtok-new");
    expect(result.scopes).toEqual(["chat:write", "channels:read"]);
    expect(result.accountLabel).toBe("BrightPath workspace");
  });

  it("types an exchange with no access token as PROVIDER_AUTH", async () => {
    const adapter = adapterWith(async () => jsonResponse({ ok: true }));
    await expect(adapter.exchangeCode({ code: "c", redirectUri: "r" })).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
      retryable: false,
    });
  });

  it("probe returns ok + account label from auth.test", async () => {
    const adapter = adapterWith(async () => jsonResponse({ ok: true, team: "BrightPath", team_id: "T1" }));
    const probe = await adapter.probe(CREDS);
    expect(probe.ok).toBe(true);
    expect(probe.accountLabel).toBe("BrightPath workspace");
    expect(probe.detail).toContain("BrightPath");
  });

  it.each([
    ["invalid_auth"],
    ["token_revoked"],
    ["account_inactive"],
  ])("probe classifies ok:false %s as PROVIDER_AUTH (not retryable)", async (error) => {
    const adapter = adapterWith(async () => jsonResponse({ ok: false, error }));
    await expect(adapter.probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_AUTH", retryable: false });
  });

  it("classifies HTTP 429 and ok:false ratelimited as PROVIDER_RATE_LIMITED (retryable)", async () => {
    const via429 = adapterWith(async () => jsonResponse({}, 429));
    await expect(via429.probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryable: true });
    const viaBody = adapterWith(async () => jsonResponse({ ok: false, error: "ratelimited" }));
    await expect(viaBody.probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED", retryable: true });
  });

  it("classifies 5xx, network failure and non-JSON as PROVIDER_UNAVAILABLE (retryable)", async () => {
    const via500 = adapterWith(async () => jsonResponse({}, 500));
    await expect(via500.probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    const viaThrow = adapterWith(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(viaThrow.probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    const viaHtml = adapterWith(async () => new Response("<html>", { status: 200 }));
    await expect(viaHtml.probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("lists channels sorted by name and drops malformed entries", async () => {
    const adapter = adapterWith(async () =>
      jsonResponse({ ok: true, channels: [{ id: "C2", name: "zeta" }, { id: "C1", name: "alerts" }, { id: "C3" }] }),
    );
    expect(await adapter.listChannels(CREDS)).toEqual([
      { id: "C1", name: "alerts" },
      { id: "C2", name: "zeta" },
    ]);
  });

  it("follows the conversations.list cursor — a multi-page workspace never gets a partial picker", async () => {
    const requested: string[] = [];
    const adapter = adapterWith(async (url) => {
      requested.push(String(url));
      const cursor = new URL(String(url)).searchParams.get("cursor");
      if (!cursor) {
        return jsonResponse({
          ok: true,
          channels: [{ id: "C2", name: "zeta" }],
          response_metadata: { next_cursor: "page2" },
        });
      }
      return jsonResponse({ ok: true, channels: [{ id: "C1", name: "alerts" }], response_metadata: { next_cursor: "" } });
    });
    expect(await adapter.listChannels(CREDS)).toEqual([
      { id: "C1", name: "alerts" },
      { id: "C2", name: "zeta" },
    ]);
    expect(requested).toHaveLength(2);
    expect(new URL(requested[1] as string).searchParams.get("cursor")).toBe("page2");
  });

  it("types request/config refusals (channel_not_found, missing_scope) as IntegrationDeliveryError", async () => {
    const adapter = adapterWith(async () => jsonResponse({ ok: false, error: "channel_not_found" }));
    await expect(adapter.postMessage(CREDS, { channelId: "C9", text: "hi" })).rejects.toBeInstanceOf(
      IntegrationDeliveryError,
    );
    const scoped = adapterWith(async () => jsonResponse({ ok: false, error: "missing_scope" }));
    await expect(scoped.listChannels(CREDS)).rejects.toMatchObject({ reason: "missing_scope" });
  });

  it("posts messages with the bearer token to chat.postMessage", async () => {
    const calls: Array<{ url: string; auth: string | undefined; body: string }> = [];
    const adapter = adapterWith(async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("Authorization") ?? undefined, body: String(init?.body) });
      return jsonResponse({ ok: true });
    });
    await adapter.postMessage(CREDS, { channelId: "C1", text: "📅 Meeting booked" });
    expect(calls[0]?.url).toBe("https://slack.test/api/chat.postMessage");
    expect(calls[0]?.auth).toBe("Bearer stubtok-test-token");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ channel: "C1", text: "📅 Meeting booked" });
  });

  it("refuses to call the vendor without an access token", async () => {
    const adapter = adapterWith(async () => jsonResponse({ ok: true }));
    await expect(adapter.probe({})).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });
});
