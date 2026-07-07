import { Module } from "@nestjs/common";
import { SystemHealthController } from "./health.controller";

/** Environment/worker readiness surface (GET /system/health) for the wizard banner. */
@Module({
  controllers: [SystemHealthController],
})
export class SystemModule {}
