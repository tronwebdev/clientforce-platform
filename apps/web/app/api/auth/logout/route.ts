import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, WORKSPACE_COOKIE } from "../../../../lib/config";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(WORKSPACE_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url));
}
