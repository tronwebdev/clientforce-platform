/**
 * Voice endpoints (P3.1, DEC-078) — the dial boundary lives HERE, in front of
 * the voice service: POST /agents/:id/calls runs the full rail order
 * (`assertDialAllowed`) and every typed refusal lands as a `call.refused.v1`
 * Event row (the Logs surface) before the caller sees the 422. Cleared dials
 * create the Call row (QUEUED) and hand Twilio a TwiML URL on the voice
 * service with callId+workspaceId bound as stream parameters.
 *
 * The Twilio status callback resolves calls that never connected
 * (no_answer/busy/canceled) — a connected call is finalized by the session
 * itself when the stream ends; the callback never overwrites its outcome.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import {
  assertDialAllowed,
  deriveVoiceMediaToken,
  outcomeFromTwilioStatus,
  SendBlockedError,
  validateTwilioSignature,
  type VoiceDialer,
} from "@clientforce/channels";
import {
  dialCallBodySchema,
  parseWorkspaceVoiceDefaults,
  VOICE_PERSONAS,
  voiceDefaultsPatchSchema,
} from "@clientforce/core";
import { withTenant, Role, type Prisma } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import { Public, Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { PrismaService } from "../db/prisma.service";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import { VOICE_DIALER } from "./voice.providers";

@Controller()
export class VoiceController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
    @Inject(VOICE_DIALER) private readonly dialer: VoiceDialer,
  ) {}

  /** Dial one contact through the FULL rail order. Refusals are typed + logged. */
  @Post("agents/:id/calls")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async dial(@Param("id") agentId: string, @Body() body: unknown) {
    const parsed = dialCallBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid dial payload",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const workspaceId = this.tenant.workspaceId;
    const campaign = await this.tenant.run((tx) =>
      tx.campaign.findFirst({ where: { agentId }, orderBy: { createdAt: "asc" } }),
    );
    if (!campaign) throw new NotFoundException(`Agent ${agentId} has no campaign`);

    const params = {
      workspaceId,
      campaignId: campaign.id,
      agentId,
      contactId: parsed.data.contactId,
    };
    let clearance;
    try {
      clearance = await assertDialAllowed({ prisma: this.prisma.app }, params);
    } catch (err) {
      if (err instanceof SendBlockedError) {
        // The Logs row the acceptance demands — refusal recorded BEFORE the 422.
        await this.publisher.publish({
          type: EVENT_TYPES.CALL_REFUSED,
          workspaceId,
          campaignId: campaign.id,
          contactId: parsed.data.contactId,
          payload: { reason: err.reason, detail: err.message, contactId: parsed.data.contactId },
        });
        throw new HttpException({ reason: err.reason, message: err.message }, 422);
      }
      throw err;
    }

    const call = await this.tenant.run((tx) =>
      tx.call.create({
        data: {
          workspaceId,
          campaignId: campaign.id,
          agentId,
          contactId: parsed.data.contactId,
          direction: "OUTBOUND",
          status: "QUEUED",
        },
      }),
    );

    const voiceServiceUrl = (process.env.VOICE_SERVICE_URL ?? "").replace(/\/$/, "");
    const apiPublicUrl = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
    // The deployed voice service gates /twiml + /media on the token derived
    // from the shared Twilio credential (P3.1 deploy) — same gate-off
    // semantics as the service: no auth token, no `t=` appended.
    const gateToken = process.env.TWILIO_AUTH_TOKEN
      ? `&t=${deriveVoiceMediaToken(process.env.TWILIO_AUTH_TOKEN)}`
      : "";
    const result = await this.dialer.placeCall({
      to: clearance.phone,
      twimlUrl: `${voiceServiceUrl}/twiml?callId=${call.id}&workspaceId=${workspaceId}${gateToken}`,
      ...(apiPublicUrl
        ? { statusCallbackUrl: `${apiPublicUrl}/webhooks/twilio-voice-status` }
        : {}),
    });
    return this.tenant.run((tx) =>
      tx.call.update({
        where: { id: call.id },
        data: {
          providerCallSid: result.providerCallSid,
          meta: { sandbox: result.sandbox },
        },
      }),
    );
  }

  /** The Calls tab rows — newest first, contact names joined. */
  @Get("agents/:id/calls")
  async list(@Param("id") agentId: string) {
    return this.tenant.run(async (tx) => {
      const calls = await tx.call.findMany({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const contactIds = [...new Set(calls.map((c) => c.contactId))];
      const contacts = await tx.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, firstName: true, lastName: true, company: true },
      });
      const byId = new Map(contacts.map((c) => [c.id, c]));
      return {
        calls: calls.map((c) => {
          const contact = byId.get(c.contactId);
          const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ");
          return {
            id: c.id,
            contactId: c.contactId,
            contactName: name || contact?.company || "Unknown",
            company: contact?.company ?? null,
            direction: c.direction,
            status: c.status,
            outcome: c.outcome,
            durationSec: c.durationSec,
            startedAt: (c.startedAt ?? c.createdAt).toISOString(),
            disclosureVariant: (c.meta as { disclosureVariant?: string } | null)?.disclosureVariant ?? null,
          };
        }),
      };
    });
  }

  /** Call detail + the transcript thread (Message rows carrying meta.callId). */
  @Get("calls/:id")
  async detail(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const call = await tx.call.findUnique({ where: { id } });
      if (!call) throw new NotFoundException(`Call ${id} not found`);
      const contact = await tx.contact.findUnique({
        where: { id: call.contactId },
        select: { id: true, firstName: true, lastName: true, company: true },
      });
      const transcript = await tx.message.findMany({
        where: { channel: "voice", contactId: call.contactId, meta: { path: ["callId"], equals: id } },
        orderBy: { sentAt: "asc" },
      });
      return {
        call: {
          id: call.id,
          status: call.status,
          outcome: call.outcome,
          durationSec: call.durationSec,
          startedAt: (call.startedAt ?? call.createdAt).toISOString(),
          endedAt: call.endedAt?.toISOString() ?? null,
          meta: call.meta,
        },
        contact,
        transcript: transcript.map((m) => ({
          id: m.id,
          direction: m.direction,
          body: m.body,
          sentAt: m.sentAt.toISOString(),
          meta: m.meta,
        })),
      };
    });
  }

  /** Voice settings read: workspace defaults + personas + the agent picker data. */
  @Get("voice/defaults")
  async defaults() {
    const workspaceId = this.tenant.workspaceId;
    const workspace = await withTenant(this.prisma.app, { workspaceId }, (tx) =>
      tx.workspace.findUnique({ where: { id: workspaceId } }),
    );
    const defaults = parseWorkspaceVoiceDefaults(workspace?.settings);
    return {
      spokenName: defaults.spokenName ?? null,
      recordingEnabled: defaults.recordingEnabled ?? false,
      personas: VOICE_PERSONAS,
    };
  }

  /** Seed/update the workspace default spoken name (the Senders-flow step). */
  @Patch("voice/defaults")
  @Roles(Role.OWNER, Role.ADMIN)
  async patchDefaults(@Body() body: unknown) {
    const parsed = voiceDefaultsPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid voice defaults",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const workspaceId = this.tenant.workspaceId;
    return withTenant(this.prisma.app, { workspaceId }, async (tx) => {
      const workspace = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!workspace) throw new NotFoundException("Workspace not found");
      const settings = (workspace.settings ?? {}) as Record<string, unknown>;
      const voiceDefaults = {
        ...(typeof settings.voiceDefaults === "object" && settings.voiceDefaults !== null
          ? (settings.voiceDefaults as Record<string, unknown>)
          : {}),
      };
      if (parsed.data.spokenName !== undefined) {
        if (parsed.data.spokenName === null) delete voiceDefaults.spokenName;
        else voiceDefaults.spokenName = parsed.data.spokenName;
      }
      const updated = await tx.workspace.update({
        where: { id: workspaceId },
        data: { settings: { ...settings, voiceDefaults } as Prisma.InputJsonValue },
      });
      const next = parseWorkspaceVoiceDefaults(updated.settings);
      return { spokenName: next.spokenName ?? null, recordingEnabled: next.recordingEnabled ?? false };
    });
  }

  /**
   * Twilio call-status callback — resolves calls that never connected. A
   * connected call is finalized by the session (stream end); this handler
   * only fills outcomes that are still null (never overwrites the session's).
   */
  @Public()
  @Post("webhooks/twilio-voice-status")
  @UseInterceptors(AnyFilesInterceptor())
  @Header("Content-Type", "text/xml")
  async voiceStatus(
    @Req() req: Request,
    @Body() form: Record<string, unknown>,
    @Headers("x-twilio-signature") signature?: string,
  ): Promise<string> {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const url = `${process.env.PUBLIC_API_URL ?? `https://${req.headers.host ?? ""}`}${req.originalUrl}`;
      const params = Object.fromEntries(
        Object.entries(form ?? {}).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
      if (!signature || !validateTwilioSignature(authToken, url, params, signature)) {
        throw new UnauthorizedException("Invalid Twilio signature");
      }
    } else if (process.env.NODE_ENV === "production") {
      throw new UnauthorizedException("Twilio auth token not configured");
    }

    const callSid = typeof form?.CallSid === "string" ? form.CallSid : "";
    const status = typeof form?.CallStatus === "string" ? form.CallStatus : "";
    const outcome = outcomeFromTwilioStatus(status);
    if (!callSid || !outcome) return "<Response/>";

    // Cross-workspace resolve by the unique sid (admin), then tenant-scoped write.
    const call = await this.prisma.admin.call.findUnique({ where: { providerCallSid: callSid } });
    if (!call || call.outcome) return "<Response/>";

    const durationSec = Number(form?.CallDuration ?? "") || null;
    await withTenant(this.prisma.app, { workspaceId: call.workspaceId }, (tx) =>
      tx.call.update({
        where: { id: call.id },
        data: {
          status: outcome === "completed" ? "COMPLETED" : "FAILED",
          outcome,
          ...(durationSec !== null && call.durationSec === null ? { durationSec } : {}),
          endedAt: new Date(),
        },
      }),
    );
    if (outcome !== "completed") {
      await this.publisher.publish({
        type: EVENT_TYPES.CALL_FAILED,
        workspaceId: call.workspaceId,
        campaignId: call.campaignId,
        contactId: call.contactId,
        payload: { callId: call.id, reason: outcome },
      });
    }
    return "<Response/>";
  }
}
