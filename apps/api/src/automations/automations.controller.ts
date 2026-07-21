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
  Post,
  Put,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ACCOUNT_ACTION_REFUSAL,
  DUPLICATE_TRIGGER_REFUSAL,
  automationConditionsSchema,
  automationToggleSchema,
  automationWriteSchema,
  campaignRuleActionSchema,
  campaignRuleTriggerSchema,
  isAccountAction,
  sameTrigger,
  type AutomationWrite,
  type CampaignRuleAction,
  type CampaignRuleTrigger,
} from "@clientforce/core";
import { Role, type Prisma } from "@clientforce/db";
import { z, type ZodTypeAny } from "zod";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
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
 * Account-scope automation rules (R1-UI, DEC-091) — the `Automation` model
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
   * The W2 write guards, shared by create and edit — the boundary refuses to
   * CREATE broken state instead of leaving the engine's error rendering to
   * catch it later (belt AND suspenders, key decisions 6–8):
   *   scope — a campaign-scoped action (`move_to_node`) on an account rule
   *   dup   — an EQUAL trigger vs another ENABLED rule (the #90/DEC-077
   *           deferral landed in core `sameTrigger`; edit excludes self,
   *           disabled rows never block, and a disabled write never conflicts)
   *   refs  — `run_automation` must point at rules that exist (and never at
   *           itself); live-resolution honesty stays the belt underneath
   */
  private async guardWrite(
    tx: Prisma.TransactionClient,
    dto: AutomationWrite,
    selfId?: string,
  ): Promise<void> {
    const offScope = dto.actions.find((a) => !isAccountAction(a));
    if (offScope) {
      throw new UnprocessableEntityException({ message: ACCOUNT_ACTION_REFUSAL });
    }

    if (dto.enabled) await this.assertNoEnabledDuplicate(tx, dto.trigger, selfId);

    const refs = dto.actions.filter((a) => a.kind === "run_automation").map((a) => a.automationId);
    if (selfId && refs.includes(selfId)) {
      throw new UnprocessableEntityException({
        message: "An automation can't run itself",
        detail: "Point “Run another automation” at a different rule",
      });
    }
    if (refs.length > 0) {
      const found = await tx.automation.findMany({
        where: { id: { in: refs } },
        select: { id: true },
      });
      const known = new Set(found.map((r) => r.id));
      if (refs.some((r) => !known.has(r))) {
        throw new UnprocessableEntityException({
          message: "Automation reference not found",
          detail: "“Run another automation” points at a rule that no longer exists — pick one from the list",
        });
      }
    }
  }

  /** The one enabled-duplicate invariant, also guarding the PATCH enable path
   *  (create-disabled-then-enable can't sidestep the 422). */
  private async assertNoEnabledDuplicate(
    tx: Prisma.TransactionClient,
    trigger: CampaignRuleTrigger,
    selfId?: string,
  ): Promise<void> {
    const others = await tx.automation.findMany({
      where: { enabled: true, ...(selfId ? { NOT: { id: selfId } } : {}) },
    });
    for (const other of others) {
      const parsed = campaignRuleTriggerSchema.safeParse(other.trigger);
      if (!parsed.success) continue; // unreadable rows render as error state — they never fire
      if (sameTrigger(parsed.data, trigger)) {
        throw new UnprocessableEntityException({
          message: DUPLICATE_TRIGGER_REFUSAL,
          detail: `“${other.name}” already fires on this exact trigger — edit that one, or change the trigger`,
        });
      }
    }
  }

  private writtenRow(
    row: { id: string; name: string; enabled: boolean; createdAt: Date; updatedAt: Date },
    dto: AutomationWrite,
    stats?: { runs: number; lastRunAt: string | null },
  ): AutomationListRow {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      trigger: dto.trigger,
      conditions: dto.conditions,
      actions: dto.actions,
      invalid: false,
      runs: stats?.runs ?? 0,
      lastRunAt: stats?.lastRunAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Create (W2) — the whole rule through the ONE engine validation
   * (`automationWriteSchema`: core unions + the conditions-refine-replies
   * boundary rule), then the write guards. No catalog event: creation isn't
   * in the locked A9 set — the initial enabled state is state, not a change.
   */
  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async create(@Body() body: unknown) {
    const dto = parse(automationWriteSchema, body);
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      await this.guardWrite(tx, dto);
      const row = await tx.automation.create({
        data: {
          workspaceId,
          name: dto.name,
          enabled: dto.enabled,
          trigger: dto.trigger as object,
          conditions: dto.conditions as object[],
          actions: dto.actions as object[],
        },
      });
      return this.writtenRow(row, dto);
    });
  }

  /**
   * Edit (W2) — a FULL replace through the same schema + guards (dup check
   * excludes self). An enabled flip that rides the edit emits the same ONE
   * `automation.status_changed.v1` the PATCH path writes — actual change
   * only, one audit trail regardless of which surface flipped it.
   */
  @Put(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async update(@Param("id") id: string, @Body() body: unknown) {
    const dto = parse(automationWriteSchema, body);
    const workspaceId = this.tenant.workspaceId;
    const { row, flipped, stats } = await this.tenant.run(async (tx) => {
      const existing = await tx.automation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Automation ${id} not found`);
      await this.guardWrite(tx, dto, id);
      const updated = await tx.automation.update({
        where: { id },
        data: {
          name: dto.name,
          enabled: dto.enabled,
          trigger: dto.trigger as object,
          conditions: dto.conditions as object[],
          actions: dto.actions as object[],
        },
      });
      const runStats = await tx.automationRun.aggregate({
        where: { automationId: id },
        _count: { _all: true },
        _max: { ranAt: true },
      });
      return {
        row: updated,
        flipped: existing.enabled !== dto.enabled,
        stats: {
          runs: runStats._count._all,
          lastRunAt: runStats._max.ranAt?.toISOString() ?? null,
        },
      };
    });
    if (flipped) {
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
    return this.writtenRow(row, dto, stats);
  }

  /**
   * Enable/disable — instant, no re-plan (disabled rules never fire, the
   * DEC-074 contract). Writes ONE `automation.status_changed.v1` per ACTUAL
   * flip (the sender.status_changed pattern) — a same-state PATCH is a no-op
   * with no audit noise. Enabling re-checks the enabled-duplicate invariant
   * (W2): a disabled twin of a live trigger stays creatable, but can never
   * quietly become the second ENABLED rule on that trigger.
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
      if (dto.enabled) {
        const trigger = campaignRuleTriggerSchema.safeParse(existing.trigger);
        // Unreadable triggers skip the dup check — an invalid row never fires.
        if (trigger.success) await this.assertNoEnabledDuplicate(tx, trigger.data, id);
      }
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
