/**
 * Stripe webhook (INT W3, DEC-095) — the CalendlyWebhookController's
 * conventions, verbatim:
 *
 *  - @Public() route; authenticity is TWO-layered: the per-workspace
 *    capability-URL `?token=` (minted at connect — ALWAYS present, unmatched
 *    = 401) + `Stripe-Signature` HMAC over the RAW body with the
 *    field-encrypted endpoint signing secret Stripe minted at create. No
 *    secret on the row → dev accepts, production REJECTS (the SendGrid gate).
 *  - Stripe's header is the SAME `t=…,v1=…` scheme Calendly uses — the one
 *    parser + constant-time comparator are shared.
 *  - Always 200-with-ack semantics for matched-but-boring outcomes
 *    (duplicates, unmatched payers, event types we don't ingest) — Stripe
 *    must never retry-storm over honest no-ops.
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
  ingestPayment,
  parseCalendlySignatureHeader,
  verifyCalendlySignature,
  type PaymentDeps,
} from "@clientforce/integrations";
import { Public } from "../auth/decorators";
import { PrismaService } from "../db/prisma.service";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";

interface StripeEventPayload {
  type?: string;
  data?: { object?: Record<string, unknown> };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

@Controller("webhooks")
export class StripeWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  private paymentDeps(): PaymentDeps {
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
  @Post("stripe")
  async stripe(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: StripeEventPayload,
    @Query("token") token?: string,
    @Headers("stripe-signature") signatureHeader?: string,
  ) {
    // 1 · token → workspace (owner client — the payload carries no tenant).
    if (!token) throw new UnauthorizedException("Missing webhook token");
    const row = await this.prisma.admin.integration.findFirst({
      where: { provider: "stripe", config: { path: ["webhookToken"], equals: token } },
    });
    if (!row) throw new UnauthorizedException("Invalid webhook token");

    // 2 · raw-body signature (Stripe's t=…,v1=… — the shared comparator).
    const creds = decryptCredentials(row);
    const secret = typeof creds.webhookSigningSecret === "string" ? creds.webhookSigningSecret : undefined;
    if (secret) {
      const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(body);
      const sig = parseCalendlySignatureHeader(signatureHeader);
      if (!sig || !verifyCalendlySignature(sig.t, sig.v1, rawBody, secret)) {
        throw new UnauthorizedException("Invalid webhook signature");
      }
    } else if (process.env.NODE_ENV === "production") {
      throw new UnauthorizedException("Webhook signing secret not configured");
    }

    const type = str(body?.type);
    if (!type) throw new BadRequestException("Malformed Stripe event payload");

    // Only checkout completion ingests this wave — everything else acks
    // honestly (never a retry storm over event types we don't handle).
    if (type !== "checkout.session.completed") {
      return { ok: true, outcome: "ignored", type };
    }
    const session = body?.data?.object ?? {};
    const externalId = str(session.id);
    const amountRaw = (session as { amount_total?: unknown }).amount_total;
    const amount = typeof amountRaw === "number" && Number.isFinite(amountRaw) ? Math.trunc(amountRaw) : undefined;
    if (!externalId || amount === undefined) {
      throw new BadRequestException("Malformed checkout session payload");
    }
    const customer = (session.customer_details ?? {}) as Record<string, unknown>;
    const result = await ingestPayment(this.paymentDeps(), {
      workspaceId: row.workspaceId,
      integrationId: row.id,
      externalId,
      amount,
      ...(str(session.currency) ? { currency: str(session.currency)! } : {}),
      ...(str(session.client_reference_id) ? { clientReferenceId: str(session.client_reference_id)! } : {}),
      ...(str(customer.email) ? { payerEmail: str(customer.email)! } : {}),
    });
    return { ok: true, outcome: result.outcome, matchedBy: result.matchedBy };
  }
}
