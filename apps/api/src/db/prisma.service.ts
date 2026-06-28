import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";

/**
 * Holds the two Prisma clients (DATA_MODEL.md §1):
 *   - `admin`: owner connection, bypasses RLS — used only for the auth bootstrap
 *     (resolving user → memberships before any workspace context exists).
 *   - `app`: non-superuser connection, subject to RLS — used for all tenant data
 *     access via the tenant-scoped client.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly admin: PrismaClient = createPrismaClient();
  readonly app: PrismaClient = createAppPrismaClient();

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.admin.$disconnect(), this.app.$disconnect()]);
  }
}
