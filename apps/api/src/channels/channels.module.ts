import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { channelsProviders } from "./channels.providers";
import { DeliverabilityController } from "./deliverability.controller";
import { SendersController } from "./senders.controller";
import { SuppressionsController } from "./suppressions.controller";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [DbModule],
  controllers: [
    SendersController,
    SuppressionsController,
    WebhooksController,
    // D1 (DEC-173): the workspace deliverability rule behind the 2% toggle.
    DeliverabilityController,
  ],
  providers: channelsProviders,
})
export class ChannelsModule {}
