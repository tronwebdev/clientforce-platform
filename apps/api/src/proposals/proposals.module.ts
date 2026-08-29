import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { ProposalsController } from "./proposals.controller";

/** B5 (DEC-130): draft proposal documents — the delivery half is Q-100. */
@Module({
  imports: [DbModule],
  controllers: [ProposalsController],
})
export class ProposalsModule {}
