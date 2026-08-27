import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { channelsProviders } from "../channels/channels.providers";
import { plannerProviders } from "../planner/planner.providers";
import { AgentViewController } from "./agent-view.controller";
import { AgentsController } from "./agents.controller";
import { BoldActivityController } from "./bold-activity.controller";
import { InboxActionsController } from "./inbox-actions.controller";
import { MessagesController } from "./messages.controller";
import { OutcomesController } from "./outcomes.controller";
import { WorkspaceInboxController } from "./workspace-inbox.controller";

@Module({
  imports: [DbModule],
  controllers: [
    AgentsController,
    AgentViewController,
    MessagesController,
    OutcomesController,
    // B1 (DEC-104): Bold activity read + the sent-to-N recipients drill.
    BoldActivityController,
    // B3a (DEC-112): the workspace-wide inbox read (same thread builder).
    WorkspaceInboxController,
    // B3b (DEC-116/117): reply-send · Ada drafts · resume · assign/snooze.
    InboxActionsController,
  ],
  // B3b: the reply spine needs the channel transports + the composer gateway
  // (the same factories the channels/planner modules register — module-scoped
  // singletons, so re-providing here is the Nest-idiomatic wiring).
  providers: [...channelsProviders, ...plannerProviders],
})
export class AgentsModule {}
