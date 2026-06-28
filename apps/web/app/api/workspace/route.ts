import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { WORKSPACE_COOKIE } from "../../../lib/config";

/**
 * Set the active workspace (dev/header path → x-workspace-id). With Clerk this is
 * `setActive({ organization })`, which re-mints the token with the new org_id.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { workspaceId?: string };
  if (!body.workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, body.workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return NextResponse.json({ ok: true });
}
