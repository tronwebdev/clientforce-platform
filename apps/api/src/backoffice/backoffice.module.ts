import { Module } from "@nestjs/common";
import { BackofficeAuthGuard } from "./backoffice-auth.guard";
import { BackofficeController, BackofficeSessionController } from "./backoffice.controller";
import { BackofficeDb } from "./backoffice-db.service";
import { BackofficeService } from "./backoffice.service";

/**
 * The platform backoffice (B1 W1, DEC-079). Self-contained: it owns the
 * RLS-exempt DB client and the staff-auth guard, and imports NO tenant modules
 * (no DbModule / TenantClient), so the tenant data path stays untouched.
 */
@Module({
  controllers: [BackofficeSessionController, BackofficeController],
  providers: [BackofficeDb, BackofficeService, BackofficeAuthGuard],
})
export class BackofficeModule {}
