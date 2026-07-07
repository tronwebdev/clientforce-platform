import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
} from "@nestjs/common";
import {
  answerGapSchema,
  delegateGapSchema,
  dismissAskSchema,
  distillRequestSchema,
  gapsQuerySchema,
  getContextQuerySchema,
  goalKeySchema,
  undoGapSchema,
  WORKSPACE_EMAIL_REQUIRED,
  type ContextFieldKey,
  type GoalKey,
} from "@clientforce/core";
import { checkGaps, mergeLayers, parseAsks, parseFields } from "@clientforce/context";
import { Role, type Prisma } from "@clientforce/db";
import { z, type ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { DISTILL_ENQUEUER, type DistillEnqueuer } from "./context.providers";

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
 * BusinessContext endpoints (P1.3, DEC-024/025). Distills run in the worker
 * (BullMQ); the wizard polls the row's `status` per A4. The gap checker spans
 * the workspace + agent layers; answers write to the right layer
 * (company_address → workspace, everything else → the requested layer).
 * Wizard/Brand-kit UI wiring lands in C2.3/C2.6.
 */
@Controller("context")
export class ContextController {
  constructor(
    private readonly tenant: TenantClient,
    @Inject(DISTILL_ENQUEUER) private readonly enqueuer: DistillEnqueuer,
  ) {}

  @Post("distill")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async distill(@Body() body: unknown) {
    const dto = parse(distillRequestSchema, body ?? {});
    const workspaceId = this.tenant.workspaceId;
    const { agentId, goal, customObjective } = await this.resolveAgent(dto.agentId);

    // Row goes DISTILLING immediately so the wizard's poll shows progress
    // from the first tick, not from worker pickup.
    const row = await this.tenant.run(async (tx) => {
      const existing = await tx.businessContext.findFirst({ where: { workspaceId, agentId } });
      if (existing) {
        return tx.businessContext.update({
          where: { id: existing.id },
          data: { status: "DISTILLING", ...(goal ? { goal } : {}) },
        });
      }
      return tx.businessContext.create({
        data: { workspaceId, agentId, goal, status: "DISTILLING" },
      });
    });
    await this.enqueuer.enqueue({ workspaceId, agentId, goal, customObjective });
    return row;
  }

  @Get()
  async getContext(@Query() query: unknown) {
    const dto = parse(getContextQuerySchema, query ?? {});
    const { workspace, agent } = await this.loadLayers(dto.agentId ?? null);
    return {
      workspace,
      agent,
      merged: mergeLayers(parseFields(workspace?.fields), parseFields(agent?.fields)),
    };
  }

  @Get("gaps")
  async gaps(@Query() query: unknown) {
    const dto = parse(gapsQuerySchema, query ?? {});
    const { workspace, agent } = await this.loadLayers(dto.agentId ?? null);
    return checkGaps({
      goal: dto.goal,
      workspaceFields: parseFields(workspace?.fields),
      agentFields: parseFields(agent?.fields),
      proposedAsks: parseAsks(agent?.proposedAsks),
    });
  }

  /**
   * C2.3 §3 "About your business · Edit" (wizard-v2 round): the distilled
   * summary is user-editable; the edit persists on the agent layer's
   * rawSummary and survives re-distills only until the next distill runs —
   * which is the documented behavior of the distilled brief (owner-visible
   * wording in the wizard).
   */
  @Post("summary")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async editSummary(@Body() body: unknown) {
    const dto = parse(
      z.object({ agentId: z.string().min(1), summary: z.string().max(4000) }),
      body,
    );
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const existing = await tx.businessContext.findFirst({
        where: { workspaceId, agentId: dto.agentId },
      });
      if (existing) {
        return tx.businessContext.update({
          where: { id: existing.id },
          data: { rawSummary: dto.summary },
        });
      }
      return tx.businessContext.create({
        data: { workspaceId, agentId: dto.agentId, fields: {}, rawSummary: dto.summary },
      });
    });
  }

  @Post("answers")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async answer(@Body() body: unknown) {
    const dto = parse(answerGapSchema, body);
    const row = await this.writeField(dto.agentId, dto.key, {
      value: dto.value,
      citations: [],
      source: "typed",
    });
    // "Type it" persists AND re-distills (DEC-024) — the typed answer is new
    // signal for the other fields; the typed entry itself is never overwritten.
    const { agentId, goal, customObjective } = await this.resolveAgent(
      this.layerFor(dto.key, dto.agentId) ?? undefined,
    );
    await this.enqueuer.enqueue({
      workspaceId: this.tenant.workspaceId,
      agentId,
      goal,
      customObjective,
    });
    return row;
  }

  @Post("delegate")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  delegate(@Body() body: unknown) {
    const dto = parse(delegateGapSchema, body);
    // Audited delegation: the planner's eventual choice surfaces in the step-6
    // preview + About-your-business card (C2.3); Undo reverts (DEC-024).
    return this.writeField(dto.agentId, dto.key, {
      value: "",
      citations: [],
      source: "ai_decides",
    });
  }

  @Post("undo")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async undo(@Body() body: unknown) {
    const dto = parse(undoGapSchema, body);
    const layerAgentId = this.layerFor(dto.key, dto.agentId);
    return this.tenant.run(async (tx) => {
      const row = await tx.businessContext.findFirst({
        where: { workspaceId: this.tenant.workspaceId, agentId: layerAgentId },
      });
      if (!row) throw new NotFoundException();
      const fields = parseFields(row.fields);
      const entry = fields[dto.key];
      if (!entry || entry.source === "distilled") {
        throw new BadRequestException("Nothing to undo — the field is not typed or delegated");
      }
      // Removing the entry re-opens the gap; a distilled fill (if the evidence
      // supports one) returns on the next re-distill.
      delete fields[dto.key];
      return tx.businessContext.update({ where: { id: row.id }, data: { fields } });
    });
  }

  @Post("asks/dismiss")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async dismissAsk(@Body() body: unknown) {
    const dto = parse(dismissAskSchema, body);
    return this.tenant.run(async (tx) => {
      const row = await tx.businessContext.findFirst({
        where: { workspaceId: this.tenant.workspaceId, agentId: dto.agentId },
      });
      if (!row) throw new NotFoundException();
      const asks = parseAsks(row.proposedAsks).map((a) =>
        a.key === dto.key ? { ...a, dismissed: true } : a,
      );
      return tx.businessContext.update({
        where: { id: row.id },
        data: { proposedAsks: asks as unknown as Prisma.InputJsonValue },
      });
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private loadLayers(agentId: string | null) {
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const workspace = await tx.businessContext.findFirst({
        where: { workspaceId, agentId: null },
      });
      const agent = agentId
        ? await tx.businessContext.findFirst({ where: { workspaceId, agentId } })
        : null;
      return { workspace, agent };
    });
  }

  /** company_address answers always write to the workspace layer (owner edit 3). */
  private layerFor(key: string, agentId?: string): string | null {
    if (WORKSPACE_EMAIL_REQUIRED.includes(key as ContextFieldKey)) return null;
    return agentId ?? null;
  }

  private async writeField(
    agentId: string | undefined,
    key: string,
    entry: { value: string; citations: string[]; source: "typed" | "ai_decides" },
  ) {
    const workspaceId = this.tenant.workspaceId;
    const layerAgentId = this.layerFor(key, agentId);
    return this.tenant.run(async (tx) => {
      const existing = await tx.businessContext.findFirst({
        where: { workspaceId, agentId: layerAgentId },
      });
      const fields = { ...parseFields(existing?.fields), [key]: entry };
      if (existing) {
        return tx.businessContext.update({ where: { id: existing.id }, data: { fields } });
      }
      return tx.businessContext.create({ data: { workspaceId, agentId: layerAgentId, fields } });
    });
  }

  /** Resolve the agent's goal key (+ custom objective) for distill targets. */
  private async resolveAgent(
    agentId?: string,
  ): Promise<{ agentId: string | null; goal: GoalKey | null; customObjective?: string }> {
    if (!agentId) return { agentId: null, goal: null };
    const agent = await this.tenant.run((tx) => tx.agent.findUnique({ where: { id: agentId } }));
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);
    const goal = goalKeySchema.safeParse(agent.goal);
    return {
      agentId,
      goal: goal.success ? goal.data : null,
      customObjective: agent.instructions ?? undefined,
    };
  }
}
