import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { BusOrInlinePublisher, EVENTS_PUBLISHER } from "../events/publisher";
import { EnrollmentsController } from "./enrollments.controller";
import { PipelineStagesController } from "./pipeline-stages.controller";
import { TemporalWorkflowEngine, WORKFLOW_ENGINE } from "./workflow-engine";

@Module({
  imports: [DbModule],
  controllers: [EnrollmentsController, PipelineStagesController],
  providers: [
    { provide: WORKFLOW_ENGINE, useClass: TemporalWorkflowEngine },
    // P5 W3 (DEC-085): manual stage moves publish on the bus, so the rules
    // that listen to lead.stage_changed.v1 fire for human moves too.
    { provide: EVENTS_PUBLISHER, useClass: BusOrInlinePublisher },
  ],
})
export class EnrollmentsModule {}
