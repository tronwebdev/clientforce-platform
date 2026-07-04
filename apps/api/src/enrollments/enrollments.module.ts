import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { EnrollmentsController } from "./enrollments.controller";
import { TemporalWorkflowEngine, WORKFLOW_ENGINE } from "./workflow-engine";

@Module({
  imports: [DbModule],
  controllers: [EnrollmentsController],
  providers: [{ provide: WORKFLOW_ENGINE, useClass: TemporalWorkflowEngine }],
})
export class EnrollmentsModule {}
