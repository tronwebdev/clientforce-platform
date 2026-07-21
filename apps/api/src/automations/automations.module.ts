import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { AutomationsController } from "./automations.controller";

/** Account-scope automation rules (R1-UI, DEC-091). */
@Module({
  imports: [DbModule],
  controllers: [AutomationsController],
  providers: [{ provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher }],
})
export class AutomationsModule {}
