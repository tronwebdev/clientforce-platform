import { Controller, Get } from "@nestjs/common";
import { resolveCreditPrice, type EffectiveCreditPrices } from "@clientforce/core";
import { TenantClient } from "../db/tenant-client";

/**
 * B2 (DEC-106): the tenant read of RESOLVED credit prices. D1 rules that
 * credit prices are data — the effective-dated `CreditPrice` table — never UI
 * constants, and until now only the backoffice could read that table. The Bold
 * plan tab shows a cost chip on every step, so this endpoint resolves the
 * caller's effective price per action through `resolveCreditPrice` (agency
 * override beats the platform default, newest effective date wins — the SAME
 * pure rule the backoffice editor uses).
 *
 * Read-only by design: price WRITES stay behind the backoffice (DEC-080).
 * `CreditPrice` is agency-scoped (no workspaceId → outside the T1 RLS set),
 * so the query filters to the caller's agency + the platform default rows
 * explicitly rather than leaning on a policy.
 */
@Controller("credit-prices")
export class CreditPricesController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  list(): Promise<EffectiveCreditPrices> {
    const agencyId = this.tenant.agencyId;
    return this.tenant.run(async (tx) => {
      const rows = await tx.creditPrice.findMany({
        where: { OR: [{ agencyId: null }, { agencyId }] },
        select: { agencyId: true, action: true, credits: true, effectiveFrom: true },
      });
      const effective: Record<string, number> = {};
      for (const action of new Set(rows.map((r) => r.action))) {
        const credits = resolveCreditPrice(rows, { agencyId, action });
        if (credits != null) effective[action] = credits;
      }
      return { agencyId, effective };
    });
  }
}
