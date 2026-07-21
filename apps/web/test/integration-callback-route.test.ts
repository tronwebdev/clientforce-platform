/**
 * INT W1-UI: the OAuth callback ROUTE HANDLER's impure branches
 * (`app/integrations/callback/[provider]/route.ts`) — the pure decision logic
 * is pinned in `integration-callback.test.ts`; this file executes the handler
 * itself with next/headers + lib/auth-token mocked and global fetch stubbed:
 *   — no bearer → the /login?next=/integrations redirect (A3 cookie session)
 *   — fetch rejection (API unreachable) → the honest ?error= redirect,
 *     never an unhandled route error
 *   — non-OK API response → apiErrorDetail rides the ?error= redirect
 *   — OK → ?connected=<provider>
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bearerToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  // The route only reads the workspace cookie from the store — an empty jar
  // exercises the "no x-workspace-id header" path.
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));
vi.mock("../lib/auth-token", () => ({ bearerToken: mocks.bearerToken }));

import { GET } from "../app/integrations/callback/[provider]/route";

const ORIGIN = "https://app.clientforce.test";

function call(query: string, provider = "slack") {
  return GET(new Request(`${ORIGIN}/integrations/callback/${provider}?${query}`), {
    params: Promise.resolve({ provider }),
  });
}

function location(res: Response): URL {
  const loc = res.headers.get("location");
  expect(loc, "redirect response must carry a Location header").not.toBeNull();
  return new URL(loc ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("callback route handler (mocked session + stubbed fetch)", () => {
  it("no bearer token → redirect to /login?next=/integrations on the same origin", async () => {
    mocks.bearerToken.mockResolvedValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const loc = location(await call("code=c123&state=s456"));
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/integrations");
    // The API is never called without a session.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("API unreachable (fetch rejects) → the honest ?error= redirect, not an unhandled error", async () => {
    mocks.bearerToken.mockResolvedValue("tok-1");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))));

    const loc = location(await call("code=c123&state=s456"));
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe("/integrations");
    expect(loc.searchParams.get("error")).toBe(
      "Couldn't finish connecting slack — the Clientforce API was unreachable. Try connecting again.",
    );
  });

  it("non-OK API response → apiErrorDetail's detail rides the ?error= redirect", async () => {
    mocks.bearerToken.mockResolvedValue("tok-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: "state mismatch — restart the connect flow" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const loc = location(await call("code=c123&state=s456"));
    expect(loc.pathname).toBe("/integrations");
    expect(loc.searchParams.get("error")).toBe("state mismatch — restart the connect flow");
  });

  it("OK API response → ?connected=<provider>, POSTing code+state with the bearer", async () => {
    mocks.bearerToken.mockResolvedValue("tok-1");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const loc = location(await call("code=c123&state=s456"));
    expect(loc.pathname).toBe("/integrations");
    expect(loc.searchParams.get("connected")).toBe("slack");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/integrations/slack/complete");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body as string)).toEqual({ code: "c123", state: "s456" });
  });
});
