import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AgentViewController } from "./agent-view.controller";
import { AgentsController } from "./agents.controller";
import { MessagesController } from "./messages.controller";

@Module({
  imports: [DbModule],
  controllers: [AgentsController, AgentViewController, MessagesController],
})
export class AgentsModule {}
