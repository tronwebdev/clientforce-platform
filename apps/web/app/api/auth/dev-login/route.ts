import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, WORKSPACE_COOKIE } from "../../../../lib/config";
import { signDevToken } from "../../../../lib/dev-token";

/**
 * Same-origin redirect for a POST form: 303 → the browser GETs `path` against the
 * public origin. A RELATIVE Location is deliberate — behind the Container Apps
 * ingress `req.url` is the internal bind address (`http://0.0.0.0:3000`), so an
 * absolute `new URL(path, req.url)` would bounce the browser to an unreachable
 * host. Cookies set via the `cookies()` store are still applied to this response.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/**
 * Dev sign-in: mint a session token for an email and set it as an httpOnly
 * cookie. Replaced by Clerk's hosted sign-in in production (env-gated, T7).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim();
  if (!email) {
    return redirectTo("/login?error=email");
  }

  const token = await signDevToken(email);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  // Reset any prior active-workspace selection on a fresh login.
  store.delete(WORKSPACE_COOKIE);

  return redirectTo("/");
}
