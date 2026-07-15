-- B1 W1 (DEC-079): platform backoffice — internal operator surface.
--
-- Additive only. Two platform-global tables (no workspaceId, no RLS policy),
-- plus the RLS-exempt `clientforce_backoffice` role that the backoffice service
-- uses for its deliberate, audited cross-tenant access.
--
-- NOTE: the auto-generated diff also wanted to `DROP INDEX
-- "KnowledgeChunk_embedding_hnsw_idx"` — that index lives on an
-- `Unsupported("vector(…)")` column created in raw SQL
-- (20260703170000_knowledge_vector_1536_hnsw), which Prisma cannot model, so it
-- re-proposes the drop on every `migrate dev`. It is stripped here to keep this
-- migration purely additive (no committed migration drops that index).

-- CreateEnum
CREATE TYPE "PlatformStaffRole" AS ENUM ('OPERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlatformStaffStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "PlatformStaff" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "PlatformStaffRole" NOT NULL DEFAULT 'OPERATOR',
    "status" "PlatformStaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackofficeAuditLog" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "operatorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackofficeAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformStaff_email_key" ON "PlatformStaff"("email");

-- CreateIndex
CREATE INDEX "BackofficeAuditLog_targetType_targetId_idx" ON "BackofficeAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "BackofficeAuditLog_operatorId_idx" ON "BackofficeAuditLog"("operatorId");

-- CreateIndex
CREATE INDEX "BackofficeAuditLog_createdAt_idx" ON "BackofficeAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "BackofficeAuditLog" ADD CONSTRAINT "BackofficeAuditLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "PlatformStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backoffice access rails.
--
-- (a) The RLS-EXEMPT operator role. `clientforce_backoffice` carries BYPASSRLS,
--     so it reads/writes across every tenant WITHOUT setting the app.workspace_id
--     GUC — deliberate, scoped, and used ONLY by the backoffice service. Created
--     without a password (trust in CI/dev; a Key Vault secret via ALTER ROLE in
--     production, provisioned out-of-band so no credential lives in the repo).
--     Granting BYPASSRLS needs a superuser migration owner — the same privileged
--     owner the `*_rls_policies` migration already assumes.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clientforce_backoffice') THEN
    CREATE ROLE clientforce_backoffice LOGIN BYPASSRLS;
  ELSE
    ALTER ROLE clientforce_backoffice BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO clientforce_backoffice;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clientforce_backoffice;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clientforce_backoffice;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clientforce_backoffice;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clientforce_backoffice;

-- (b) Defense in depth: the RLS-subject app role (all tenant/feature paths) is
--     REVOKEd from the backoffice tables. Even if code on a tenant path tried,
--     it cannot read the staff allow-list or the audit trail at the DB layer.
REVOKE ALL PRIVILEGES ON "PlatformStaff" FROM clientforce_app;
REVOKE ALL PRIVILEGES ON "BackofficeAuditLog" FROM clientforce_app;
