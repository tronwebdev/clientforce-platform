import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { Role } from "@clientforce/db";
import { PrismaService } from "../db/prisma.service";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";

/**
 * B9 (DEC-136): the tenant read of PLAN TIERS + the tier choice — the D2
 * discipline made mechanical:
 *
 *  - Tiers are AGENCY-LEVEL (the `AgencyPlan` enum on `Agency.planTier`;
 *    the agency pays Clientforce — there is no payout/earnings surface,
 *    v2 by ruling). The three seeded tiers are `Plan` rows resolved like
 *    credit prices: a row for the caller's agency beats the platform-null
 *    default of the same name.
 *  - EVERY number (price, limits, included credits) comes from the Plan
 *    row — never a UI constant (D1). A row the admin has not confirmed in
 *    the backoffice billing UI carries `proposal: true` (D2: "any number
 *    shown is a proposal until set there") — the admin editor stamps
 *    `features.confirmed` when it saves; seeded rows don't have it.
 *  - Choosing a tier records intent on `Agency.planTier` only. With no
 *    platform Stripe key wired anywhere (Q-118), NOTHING is charged and
 *    the surface says so — the card-on-file step renders its deferred
 *    state, never a fake form.
 */
const chooseSchema = z.object({ tier: z.enum(["STARTER", "GROWTH", "SCALE"]) });

@Controller("plans")
export class PlansController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async list() {
    const agencyId = this.tenant.agencyId;
    const [agency, rows] = await Promise.all([
      this.prisma.admin.agency.findUniqueOrThrow({
        where: { id: agencyId },
        select: { planTier: true },
      }),
      this.prisma.admin.plan.findMany({
        where: { OR: [{ agencyId: null }, { agencyId }] },
        orderBy: { priceMonthly: "asc" },
      }),
    ]);
    // Per-name resolution: the agency's own row beats the platform default.
    const byName = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const prior = byName.get(r.name);
      if (!prior || (prior.agencyId == null && r.agencyId != null)) byName.set(r.name, r);
    }
    const tiers = [...byName.values()]
      .sort((a, b) => a.priceMonthly - b.priceMonthly)
      .map((r) => ({
        name: r.name,
        priceMonthlyCents: r.priceMonthly,
        limits: (r.limits ?? {}) as Record<string, unknown>,
        proposal: (r.features as { confirmed?: boolean } | null)?.confirmed !== true,
        agencyOverride: r.agencyId != null,
      }));
    return { current: agency.planTier, tiers };
  }

  @Post("choose")
  @Roles(Role.OWNER)
  async choose(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = chooseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("tier must be STARTER | GROWTH | SCALE");
    const agencyId = this.tenant.agencyId;
    // The tier is an AGENCY-wide bill, so a single workspace's OWNER role is
    // not enough authority on its own: the caller must own every workspace
    // the agency has. (First run — one workspace — passes trivially; a
    // multi-workspace agency routes the change to whoever owns all of it.)
    const userId = req.auth!.user.id;
    const [workspaces, owned] = await Promise.all([
      this.prisma.admin.workspace.count({ where: { agencyId } }),
      this.prisma.admin.membership.count({
        where: { userId, role: "OWNER", workspace: { agencyId } },
      }),
    ]);
    if (owned < workspaces) {
      throw new ForbiddenException(
        "Changing the plan bills the whole agency — an owner of every workspace in it has to make this change.",
      );
    }
    await this.prisma.admin.agency.update({
      where: { id: agencyId },
      data: { planTier: parsed.data.tier },
    });
    return { ok: true, current: parsed.data.tier, charged: false };
  }
}
