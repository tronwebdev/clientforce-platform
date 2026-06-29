import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, WORKSPACE_COOKIE } from "../../../../lib/config";

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(WORKSPACE_COOKIE);
  // Relative Location (same reason as dev-login): the client also navigates
  // explicitly after this fetch, but keep the redirect on the public origin.
  return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
}
