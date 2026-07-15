-- B1 W3 (DEC-081): TelemetryEvent — the local, PII-free product-adoption store.
--
-- Additive, platform-global, backoffice-only. (The auto-generated diff also
-- re-proposed `DROP INDEX "KnowledgeChunk_embedding_hnsw_idx"` — Prisma drift on
-- the raw-SQL pgvector index; stripped, same as W1/W2, to stay purely additive.)

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "workspaceId" TEXT,
    "agencyId" TEXT,
    "entityId" TEXT,
    "props" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelemetryEvent_name_occurredAt_idx" ON "TelemetryEvent"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_workspaceId_occurredAt_idx" ON "TelemetryEvent"("workspaceId", "occurredAt");

-- Backoffice-only access (same rail as the W1/W2 tables): grant the RLS-exempt
-- operator role, REVOKE the RLS-subject tenant role. Telemetry is internal-only
-- and never reachable from a tenant/feature path.
GRANT SELECT, INSERT, UPDATE, DELETE ON "TelemetryEvent" TO clientforce_backoffice;
REVOKE ALL PRIVILEGES ON "TelemetryEvent" FROM clientforce_app;
