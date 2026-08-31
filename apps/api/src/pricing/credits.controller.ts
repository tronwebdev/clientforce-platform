import { Controller, Get } from "@nestjs/common";
import {
  BURN_MIN_HISTORY_DAYS,
  LEDGER_ADJUSTMENT_REASONS,
  METERED_CREDIT_ACTIONS,
} from "@clientforce/core";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

/**
 * B7 (DEC-133): the tenant's credit SPEND view — the first workspace-facing
 * read of the `CreditLedger` spine the reveal debit (B6, partial Q-020) and
 * the backoffice adjustments write into.
 *
 * Honesty rails: the "where they go" numbers are REAL ledger aggregation and
 * nothing else — sends, SMS segments, call minutes and widget turns do not
 * meter yet (Q-108), and this endpoint never fabricates rows for them; the
 * surface says so in plain copy instead. Prices stay data (`/credit-prices`,
 * D1/D2) — this read carries none.
 *
 * B7.5 adds the per-field HONESTY GATE the credits surface renders against
 * (SURFACE_SPEC_SETTINGS §9.3). The design wants a burn rate, a runway
 * sentence, an allowance bar and four hero tiles. Three of those have no
 * source on this platform, so rather than ship a worse design OR invent the
 * numbers, this read tells the surface exactly which ones it may draw:
 *
 *  - `history` — how many days of ledger actually exist. Burn, "runs out" and
 *    the runway sentence render ONLY above the minimum; below it they are
 *    absent with a stated reason, because a projection from three days of
 *    data is a fabrication with an error bar drawn on it.
 *  - `allowance` — the monthly included credits from plan entitlement, or
 *    null with the reason. No plan model carries a credit allowance yet, so
 *    the % bar and the INCLUDED MONTHLY tile do not render at all rather than
 *    invent a denominator.
 *  - `metered` / `unmetered` — which priced actions have a debit path. A kind
 *    that cannot be measured gets named as such, never a zero bar.
 *
 * Everything here is ADDITIVE: the fields B7 already reads are untouched.
 */
@Controller("credits")
export class CreditsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get("summary")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  summary() {
    const workspaceId = this.tenant.workspaceId;
    const agencyId = this.tenant.agencyId;
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { creditBalance: true },
      });
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [monthRows, recent, oldest, priceRows] = await Promise.all([
        tx.creditLedger.groupBy({
          by: ["reason"],
          where: { createdAt: { gte: monthStart } },
          _sum: { delta: true },
          _count: { _all: true },
        }),
        tx.creditLedger.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            delta: true,
            reason: true,
            channel: true,
            balanceAfter: true,
            createdAt: true,
          },
        }),
        // The FIRST ledger row is the whole basis of the burn gate: history is
        // measured from real data, not from when the workspace was created.
        tx.creditLedger.findFirst({
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
        // Priced actions, so the surface can name what is NOT metered by
        // difference rather than from a second hand-written list. CreditPrice
        // is agency-scoped (no workspaceId → outside the RLS set), so the
        // caller's agency + the platform defaults are filtered explicitly —
        // the same stance the /credit-prices read takes.
        tx.creditPrice.findMany({
          where: { OR: [{ agencyId: null }, { agencyId }] },
          select: { action: true },
          distinct: ["action"],
        }),
      ]);
      const spent = monthRows
        .filter((r) => (r._sum.delta ?? 0) < 0)
        .map((r) => ({
          reason: r.reason,
          credits: -(r._sum.delta ?? 0),
          entries: r._count._all,
        }))
        .sort((a, b) => b.credits - a.credits);
      const added = monthRows
        .filter((r) => (r._sum.delta ?? 0) > 0)
        .map((r) => ({ reason: r.reason, credits: r._sum.delta ?? 0, entries: r._count._all }));
      const historyDays =
        oldest == null
          ? 0
          : Math.floor((Date.now() - oldest.createdAt.getTime()) / 86_400_000);
      const pricedActions = priceRows.map((r) => r.action).sort();
      const metered = pricedActions.filter((a) => METERED_CREDIT_ACTIONS.includes(a));
      const unmetered = pricedActions.filter((a) => !METERED_CREDIT_ACTIONS.includes(a));

      return {
        balance: ws.creditBalance,
        monthStart: monthStart.toISOString(),
        spent,
        added,
        recent,
        /** Which priced actions can be measured, and which cannot — yet. */
        metering: { metered, unmetered, adjustmentReasons: [...LEDGER_ADJUSTMENT_REASONS] },
        /** The burn gate. `enough` false ⇒ burn/runway/runs-out do not render. */
        history: {
          firstEntryAt: oldest?.createdAt.toISOString() ?? null,
          days: historyDays,
          minDays: BURN_MIN_HISTORY_DAYS,
          enough: oldest != null && historyDays >= BURN_MIN_HISTORY_DAYS,
        },
        /**
         * Monthly included credits. Null until a plan carries an allowance —
         * `Plan.limits` has workspaces and emails, never credits — so the
         * allowance bar and its tile stay absent rather than inventing a
         * denominator to divide the balance by.
         */
        allowance: {
          includedMonthly: null as number | null,
          reason: "Your plan does not carry a monthly credit allowance yet",
        },
      };
    });
  }
}
