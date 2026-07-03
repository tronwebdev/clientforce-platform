import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { ContextController } from "./context.controller";
import { contextProviders } from "./context.providers";

@Module({
  imports: [DbModule],
  controllers: [ContextController],
  providers: contextProviders,
})
export class ContextModule {}
