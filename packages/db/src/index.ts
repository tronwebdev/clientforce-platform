/**
 * @clientforce/db — Prisma client + tenant-scoped access (DATA_MODEL.md §1).
 *
 * Two client flavours:
 *   - `createPrismaClient()` — privileged owner connection (DATABASE_URL) for
 *     migrations, seeding, and admin/agency-aggregate reads. Bypasses RLS.
 *   - `createAppPrismaClient()` — runtime connection as the non-superuser
 *     `clientforce_app` role (APP_DATABASE_URL). Subject to RLS.
 *
 * `withTenant()` wraps work in a transaction that sets the `app.workspace_id`
 * (and optional `app.agency_id`) GUCs so the tenant_isolation policies apply to
 * every query inside.
 */
import { Prisma, PrismaClient } from "@prisma/client";

// Re-export the generated client surface (models, enums, `Prisma`, `PrismaClient`).
export * from "@prisma/client";

export interface TenantContext {
  workspaceId: string;
  /** Set for agency-aggregate reads (T3); exposed to SQL as `app.agency_id`. */
  agencyId?: string;
}

export interface CreatePrismaClientOptions {
  /** Connection string. Falls back to the relevant env var when omitted. */
  url?: string;
  log?: Prisma.LogLevel[];
}

/** Privileged client (owner role). Use for migrations, seeds, admin reads. */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const url = options.url ?? process.env.DATABASE_URL;
  return new PrismaClient({
    ...(url ? { datasourceUrl: url } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
}

/**
 * Runtime client subject to RLS — connects as the `clientforce_app` role.
 * Prefers APP_DATABASE_URL, falling back to DATABASE_URL for local convenience.
 */
export function createAppPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const url = options.url ?? process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  return createPrismaClient({ ...options, url });
}

/**
 * Execute `fn` inside a tenant-scoped transaction. The RLS GUCs are set
 * transaction-locally (`set_config(..., true)`), so they cannot leak across
 * pooled connections. Returns whatever `fn` returns.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.workspace_id', ${ctx.workspaceId}, true)`;
    if (ctx.agencyId !== undefined) {
      await tx.$executeRaw`SELECT set_config('app.agency_id', ${ctx.agencyId}, true)`;
    }
    return fn(tx);
  });
}

export const DB_PACKAGE = "@clientforce/db";
