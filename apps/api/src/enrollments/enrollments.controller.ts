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
import {
  createEnrollmentSchema,
  goalTerminalLabel,
  listEnrollmentsQuerySchema,
  parseGuardrails,
  signalReplySchema,
} from "@clientforce/core";
import { Role } from "@clientforce/db";
import { enrollContact, type EnrollEventInput } from "@clientforce/workflows";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
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
 *
 * LH1 W3 (DEC-087): creation goes through the SHARED enrollment gate
 * (`enrollContact` in @clientforce/workflows — the drain uses the same fn):
 * `invalid` refuses typed (422 CONTACT_INVALID + a cataloged Logs row),
 * `unverified`/`risky`(policy)/cap-overflow HOLD (a 201 with `held: true` —
 * the flow completed; sending starts as the contact clears). Pre-LH1
 * resolution errors keep their exact messages and statuses.
 */
@Controller("enrollments")
export class EnrollmentsController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
    @Inject(WORKFLOW_ENGINE) private readonly engine: WorkflowEngine,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async create(@Body() body: unknown) {
    const dto = parse(createEnrollmentSchema, body);
    const workspaceId = this.tenant.workspaceId;
    const scale = Number(process.env.TEST_DELAY_SCALE);

    const outcome = await enrollContact(
      {
        prisma: this.prisma.app,
        engine: this.engine,
        publish: (e: EnrollEventInput) => this.publisher.publish(e),
      },
      {
        workspaceId,
        agentId: dto.agentId,
        contactId: dto.contactId,
        ...(dto.senderId ? { senderId: dto.senderId } : {}),
        ...(dto.origin ? { origin: dto.origin } : {}),
        ...(Number.isFinite(scale) && scale > 0 ? { delayScale: scale } : {}),
      },
    );
    switch (outcome.kind) {
      case "enrolled":
        return {
          ...outcome.enrollment,
          workflowId: outcome.workflowId,
          workflowDeduped: outcome.workflowDeduped,
        };
      case "held":
        return { held: true, holdId: outcome.holdId, reason: outcome.reason };
      case "refused":
        throw new UnprocessableEntityException({ reason: outcome.code, message: outcome.message });
      case "error":
        if (outcome.code === "AGENT_NOT_FOUND" || outcome.code === "CONTACT_NOT_FOUND") {
          throw new NotFoundException(outcome.message);
        }
        throw new UnprocessableEntityException(outcome.message);
    }
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
   * C2.4 manual stage move (lead drawer "Move" / inbox "Move to" / the P5-W3
   * pipeline-board drag). P5 W3 (DEC-085): the stage_changed event now goes
   * through the EVENTS PUBLISHER (bus with Redis, inline persist without) —
   * the Event row still lands for Logs/timelines, AND the campaign rules that
   * listen to lead.stage_changed.v1 (e.g. meeting_booked) fire for HUMAN
   * moves exactly like machine moves. Behavior upgrade, regression-pinned.
   */
  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async move(@Param("id") id: string, @Body() body: { pipelineStage?: string }) {
    const stage = String(body?.pipelineStage ?? "").trim();
    if (!stage || stage.length > 40) throw new BadRequestException("pipelineStage required");
    const moved = await this.tenant.run(async (tx) => {
      const enrollment = await tx.enrollment.findUnique({
        where: { id },
        include: { campaign: { select: { agent: { select: { goal: true, guardrails: true } } } } },
      });
      if (!enrollment) throw new NotFoundException(`Enrollment ${id} not found`);
      if (enrollment.pipelineStage === stage) return { updated: enrollment, event: null };
      const { campaign, ...bare } = enrollment;
      const updated = await tx.enrollment.update({
        where: { id },
        data: { pipelineStage: stage },
      });
      // C2.9 (DEC-059): goal-completion moves carry the campaign goal + its
      // terminal label — timelines render the label verbatim.
      const goal = stage === "booked" ? goalMeta(campaign.agent.goal, campaign.agent.guardrails) : null;
      return {
        updated,
        event: {
          workspaceId: this.tenant.workspaceId,
          type: "lead.stage_changed.v1" as const,
          contactId: bare.contactId,
          enrollmentId: bare.id,
          campaignId: bare.campaignId,
          payload: { fromStage: bare.pipelineStage, toStage: stage, manual: true, ...(goal ?? {}) },
        },
      };
    });
    if (moved.event) await this.publisher.publish(moved.event);
    return moved.updated;
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
