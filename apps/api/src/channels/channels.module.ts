import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { channelsProviders } from "./channels.providers";
import { SendersController } from "./senders.controller";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [DbModule],
  controllers: [SendersController, WebhooksController],
  providers: channelsProviders,
})
export class ChannelsModule {}
