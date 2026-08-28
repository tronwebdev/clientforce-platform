import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AiGateway } from "@clientforce/ai";
import {
  ComposeRefusedError,
  createReplyComposer,
  SendBlockedError,
  sendSmsStep,
  sendStep,
  type EmailSender,
  type SmsSender,
} from "@clientforce/channels";
import { EVENT_TYPES } from "@clientforce/events";
import { Role, type Prisma } from "@clientforce/db";
import { z } from "zod";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { EMAIL_TRANSPORT, SMS_TRANSPORT } from "../channels/channels.providers";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import { COMPOSER_GATEWAY } from "../planner/planner.providers";

/**
 * B3b (DEC-116/117): the console's reply spine — every write the workspace
 * inbox gained when it stopped being read-only.
 *
 *  - POST /inbox/reply  — a HUMAN sends a reply on an existing thread, through
 *    the byte-shared send boundary (`origin: "reply"`: every safety gate runs;
 *    Ada's scheduling rails don't govern a human answering). Who may send =
 *    who may work the inbox (owner ruling — the existing role set, no new
 *    tier). On success the contact's ACTIVE enrollments take a reply-hold
 *    (owner ruling: Ada pauses until the explicit Resume) with
 *    `enrollment.held.v1` on the timeline.
 *  - POST /inbox/draft  — Ada drafts a reply for approve/edit/send (the
 *    `composer.reply` prompt; reads the conversation, the business context
 *    and the owner's contact note — Q-079 closes here). Never auto-sent.
 *  - POST /inbox/resume — the explicit Resume Ada control: releases the
 *    contact's holds, `enrollment.resumed.v1` on the timeline.
 *  - PATCH /inbox/thread-state — assign + snooze (additive ThreadState).
 *  - GET /inbox/members — who a thread can be assigned to.
 */

const consentAskSchema = z.object({
  agentId: z.string().min(1),
  contactId: z.string().min(1),
});

const replySchema = z.object({
  campaignId: z.string().min(1),
  contactId: z.string().min(1),
  body: z.string().trim().min(1).max(5000),
  channel: z.enum(["email", "sms"]),
  /** Provenance the human's client states: was this Ada's draft, edited? */
  draft: z.enum(["ada", "none"]).default("none"),
  draftEdited: z.boolean().optional(),
});

const draftSchema = z.object({
  campaignId: z.string().min(1),
  contactId: z.string().min(1),
  channel: z.enum(["email", "sms"]),
});

const resumeSchema = z.object({ contactId: z.string().min(1) });

const threadStateSchema = z
  .object({
    campaignId: z.string().min(1),
    contactId: z.string().min(1),
    assigneeUserId: z.string().min(1).nullable().optional(),
    snoozedUntil: z.string().datetime().nullable().optional(),
  })
  .refine((v) => v.assigneeUserId !== undefined || v.snoozedUntil !== undefined, {
    message: "Provide assigneeUserId or snoozedUntil",
  });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

@Controller("inbox")
export class InboxActionsController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
    @Inject(EMAIL_TRANSPORT) private readonly emailTransport: EmailSender,
    @Inject(SMS_TRANSPORT) private readonly smsTransport: SmsSender,
    @Inject(COMPOSER_GATEWAY) private readonly composerGateway: AiGateway | null,
  ) {}

  /** Who a thread can be assigned to — the workspace's members. */
  @Get("members")
  async members(@Req() req: AuthenticatedRequest) {
    const rows = await this.prisma.admin.membership.findMany({
      where: { workspaceId: req.auth!.activeWorkspaceId },
      select: { role: true, user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((m) => ({ ...m.user, role: m.role }));
  }

  @Post("reply")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async reply(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(replySchema, body);
    const workspaceId = req.auth!.activeWorkspaceId;
    const userId = req.auth!.user.id;

    const { campaign, enrollment, senderId } = await this.tenant.run(async (tx) => {
      const camp = await tx.campaign.findUnique({ where: { id: dto.campaignId } });
      if (!camp) throw new NotFoundException(`Campaign ${dto.campaignId} not found`);
      const enr = await tx.enrollment.findFirst({
        where: { campaignId: dto.campaignId, contactId: dto.contactId },
      });
      // Sender resolution is deterministic: the thread's own last outbound
      // sender when it is still ACTIVE and channel-matched, else the
      // workspace's first ACTIVE sender of the channel's type.
      const wantType = dto.channel === "sms" ? "TWILIO_SMS" : "CF_MANAGED";
      const lastOutbound = await tx.message.findFirst({
        where: {
          campaignId: dto.campaignId,
          contactId: dto.contactId,
          direction: "OUTBOUND",
          channel: dto.channel,
          senderId: { not: null },
        },
        orderBy: { sentAt: "desc" },
        select: { senderId: true },
      });
      let sender = lastOutbound?.senderId
        ? await tx.senderConnection.findUnique({ where: { id: lastOutbound.senderId } })
        : null;
      if (!sender || sender.status !== "ACTIVE" || sender.type !== wantType) {
        sender = await tx.senderConnection.findFirst({
          where: { status: "ACTIVE", type: wantType },
          orderBy: { createdAt: "asc" },
        });
      }
      if (!sender) {
        throw new BadRequestException(
          dto.channel === "sms"
            ? "No active text sender — connect one in Settings before replying by text."
            : "No active email sender — connect one in Settings before replying.",
        );
      }
      return { campaign: camp, enrollment: enr, senderId: sender.id };
    });

    const params = {
      workspaceId,
      campaignId: campaign.id,
      agentId: campaign.agentId,
      ...(enrollment ? { enrollmentId: enrollment.id } : {}),
      contactId: dto.contactId,
      senderId,
      content: { body: dto.body, threaded: true },
      origin: "reply" as const,
      replyBy: {
        userId,
        draft: dto.draft ?? "none",
        ...(dto.draftEdited !== undefined ? { draftEdited: dto.draftEdited } : {}),
      },
    };
    let message;
    try {
      message =
        dto.channel === "sms"
          ? await sendSmsStep({ prisma: this.prisma.app, transport: this.smsTransport }, params)
          : await sendStep({ prisma: this.prisma.app, transport: this.emailTransport }, params);
    } catch (err) {
      if (err instanceof SendBlockedError) {
        // The boundary's typed refusal, surfaced owner-readably (fix, don't guess).
        throw new BadRequestException(`Not sent — ${err.message}`);
      }
      throw err;
    }

    // Owner ruling (DEC-116(2)): the human's reply pauses Ada FOR THIS
    // CONTACT — every ACTIVE enrollment takes a hold until explicit Resume.
    // Idempotent: an enrollment already held is left as it stands.
    const held = await this.tenant.run(async (tx) => {
      const active = await tx.enrollment.findMany({
        where: { contactId: dto.contactId, status: "ACTIVE" },
        select: { id: true, campaignId: true },
      });
      const placed: string[] = [];
      for (const e of active) {
        const existing = await tx.enrollmentReplyHold.findFirst({
          where: { enrollmentId: e.id, releasedAt: null },
        });
        if (existing) continue;
        await tx.enrollmentReplyHold.create({
          data: {
            workspaceId,
            enrollmentId: e.id,
            campaignId: e.campaignId,
            contactId: dto.contactId,
            reason: "human_reply",
            createdById: userId,
          },
        });
        await tx.event.create({
          data: {
            workspaceId,
            type: EVENT_TYPES.ENROLLMENT_HELD,
            contactId: dto.contactId,
            enrollmentId: e.id,
            campaignId: e.campaignId,
            payload: { reason: "human_reply", byUserId: userId },
          },
        });
        placed.push(e.id);
      }
      return placed;
    });

    return { message, heldEnrollments: held };
  }

  /**
   * B3d (DEC-120 expansion 1): Ada's may-we-call ask — one fixed line, sent
   * through the SAME boundary as every human 1:1 message (origin "reply":
   * every safety gate runs; a human tapped this, so the scheduling rails
   * don't govern it), marked `consentAsk` so an affirmative reply on this
   * thread flips call consent deterministically. Asking does NOT hold Ada —
   * nothing was answered.
   */
  @Post("consent-ask")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async consentAsk(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(consentAskSchema, body);
    const workspaceId = req.auth!.activeWorkspaceId;
    const userId = req.auth!.user.id;

    const { campaign, enrollment, senderId, channel } = await this.tenant.run(async (tx) => {
      const camp = await tx.campaign.findFirst({
        where: { agentId: dto.agentId },
        orderBy: { createdAt: "asc" },
      });
      if (!camp) throw new NotFoundException(`Agent ${dto.agentId} has no campaign`);
      const contact = await tx.contact.findUnique({ where: { id: dto.contactId } });
      if (!contact) throw new NotFoundException(`Contact ${dto.contactId} not found`);
      const enr = await tx.enrollment.findFirst({
        where: { campaignId: camp.id, contactId: dto.contactId },
      });
      // Channel: text when they have a phone AND a text sender is live —
      // a call question reads naturally by text; else email.
      const smsSender = contact.phone
        ? await tx.senderConnection.findFirst({
            where: { status: "ACTIVE", type: "TWILIO_SMS" },
            orderBy: { createdAt: "asc" },
          })
        : null;
      if (smsSender) return { campaign: camp, enrollment: enr, senderId: smsSender.id, channel: "sms" as const };
      const emailSender = await tx.senderConnection.findFirst({
        where: { status: "ACTIVE", type: "CF_MANAGED" },
        orderBy: { createdAt: "asc" },
      });
      if (!emailSender) {
        throw new BadRequestException("No active sender — connect one in Settings before asking.");
      }
      return { campaign: camp, enrollment: enr, senderId: emailSender.id, channel: "email" as const };
    });

    const askLine = "Mind if we call you about this? Reply YES and we'll ring at a time that suits you.";
    const params = {
      workspaceId,
      campaignId: campaign.id,
      agentId: campaign.agentId,
      ...(enrollment ? { enrollmentId: enrollment.id } : {}),
      contactId: dto.contactId,
      senderId,
      content: { subject: "Quick question", body: askLine, threaded: true },
      origin: "reply" as const,
      replyBy: { userId, draft: "none" as const },
      consentAsk: true,
    };
    try {
      const message =
        channel === "sms"
          ? await sendSmsStep({ prisma: this.prisma.app, transport: this.smsTransport }, params)
          : await sendStep({ prisma: this.prisma.app, transport: this.emailTransport }, params);
      return { message, channel };
    } catch (err) {
      if (err instanceof SendBlockedError) {
        throw new BadRequestException(`Not sent — ${err.message}`);
      }
      throw err;
    }
  }

  @Post("draft")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async draft(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(draftSchema, body);
    if (!this.composerGateway) {
      // DEC-047 ladder: a designed 503 naming the prerequisite, never a dead click.
      throw new ServiceUnavailableException(
        "Drafting is not configured on this deployment (no model key). Type the reply yourself — sending works.",
      );
    }
    const campaign = await this.tenant.run((tx) =>
      tx.campaign.findUnique({ where: { id: dto.campaignId } }),
    );
    if (!campaign) throw new NotFoundException(`Campaign ${dto.campaignId} not found`);
    try {
      const compose = createReplyComposer({ prisma: this.prisma.app, gateway: this.composerGateway });
      const draft = await compose({
        workspaceId: req.auth!.activeWorkspaceId,
        agentId: campaign.agentId,
        campaignId: dto.campaignId,
        contactId: dto.contactId,
        channel: dto.channel,
      });
      return draft;
    } catch (err) {
      if (err instanceof ComposeRefusedError) {
        throw new BadRequestException(`No draft — ${err.reason}: ${err.detail}`);
      }
      throw err;
    }
  }

  /** The explicit "Resume Ada" control (owner ruling: no auto-resume timer). */
  @Post("resume")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async resume(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(resumeSchema, body);
    const workspaceId = req.auth!.activeWorkspaceId;
    const userId = req.auth!.user.id;
    return this.tenant.run(async (tx) => {
      const holds = await tx.enrollmentReplyHold.findMany({
        where: { contactId: dto.contactId, releasedAt: null },
      });
      for (const hold of holds) {
        await tx.enrollmentReplyHold.update({
          where: { id: hold.id },
          data: { releasedAt: new Date(), releasedById: userId },
        });
        await tx.event.create({
          data: {
            workspaceId,
            type: EVENT_TYPES.ENROLLMENT_RESUMED,
            contactId: dto.contactId,
            enrollmentId: hold.enrollmentId,
            campaignId: hold.campaignId,
            payload: { byUserId: userId },
          },
        });
      }
      return { released: holds.length };
    });
  }

  /** Assign + snooze — per-thread working state (additive ThreadState). */
  @Patch("thread-state")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async threadState(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(threadStateSchema, body);
    const workspaceId = req.auth!.activeWorkspaceId;
    if (dto.assigneeUserId) {
      const member = await this.prisma.admin.membership.findFirst({
        where: { workspaceId, userId: dto.assigneeUserId },
      });
      if (!member) throw new BadRequestException("That person is not a member of this workspace");
    }
    if (dto.snoozedUntil && new Date(dto.snoozedUntil).getTime() <= Date.now()) {
      throw new BadRequestException("Snooze until a future time");
    }
    return this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findUnique({ where: { id: dto.campaignId } });
      if (!campaign) throw new NotFoundException(`Campaign ${dto.campaignId} not found`);
      const data: Prisma.ThreadStateUncheckedCreateInput = {
        workspaceId,
        campaignId: dto.campaignId,
        contactId: dto.contactId,
        assigneeUserId: dto.assigneeUserId ?? null,
        snoozedUntil: dto.snoozedUntil ? new Date(dto.snoozedUntil) : null,
      };
      return tx.threadState.upsert({
        where: { campaignId_contactId: { campaignId: dto.campaignId, contactId: dto.contactId } },
        create: data,
        update: {
          ...(dto.assigneeUserId !== undefined ? { assigneeUserId: dto.assigneeUserId } : {}),
          ...(dto.snoozedUntil !== undefined
            ? { snoozedUntil: dto.snoozedUntil ? new Date(dto.snoozedUntil) : null }
            : {}),
        },
      });
    });
  }
}
