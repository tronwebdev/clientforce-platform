import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Put,
  ServiceUnavailableException,
  UnprocessableEntityException,
  Post,
  Query,
} from "@nestjs/common";
import type { AiGateway } from "@clientforce/ai";
import {
  composeSampleEmail,
  composeSampleSms,
  ComposeRefusedError,
  SAMPLE_LEAD,
} from "@clientforce/channels";
import {
  addSubcampaign,
  campaignGraphSchema,
  campaignRuleActionSchema,
  campaignRuleTriggerSchema,
  createSubcampaignSchema,
  GUIDED_EMAIL_CREDITS,
  GUIDED_SMS_CREDITS,
  planRequestSchema,
  plannerGraphQuerySchema,
  repairGraph,
  stepBriefSchema,
  validateGraph,
  type CampaignGraph,
} from "@clientforce/core";
import { IntentSchema } from "@clientforce/events";
import { z } from "zod";
import { Role, type Prisma } from "@clientforce/db";
import {
  createPlanQueue,
  validateEditedGraph,
  type EditContext,
  type PlanTarget,
} from "@clientforce/planner";
import { mainStepPosition } from "@clientforce/workflows";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import { COMPOSER_GATEWAY, PLAN_ENQUEUER, type PlanEnqueuer } from "./planner.providers";

const putGraphSchema = z.object({
  agentId: z.string().min(1),
  graph: campaignGraphSchema,
});

const composePreviewSchema = z.object({
  agentId: z.string().min(1),
  stepNodeId: z.string().min(1),
  /**
   * W3-4 (DEC-076): a STAGED brief — the per-step mode flip composes its
   * seed before anything persists (the one-step compose, sandbox). Absent =
   * the saved graph's brief, exactly as before. Same fixed sample lead, same
   * real deterministic checks, still zero send path.
   */
  brief: stepBriefSchema.optional(),
});

type RuleTrigger = z.infer<typeof campaignRuleTriggerSchema>;

/**
 * The node ids a rule row's `move_to_node` actions point at — parsed through
 * the canonical R1 action union (the same read `packages/automations` does);
 * an unparseable row contributes nothing (it renders as its own error state).
 */
function moveTargetIdsOf(actions: unknown): string[] {
  const parsed = z.array(campaignRuleActionSchema).safeParse(actions);
  if (!parsed.success) return [];
  return parsed.data.flatMap((a) => (a.kind === "move_to_node" ? [a.targetNodeId] : []));
}

/**
 * Trigger equality for the duplicate-branch refusal (#90, DEC-077): same kind
 * + same payload — `reply_classified` intents compare as SETS, `sequence_quiet`
 * by its day count. Overlapping-but-different triggers coexist (R1 row order
 * arbitrates multi-rule events); only an EQUAL trigger is a duplicate.
 * Exhaustive over the union — a new trigger kind fails compilation here.
 */
function sameTrigger(a: RuleTrigger, b: RuleTrigger): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "reply_classified": {
      const other = b as Extract<RuleTrigger, { kind: "reply_classified" }>;
      const setA = new Set(a.intents);
      const setB = new Set(other.intents);
      return setA.size === setB.size && [...setA].every((i) => setB.has(i));
    }
    case "sequence_quiet":
      return a.days === (b as Extract<RuleTrigger, { kind: "sequence_quiet" }>).days;
    case "meeting_booked":
    case "opted_out":
    case "email_opened":
    case "link_clicked":
    case "lead_captured":
      return true;
  }
}

/**
 * The ONE manual-edit persistence chain (#90 review round): repairGraph →
 * validateEditedGraph → next MANUAL version + graphId pointer. Both writers
 * (`PUT /planner/graph`, `POST /planner/subcampaign`) ride it; a version
 * collision (two writers raced the same `latest`) surfaces as a typed 409
 * instead of a raw P2002 500.
 */
async function persistManualEdit(
  tx: Prisma.TransactionClient,
  params: {
    workspaceId: string;
    campaignId: string;
    latestVersion: number;
    previous: CampaignGraph | null;
    candidate: CampaignGraph;
    ctx: EditContext;
  },
) {
  const { graph: repaired, repairs } = repairGraph(params.candidate);
  let graph: CampaignGraph;
  try {
    graph = validateEditedGraph(params.previous, repaired, params.ctx);
  } catch (err) {
    throw new UnprocessableEntityException({
      message: "Invalid campaign graph",
      detail: err instanceof Error ? err.message : String(err),
      ...(repairs.length > 0 ? { repaired: repairs } : {}),
    });
  }
  let row;
  try {
    row = await tx.campaignGraph.create({
      data: {
        workspaceId: params.workspaceId,
        campaignId: params.campaignId,
        version: params.latestVersion + 1,
        source: "MANUAL",
        graph: graph as object,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw new ConflictException({
        message: "The sequence changed underneath this edit — reload and try again",
      });
    }
    throw err;
  }
  await tx.campaign.update({ where: { id: params.campaignId }, data: { graphId: row.id } });
  return { row, repairs };
}

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
    private readonly prisma: PrismaService,
    @Inject(PLAN_ENQUEUER) private readonly enqueuer: PlanEnqueuer,
    @Inject(COMPOSER_GATEWAY) private readonly composerGateway: AiGateway | null,
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
   * C2.3 / W3-4 (DEC-076): a manual edit persists as the NEXT graph version,
   * source MANUAL — through the same three-layer discipline as planner output
   * (shape zod → `validateGraph` → edit-policy layer) plus the deterministic
   * `repairGraph` pass; repairs are reported, invalid graphs never persist.
   * The copy rails (merge tokens · neverSay · language) stay generation-only:
   * they judge the model's writing, not the owner's typed words (M1a stance).
   * In-flight enrollments are untouched by construction — the graph is pinned
   * into each run's Temporal input at start; the new version applies to new
   * enrollments and rule moves only (the versioning semantics, DEC-076).
   */
  @Put("graph")
  @Roles(Role.OWNER, Role.ADMIN)
  async putGraph(@Body() body: unknown) {
    const dto = parse(putGraphSchema, body);
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
      });
      // DEC-061 capability rule, same as planning: sms steps only with an
      // ACTIVE Twilio sender (channels the stored graph already uses stay legal).
      const smsSender = await tx.senderConnection.findFirst({
        where: { type: "TWILIO_SMS", status: "ACTIVE" },
      });
      let previous: CampaignGraph | null = null;
      if (latest) {
        try {
          previous = validateGraph(latest.graph);
        } catch {
          previous = null; // an unreadable stored row must not brick edits
        }
      }
      // #90 (DEC-077): nodes that enabled rules move contacts to must survive
      // the edit — the orphaned-trigger guard.
      const enabledRules = await tx.campaignRule.findMany({
        where: { campaignId: campaign.id, enabled: true },
      });
      const { row, repairs } = await persistManualEdit(tx, {
        workspaceId,
        campaignId: campaign.id,
        latestVersion: latest?.version ?? 0,
        previous,
        candidate: dto.graph as CampaignGraph,
        ctx: {
          allowedChannels: smsSender ? ["email", "sms"] : ["email"],
          ruleTargetNodeIds: enabledRules.flatMap((r) => moveTargetIdsOf(r.actions)),
        },
      });
      return { ...row, repaired: repairs };
    });
  }

  /**
   * #90 (DEC-077): "Add a sub-campaign" — a behaviour-triggered branch as ONE
   * atomic decision: the graph gains a SubcampaignNode-headed chain through
   * the SAME three-layer gate as every edit (with the creator's explicit
   * `subcampaigns:"admit-new"` carve-out), and the container's entry trigger
   * — R1's `campaignRuleTriggerSchema`, consumed verbatim — lands as a
   * `CampaignRule` row whose terminal `move_to_node` targets the container.
   * One `withTenant` transaction: a 422 persists neither the graph version
   * nor the rule. The real #86 engine then routes enrollments in (cancel +
   * restart at the container node; the graph itself never changes shape at
   * trigger time — versioning semantics are DEC-076's, untouched).
   */
  @Post("subcampaign")
  @Roles(Role.OWNER, Role.ADMIN)
  async createSubcampaign(@Body() body: unknown) {
    const dto = parse(createSubcampaignSchema, body);
    // R1's documented contract: reply_classified intents are validated
    // against IntentSchema at the API boundary (core keeps them opaque).
    if (dto.trigger.kind === "reply_classified") {
      const unknown = dto.trigger.intents.filter((i) => !IntentSchema.safeParse(i).success);
      if (unknown.length > 0) {
        throw new UnprocessableEntityException({
          message: "Unknown trigger intents",
          detail: `Intents ${unknown.join(", ")} are not in the taxonomy — use only: ${IntentSchema.options.join(", ")}`,
        });
      }
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
      });
      if (!latest) {
        throw new NotFoundException(`Agent ${dto.agentId} has no sequence yet — draft one first`);
      }
      let previous: CampaignGraph;
      try {
        previous = validateGraph(latest.graph);
      } catch {
        // The creator MUTATES the stored graph (unlike PUT, whose client
        // supplies the whole graph) — an unreadable row can't be extended.
        throw new UnprocessableEntityException({
          message: "Invalid campaign graph",
          detail: "The stored sequence couldn't be read — regenerate it before adding a sub-campaign",
        });
      }

      // Dup-trigger refusal: one entry trigger, one branch. Only ENABLED
      // rules that move into an EXISTING sub-campaign container block; other
      // rule kinds coexist (R1 row order arbitrates multi-rule events).
      const subIds = new Set(
        previous.nodes.filter((n) => n.type === "subcampaign").map((n) => n.id),
      );
      const rules = await tx.campaignRule.findMany({
        where: { campaignId: campaign.id, enabled: true },
      });
      for (const rule of rules) {
        const trig = campaignRuleTriggerSchema.safeParse(rule.trigger);
        if (!trig.success) continue; // unparseable rows render as error state (R1)
        const movesToSub = moveTargetIdsOf(rule.actions).some((id) => subIds.has(id));
        if (!movesToSub) continue;
        if (sameTrigger(trig.data, dto.trigger)) {
          throw new UnprocessableEntityException({
            message: "Duplicate trigger",
            detail:
              "A sub-campaign already enters on this trigger — edit that branch or pick a different trigger",
          });
        }
      }

      // The mutation, then the ONE shared persistence chain.
      let mutated: ReturnType<typeof addSubcampaign>;
      try {
        mutated = addSubcampaign(previous, { name: dto.name, seed: dto.seed });
      } catch (err) {
        throw new UnprocessableEntityException({
          message: "Invalid sub-campaign",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      const smsSender = await tx.senderConnection.findFirst({
        where: { type: "TWILIO_SMS", status: "ACTIVE" },
      });
      const { row, repairs } = await persistManualEdit(tx, {
        workspaceId,
        campaignId: campaign.id,
        latestVersion: latest.version,
        previous,
        candidate: mutated.graph,
        ctx: {
          allowedChannels: smsSender ? ["email", "sms"] : ["email"],
          subcampaigns: "admit-new",
          ruleTargetNodeIds: rules.flatMap((r) => moveTargetIdsOf(r.actions)),
        },
      });

      const maxOrder = await tx.campaignRule.aggregate({
        where: { campaignId: campaign.id },
        _max: { order: true },
      });
      const rule = await tx.campaignRule.create({
        data: {
          workspaceId,
          campaignId: campaign.id,
          order: (maxOrder._max.order ?? 0) + 1,
          trigger: dto.trigger as object,
          actions: [{ kind: "move_to_node", targetNodeId: mutated.subcampaignId }],
          enabled: true,
        },
      });
      return {
        ...row,
        repaired: repairs,
        subcampaignId: mutated.subcampaignId,
        stepIds: mutated.stepIds,
        ruleId: rule.id,
      };
    });
  }

  /**
   * G1 (DEC-070) / G2 (DEC-071): sample preview — compose a guided step's
   * brief against the FIXED sample lead (no contact row, empty history)
   * through the REAL deterministic checks, routed by the step's channel
   * (email previews return subject + body, arc-role aware). A check refusal
   * is a legitimate outcome to DISPLAY, so it returns 200 `{refused}` rather
   * than an error status; free at launch (Q-020 owns metering — the credits
   * figure here is display-only).
   */
  @Post("compose-preview")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async composePreview(@Body() body: unknown) {
    const dto = parse(composePreviewSchema, body);
    if (!this.composerGateway) {
      throw new ServiceUnavailableException(
        "AI composing isn't configured for this environment yet — ask your admin to finish AI setup.",
      );
    }
    const workspaceId = this.tenant.workspaceId;
    const { step, position } = await this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { agentId: dto.agentId },
        orderBy: { createdAt: "asc" },
      });
      const graphRow = campaign
        ? await tx.campaignGraph.findFirst({
            where: { campaignId: campaign.id },
            orderBy: { version: "desc" },
          })
        : null;
      if (!graphRow) throw new NotFoundException(`Agent ${dto.agentId} has no planned sequence`);
      const graph = validateGraph(graphRow.graph);
      const node = graph.nodes.find((n) => n.id === dto.stepNodeId);
      if (!node || node.type !== "step") {
        throw new UnprocessableEntityException(
          `Step ${dto.stepNodeId} is not a step — previews compose briefs only`,
        );
      }
      // W3-4 (DEC-076): a staged brief previews an UNSAVED flip/edit; without
      // one the step must already be guided (the pre-W3-4 contract, unchanged).
      if (!dto.brief && (node.mode !== "guided" || !node.brief)) {
        throw new UnprocessableEntityException(
          `Step ${dto.stepNodeId} is not a guided step — previews compose briefs only`,
        );
      }
      if (node.channel !== "email" && node.channel !== "sms") {
        throw new UnprocessableEntityException(
          `Step ${dto.stepNodeId} is on channel "${node.channel}" — guided composing is email/sms-only this phase`,
        );
      }
      if (dto.brief?.subjectHint !== undefined && node.channel === "sms") {
        throw new UnprocessableEntityException("Subject hints are email-only — an SMS brief cannot carry one");
      }
      const staged = dto.brief ? { ...node, brief: dto.brief } : node;
      // G2: the step's main-sequence position → the composer's M1a arc role.
      return { step: staged, position: mainStepPosition(graph, node.id) };
    });
    try {
      // The sample composers tenant-scope their own reads (withTenant on the
      // app client) with the request's workspace — same RLS subject as
      // tenant.run.
      if (step.channel === "email") {
        const composed = await composeSampleEmail(
          { prisma: this.prisma.app, gateway: this.composerGateway },
          { workspaceId, agentId: dto.agentId, brief: step.brief!, position },
        );
        return {
          composed: {
            subject: composed.subject,
            body: composed.body,
            composerVersion: composed.composerVersion,
            attempts: composed.attempts,
          },
          sampleLead: SAMPLE_LEAD,
          credits: GUIDED_EMAIL_CREDITS,
        };
      }
      const composed = await composeSampleSms(
        { prisma: this.prisma.app, gateway: this.composerGateway },
        { workspaceId, agentId: dto.agentId, brief: step.brief! },
      );
      return {
        composed: {
          body: composed.body,
          composerVersion: composed.composerVersion,
          attempts: composed.attempts,
        },
        sampleLead: SAMPLE_LEAD,
        credits: GUIDED_SMS_CREDITS,
      };
    } catch (err) {
      if (err instanceof ComposeRefusedError) {
        return { refused: { reason: err.reason, detail: err.detail }, sampleLead: SAMPLE_LEAD };
      }
      throw err;
    }
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
