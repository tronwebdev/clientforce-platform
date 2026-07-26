import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { WidgetController } from "./widget.controller";
import { widgetProviders } from "./widget.providers";
import { WidgetService } from "./widget.service";

/** The embeddable Agent Widget's server half (WID2, DEC-101). */
@Module({
  imports: [DbModule],
  controllers: [WidgetController],
  providers: [
    WidgetService,
    { provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher },
    ...widgetProviders,
  ],
})
export class WidgetModule {}
