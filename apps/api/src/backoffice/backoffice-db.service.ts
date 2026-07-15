import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createBackofficePrismaClient, type PrismaClient } from "@clientforce/db";

/**
 * Holds the RLS-EXEMPT backoffice Prisma client (the `clientforce_backoffice`
 * role, BYPASSRLS). This is the ONLY place that client is instantiated, and it
 * is provided ONLY inside `BackofficeModule` — no tenant/feature module imports
 * it. Tenant data everywhere else still flows through the RLS-subject
 * `TenantClient` (regression pinned in tests).
 */
@Injectable()
export class BackofficeDb implements OnModuleDestroy {
  readonly client: PrismaClient = createBackofficePrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
