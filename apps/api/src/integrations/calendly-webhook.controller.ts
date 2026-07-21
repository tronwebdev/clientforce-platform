/**
 * Calendly webhook (INT W2, DEC-094) — the inbound-webhook conventions of
 * apps/api/src/channels/webhooks.controller.ts, applied:
 *
 *  - @Public() route; authenticity is TWO-layered: the per-workspace
 *    capability-URL `?token=` (the INBOUND-PARSE-TOKEN precedent, minted at
 *    connect time — ALWAYS present, so an unmatched token is always a 401)
 *    + the `Calendly-Webhook-Signature` HMAC over the RAW body with the
 *    field-encrypted per-workspace signing key. No signing key on the row →
 *    dev accepts, production REJECTS (the SendGrid gate).
 *  - Tenantless payloads resolve their workspace via the OWNER client
 *    (config.webhookToken lookup); all writes ride the tenant-scoped ingest.
 *  - Always 200-with-ack semantics for matched-but-boring outcomes
 *    (duplicates, unmatched invitees, unknown meetings) — Calendly must
 *    never retry-storm over honest no-ops.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Query,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import { Req } from "@nestjs/common";
import type { Request } from "express";
import {
  decryptCredentials,
  ingestBooking,
  ingestCancellation,
  parseCalendlySignatureHeader,
  verifyCalendlySignature,
  type BookingDeps,
} from "@clientforce/integrations";
import { Public } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";

interface CalendlyPayload {
  event?: string;
  payload?: Record<string, unknown>;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

@Controller("webhooks")
export class CalendlyWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  private bookingDeps(): BookingDeps {
    return {
      prisma: this.prisma.app,
      publish: async (input) =>
        this.publisher.publish({
          ...input,
          contactId: input.contactId ?? undefined,
          enrollmentId: input.enrollmentId ?? undefined,
          campaignId: input.campaignId ?? undefined,
          senderId: input.senderId ?? undefined,
        }),
    };
  }

  @Public()
  @Post("calendly")
  async calendly(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: CalendlyPayload,
    @Query("token") token?: string,
    @Headers("calendly-webhook-signature") signatureHeader?: string,
  ) {
    // 1 · token → workspace (owner client — the payload carries no tenant).
    if (!token) throw new UnauthorizedException("Missing webhook token");
    const row = await this.prisma.admin.integration.findFirst({
      where: { provider: "calendly", config: { path: ["webhookToken"], equals: token } },
    });
    if (!row) throw new UnauthorizedException("Invalid webhook token");

    // 2 · raw-body signature (constant-time HMAC over "<t>.<rawBody>").
    const creds = decryptCredentials(row);
    const signingKey = typeof creds.signingKey === "string" ? creds.signingKey : undefined;
    if (signingKey) {
      const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(body);
      const sig = parseCalendlySignatureHeader(signatureHeader);
      if (!sig || !verifyCalendlySignature(sig.t, sig.v1, rawBody, signingKey)) {
        throw new UnauthorizedException("Invalid webhook signature");
      }
    } else if (process.env.NODE_ENV === "production") {
      // The SendGrid gate: no key configured → accepted in dev, REJECTED in prod.
      throw new UnauthorizedException("Webhook signing key not configured");
    }

    const event = str(body?.event);
    const payload = body?.payload ?? {};
    if (!event) throw new BadRequestException("Malformed Calendly webhook payload");

    const deps = this.bookingDeps();
    const workspaceId = row.workspaceId;

    if (event === "invitee.created") {
      const scheduled = (payload.scheduled_event ?? {}) as Record<string, unknown>;
      const externalId = str(payload.uri);
      const startAtRaw = str(scheduled.start_time);
      if (!externalId || !startAtRaw) throw new BadRequestException("Malformed Calendly invitee payload");
      const tracking = (payload.tracking ?? {}) as Record<string, unknown>;
      const endAtRaw = str(scheduled.end_time);
      const result = await ingestBooking(deps, {
        workspaceId,
        provider: "calendly",
        externalId,
        // Reschedule chain: Calendly's created event names the PRIOR invitee.
        ...(payload.rescheduled === true && str(payload.old_invitee)
          ? { previousExternalId: str(payload.old_invitee)! }
          : {}),
        startAt: new Date(startAtRaw),
        ...(endAtRaw ? { endAt: new Date(endAtRaw) } : {}),
        ...(str(scheduled.name) ? { title: str(scheduled.name)! } : {}),
        ...(str(payload.timezone) ? { timezone: str(payload.timezone)! } : {}),
        ...(str(payload.email) ? { inviteeEmail: str(payload.email)! } : {}),
        ...(str(tracking.utm_content) ? { utmContent: str(tracking.utm_content)! } : {}),
        ...(str(payload.reschedule_url) ? { rescheduleUrl: str(payload.reschedule_url)! } : {}),
        ...(str(payload.cancel_url) ? { cancelUrl: str(payload.cancel_url)! } : {}),
      });
      return { received: true, outcome: result.outcome, matchedBy: result.matchedBy };
    }

    if (event === "invitee.canceled") {
      // A reschedule fires canceled(old) + created(new): the created twin
      // carries the transition — acknowledging the canceled half without a
      // status flip is what keeps a reschedule from reading as a loss.
      if (payload.rescheduled === true) return { received: true, outcome: "rescheduling" };
      const externalId = str(payload.uri);
      if (!externalId) throw new BadRequestException("Malformed Calendly invitee payload");
      const result = await ingestCancellation(deps, {
        workspaceId,
        provider: "calendly",
        externalId,
        reason: "canceled",
      });
      return { received: true, outcome: result.outcome };
    }

    if (event === "invitee_no_show.created") {
      // The no-show payload points at the invitee it marks.
      const externalId = str(payload.invitee);
      if (!externalId) throw new BadRequestException("Malformed Calendly no-show payload");
      const result = await ingestCancellation(deps, {
        workspaceId,
        provider: "calendly",
        externalId,
        reason: "no_show",
      });
      return { received: true, outcome: result.outcome };
    }

    // Unknown event kinds ack honestly — the subscription may widen upstream.
    return { received: true, outcome: "ignored" };
  }
}
