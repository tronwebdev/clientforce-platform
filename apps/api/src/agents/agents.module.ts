import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AgentViewController } from "./agent-view.controller";
import { AgentsController } from "./agents.controller";
import { BoldActivityController } from "./bold-activity.controller";
import { MessagesController } from "./messages.controller";
import { OutcomesController } from "./outcomes.controller";

@Module({
  imports: [DbModule],
  controllers: [
    AgentsController,
    AgentViewController,
    MessagesController,
    OutcomesController,
    // B1 (DEC-104): Bold activity read + the sent-to-N recipients drill.
    BoldActivityController,
  ],
})
export class AgentsModule {}
