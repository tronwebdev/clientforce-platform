import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { PlannerController } from "./planner.controller";
import { plannerProviders } from "./planner.providers";

@Module({
  imports: [DbModule],
  controllers: [PlannerController],
  providers: plannerProviders,
})
export class PlannerModule {}
