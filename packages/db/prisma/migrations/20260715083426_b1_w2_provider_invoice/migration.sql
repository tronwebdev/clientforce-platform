-- B1 W2 (DEC-080): ProviderInvoice — the reconciliation fixture store.
--
-- Additive, platform-global, backoffice-only. (The auto-generated diff also
-- re-proposed `DROP INDEX "KnowledgeChunk_embedding_hnsw_idx"` — Prisma drift on
-- the raw-SQL pgvector index it cannot model; stripped here, same as the W1
-- migration, to stay purely additive.)

-- CreateTable
CREATE TABLE "ProviderInvoice" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderInvoice_provider_periodStart_idx" ON "ProviderInvoice"("provider", "periodStart");

-- Backoffice-only access: grant the RLS-exempt operator role, and REVOKE the
-- RLS-subject tenant role (defense in depth — same rail as the W1 tables).
GRANT SELECT, INSERT, UPDATE, DELETE ON "ProviderInvoice" TO clientforce_backoffice;
REVOKE ALL PRIVILEGES ON "ProviderInvoice" FROM clientforce_app;
