import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { API_URL, STAFF_SESSION_COOKIE } from "../../../../lib/config";

/**
 * Platform-staff sign-in (B1 W1, DEC-079). Posts the email to the NestJS
 * `/backoffice/session` endpoint, which mints a staff token ONLY for an ACTIVE
 * row in the owner-managed allow-list. On success the token is stored as the
 * httpOnly `cf_staff_session` cookie — a rail entirely separate from tenant auth.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim();
  if (!email) return redirectTo("/backoffice/login?error=email");

  const res = await fetch(`${API_URL}/backoffice/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) return redirectTo("/backoffice/login?error=denied");

  const { token } = (await res.json()) as { token: string };
  const store = await cookies();
  store.set(STAFF_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return redirectTo("/backoffice/tenants");
}
