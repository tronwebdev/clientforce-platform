/** INT W5 (DEC-101) — the Zapier private app's REST rail. */
import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { ZapierAuthGuard } from "./zapier-auth.guard";
import { ZapierController } from "./zapier.controller";
import { ZapierWritesService } from "./zapier-writes.service";

@Module({
  imports: [DbModule],
  controllers: [ZapierController],
  providers: [ZapierAuthGuard, ZapierWritesService],
})
export class ZapierModule {}
