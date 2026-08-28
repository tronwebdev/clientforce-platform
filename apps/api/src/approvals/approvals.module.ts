import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { ApprovalsController } from "./approvals.controller";

/** B3d (DEC-122): the unified approvals queue — read + row decisions. */
@Module({
  imports: [DbModule],
  controllers: [ApprovalsController],
})
export class ApprovalsModule {}
