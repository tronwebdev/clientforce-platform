import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, WORKSPACE_COOKIE } from "../../../../lib/config";
import { bearerToken } from "../../../../lib/auth-token";

/** C2.2 mutation proxy — cookie session → bearer + workspace headers (A2). */
async function forward(req: Request, id: string, method: "PATCH" | "DELETE") {
  const store = await cookies();
  const token = await bearerToken();
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const workspace = store.get(WORKSPACE_COOKIE)?.value;
  const res = await fetch(`${API_URL}/agents/${id}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(workspace ? { "x-workspace-id": workspace } : {}),
      "Content-Type": "application/json",
    },
    body: method === "PATCH" ? await req.text() : undefined,
  });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, id, "PATCH");
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return forward(req, id, "DELETE");
}
