import { NextResponse } from "next/server";

/**
 * Deploy-identity probe (DEC-132): which build is this container running?
 * IMAGE_SHA is stamped by Bicep at deploy time (the git SHA the images were
 * built from); the stale-staging guard workflow compares it against main and
 * fails loudly on persistent divergence. Public and secret-free by
 * construction — it reveals nothing but a commit id already visible on GitHub.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ sha: process.env.IMAGE_SHA ?? null });
}
