import { BadRequestException, Body, Controller, Get, Patch } from "@nestjs/common";
import {
  DELIVERABILITY_DEFAULTS,
  resolveDeliverabilityRule,
  updateDeliverabilityRuleSchema,
} from "@clientforce/core";
import { Role } from "@clientforce/db";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

/**
 * D1 (DEC-173): the workspace's deliverability rule — the read/write layer
 * behind the Health tab's ruling toggle, *"Pause if bounces exceed 2% — she
 * stops rather than burn the domain."*
 *
 * ADDITIVE: two new routes, nothing existing touched. The GET always answers,
 * whether or not a row exists — an unset workspace gets the platform defaults
 * and `configured: false`, so a surface can say "this is the default" rather
 * than inventing a value or rendering an empty toggle.
 *
 * NO UI ships with this unit: the Health tab belongs to another session. What
 * that surface needs from here is `rule` (render the toggle and its threshold)
 * and `configured` (whether to show it as inherited) — see Q-172.
 */
@Controller("deliverability")
export class DeliverabilityController {
  constructor(private readonly tenant: TenantClient) {}

  @Get("rule")
  async read() {
    const workspaceId = this.tenant.workspaceId;
    const row = await this.tenant.run((tx) =>
      tx.deliverabilityRule.findUnique({ where: { workspaceId } }),
    );
    return {
      rule: resolveDeliverabilityRule(row),
      /** False = never set; the values above are the platform defaults. */
      configured: row !== null,
      defaults: DELIVERABILITY_DEFAULTS,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /**
   * Upsert, because "the workspace has never touched this" and "the workspace
   * set it to the defaults" are the same rule and must not be two code paths.
   * Only OWNER/ADMIN: turning the 2% rail off is a decision with a blast
   * radius across every other tenant on the shared IP pool.
   */
  @Patch("rule")
  @Roles(Role.OWNER, Role.ADMIN)
  async update(@Body() body: unknown) {
    const dto = parse(updateDeliverabilityRuleSchema, body);
    const workspaceId = this.tenant.workspaceId;
    const row = await this.tenant.run((tx) =>
      tx.deliverabilityRule.upsert({
        where: { workspaceId },
        create: { workspaceId, ...dto },
        update: dto,
      }),
    );
    return { rule: resolveDeliverabilityRule(row), configured: true, updatedAt: row.updatedAt };
  }
}
