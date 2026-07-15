import { Module } from "@nestjs/common";
import { BackofficeAuthGuard } from "./backoffice-auth.guard";
import { BackofficeController, BackofficeSessionController } from "./backoffice.controller";
import { BackofficeDb } from "./backoffice-db.service";
import { BackofficeService } from "./backoffice.service";
import { SenderHealthClient } from "./sender-health";

/**
 * The platform backoffice (B1 W1, DEC-079). Self-contained: it owns the
 * RLS-exempt DB client and the staff-auth guard, and imports NO tenant modules
 * (no DbModule / TenantClient), so the tenant data path stays untouched.
 * B1 W4 (DEC-082): + `SenderHealthClient`, the CONSUME-only interlock to P5-W1's
 * health-score endpoint (never a second health computation).
 */
@Module({
  controllers: [BackofficeSessionController, BackofficeController],
  providers: [BackofficeDb, BackofficeService, BackofficeAuthGuard, SenderHealthClient],
})
export class BackofficeModule {}
