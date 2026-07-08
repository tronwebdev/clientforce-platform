import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, WORKSPACE_COOKIE } from "../../../../lib/config";
import { bearerToken } from "../../../../lib/auth-token";

/**
 * Generic authenticated proxy (C2.3): the wizard is client-driven (polling +
 * mutations), so every NestJS domain endpoint is reachable as /api/cf/<path>
 * with the cookie session translated to bearer + workspace headers (A2 — the
 * Next side never handles domain data itself).
 */
async function forward(req: Request, path: string[]): Promise<NextResponse> {
  const store = await cookies();
  // A3 (DEC-060): Clerk session JWT when configured, dev cookie otherwise.
  const token = await bearerToken();
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const workspace = store.get(WORKSPACE_COOKIE)?.value;
  const url = new URL(req.url);
  const res = await fetch(`${API_URL}/${path.join("/")}${url.search}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(workspace ? { "x-workspace-id": workspace } : {}),
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
export async function PATCH(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PUT(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
