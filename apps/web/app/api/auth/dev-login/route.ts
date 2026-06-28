import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, WORKSPACE_COOKIE } from "../../../../lib/config";
import { signDevToken } from "../../../../lib/dev-token";

/**
 * Dev sign-in: mint a session token for an email and set it as an httpOnly
 * cookie. Replaced by Clerk's hosted sign-in in production (env-gated, T7).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim();
  if (!email) {
    return NextResponse.redirect(new URL("/login?error=email", req.url));
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

  return NextResponse.redirect(new URL("/", req.url));
}
