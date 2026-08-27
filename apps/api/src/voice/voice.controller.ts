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
  Query,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import {
  assertDialAllowed,
  deriveVoiceMediaToken,
  outcomeFromTwilioStatus,
  recordingStatusCallbackUrl,
  SendBlockedError,
  validateTwilioSignature,
  type VoiceDialer,
  nextWindowOpenAt,
  resolveCallWindow,
  type CallDialJobData,
  isTimingOpen,
  workspaceRecordingEnabled,
} from "@clientforce/channels";
import {
  dialCallBodySchema,
  parseWorkspaceVoiceDefaults,
  VOICE_PERSONAS,
  voiceDefaultsPatchSchema,
} from "@clientforce/core";
import { withTenant, Role, type Prisma } from "@clientforce/db";
import { parseGuardrails } from "@clientforce/core";
import { EVENT_TYPES } from "@clientforce/events";
import type { Queue } from "bullmq";
import { Public, Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";
import { PrismaService } from "../db/prisma.service";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import { CALL_DIAL_QUEUE_TOKEN, VOICE_DIALER } from "./voice.providers";

@Controller()
export class VoiceController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
    @Inject(VOICE_DIALER) private readonly dialer: VoiceDialer,
    @Inject(CALL_DIAL_QUEUE_TOKEN) private readonly callQueue: Queue<CallDialJobData> | null,
  ) {}

  /** Dial one contact through the FULL rail order. Refusals are typed +
   *  logged. B3c-1 (DEC-113/118): the row carries caller attribution, and
   *  `when: "best_time"` queues the call for the next contact-local window
   *  opening instead of refusing on the clock. */
  @Post("agents/:id/calls")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async dial(@Req() req: AuthenticatedRequest, @Param("id") agentId: string, @Body() body: unknown) {
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
      caller: "ada" as const,
    };
    let clearance;
    try {
      clearance = await assertDialAllowed({ prisma: this.prisma.app }, params);
    } catch (err) {
      if (err instanceof SendBlockedError) {
        // B3c-1: a TIMING refusal on a best-time dial is not a refusal — it
        // is the queue's reason to exist. Every other gate still 422s.
        if (
          parsed.data.when === "best_time" &&
          (err.reason === "OUTSIDE_SENDING_WINDOW" || err.reason === "OUTSIDE_QUIET_HOURS")
        ) {
          return this.queueBestTime(req, agentId, campaign.id, parsed.data.contactId, workspaceId);
        }
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
          // B3c-1 (DEC-113): caller attribution on the one Call spine.
          caller: "ada",
          placedById: req.auth?.user.id ?? null,
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
    // B3c-2 (DEC-118(3)): the workspace recording flag rides the dial — the
    // session's spoken recording sentence and the capture flip together.
    const record = await workspaceRecordingEnabled(this.prisma.app, workspaceId);
    const result = await this.dialer.placeCall({
      to: clearance.phone,
      twimlUrl: `${voiceServiceUrl}/twiml?callId=${call.id}&workspaceId=${workspaceId}${gateToken}`,
      ...(apiPublicUrl
        ? { statusCallbackUrl: `${apiPublicUrl}/webhooks/twilio-voice-status` }
        : {}),
      ...(record ? { record: true, recordingStatusCallbackUrl: recordingStatusCallbackUrl() } : {}),
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

  /**
   * B3c-1: queue a best-time dial — the next contact-local window opening is
   * computed from the SAME resolver the rail enforces, stored on the row
   * (the checkable claim) and armed as a delayed job. The worker re-runs the
   * full rail at fire time; a queued call never bypasses a fresh gate.
   */
  private async queueBestTime(
    req: AuthenticatedRequest,
    agentId: string,
    campaignId: string,
    contactId: string,
    workspaceId: string,
  ) {
    // Review-round fix: without the queue there is nothing to fire the call
    // — an honest 503 beats a phantom "queued" row nobody will ever dial.
    if (!this.callQueue) {
      throw new HttpException(
        { reason: "QUEUE_UNAVAILABLE", message: "Call scheduling is not available right now — try when their window is open." },
        503,
      );
    }
    // Review-round fix: every NON-timing gate must clear BEFORE queueing —
    // consent, attempts, caps, opt-out, suppression, allow-list. Refusals
    // here flow back to the caller's normal catch (Logs row + 422): a call
    // the rail already knows it will refuse is never promised.
    const clearance = await assertDialAllowed(
      { prisma: this.prisma.app },
      { workspaceId, campaignId, agentId, contactId, caller: "ada", skipTimingGates: true },
    );
    const openAt = nextWindowOpenAt(clearance.window, new Date());
    if (!openAt) {
      throw new HttpException(
        {
          reason: "OUTSIDE_QUIET_HOURS",
          message:
            "Their clock and the campaign's calling window never overlap this week — widen the campaign window.",
        },
        422,
      );
    }
    // Idempotent: one pending best-time call per (campaign, contact) —
    // repeat clicks return the pending row instead of stacking rings.
    const pending = await this.tenant.run((tx) =>
      tx.call.findFirst({
        where: {
          campaignId,
          contactId,
          caller: "ada",
          status: "QUEUED",
          providerCallSid: null,
        },
      }),
    );
    if (pending) {
      const meta = (pending.meta ?? {}) as { scheduledAt?: string };
      return { ...pending, queued: true, scheduledAt: meta.scheduledAt ?? openAt.toISOString(), window: clearance.window };
    }
    const call = await this.tenant.run((tx) =>
      tx.call.create({
        data: {
          workspaceId,
          campaignId,
          agentId,
          contactId,
          direction: "OUTBOUND",
          status: "QUEUED",
          caller: "ada",
          placedById: req.auth?.user.id ?? null,
          meta: {
            scheduledAt: openAt.toISOString(),
            window: {
              timezone: clearance.window.timezone,
              source: clearance.window.source,
              start: clearance.window.start,
              end: clearance.window.end,
            },
          },
        },
      }),
    );
    await this.callQueue.add(
      "dial",
      { workspaceId, callId: call.id },
      { delay: Math.max(0, openAt.getTime() - Date.now()), jobId: `call-${call.id}` },
    );
    return { ...call, queued: true, scheduledAt: openAt.toISOString(), window: clearance.window };
  }

  /**
   * B3c-1: the checkable "Ada picks the best time" read — the drawer's
   * confirm sheet renders exactly this window, its SOURCE, and the next
   * opening, from the same resolver the rail enforces.
   */
  @Get("voice/call-window")
  async callWindow(@Query("agentId") agentId: string, @Query("contactId") contactId: string) {
    if (!agentId || !contactId) throw new BadRequestException("agentId and contactId required");
    const [contact, agent] = await this.tenant.run((tx) =>
      Promise.all([
        tx.contact.findUnique({ where: { id: contactId } }),
        tx.agent.findUnique({ where: { id: agentId } }),
      ]),
    );
    if (!contact || !agent) throw new NotFoundException("Contact or agent not found");
    const guardrails = parseGuardrails(agent.guardrails);
    const window = await resolveCallWindow(
      this.prisma.app,
      this.tenant.workspaceId,
      contact,
      guardrails,
    );
    const now = new Date();
    const openAt = nextWindowOpenAt(window, now);
    return {
      window,
      nextOpenAt: openAt ? openAt.toISOString() : null,
      // The ONE timing truth the rail enforces — never a near-enough guess.
      insideNow: isTimingOpen(window, now),
      callConsent: (contact as { callConsent?: string }).callConsent ?? "unknown",
    };
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
            disclosureVariant:
              (c.meta as { disclosureVariant?: string } | null)?.disclosureVariant ?? null,
          };
        }),
      };
    });
  }

  /**
   * Call detail + the transcript thread (Message rows carrying meta.callId)
   * + the SPEC A retrieval receipts: what the agent read from the record
   * mid-call, in the order it read it. A turn with no receipt was answered
   * from the brief alone — that absence is itself the audit signal, which is
   * why empty and refused lookups are returned alongside the ones that hit.
   */
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
        where: {
          channel: "voice",
          contactId: call.contactId,
          meta: { path: ["callId"], equals: id },
        },
        orderBy: { sentAt: "asc" },
      });
      const retrievals = await tx.callRetrieval.findMany({
        where: { callId: id },
        orderBy: { seq: "asc" },
      });
      return {
        retrievals: retrievals.map((r) => ({
          id: r.id,
          callId: r.callId,
          turn: r.turn,
          seq: r.seq,
          facet: r.facet,
          query: r.query,
          found: r.found,
          itemCount: r.itemCount,
          latencyMs: r.latencyMs,
          refusalReason: r.refusalReason,
          sources: Array.isArray(r.sources) ? (r.sources as string[]) : [],
          createdAt: r.createdAt.toISOString(),
        })),
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
      // B3c-2 (DEC-118(3)): the per-workspace recording toggle — read at
      // dial time by every outbound path, so the spoken recording sentence
      // and the actual capture always flip together.
      if (parsed.data.recordingEnabled !== undefined) {
        voiceDefaults.recordingEnabled = parsed.data.recordingEnabled;
      }
      const updated = await tx.workspace.update({
        where: { id: workspaceId },
        data: { settings: { ...settings, voiceDefaults } as Prisma.InputJsonValue },
      });
      const next = parseWorkspaceVoiceDefaults(updated.settings);
      return {
        spokenName: next.spokenName ?? null,
        recordingEnabled: next.recordingEnabled ?? false,
      };
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
        payload: { callId: call.id, reason: outcome, caller: call.caller },
      });
    } else {
      // B3c-2: a call the WEBHOOK resolves as completed had no session
      // finalizer (the human bridge, or a connected call with no stream) —
      // the timeline row lands here or nowhere.
      await this.publisher.publish({
        type: EVENT_TYPES.CALL_COMPLETED,
        workspaceId: call.workspaceId,
        campaignId: call.campaignId,
        contactId: call.contactId,
        payload: { callId: call.id, durationSec: durationSec ?? 0, outcome, caller: call.caller },
      });
    }
    return "<Response/>";
  }
}
