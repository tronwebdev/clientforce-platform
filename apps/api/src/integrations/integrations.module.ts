import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { IntegrationsController } from "./integrations.controller";
import { integrationsDepsProvider } from "./integrations.providers";

/** Integrations platform core + surface API (INT W1, DEC-093). */
@Module({
  imports: [DbModule],
  controllers: [IntegrationsController],
  providers: [{ provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher }, integrationsDepsProvider],
})
export class IntegrationsModule {}
