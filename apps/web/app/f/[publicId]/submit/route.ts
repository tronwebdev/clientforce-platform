import { NextResponse } from "next/server";
import { API_URL } from "../../../../lib/config";

/**
 * B5 (DEC-130): the hosted form's PUBLIC forward — the one unauthenticated
 * Next route (the /api/cf proxy demands a session; a visitor has none). It
 * forwards the body verbatim to the api's public submit rail and returns
 * its verdict — validation, caps and refusal copy all live server-side.
 */
export async function POST(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await ctx.params;
  const res = await fetch(`${API_URL}/forms/v1/${encodeURIComponent(publicId)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await req.arrayBuffer(),
  });
  const body = await res.arrayBuffer();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}
