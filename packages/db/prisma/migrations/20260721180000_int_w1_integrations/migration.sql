-- INT W1 (DEC-093): the integrations platform core.
-- Additive on the pre-existing (never-written) "Integration" table: tokens
-- move to field-encrypted credentialsEnc (the SenderConnection/DEC-030 rule —
-- the plaintext `credentials Json` column is retired in place, kept for
-- additive-schema compliance with a "{}" default so new inserts never touch
-- it); status becomes probe-backed; one row per (workspace, provider).
-- New IntegrationDelivery = the outbound delivery audit + redelivery
-- idempotency ledger (unique (integrationId, sourceEventId, kind); Postgres
-- NULL-distinct semantics keep manual test rows out of the dedupe).

ALTER TABLE "Integration" ALTER COLUMN "credentials" SET DEFAULT '{}';
ALTER TABLE "Integration" ADD COLUMN "credentialsEnc" BYTEA;
ALTER TABLE "Integration" ADD COLUMN "accountLabel" TEXT;
ALTER TABLE "Integration" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Integration" ADD COLUMN "lastProbeAt" TIMESTAMP(3);
ALTER TABLE "Integration" ADD COLUMN "lastSyncAt" TIMESTAMP(3);
ALTER TABLE "Integration" ADD COLUMN "connectedById" TEXT;

CREATE UNIQUE INDEX "Integration_workspaceId_provider_key" ON "Integration"("workspaceId", "provider");

CREATE TABLE "IntegrationDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationDelivery_integrationId_sourceEventId_kind_key" ON "IntegrationDelivery"("integrationId", "sourceEventId", "kind");
CREATE INDEX "IntegrationDelivery_workspaceId_createdAt_idx" ON "IntegrationDelivery"("workspaceId", "createdAt");

ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: the standard tenant policy ("Integration" already carries it from the
-- base rls_policies migration; the new table gets its own block).
ALTER TABLE "IntegrationDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntegrationDelivery"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
