/**
 * P5 W3 (DEC-085): suppression-list hygiene — deterministic repairs only,
 * never invented policy:
 *
 * 1. CASE DUPLICATES. `Suppression`'s unique key is case-sensitive, and the
 *    boundary matches the contact's address verbatim — so "User@x.com" and
 *    "user@x.com" can coexist and a mixed-case contact can slip past a
 *    lowercase row. The sweep lowercases every address (merging collisions
 *    into the OLDEST row, the first-suppressed-wins rule); the writers and
 *    the boundary lookup normalize too (same-PR hardening, regression-pinned)
 *    so the sweep converges to a no-op.
 * 2. OPT-OUT SYNC. A suppressed address whose contact lost (or never gained)
 *    the matching `optOut` flag is repaired — the two rails must agree.
 * 3. AGING BOUNCES are COUNTED, not expired: there is no honest way to
 *    re-check a bounce without sending to it, so auto-expiry stays a product
 *    decision (documented default; the count keeps the backlog visible).
 *
 * Cross-tenant discovery on the owner client, tenant-scoped writes — the
 * stranded-source sweep precedent. Idempotent; cadence only bounds latency.
 */
import { withTenant, type Prisma, type PrismaClient } from "@clientforce/db";

/** Bounce rows older than this are counted as "aging" (visibility only). */
export const SUPPRESSION_AGING_BOUNCE_DAYS = 90;

export interface SuppressionHygieneResult {
  scanned: number;
  caseDuplicatesMerged: number;
  addressesNormalized: number;
  optOutsRepaired: number;
  agingBounces: number;
}

export async function runSuppressionHygiene(deps: {
  ownerPrisma: PrismaClient;
  prisma: PrismaClient;
  now?: () => Date;
}): Promise<SuppressionHygieneResult> {
  const now = deps.now?.() ?? new Date();
  const result: SuppressionHygieneResult = {
    scanned: 0,
    caseDuplicatesMerged: 0,
    addressesNormalized: 0,
    optOutsRepaired: 0,
    agingBounces: 0,
  };

  const rows = await deps.ownerPrisma.suppression.findMany({
    orderBy: { createdAt: "asc" },
    take: 10_000,
  });
  result.scanned = rows.length;
  if (rows.length === 10_000) {
    console.warn("[hygiene] suppression sweep hit the 10k page cap — split before this is real");
  }

  // 1 · case-duplicate merge + normalization (oldest row wins its group).
  const seen = new Map<string, string>(); // ws|channel|lower(address) → surviving row id
  for (const row of rows) {
    const key = `${row.workspaceId}|${row.channel}|${row.address.toLowerCase()}`;
    const survivor = seen.get(key);
    if (survivor) {
      await withTenant(deps.prisma, { workspaceId: row.workspaceId }, (tx) =>
        tx.suppression.delete({ where: { id: row.id } }),
      );
      result.caseDuplicatesMerged++;
      continue;
    }
    seen.set(key, row.id);
    if (row.address !== row.address.toLowerCase()) {
      await withTenant(deps.prisma, { workspaceId: row.workspaceId }, (tx) =>
        tx.suppression.update({ where: { id: row.id }, data: { address: row.address.toLowerCase() } }),
      );
      result.addressesNormalized++;
    }
  }

  // 2 · opt-out sync (email + sms channels use the same optOut Json rider).
  const fresh = await deps.ownerPrisma.suppression.findMany({
    select: { workspaceId: true, channel: true, address: true },
    take: 10_000,
  });
  for (const row of fresh) {
    if (row.channel !== "email" && row.channel !== "sms") continue;
    const contacts = await deps.ownerPrisma.contact.findMany({
      where:
        row.channel === "email"
          ? { workspaceId: row.workspaceId, email: { equals: row.address, mode: "insensitive" } }
          : { workspaceId: row.workspaceId, phone: row.address },
      select: { id: true, optOut: true, workspaceId: true },
    });
    for (const c of contacts) {
      const optOut = (c.optOut ?? {}) as Record<string, unknown>;
      if (optOut[row.channel] === true) continue;
      await withTenant(deps.prisma, { workspaceId: c.workspaceId }, (tx) =>
        tx.contact.update({
          where: { id: c.id },
          data: { optOut: { ...optOut, [row.channel]: true } as Prisma.InputJsonValue },
        }),
      );
      result.optOutsRepaired++;
    }
  }

  // 3 · aging bounces — visibility only, never auto-expired.
  result.agingBounces = await deps.ownerPrisma.suppression.count({
    where: {
      reason: "BOUNCED",
      createdAt: { lt: new Date(now.getTime() - SUPPRESSION_AGING_BOUNCE_DAYS * 86_400_000) },
    },
  });

  return result;
}
