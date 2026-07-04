import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { SendBlockedError, sendStep, type EmailSender } from "@clientforce/channels";
import { createSenderSchema, testSendSchema } from "@clientforce/core";
import { Role, type Prisma } from "@clientforce/db";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import { EMAIL_TRANSPORT } from "./channels.providers";

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
 * Sender connections (P1.5). CF_MANAGED is the live tier; the OAuth/SMTP
 * tiers are designed-but-inert (the Settings connect surface shows their
 * forms with a "coming soon" submit — checkpoints §6). Test-send goes through
 * the FULL send boundary — all three owner rules + guardrails + allow-list.
 */
@Controller("senders")
export class SendersController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailSender,
  ) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  create(@Body() body: unknown) {
    const dto = parse(createSenderSchema, body);
    if (dto.type !== "CF_MANAGED") {
      throw new BadRequestException(
        `${dto.type} senders are designed but not yet available — CF_MANAGED ships first (P1.5)`,
      );
    }
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run((tx) =>
      tx.senderConnection.create({
        data: {
          workspaceId,
          type: dto.type,
          fromEmail: dto.fromEmail,
          fromName: dto.fromName ?? null,
          replyTo: dto.replyTo ?? null,
          ...(dto.dailyLimit ? { dailyLimit: dto.dailyLimit } : {}),
          sendingWindow: (dto.sendingWindow ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
    );
  }

  @Get()
  list() {
    return this.tenant.run((tx) => tx.senderConnection.findMany({ orderBy: { createdAt: "asc" } }));
  }

  @Post("test-send")
  @Roles(Role.OWNER, Role.ADMIN)
  async testSend(@Body() body: unknown) {
    const dto = parse(testSendSchema, body);
    const workspaceId = this.tenant.workspaceId;

    const agent = await this.tenant.run((tx) =>
      tx.agent.findUnique({ where: { id: dto.agentId } }),
    );
    if (!agent) throw new NotFoundException(`Agent ${dto.agentId} not found`);

    const { contactId, campaignId } = await this.tenant.run(async (tx) => {
      // Test recipients become ordinary contacts so the boundary (suppression,
      // opt-out, allow-list) applies to them exactly like real leads.
      const contact =
        (await tx.contact.findFirst({ where: { workspaceId, email: dto.to } })) ??
        (await tx.contact.create({
          data: {
            workspaceId,
            source: "test-send",
            optOut: {},
            tags: [],
            email: dto.to,
            firstName: "Test",
            company: "Clientforce Test",
          },
        }));
      const campaign =
        (await tx.campaign.findFirst({
          where: { agentId: dto.agentId },
          orderBy: { createdAt: "asc" },
        })) ??
        (await tx.campaign.create({
          data: { workspaceId, agentId: dto.agentId, name: `${agent.name} — primary`, graphId: "" },
        }));
      return { contactId: contact.id, campaignId: campaign.id };
    });

    try {
      const message = await sendStep(
        { prisma: this.prisma.app, transport: this.transport },
        {
          workspaceId,
          campaignId,
          agentId: dto.agentId,
          contactId,
          senderId: dto.senderId,
          stepNodeId: "test-send",
          content: {
            subject: "Clientforce test send",
            body: "This is a test send from {{senderName}} via Clientforce. If you received it, the sender is wired correctly.",
          },
        },
      );
      return { providerMessageId: message.providerMessageId, messageId: message.id };
    } catch (err) {
      // Typed refusals from the boundary are client-visible outcomes, not 500s.
      if (err instanceof SendBlockedError) {
        throw new UnprocessableEntityException({ reason: err.reason, message: err.message });
      }
      throw err;
    }
  }
}
