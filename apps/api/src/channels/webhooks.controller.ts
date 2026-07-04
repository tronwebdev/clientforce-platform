import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Optional,
  Post,
  Query,
  UnauthorizedException,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Queue } from "bullmq";
import {
  applyEmailEvent,
  ingestInboundEmail,
  MalformedInboundError,
  normalizeInboundParse,
  normalizeSendGridEvents,
  resolveEventMessage,
  toBusEvents,
  verifySendGridSignature,
  type ClassifyJobData,
} from "@clientforce/channels";
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
    @Body() body: unknown,
    @Headers("x-twilio-email-event-webhook-signature") signature?: string,
    @Headers("x-twilio-email-event-webhook-timestamp") timestamp?: string,
  ) {
    const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    if (publicKey) {
      const ok =
        signature &&
        timestamp &&
        verifySendGridSignature(publicKey, JSON.stringify(body), signature, timestamp);
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
    for (const event of events) {
      // Events carry no tenant — resolve through the persisted Message row
      // (owner-client unique lookup), then apply tenant-scoped.
      const message = await resolveEventMessage(this.prisma.admin, event);
      if (!message) continue;
      const { suppressed } = await applyEmailEvent(this.prisma.app, message.workspaceId, event);
      if (suppressed) applied++;
      // P1.7 engagement awareness: every provider event becomes a typed Event
      // row on the lead (Logs feed, drawer timeline, classifier context).
      for (const busEvent of toBusEvents(event, message)) {
        await this.publisher.publish(busEvent);
        published++;
      }
    }
    return { received: events.length, suppressionsApplied: applied, eventsPublished: published };
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
}
