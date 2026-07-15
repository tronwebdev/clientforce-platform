import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, STAFF_SESSION_COOKIE } from "../../../../lib/config";

/**
 * Authenticated backoffice proxy (B1 W1, DEC-079). Client components reach the
 * NestJS `/backoffice/*` API as `/api/bo/<path>`, with the httpOnly
 * `cf_staff_session` cookie translated to a Bearer token (the browser never sees
 * the token). No `x-workspace-id` — the backoffice is cross-tenant by design.
 */
async function forward(req: Request, path: string[]): Promise<NextResponse> {
  const store = await cookies();
  const token = store.get(STAFF_SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const res = await fetch(`${API_URL}/backoffice/${path.join("/")}${url.search}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(req.headers.get("content-type")
        ? { "Content-Type": req.headers.get("content-type")! }
        : {}),
    },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
  });
  const body = await res.arrayBuffer();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
