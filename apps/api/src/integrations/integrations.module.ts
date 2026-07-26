import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { CalendlyWebhookController } from "./calendly-webhook.controller";
import { StripeWebhookController } from "./stripe-webhook.controller";
import { IntegrationsController } from "./integrations.controller";
import { integrationsDepsProvider } from "./integrations.providers";

/** Integrations platform core + surface API (INT W1, DEC-093; W2 DEC-094
 *  adds the Calendly booking webhook + the gcal/calendly adapters). */
@Module({
  imports: [DbModule],
  controllers: [IntegrationsController, CalendlyWebhookController, StripeWebhookController],
  providers: [{ provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher }, integrationsDepsProvider],
})
export class IntegrationsModule {}
