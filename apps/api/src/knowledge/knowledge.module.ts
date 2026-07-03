import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { KnowledgeController } from "./knowledge.controller";
import { knowledgeProviders } from "./knowledge.providers";

@Module({
  imports: [DbModule],
  controllers: [KnowledgeController],
  providers: knowledgeProviders,
})
export class KnowledgeModule {}
