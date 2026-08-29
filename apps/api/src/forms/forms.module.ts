import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { FormsController } from "./forms.controller";
import { FormsPublicController } from "./forms-public.controller";

/** B5 (DEC-130): the form spine — tenant CRUD + the public hosted-page rail. */
@Module({
  imports: [DbModule],
  controllers: [FormsController, FormsPublicController],
  providers: [{ provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher }],
})
export class FormsModule {}
