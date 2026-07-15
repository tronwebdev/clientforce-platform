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
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  SendBlockedError,
  computeSenderHealth,
  loadSenderLedgerSample,
  initialWarmupState,
  parseHealthState,
  runSenderDnsCheck,
  sendStep,
  senderLedgerChannel,
  warmupProgressFor,
  HEALTH_WINDOW_DAYS,
  type DnsCheckDeps,
  type EmailSender,
} from "@clientforce/channels";
import { createSenderSchema, createSmsSenderSchema, testSendSchema, updateSenderSchema } from "@clientforce/core";
import { encryptField, Role, type Prisma } from "@clientforce/db";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import { DNS_CHECK_DEPS, EMAIL_TRANSPORT } from "./channels.providers";

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
    @Inject(DNS_CHECK_DEPS) private readonly dnsDeps: DnsCheckDeps,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  create(@Body() body: unknown) {
    // P2.1 (DEC-061): the SMS create shape is its own schema — E.164 phone
    // rides the fromEmail column (enum-only migration, documented), the
    // messaging-service SID rides the field-encrypted credentials blob.
    if ((body as { type?: string })?.type === "TWILIO_SMS") {
      const sms = parse(createSmsSenderSchema, body);
      const workspaceId = this.tenant.workspaceId;
      return this.tenant.run((tx) =>
        tx.senderConnection.create({
          data: {
            workspaceId,
            type: "TWILIO_SMS",
            fromEmail: sms.phone,
            fromName: sms.fromName,
            ...(sms.dailyLimit ? { dailyLimit: sms.dailyLimit } : {}),
            credentialsEnc: new Uint8Array(encryptField(JSON.stringify({ messagingServiceSid: sms.messagingServiceSid }))),
            // P5 W1 (DEC-083): NEW senders ramp from day 1 (carrier reputation
            // warms like domain reputation); pre-W1 senders never gain a ramp
            // retroactively (warmup is triggered, DEC-019).
            warmupState: initialWarmupState(new Date()) as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }
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
          // P5 W1 (DEC-083): fresh senders ramp per the warmup curve from day 1.
          warmupState: initialWarmupState(new Date()) as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  }

  @Get()
  list() {
    // C2.3: wizard step 5 shows the live "Daily sending" bar per sender.
    // P5 W3 (DEC-085) perf pass: the count moved from the unindexed
    // `meta.senderId` JSON-path scan to the W1 `senderId` column (covered by
    // [workspaceId, senderId, channel, sentAt]; the migration backfilled every
    // historical row from meta) — before/after numbers in the §8 evidence.
    return this.tenant.run(async (tx) => {
      const senders = await tx.senderConnection.findMany({ orderBy: { createdAt: "asc" } });
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const counts = await Promise.all(
        senders.map((s) =>
          tx.message.count({
            where: {
              senderId: s.id,
              channel: s.type === "TWILIO_SMS" ? "sms" : "email",
              direction: "OUTBOUND",
              sentAt: { gte: dayStart },
            },
          }),
        ),
      );
      // P5 W1 (DEC-083): additive read-model fields — the persisted health
      // snapshot (null until the first sweep; never invented) and the warmup
      // projection (null = no ramp, the pre-W1 senders).
      const now = new Date();
      return senders.map((s, i) => ({
        ...s,
        sentToday: counts[i] ?? 0,
        health: parseHealthState(s.healthState),
        warmup: warmupProgressFor(s, now),
      }));
    });
  }

  /**
   * P5 W1 (DEC-083): the score endpoint — fresh, deterministic computation
   * from the ledger (persisted snapshot echoed alongside). B1-W4's backoffice
   * fleet view consumes THIS same computation via the shared channels service;
   * the score math must never fork. W2 adds `sentAllTime` (the canon drawer's
   * "All time" tile; `sample.sent` over the 7-day window is "This week").
   */
  @Get(":id/health")
  async health(@Param("id") id: string) {
    const workspaceId = this.tenant.workspaceId;
    const sender = await this.tenant.run((tx) =>
      tx.senderConnection.findFirst({ where: { id, workspaceId } }),
    );
    if (!sender) throw new NotFoundException(`Sender ${id} not found`);
    const now = new Date();
    const persisted = parseHealthState(sender.healthState);
    const sample = await loadSenderLedgerSample(this.prisma.app, {
      workspaceId,
      senderId: id,
      channel: senderLedgerChannel(sender),
      now,
    });
    const computed = computeSenderHealth(sample);
    const sentAllTime = await this.tenant.run((tx) =>
      tx.message.count({
        where: { senderId: id, channel: senderLedgerChannel(sender), direction: "OUTBOUND" },
      }),
    );
    return {
      senderId: id,
      fromEmail: sender.fromEmail,
      status: sender.status,
      windowDays: HEALTH_WINDOW_DAYS,
      computedAt: now.toISOString(),
      ...computed,
      sample,
      sentAllTime,
      persisted,
      warmup: warmupProgressFor(sender, now),
      domainAuthStatus: sender.domainAuthStatus,
    };
  }

  /**
   * P5 W2 (DEC-084): pause/resume (typed, audited) + the daily-limit edit.
   * Status moves ACTIVE↔PAUSED only — a PAUSED sender refuses at the existing
   * `SENDER_DISABLED` rail (status ≠ ACTIVE), so no boundary change rides
   * this. Every status flip writes one `sender.status_changed.v1` Event row
   * (the lead.stage_changed manual-move audit pattern).
   */
  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async update(@Param("id") id: string, @Body() body: unknown) {
    const dto = parse(updateSenderSchema, body);
    const workspaceId = this.tenant.workspaceId;
    const sender = await this.tenant.run((tx) =>
      tx.senderConnection.findFirst({ where: { id, workspaceId } }),
    );
    if (!sender) throw new NotFoundException(`Sender ${id} not found`);
    if (dto.status && sender.status === "DISABLED") {
      throw new BadRequestException("A disabled sender can't be paused or resumed here");
    }
    const updated = await this.tenant.run((tx) =>
      tx.senderConnection.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.dailyLimit ? { dailyLimit: dto.dailyLimit } : {}),
        },
      }),
    );
    if (dto.status && dto.status !== sender.status) {
      await this.publisher.publish({
        workspaceId,
        type: "sender.status_changed.v1",
        senderId: id,
        payload: { senderId: id, from: sender.status, to: dto.status },
      });
    }
    return updated;
  }

  /**
   * P5 W2 (DEC-084): the drawer activity timeline — this sender's ledger rows
   * (health collapses/recoveries, warmup completion, pause/resume), newest
   * first, off the W1 `Event.senderId` index.
   */
  @Get(":id/events")
  async events(@Param("id") id: string) {
    const workspaceId = this.tenant.workspaceId;
    const sender = await this.tenant.run((tx) =>
      tx.senderConnection.findFirst({ where: { id, workspaceId }, select: { id: true } }),
    );
    if (!sender) throw new NotFoundException(`Sender ${id} not found`);
    return this.tenant.run((tx) =>
      tx.event.findMany({
        where: { workspaceId, senderId: id },
        orderBy: { occurredAt: "desc" },
        take: 50,
        select: { id: true, type: true, payload: true, occurredAt: true },
      }),
    );
  }

  /**
   * P5 W1 (DEC-083): on-demand DNS re-verification (the drawer's "Re-check
   * DNS" gains a real endpoint in W2). Real lookups through the injected
   * deps; the fresh result REPLACES `domainAuthStatus` — never cached-as-
   * verified. 400 for SMS senders (no DNS posture — honest, not a fake pass).
   */
  @Post(":id/dns-check")
  @Roles(Role.OWNER, Role.ADMIN)
  async dnsCheck(@Param("id") id: string) {
    const workspaceId = this.tenant.workspaceId;
    const sender = await this.tenant.run((tx) =>
      tx.senderConnection.findFirst({ where: { id, workspaceId } }),
    );
    if (!sender) throw new NotFoundException(`Sender ${id} not found`);
    if (sender.type === "TWILIO_SMS") {
      throw new BadRequestException("SMS senders have no DNS posture to verify");
    }
    const status = await runSenderDnsCheck(
      { ...this.dnsDeps, prisma: this.prisma.app },
      { workspaceId, senderId: id },
    );
    return { senderId: id, domainAuthStatus: status };
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
