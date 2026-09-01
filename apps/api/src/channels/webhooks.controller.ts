import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  Inject,
  Optional,
  Post,
  Query,
  UnauthorizedException,
  UseInterceptors,
  type RawBodyRequest,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Queue } from "bullmq";
import {
  applyEmailEvent,
  applySmsStop,
  applyWarmupHealthInterlock,
  ingestInboundEmail,
  ingestInboundSms,
  isStopMessage,
  MalformedInboundError,
  messageSenderId,
  normalizeInboundParse,
  normalizeSendGridEvents,
  normalizeTwilioInbound,
  recomputeSenderHealth,
  resolveEventMessage,
  resolveSmsStopFallback,
  toBusEvents,
  validateTwilioSignature,
  verifySendGridSignature,
  type ClassifyJobData,
} from "@clientforce/channels";
import { EVENT_TYPES } from "@clientforce/events";
import { Req } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";

export const CLASSIFY_QUEUE = Symbol("CLASSIFY_QUEUE");

/**
 * SendGrid webhooks (P1.5 events + P1.7 inbound parse). Both are public
 * routes with their own authenticity model:
 *  - Event webhook: ECDSA signature (`SENDGRID-WEBHOOK-PUBLIC-KEY`); with no
 *    key configured, accepted in dev, REJECTED in production.
 *  - Inbound Parse: payloads are UNSIGNED — authenticity is a shared-secret
 *    URL token (`INBOUND-PARSE-TOKEN`, baked into the SendGrid destination
 *    URL); with no token configured, accepted in dev, REJECTED in production.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
    @Optional()
    @Inject(CLASSIFY_QUEUE)
    private readonly classifyQueue: Queue<ClassifyJobData> | null,
  ) {}

  @Public()
  @Post("sendgrid")
  async sendgrid(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers("x-twilio-email-event-webhook-signature") signature?: string,
    @Headers("x-twilio-email-event-webhook-timestamp") timestamp?: string,
  ) {
    const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    if (publicKey) {
      // D1 (DEC-170): SendGrid signs the RAW request bytes. Verifying against
      // `JSON.stringify(parsedBody)` re-serializes them — different spacing,
      // different unicode escaping — and fails a perfectly valid signature, so
      // every signed event would have been rejected even WITH the key present.
      // `rawBody: true` is already on in main.ts; this is the same read the
      // Calendly and Stripe routes do, with the same dev-only fallback.
      const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(body);
      const ok =
        signature && timestamp && verifySendGridSignature(publicKey, rawBody, signature, timestamp);
      if (!ok) throw new UnauthorizedException("Invalid webhook signature");
    } else if (process.env.NODE_ENV === "production") {
      throw new UnauthorizedException("Webhook verification key not configured");
    }

    let events;
    try {
      events = normalizeSendGridEvents(body);
    } catch {
      throw new BadRequestException("Malformed SendGrid event payload");
    }

    let applied = 0;
    let published = 0;
    let duplicates = 0;
    // D1: events whose Message cannot be resolved were dropped SILENTLY. A
    // bounce we cannot correlate is still a bounce that suppressed nothing, so
    // it is counted and returned — an unexplained number here is the signal
    // that correlation is broken, which is exactly the failure that would
    // otherwise look like "clean delivery".
    let unresolved = 0;
    // P5 W1 (DEC-083): bounce/spam touch sender reputation — collect the
    // distinct senders and recompute their health AFTER the events land, so a
    // collapsing sender auto-pauses within one webhook delivery, not one sweep.
    const healthTouched = new Map<string, string>();
    for (const event of events) {
      // D1 (DEC-174): SendGrid retries a batch until it is acked, and every
      // retry used to re-publish its events — inflating the very bounce and
      // complaint rates that now pause senders. The receipt makes a replay a
      // no-op. Events with no `sg_event_id` are processed as before: dedup is
      // best-effort and must never DROP an event it cannot identify.
      if (event.eventId && !(await this.claimEvent(event.eventId))) {
        duplicates++;
        continue;
      }
      // Events carry no tenant — resolve through the persisted Message row
      // (owner-client unique lookup), then apply tenant-scoped.
      const message = await resolveEventMessage(this.prisma.admin, event);
      if (!message) {
        unresolved++;
        continue;
      }
      const { suppressed, softBounce } = await applyEmailEvent(
        this.prisma.app,
        message.workspaceId,
        event,
      );
      if (suppressed) applied++;
      // P1.7 engagement awareness: every provider event becomes a typed Event
      // row on the lead (Logs feed, drawer timeline, classifier context).
      for (const busEvent of toBusEvents(event, message, softBounce?.strikes)) {
        await this.publisher.publish(busEvent);
        published++;
      }
      // D1 (DEC-171): a SOFT bounce is not a reputation event — it must not
      // trigger the collapse fast path, or a transient block would pause a
      // sender the health formula never scored down.
      const hardFailure = event.type === "bounce" && event.bounce?.kind !== "soft";
      if (hardFailure || event.type === "spam_report") {
        const senderId = messageSenderId(message);
        if (senderId) healthTouched.set(senderId, message.workspaceId);
      }
    }
    for (const [senderId, workspaceId] of healthTouched) {
      try {
        await recomputeSenderHealth(
          { prisma: this.prisma.app, publish: (input) => this.publisher.publish(input) },
          { workspaceId, senderId },
        );
        // Owner-locked interlock: a spike holds a mid-warmup ramp immediately.
        await applyWarmupHealthInterlock({ prisma: this.prisma.app }, { workspaceId, senderId });
      } catch (err) {
        // The webhook must ack regardless — the 10-minute sweep is the floor.
        console.error(`[webhooks] sender-health fast path failed for sender=${senderId}`, err);
      }
    }
    return {
      received: events.length,
      suppressionsApplied: applied,
      eventsPublished: published,
      duplicatesSkipped: duplicates,
      unresolved,
    };
  }

  /**
   * D1 (DEC-174): claim one provider event id. True = ours to process, false =
   * already seen. The unique index is the arbiter, so two concurrent retries
   * of the same batch cannot both win. The receipt is cross-tenant by nature
   * (a provider event carries no tenant and is resolved through `Message`
   * afterwards), so it is written on the admin client and carries no RLS
   * policy — the `KillSwitch` precedent.
   *
   * A failure to record NEVER blocks the event: losing an event is worse than
   * counting one twice, and the health window is 7 days of self-correcting
   * aggregate either way.
   */
  private async claimEvent(eventId: string): Promise<boolean> {
    try {
      await this.prisma.admin.providerEventReceipt.create({
        data: { provider: "sendgrid", eventId },
      });
      return true;
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "P2002"
      ) {
        return false;
      }
      console.error(`[webhooks] receipt write failed for event=${eventId}`, err);
      return true;
    }
  }

  @Public()
  @Post("sendgrid-inbound")
  @UseInterceptors(AnyFilesInterceptor())
  async sendgridInbound(@Body() form: Record<string, unknown>, @Query("token") token?: string) {
    const expected = process.env.INBOUND_PARSE_TOKEN;
    if (expected) {
      if (token !== expected) throw new UnauthorizedException("Invalid inbound token");
    } else if (process.env.NODE_ENV === "production") {
      throw new UnauthorizedException("Inbound token not configured");
    }

    let inbound;
    try {
      inbound = normalizeInboundParse(form ?? {});
    } catch (err) {
      if (err instanceof MalformedInboundError) throw new BadRequestException(err.message);
      throw err;
    }

    const result = await ingestInboundEmail(
      { owner: this.prisma.admin, app: this.prisma.app },
      inbound,
    );
    if (!result) {
      // Not our thread — acknowledge without detail (nothing probe-able).
      return { received: true, matched: false };
    }

    if (this.classifyQueue) {
      await this.classifyQueue.add(
        "classify",
        { workspaceId: result.resolution.workspaceId, messageId: result.message.id },
        { attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
      );
    }
    return { received: true, matched: true, messageId: result.message.id };
  }

  /**
   * P2.1 (DEC-061/062): Twilio inbound SMS. Authenticity = X-Twilio-Signature
   * (HMAC over the public URL + params with the auth token); with no token
   * configured, accepted in dev, REJECTED in production — the SendGrid model.
   * STOP-family bodies run the second opt-out rail (Suppression + optOut.sms +
   * enrollments UNSUBSCRIBED + lead.unsubscribed.v1 + sms.opted_out.v1);
   * everything else rides the SAME P1.7 classify queue as email.
   */
  @Public()
  @Post("twilio-inbound")
  @UseInterceptors(AnyFilesInterceptor())
  // 60-round: Twilio requires a TwiML (xml) response — answering json raised
  // error 12300 on every inbound. We never instruct a reply, so the body is
  // always the empty <Response/>.
  @Header("Content-Type", "text/xml")
  async twilioInbound(
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

    const inbound = normalizeTwilioInbound(form ?? {});
    if (!inbound.from || !inbound.body)
      throw new BadRequestException("Malformed Twilio inbound payload");
    const result = await ingestInboundSms(
      { owner: this.prisma.admin, app: this.prisma.app },
      inbound,
    );
    if (!result) {
      // DEC-064: consent fails safe — a STOP whose thread can't resolve (no
      // prior outbound sms Message) still suppresses in every workspace that
      // holds a contact with this phone. `sms.opted_out.v1` needs a messageId
      // (none exists on this path), so only `lead.unsubscribed.v1` is emitted.
      if (isStopMessage(inbound.body)) {
        const targets = await resolveSmsStopFallback(this.prisma.admin, inbound.from);
        for (const t of targets) {
          await applySmsStop(this.prisma.app, t.workspaceId, t.contactId, inbound.from, null);
          await this.publisher.publish({
            type: "lead.unsubscribed.v1",
            workspaceId: t.workspaceId,
            contactId: t.contactId,
            payload: { channel: "sms" },
          });
        }
      }
      return "<Response/>";
    }

    const { message, resolution, stop } = result;
    if (stop) {
      await applySmsStop(
        this.prisma.app,
        resolution.workspaceId,
        resolution.contactId,
        inbound.from,
        resolution.enrollmentId,
      );
      await this.publisher.publish({
        type: EVENT_TYPES.SMS_OPTED_OUT,
        workspaceId: resolution.workspaceId,
        contactId: resolution.contactId,
        enrollmentId: resolution.enrollmentId ?? undefined,
        campaignId: resolution.campaignId,
        payload: { messageId: message.id, reason: "STOP reply" },
      });
      await this.publisher.publish({
        type: "lead.unsubscribed.v1",
        workspaceId: resolution.workspaceId,
        contactId: resolution.contactId,
        enrollmentId: resolution.enrollmentId ?? undefined,
        campaignId: resolution.campaignId,
        payload: { channel: "sms" },
      });
      return "<Response/>";
    }

    if (this.classifyQueue) {
      await this.classifyQueue.add(
        "classify",
        { workspaceId: resolution.workspaceId, messageId: message.id },
        { attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
      );
    }
    return "<Response/>";
  }
}
