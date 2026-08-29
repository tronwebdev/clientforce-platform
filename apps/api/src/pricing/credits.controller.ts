import { Controller, Get } from "@nestjs/common";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

/**
 * B7 (DEC-132): the tenant's credit SPEND view — the first workspace-facing
 * read of the `CreditLedger` spine the reveal debit (B6, partial Q-020) and
 * the backoffice adjustments write into.
 *
 * Honesty rails: the "where they go" numbers are REAL ledger aggregation and
 * nothing else — sends, SMS segments, call minutes and widget turns do not
 * meter yet (Q-108), and this endpoint never fabricates rows for them; the
 * surface says so in plain copy instead. Prices stay data (`/credit-prices`,
 * D1/D2) — this read carries none.
 */
@Controller("credits")
export class CreditsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get("summary")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  summary() {
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { creditBalance: true },
      });
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [monthRows, recent] = await Promise.all([
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
      return {
        balance: ws.creditBalance,
        monthStart: monthStart.toISOString(),
        spent,
        added,
        recent,
      };
    });
  }
}
