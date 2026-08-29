/**
 * B3c-2 (DEC-118(1)): HUMAN in-app calling — the browser mic bridged through
 * the business line. The flow:
 *
 *   POST /voice/browser-calls        (auth)  rail-checked, Call row created
 *      → browser Device.connect({ callId })  (Twilio Voice JS SDK)
 *   POST /webhooks/twilio-browser-bridge     TwiML App Voice URL: resolves
 *      the row SERVER-SIDE (the browser never chooses the number), stamps
 *      the parent CallSid, returns <Dial> through VOICE_FROM_NUMBER
 *   POST /webhooks/twilio-browser-whisper    callee-leg <Say> — the spoken
 *      recording sentence, ONLY when the workspace toggle is on
 *   POST /webhooks/twilio-browser-dial-result  <Dial action>: the bridged
 *      leg's outcome + duration land on the row; call.completed/failed.v1
 *      publish with caller attribution
 *
 * DEC-118(2): a human may call any non-DNC contact with a phone — the rail
 * runs with caller "human" (consent/attempt gates skip; tenant, kill switch,
 * phone, language, timing, caps, opt-out, suppression, allow-list all hold).
 *
 * Keyless sandbox (no TWILIO_API_KEY_SID/SECRET/TWIML_APP_SID): no Device
 * registration — the endpoint says `sandbox: true`, the row carries a
 * deterministic sandbox sid, and ONLY such rows accept the client-reported
 * finish (real calls resolve exclusively through the signed webhooks).
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
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import {
  assertDialAllowed,
  browserVoiceConfig,
  conferenceJoinTwiml,
  conferenceRoomForCall,
  mintVoiceAccessToken,
  outcomeFromTwilioStatus,
  SendBlockedError,
  twimlEscape,
  validateTwilioSignature,
  type VoiceDialer,
} from "@clientforce/channels";
import { browserCallBodySchema, parseWorkspaceVoiceDefaults } from "@clientforce/core";
import { withTenant, Role } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import { Public, Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";
import { PrismaService } from "../db/prisma.service";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import { VOICE_DIALER } from "./voice.providers";

const FINISH_OUTCOMES = new Set(["completed", "no_answer", "busy", "failed", "canceled"]);

@Controller()
export class VoiceBrowserController {
  constructor(
    private readonly tenant: TenantClient,
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
    @Inject(VOICE_DIALER) private readonly dialer: VoiceDialer,
  ) {}

  private apiPublicUrl(): string {
    return (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
  }

  /** Start a human browser call: full rail (caller "human"), Call row, token. */
  @Post("voice/browser-calls")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async start(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = browserCallBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid browser-call payload",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const workspaceId = this.tenant.workspaceId;
    const campaign = await this.tenant.run((tx) =>
      tx.campaign.findFirst({ where: { agentId: parsed.data.agentId }, orderBy: { createdAt: "asc" } }),
    );
    if (!campaign) throw new NotFoundException(`Agent ${parsed.data.agentId} has no campaign`);

    try {
      await assertDialAllowed(
        { prisma: this.prisma.app },
        {
          workspaceId,
          campaignId: campaign.id,
          agentId: parsed.data.agentId,
          contactId: parsed.data.contactId,
          caller: "human",
        },
      );
    } catch (err) {
      if (err instanceof SendBlockedError) {
        // The same Logs row the Ada path writes — refusal recorded, then 422.
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

    const cfg = browserVoiceConfig();
    const call = await this.tenant.run((tx) =>
      tx.call.create({
        data: {
          workspaceId,
          campaignId: campaign.id,
          agentId: parsed.data.agentId,
          contactId: parsed.data.contactId,
          direction: "OUTBOUND",
          status: cfg ? "QUEUED" : "IN_PROGRESS",
          caller: "human",
          placedById: req.auth?.user.id ?? null,
          ...(cfg ? {} : { startedAt: new Date() }),
          meta: { browser: true, sandbox: !cfg },
        },
      }),
    );
    if (!cfg) {
      // Keyless sandbox: a deterministic sid keeps caps/idempotency real.
      const sid = `CA-sandbox-browser-${createHash("sha256").update(call.id).digest("hex").slice(0, 24)}`;
      await this.tenant.run((tx) =>
        tx.call.update({ where: { id: call.id }, data: { providerCallSid: sid } }),
      );
      return { callId: call.id, sandbox: true };
    }
    const minted = mintVoiceAccessToken(cfg, `ws-${workspaceId}-u-${req.auth?.user.id ?? "anon"}`);
    return { callId: call.id, sandbox: false, token: minted.token, expiresAt: minted.expiresAt };
  }

  /**
   * B4.5 (DEC-128): JUMP IN — a human takes over an in-progress Ada call.
   * The contact leg is REDIRECTED into the call's conference room and the
   * operator's browser leg joins it through the bridge webhook (the B3c-2
   * leg, per the Q-088 ruling). Ada's media stream stops when the leg
   * redirects — she is OUT of the audio from this moment (her live listen-
   * along is Q-097), and her voice-side finalize leaves the terminal stamp
   * to the contact leg's status webhook. Direction-agnostic: any call row
   * with a live provider sid joins its room the same way (Q-090 inbound).
   * Keyless sandbox: the redirect is a recorded no-op and no Device mounts —
   * the row still carries the takeover truthfully.
   */
  @Post("voice/calls/:id/jump-in")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async jumpIn(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const call = await this.tenant.run((tx) => tx.call.findUnique({ where: { id } }));
    if (!call) throw new NotFoundException(`Call ${id} not found`);
    const meta = (call.meta ?? {}) as Record<string, unknown>;
    if (call.status !== "IN_PROGRESS" || call.outcome) {
      throw new HttpException(
        { reason: "NOT_LIVE", message: "That call is not in progress — nothing to join." },
        409,
      );
    }
    if (meta.takenOver) {
      throw new HttpException(
        { reason: "ALREADY_TAKEN", message: "Someone already jumped into this call." },
        409,
      );
    }
    if (!call.providerCallSid) {
      throw new HttpException(
        { reason: "NO_PROVIDER_LEG", message: "The call has no provider leg to redirect yet." },
        409,
      );
    }
    const byUserId = req.auth?.user.id ?? null;
    // Mark FIRST: the voice finalize reads the marker when Ada's stream stops
    // (redirect ⇒ stop), and the marker is what lets the bridge webhook admit
    // the browser leg into the room.
    await this.tenant.run((tx) =>
      tx.call.update({
        where: { id: call.id },
        data: { meta: { ...meta, takenOver: { byUserId, at: new Date().toISOString() } } },
      }),
    );
    await this.publisher.publish({
      type: EVENT_TYPES.CALL_TAKEN_OVER,
      workspaceId: call.workspaceId,
      campaignId: call.campaignId,
      contactId: call.contactId,
      enrollmentId: call.enrollmentId ?? undefined,
      payload: { callId: call.id, ...(byUserId ? { byUserId } : {}) },
    });
    const room = conferenceRoomForCall(call.id);
    const redirected = await this.dialer.redirectCall(
      call.providerCallSid,
      conferenceJoinTwiml(room),
    );
    const cfg = browserVoiceConfig();
    if (!cfg || redirected.sandbox) {
      return { callId: call.id, room, sandbox: true };
    }
    const minted = mintVoiceAccessToken(cfg, `ws-${call.workspaceId}-u-${byUserId ?? "anon"}`);
    return {
      callId: call.id,
      room,
      sandbox: false,
      token: minted.token,
      expiresAt: minted.expiresAt,
    };
  }

  /** SANDBOX-ONLY finish: the keyless path has no webhooks — the placing
   *  user reports the simulated outcome. Real rows refuse (409): their
   *  truth arrives only through the signed Twilio callbacks. */
  @Post("voice/browser-calls/:id/finish")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async finish(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { outcome?: unknown; durationSec?: unknown },
  ) {
    const outcome = typeof body?.outcome === "string" ? body.outcome : "";
    if (!FINISH_OUTCOMES.has(outcome)) throw new BadRequestException("Unknown outcome");
    const durationSec =
      typeof body?.durationSec === "number" && Number.isFinite(body.durationSec)
        ? Math.max(0, Math.round(body.durationSec))
        : 0;
    return this.tenant.run(async (tx) => {
      const call = await tx.call.findUnique({ where: { id } });
      if (!call) throw new NotFoundException(`Call ${id} not found`);
      const meta = (call.meta ?? {}) as { browser?: boolean; sandbox?: boolean };
      if (call.caller !== "human" || !meta.browser || meta.sandbox !== true) {
        throw new HttpException(
          { reason: "NOT_SANDBOX", message: "A live call's outcome arrives from the provider, never the client." },
          409,
        );
      }
      if (call.placedById && call.placedById !== req.auth?.user.id) {
        throw new HttpException({ reason: "NOT_PLACER", message: "Only the caller can finish their test call." }, 403);
      }
      if (call.outcome) return call;
      const updated = await tx.call.update({
        where: { id },
        data: {
          status: outcome === "completed" ? "COMPLETED" : "FAILED",
          outcome,
          durationSec,
          endedAt: new Date(),
        },
      });
      await this.publishOutcome(call.workspaceId, call.campaignId, call.contactId, call.id, outcome, durationSec);
      return updated;
    });
  }

  /** Stream a stored recording (Twilio-side audio; the row's meta carries
   *  the pointer). 404 = no recording — sandbox rows and recording-off
   *  calls have none, honestly. */
  @Get("calls/:id/recording")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async recording(@Param("id") id: string, @Res() res: Response) {
    const call = await this.tenant.run((tx) => tx.call.findUnique({ where: { id } }));
    if (!call) throw new NotFoundException(`Call ${id} not found`);
    const rec = ((call.meta ?? {}) as { recording?: { url?: string } }).recording;
    if (!rec?.url) throw new NotFoundException("No recording on this call");
    const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
    if (!accountSid || !authToken) throw new NotFoundException("Recording storage is not reachable");
    const upstream = await fetch(`${rec.url}.mp3`, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
    });
    if (!upstream.ok) throw new NotFoundException("Recording not available");
    const audio = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audio.length));
    res.send(audio);
  }

  // ── Twilio webhooks (signed; the TwiML App's Voice URL + <Dial> callbacks) ──

  private assertTwilioSignature(req: Request, form: Record<string, unknown>, signature?: string): void {
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
  }

  /** The TwiML App Voice URL: the browser leg answered — bridge it. */
  @Public()
  @Post("webhooks/twilio-browser-bridge")
  @UseInterceptors(AnyFilesInterceptor())
  @Header("Content-Type", "text/xml")
  async bridge(
    @Req() req: Request,
    @Body() form: Record<string, unknown>,
    @Headers("x-twilio-signature") signature?: string,
  ): Promise<string> {
    this.assertTwilioSignature(req, form, signature);
    // B4.5 (DEC-128): a JOIN leg — the operator's browser dialing into an
    // in-progress call's conference room after jump-in marked the row. The
    // room name derives from OUR call id; the marker is the admission check.
    const joinCallId = typeof form?.joinCallId === "string" ? form.joinCallId : "";
    if (joinCallId) {
      const joined = await this.prisma.admin.call.findUnique({ where: { id: joinCallId } });
      const joinedMeta = (joined?.meta ?? {}) as { takenOver?: unknown };
      if (!joined || joined.status !== "IN_PROGRESS" || !joinedMeta.takenOver) {
        return "<Response><Reject/></Response>";
      }
      return conferenceJoinTwiml(conferenceRoomForCall(joined.id));
    }
    const callId = typeof form?.callId === "string" ? form.callId : "";
    const parentSid = typeof form?.CallSid === "string" ? form.CallSid : "";
    if (!callId || !parentSid) return "<Response><Reject/></Response>";

    const call = await this.prisma.admin.call.findUnique({ where: { id: callId } });
    if (!call || call.caller !== "human" || call.providerCallSid || call.status !== "QUEUED") {
      return "<Response><Reject/></Response>";
    }
    const [contact, workspace] = await withTenant(this.prisma.app, { workspaceId: call.workspaceId }, (tx) =>
      Promise.all([
        tx.contact.findUnique({ where: { id: call.contactId } }),
        tx.workspace.findUnique({ where: { id: call.workspaceId } }),
      ]),
    );
    if (!contact?.phone) return "<Response><Reject/></Response>";
    await withTenant(this.prisma.app, { workspaceId: call.workspaceId }, (tx) =>
      tx.call.update({
        where: { id: call.id },
        data: { providerCallSid: parentSid, status: "IN_PROGRESS", startedAt: new Date() },
      }),
    );

    const fromNumber = process.env.VOICE_FROM_NUMBER ?? "";
    const api = this.apiPublicUrl();
    const recordingEnabled = parseWorkspaceVoiceDefaults(workspace?.settings).recordingEnabled ?? false;
    const recordAttrs = recordingEnabled
      ? ` record="record-from-answer-dual" recordingStatusCallback="${twimlEscape(`${api}/webhooks/twilio-voice-recording`)}" recordingStatusCallbackMethod="POST"`
      : "";
    // The whisper <Say> plays to the CALLEE before the bridge — the spoken
    // recording sentence, only when recording is actually on (a disclosure
    // over no capture would lie; DEC-118(3)).
    const whisper = recordingEnabled
      ? ` url="${twimlEscape(`${api}/webhooks/twilio-browser-whisper?callId=${call.id}`)}" method="POST"`
      : "";
    const action = twimlEscape(`${api}/webhooks/twilio-browser-dial-result?callId=${call.id}`);
    return (
      `<Response><Dial callerId="${twimlEscape(fromNumber)}" answerOnBridge="true" action="${action}" method="POST"${recordAttrs}>` +
      `<Number${whisper}>${twimlEscape(contact.phone)}</Number>` +
      `</Dial></Response>`
    );
  }

  /** Callee-leg whisper: the spoken recording sentence (locked constant,
   *  spoken first — never composed). Only reachable when recording is on. */
  @Public()
  @Post("webhooks/twilio-browser-whisper")
  @UseInterceptors(AnyFilesInterceptor())
  @Header("Content-Type", "text/xml")
  async whisper(
    @Req() req: Request,
    @Body() form: Record<string, unknown>,
    @Headers("x-twilio-signature") signature?: string,
  ): Promise<string> {
    this.assertTwilioSignature(req, form, signature);
    const { COMPLIANCE_STRINGS, DEFAULT_LANGUAGE } = await import("@clientforce/core");
    // The dial rail limits voice to English contacts (VOICE_LANGUAGE_UNSUPPORTED)
    // — the default-language constant is the factual sentence.
    const line = COMPLIANCE_STRINGS[DEFAULT_LANGUAGE].voiceRecordingNotice;
    return `<Response><Say>${twimlEscape(line)}</Say></Response>`;
  }

  /** <Dial action>: the bridged leg ended — the row takes its outcome. */
  @Public()
  @Post("webhooks/twilio-browser-dial-result")
  @UseInterceptors(AnyFilesInterceptor())
  @Header("Content-Type", "text/xml")
  async dialResult(
    @Req() req: Request,
    @Query("callId") callId: string,
    @Body() form: Record<string, unknown>,
    @Headers("x-twilio-signature") signature?: string,
  ): Promise<string> {
    this.assertTwilioSignature(req, form, signature);
    const dialStatus = typeof form?.DialCallStatus === "string" ? form.DialCallStatus : "";
    const outcome = outcomeFromTwilioStatus(dialStatus);
    if (!callId || !outcome) return "<Response><Hangup/></Response>";
    const call = await this.prisma.admin.call.findUnique({ where: { id: callId } });
    if (!call || call.outcome) return "<Response><Hangup/></Response>";
    const durationSec = Number(form?.DialCallDuration ?? "") || 0;
    await withTenant(this.prisma.app, { workspaceId: call.workspaceId }, (tx) =>
      tx.call.update({
        where: { id: call.id },
        data: {
          status: outcome === "completed" ? "COMPLETED" : "FAILED",
          outcome,
          durationSec,
          endedAt: new Date(),
        },
      }),
    );
    await this.publishOutcome(call.workspaceId, call.campaignId, call.contactId, call.id, outcome, durationSec);
    return "<Response><Hangup/></Response>";
  }

  /** RecordingStatusCallback (Ada REST dials + human <Dial record>): the
   *  stored recording's pointer lands on the Call row's meta. */
  @Public()
  @Post("webhooks/twilio-voice-recording")
  @UseInterceptors(AnyFilesInterceptor())
  @Header("Content-Type", "text/xml")
  async recordingStatus(
    @Req() req: Request,
    @Body() form: Record<string, unknown>,
    @Headers("x-twilio-signature") signature?: string,
  ): Promise<string> {
    this.assertTwilioSignature(req, form, signature);
    const callSid = typeof form?.CallSid === "string" ? form.CallSid : "";
    const recordingSid = typeof form?.RecordingSid === "string" ? form.RecordingSid : "";
    const recordingUrl = typeof form?.RecordingUrl === "string" ? form.RecordingUrl : "";
    const status = typeof form?.RecordingStatus === "string" ? form.RecordingStatus : "completed";
    if (!callSid || !recordingSid || !recordingUrl || status !== "completed") return "<Response/>";
    const call = await this.prisma.admin.call.findUnique({ where: { providerCallSid: callSid } });
    if (!call) return "<Response/>";
    const durationSec = Number(form?.RecordingDuration ?? "") || null;
    await withTenant(this.prisma.app, { workspaceId: call.workspaceId }, (tx) =>
      tx.call.update({
        where: { id: call.id },
        data: {
          meta: {
            ...((call.meta ?? {}) as object),
            recording: { sid: recordingSid, url: recordingUrl, ...(durationSec !== null ? { durationSec } : {}) },
          },
        },
      }),
    );
    return "<Response/>";
  }

  private async publishOutcome(
    workspaceId: string,
    campaignId: string,
    contactId: string,
    callId: string,
    outcome: string,
    durationSec: number,
  ): Promise<void> {
    if (outcome === "completed") {
      await this.publisher.publish({
        type: EVENT_TYPES.CALL_COMPLETED,
        workspaceId,
        campaignId,
        contactId,
        payload: { callId, durationSec, outcome, caller: "human" },
      });
    } else {
      await this.publisher.publish({
        type: EVENT_TYPES.CALL_FAILED,
        workspaceId,
        campaignId,
        contactId,
        payload: { callId, reason: outcome, caller: "human" },
      });
    }
  }
}
