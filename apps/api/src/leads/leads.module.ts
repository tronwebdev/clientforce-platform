import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { LeadsController } from "./leads.controller";
import { leadsProviders } from "./leads.providers";

/** B6 (DEC-131): the Lead finder + BuyerPing intent tier's server half. */
@Module({
  imports: [DbModule],
  controllers: [LeadsController],
  providers: [{ provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher }, ...leadsProviders],
})
export class LeadsModule {}
