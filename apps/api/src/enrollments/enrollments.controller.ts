import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  createEnrollmentSchema,
  goalTerminalLabel,
  listEnrollmentsQuerySchema,
  parseGuardrails,
  signalReplySchema,
  validateGraph,
  type CampaignGraph,
} from "@clientforce/core";
import { Role } from "@clientforce/db";
import { workflowIdFor } from "@clientforce/workflows";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { WORKFLOW_ENGINE, type WorkflowEngine } from "./workflow-engine";

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
 * Enrollments (P1.6): enrolling a contact creates the Enrollment row and
 * starts ONE durable CampaignWorkflow (id `enroll-<enrollmentId>` — start is
 * idempotent, so re-enrolling or crash-retrying never double-runs). The
 * signal-reply endpoint is the dev/testing surface until P1.7 wires the
 * inbound classifier to the same signal.
 */
@Controller("enrollments")
export class EnrollmentsController {
  constructor(
    private readonly tenant: TenantClient,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEngine,
  ) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async create(@Body() body: unknown) {
    const dto = parse(createEnrollmentSchema, body);
    const workspaceId = this.tenant.workspaceId;

    const { enrollment, campaignId, senderId, graph, graphVersion, existed } = await this.tenant.run(
      async (tx) => {
        const [agent, contact] = await Promise.all([
          tx.agent.findUnique({ where: { id: dto.agentId } }),
          tx.contact.findUnique({ where: { id: dto.contactId } }),
        ]);
        if (!agent) throw new NotFoundException(`Agent ${dto.agentId} not found`);
        if (!contact) throw new NotFoundException(`Contact ${dto.contactId} not found`);

        // A5: one agent = one auto-created primary campaign (first by createdAt).
        const campaign = await tx.campaign.findFirst({
          where: { agentId: dto.agentId },
          orderBy: { createdAt: "asc" },
        });
        if (!campaign) {
          throw new UnprocessableEntityException(
            "Agent has no campaign — plan the campaign first (P1.4)",
          );
        }
        const graphRow = await tx.campaignGraph.findFirst({
          where: { campaignId: campaign.id },
          orderBy: { version: "desc" },
        });
        if (!graphRow) {
          throw new UnprocessableEntityException(
            "Campaign has no graph yet — plan the campaign first (P1.4)",
          );
        }

        const sender = dto.senderId
          ? await tx.senderConnection.findUnique({ where: { id: dto.senderId } })
          : await tx.senderConnection.findFirst({
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "asc" },
            });
        if (!sender || sender.status !== "ACTIVE") {
          throw new UnprocessableEntityException(
            "No active sender connection — connect a sender in Settings first (P1.5)",
          );
        }

        // Idempotent create on (campaignId, contactId) — re-enroll returns the
        // existing row and re-issues the (deduped) workflow start.
        const prior = await tx.enrollment.findUnique({
          where: { campaignId_contactId: { campaignId: campaign.id, contactId: contact.id } },
        });
        const id = prior?.id ?? randomUUID();
        const row =
          prior ??
          (await tx.enrollment.create({
            data: {
              id,
              workspaceId,
              campaignId: campaign.id,
              contactId: contact.id,
              workflowId: workflowIdFor(id),
              pipelineStage: "new",
              // 49-3: provenance rides the run-audit meta — never a schema change.
              // W3-4 (DEC-076): the enrolled graph version too — the run is
              // pinned to it (Temporal input), so surfaces can say honestly
              // which version a mid-sequence lead finishes on.
              meta: {
                ...(dto.origin ? { origin: dto.origin } : {}),
                graphVersion: graphRow.version,
              },
            },
          }));
        return {
          enrollment: row,
          campaignId: campaign.id,
          senderId: sender.id,
          // Graphs are validated at persist time (P1.4); re-validate on the way
          // into the engine so a hand-edited row can never start a broken run.
          graph: validateGraph(graphRow.graph) as CampaignGraph,
          // G1 (DEC-070): guided sends record which brief version wrote them.
          graphVersion: graphRow.version,
          existed: Boolean(prior),
        };
      },
    );

    const scale = Number(process.env.TEST_DELAY_SCALE);
    const { workflowId, deduped } = await this.engine.start({
      workspaceId,
      enrollmentId: enrollment.id,
      campaignId,
      agentId: dto.agentId,
      contactId: dto.contactId,
      senderId,
      graph,
      graphVersion,
      ...(Number.isFinite(scale) && scale > 0 ? { delayScale: scale } : {}),
    });
    // W3-4 (DEC-076): a RE-enroll whose prior run already closed starts a
    // fresh run pinned to the LATEST graph (Temporal dedupes only while the
    // old run is open) — restamp the audit so meta.graphVersion keeps naming
    // the version the CURRENT run executes. A deduped start keeps the old
    // stamp (the open run keeps its enrolled snapshot).
    let row = enrollment;
    if (existed && !deduped) {
      row = await this.tenant.run(async (tx) => {
        const fresh = await tx.enrollment.findUnique({
          where: { id: enrollment.id },
          select: { meta: true },
        });
        const freshMeta =
          typeof fresh?.meta === "object" && fresh.meta !== null
            ? (fresh.meta as Record<string, unknown>)
            : {};
        return tx.enrollment.update({
          where: { id: enrollment.id },
          data: { meta: { ...freshMeta, graphVersion } },
        });
      });
    }
    return { ...row, workflowId, workflowDeduped: deduped || existed };
  }

  @Get()
  list(@Query() query: unknown) {
    const { agentId } = parse(listEnrollmentsQuerySchema, query);
    return this.tenant.run((tx) =>
      tx.enrollment.findMany({
        where: { campaign: { agentId } },
        orderBy: { createdAt: "asc" },
        include: {
          contact: {
            select: { id: true, email: true, firstName: true, lastName: true, company: true },
          },
        },
      }),
    );
  }

  /**
   * C2.4 manual stage move (lead drawer "Move" / inbox "Move to"): persists the
   * stage and writes the lead.stage_changed.v1 Event row directly (no bus in
   * the API process — Logs and the drawer timeline read Event rows).
   */
  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async move(@Param("id") id: string, @Body() body: { pipelineStage?: string }) {
    const stage = String(body?.pipelineStage ?? "").trim();
    if (!stage || stage.length > 40) throw new BadRequestException("pipelineStage required");
    return this.tenant.run(async (tx) => {
      const enrollment = await tx.enrollment.findUnique({
        where: { id },
        include: { campaign: { select: { agent: { select: { goal: true, guardrails: true } } } } },
      });
      if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
      if (enrollment.pipelineStage === stage) return enrollment;
      const { campaign, ...bare } = enrollment;
      const updated = await tx.enrollment.update({
        where: { id },
        data: { pipelineStage: stage },
      });
      // C2.9 (DEC-059): goal-completion moves carry the campaign goal + its
      // terminal label — timelines render the label verbatim.
      const goal = stage === "booked" ? goalMeta(campaign.agent.goal, campaign.agent.guardrails) : null;
      await tx.event.create({
        data: {
          workspaceId: this.tenant.workspaceId,
          type: "lead.stage_changed.v1",
          contactId: bare.contactId,
          enrollmentId: bare.id,
          campaignId: bare.campaignId,
          payload: { fromStage: bare.pipelineStage, toStage: stage, manual: true, ...(goal ?? {}) },
        },
      });
      return updated;
    });
  }

  @Post(":id/signal-reply")
  @Roles(Role.OWNER, Role.ADMIN)
  async signalReply(@Param("id") id: string, @Body() body: unknown) {
    const { intent } = parse(signalReplySchema, body);
    const enrollment = await this.tenant.run((tx) =>
      tx.enrollment.findUnique({ where: { id } }),
    );
    if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
    await this.engine.signalReply(id, intent);
    return { delivered: true, workflowId: enrollment.workflowId };
  }
}

/** C2.9: `{ goalKey, label }` for a goal-completion event payload. */
function goalMeta(goal: string, guardrails: unknown): { goalKey: string; label: string } {
  let customLabel: string | undefined;
  try {
    customLabel = parseGuardrails(guardrails).goalLabel;
  } catch {
    customLabel = undefined; // legacy/invalid guardrails never block a stage move
  }
  return { goalKey: goal, label: goalTerminalLabel(goal, customLabel) };
}
