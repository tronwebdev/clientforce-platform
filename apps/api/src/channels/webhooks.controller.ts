import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import {
  applyEmailEvent,
  normalizeSendGridEvents,
  resolveEventWorkspace,
  verifySendGridSignature,
} from "@clientforce/channels";
import { Public } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";

/**
 * SendGrid event webhook (P1.5). Public route — authenticity comes from the
 * ECDSA signature (public key via Key Vault secret SENDGRID-WEBHOOK-PUBLIC-KEY
 * once event webhooks are enabled). With no key configured: accepted in dev,
 * REJECTED in production — unauthenticated suppression writes are not a thing.
 * P1.7 forwards the normalized events to the event bus.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly prisma: PrismaService) {}

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
    for (const event of events) {
      // Events carry no tenant — resolve through the persisted Message row
      // (owner-client unique lookup), then apply tenant-scoped.
      const workspaceId = await resolveEventWorkspace(this.prisma.admin, event);
      if (!workspaceId) continue;
      const { suppressed } = await applyEmailEvent(this.prisma.app, workspaceId, event);
      if (suppressed) applied++;
    }
    return { received: events.length, suppressionsApplied: applied };
  }
}
