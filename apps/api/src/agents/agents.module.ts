import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AgentsController } from "./agents.controller";

@Module({
  imports: [DbModule],
  controllers: [AgentsController],
})
export class AgentsModule {}
