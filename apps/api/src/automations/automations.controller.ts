import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  automationConditionsSchema,
  automationToggleSchema,
  campaignRuleActionSchema,
  campaignRuleTriggerSchema,
  type CampaignRuleAction,
  type CampaignRuleTrigger,
} from "@clientforce/core";
import { Role } from "@clientforce/db";
import { z, type ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";

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

const actionsSchema = z.array(campaignRuleActionSchema).min(1);

/**
 * One list/drawer row: the stored Json parsed through the CORE unions — an
 * unparseable row renders as an HONEST error state (`invalid: true`, the B6
 * live-resolution stance the engine already takes when it skips the row),
 * never a crash, never a silent drop.
 */
export interface AutomationListRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: CampaignRuleTrigger | null;
  conditions: unknown[];
  actions: CampaignRuleAction[];
  invalid: boolean;
  runs: number;
  lastRunAt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Account-scope automation rules (R1-UI, DEC-088) — the `Automation` model
 * live on the ONE R1 vocabulary. W1 = read · enable/disable · delete (+ the
 * ledger-backed run history); W2 adds create/edit through the same engine
 * validation. Campaign-scoped rules stay owned by Campaign View (#90) —
 * link, don't duplicate.
 */
@Controller("automations")
export class AutomationsController {
  constructor(
    private readonly tenant: TenantClient,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async list(): Promise<AutomationListRow[]> {
    return this.tenant.run(async (tx) => {
      const [rows, counts] = await Promise.all([
        tx.automation.findMany({ orderBy: { createdAt: "asc" } }),
        tx.automationRun.groupBy({
          by: ["automationId"],
          _count: { _all: true },
          _max: { ranAt: true },
        }),
      ]);
      const runsFor = new Map(counts.map((c) => [c.automationId, c]));
      return rows.map((row) => {
        const trigger = campaignRuleTriggerSchema.safeParse(row.trigger);
        const conditions = automationConditionsSchema.safeParse(row.conditions);
        const actions = actionsSchema.safeParse(row.actions);
        const invalid = !trigger.success || !conditions.success || !actions.success;
        const stat = runsFor.get(row.id);
        return {
          id: row.id,
          name: row.name,
          enabled: row.enabled,
          trigger: trigger.success ? trigger.data : null,
          conditions: conditions.success ? conditions.data : [],
          actions: actions.success ? actions.data : [],
          invalid,
          runs: stat?._count._all ?? 0,
          lastRunAt: stat?._max.ranAt?.toISOString() ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });
    });
  }

  /**
   * Run history — read-only rows FROM THE LEDGER (rule fires are already
   * events, the dispatch rule): `automation.rule.run.v1` rows whose payload
   * ruleId is this automation (direct fires AND nested run_automation runs),
   * newest first, with the contact joined for "on whom". Raw rows, verbatim
   * statuses — no aggregate, so no F1 floor applies.
   */
  @Get(":id/runs")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async runs(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const automation = await tx.automation.findUnique({ where: { id } });
      if (!automation) throw new NotFoundException(`Automation ${id} not found`);
      const events = await tx.event.findMany({
        where: {
          type: "automation.rule.run.v1",
          payload: { path: ["ruleId"], equals: id },
        },
        orderBy: { occurredAt: "desc" },
        take: 20,
        include: { contact: { select: { firstName: true, lastName: true, email: true } } },
      });
      return events.map((e) => {
        const payload = e.payload as {
          status?: string;
          trigger?: string;
          detail?: string;
          runId?: string;
        };
        const name = [e.contact?.firstName, e.contact?.lastName].filter(Boolean).join(" ");
        return {
          id: e.id,
          runId: payload.runId ?? null,
          status: payload.status ?? "unknown",
          trigger: payload.trigger ?? null,
          detail: payload.detail ?? null,
          contactId: e.contactId,
          contactLabel: name || e.contact?.email || null,
          campaignId: e.campaignId,
          occurredAt: e.occurredAt.toISOString(),
        };
      });
    });
  }

  /**
   * Enable/disable — instant, no re-plan (disabled rules never fire, the
   * DEC-074 contract). Writes ONE `automation.status_changed.v1` per ACTUAL
   * flip (the sender.status_changed pattern) — a same-state PATCH is a no-op
   * with no audit noise.
   */
  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async toggle(@Param("id") id: string, @Body() body: unknown) {
    const dto = parse(automationToggleSchema, body);
    const workspaceId = this.tenant.workspaceId;
    const { row, changed } = await this.tenant.run(async (tx) => {
      const existing = await tx.automation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Automation ${id} not found`);
      if (existing.enabled === dto.enabled) return { row: existing, changed: false };
      const updated = await tx.automation.update({ where: { id }, data: { enabled: dto.enabled } });
      return { row: updated, changed: true };
    });
    if (changed) {
      await this.publisher.publish({
        workspaceId,
        type: "automation.status_changed.v1",
        payload: {
          automationId: row.id,
          from: dto.enabled ? "disabled" : "enabled",
          to: dto.enabled ? "enabled" : "disabled",
        },
      });
    }
    return { id: row.id, enabled: row.enabled, changed };
  }

  /**
   * Delete — atomic with dependent state (runs cascade via FK; ledger events
   * OUTLIVE the row, they are the audit), with the refusal walk: a live
   * `run_automation` reference from an ENABLED campaign rule or another
   * ENABLED automation refuses 422 naming the referrers — the CRUD layer
   * never CREATES dangling state; the engine's honest-absence error state
   * stays the belt underneath for anything that slips through.
   */
  @Delete(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async remove(@Param("id") id: string) {
    const workspaceId = this.tenant.workspaceId;
    const deleted = await this.tenant.run(async (tx) => {
      const existing = await tx.automation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Automation ${id} not found`);

      const referencesTarget = (actions: unknown): boolean => {
        const parsed = actionsSchema.safeParse(actions);
        if (!parsed.success) return false;
        return parsed.data.some((a) => a.kind === "run_automation" && a.automationId === id);
      };

      const [campaignRules, automations] = await Promise.all([
        tx.campaignRule.findMany({
          where: { enabled: true },
          include: { campaign: { select: { name: true } } },
        }),
        tx.automation.findMany({ where: { enabled: true, NOT: { id } } }),
      ]);
      const ruleReferrers = campaignRules.filter((r) => referencesTarget(r.actions));
      const automationReferrers = automations.filter((a) => referencesTarget(a.actions));
      if (ruleReferrers.length > 0 || automationReferrers.length > 0) {
        const names = [
          ...ruleReferrers.map((r) => `campaign rule in “${r.campaign.name}”`),
          ...automationReferrers.map((a) => `automation “${a.name}”`),
        ];
        throw new UnprocessableEntityException({
          message: "Automation is still referenced",
          detail: `Still run by: ${names.join(", ")} — disable or edit ${
            names.length === 1 ? "it" : "them"
          } first, then delete`,
        });
      }

      const trigger = campaignRuleTriggerSchema.safeParse(existing.trigger);
      await tx.automation.delete({ where: { id } });
      return { name: existing.name, trigger: trigger.success ? trigger.data.kind : "unknown" };
    });
    await this.publisher.publish({
      workspaceId,
      type: "automation.deleted.v1",
      payload: { automationId: id, name: deleted.name, trigger: deleted.trigger },
    });
    return { deleted: true };
  }
}
