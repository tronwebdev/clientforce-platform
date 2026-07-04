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
import { planRequestSchema, plannerGraphQuerySchema } from "@clientforce/core";
import { Role } from "@clientforce/db";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { PLAN_ENQUEUER, type PlanEnqueuer } from "./planner.providers";

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
 * Planner endpoints (P1.4). Planning runs in the worker (one Opus-class call);
 * the wizard's step-2 "drafting sequence" state polls GET /planner/graph until
 * a (new) version appears (A4). C2.3 wires the UI.
 */
@Controller("planner")
export class PlannerController {
  constructor(
    private readonly tenant: TenantClient,
    @Inject(PLAN_ENQUEUER) private readonly enqueuer: PlanEnqueuer,
  ) {}

  @Post("plan")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async plan(@Body() body: unknown) {
    const dto = parse(planRequestSchema, body);
    const workspaceId = this.tenant.workspaceId;
    const agent = await this.tenant.run((tx) =>
      tx.agent.findUnique({ where: { id: dto.agentId } }),
    );
    if (!agent) throw new NotFoundException(`Agent ${dto.agentId} not found`);
    await this.enqueuer.enqueue({ workspaceId, agentId: dto.agentId });
    return { queued: true };
  }

  @Get("graph")
  async graph(@Query() query: unknown) {
    const dto = parse(plannerGraphQuerySchema, query ?? {});
    return this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { agentId: dto.agentId },
        orderBy: { createdAt: "asc" },
      });
      if (!campaign) return { campaign: null, graph: null };
      const graph = await tx.campaignGraph.findFirst({
        where: { campaignId: campaign.id },
        orderBy: { version: "desc" },
      });
      return { campaign, graph };
    });
  }
}
