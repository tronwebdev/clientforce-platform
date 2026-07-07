import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { channelsProviders } from "./channels.providers";
import { SendersController } from "./senders.controller";
import { SuppressionsController } from "./suppressions.controller";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [DbModule],
  controllers: [SendersController, SuppressionsController, WebhooksController],
  providers: channelsProviders,
})
export class ChannelsModule {}
