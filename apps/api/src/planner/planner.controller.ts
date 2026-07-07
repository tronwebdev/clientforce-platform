import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Put,
  UnprocessableEntityException,
  Post,
  Query,
} from "@nestjs/common";
import {
  campaignGraphSchema,
  planRequestSchema,
  plannerGraphQuerySchema,
  validateGraph,
} from "@clientforce/core";
import { z } from "zod";
import { Role } from "@clientforce/db";
import { createPlanQueue, type PlanTarget } from "@clientforce/planner";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { PLAN_ENQUEUER, type PlanEnqueuer } from "./planner.providers";

const putGraphSchema = z.object({
  agentId: z.string().min(1),
  graph: campaignGraphSchema,
});

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

  /**
   * C2.3: a manual edit from the wizard's step editor persists as the NEXT
   * graph version, source MANUAL — validated exactly like planner output.
   */
  @Put("graph")
  @Roles(Role.OWNER, Role.ADMIN)
  async putGraph(@Body() body: unknown) {
    const dto = parse(putGraphSchema, body);
    let graph;
    try {
      graph = validateGraph(dto.graph);
    } catch (err) {
      throw new UnprocessableEntityException({
        message: "Invalid campaign graph",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { agentId: dto.agentId },
        orderBy: { createdAt: "asc" },
      });
      if (!campaign) throw new NotFoundException(`Agent ${dto.agentId} has no campaign`);
      const latest = await tx.campaignGraph.findFirst({
        where: { campaignId: campaign.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const row = await tx.campaignGraph.create({
        data: {
          workspaceId,
          campaignId: campaign.id,
          version: (latest?.version ?? 0) + 1,
          source: "MANUAL",
          graph: graph as object,
        },
      });
      await tx.campaign.update({ where: { id: campaign.id }, data: { graphId: row.id } });
      return row;
    });
  }

  /** Lazy BullMQ handle onto the planner queue — the API boots without Redis. */
  private statusQueue?: ReturnType<typeof createPlanQueue>;

  /**
   * Wizard bugfix round (B7): expose the agent's newest plan job state so the
   * "drafting sequence" poll can distinguish "still working" from "failed" —
   * hold until graph OR failure, never infinite. Redis absence/errors degrade
   * to { state: "none" }, never a 500.
   */
  @Get("status")
  async status(@Query() query: unknown) {
    const dto = parse(plannerGraphQuerySchema, query ?? {});
    const none = { state: "none" as string, failedReason: null as string | null, at: null as string | null };
    if (!process.env.REDIS_URL) return none;
    try {
      // Same queue name as the worker: createPlanQueue → PLANNER_QUEUE_NAME.
      this.statusQueue ??= createPlanQueue();
      const jobs = await this.statusQueue.getJobs(
        ["failed", "active", "waiting", "delayed", "completed"],
        0,
        50,
      );
      const workspaceId = this.tenant.workspaceId;
      const mine = jobs
        .filter((j) => {
          const data = j?.data as PlanTarget | undefined;
          return data?.agentId === dto.agentId && data?.workspaceId === workspaceId;
        })
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      const job = mine[0];
      if (!job) return none;
      const raw = await job.getState();
      const state =
        raw === "waiting" || raw === "delayed" || raw === "waiting-children" || raw === "prioritized"
          ? "waiting"
          : raw === "active" || raw === "completed" || raw === "failed"
            ? raw
            : "none";
      return {
        state,
        failedReason: state === "failed" ? (job.failedReason ?? null) : null,
        at: job.finishedOn
          ? new Date(job.finishedOn).toISOString()
          : job.timestamp
            ? new Date(job.timestamp).toISOString()
            : null,
      };
    } catch {
      return none;
    }
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
