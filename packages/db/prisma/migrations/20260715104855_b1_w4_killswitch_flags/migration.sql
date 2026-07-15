-- B1 W4 (DEC-082): KillSwitch + FeatureFlag — operational control tables.
--
-- Additive, platform-global, backoffice-only. (The auto-generated diff also
-- re-proposed `DROP INDEX "KnowledgeChunk_embedding_hnsw_idx"` — Prisma drift on
-- the raw-SQL pgvector index; stripped, same as W1/W2/W3, to stay purely additive.)

-- CreateTable
CREATE TABLE "KillSwitch" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KillSwitch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KillSwitch_agencyId_idx" ON "KillSwitch"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "KillSwitch_agencyId_channel_key" ON "KillSwitch"("agencyId", "channel");

-- CreateIndex
CREATE INDEX "FeatureFlag_workspaceId_idx" ON "FeatureFlag"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_workspaceId_key_key" ON "FeatureFlag"("workspaceId", "key");

-- Access model: these are backoffice-WRITTEN but app-READABLE (unlike the fully
-- revoked W1-W3 tables). The send boundary (RLS-subject app role) READS KillSwitch
-- to enforce the kill switch, and the app reads FeatureFlag to gate features — so
-- the tenant role keeps SELECT but loses all WRITE (only the backoffice mutates them).
GRANT SELECT, INSERT, UPDATE, DELETE ON "KillSwitch" TO clientforce_backoffice;
GRANT SELECT, INSERT, UPDATE, DELETE ON "FeatureFlag" TO clientforce_backoffice;
REVOKE INSERT, UPDATE, DELETE ON "KillSwitch" FROM clientforce_app;
REVOKE INSERT, UPDATE, DELETE ON "FeatureFlag" FROM clientforce_app;
