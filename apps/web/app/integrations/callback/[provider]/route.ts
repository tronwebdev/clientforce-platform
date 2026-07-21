import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, WORKSPACE_COOKIE } from "../../../../lib/config";
import { bearerToken } from "../../../../lib/auth-token";
import { apiErrorDetail, decideCallback, resultQuery } from "../../../../lib/integration-callback";

/**
 * OAuth callback landing (INT W1-UI) — the vendor redirects here after the
 * user authorizes. This route forwards code+state to the API's
 * POST /integrations/:provider/complete (cookie session → Bearer +
 * x-workspace-id, exactly the `lib/api.ts` authHeaders pattern) and bounces
 * back to /integrations with `?connected=<provider>` or `?error=<detail>`
 * (detail verbatim, URL-encoded, truncated — the SC/#94 honest-error rail).
 * Decision logic lives in `lib/integration-callback.ts` (pure, tested).
 */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }): Promise<NextResponse> {
  const { provider } = await ctx.params;
  const url = new URL(req.url);
  const dest = (query: string) => NextResponse.redirect(new URL(`/integrations?${query}`, url.origin));

  const decision = decideCallback(provider, {
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    error: url.searchParams.get("error"),
  });
  if (decision.kind === "error") return dest(resultQuery(decision));

  // A3 (DEC-060): cookie session → bearer + workspace headers (lib/api.ts).
  const store = await cookies();
  const token = await bearerToken();
  if (!token) return NextResponse.redirect(new URL("/login?next=/integrations", url.origin));
  const workspace = store.get(WORKSPACE_COOKIE)?.value;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/integrations/${decision.provider}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(workspace ? { "x-workspace-id": workspace } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: decision.code, state: decision.state }),
      cache: "no-store",
    });
  } catch {
    // API unreachable — an honest redirect, never an unhandled route error.
    return dest(
      resultQuery({
        kind: "error",
        detail: `Couldn't finish connecting ${decision.provider} — the Clientforce API was unreachable. Try connecting again.`,
      }),
    );
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    return dest(resultQuery({ kind: "error", detail: apiErrorDetail(body, res.status) }));
  }
  return dest(resultQuery({ kind: "connected", provider: decision.provider }));
}
