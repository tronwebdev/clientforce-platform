-- LH1 (DEC-087): list hygiene — email validation at every ingress. Additive:
--   · Contact verdict columns (valid | risky | invalid | unverified default)
--   · EmailValidationVerdict — workspace-scoped verdict cache (TTL ~90d;
--     billedAt = the COGS meter, set only on PAID provider calls)
--   · ValidationBatch/Item — async, never-blocking validation runs with
--     honest progress + honest holds (allowance / ceiling / provider down)
--   · EnrollmentHold — the gate's hold queue (unverified · risky_held ·
--     cap_overflow), draining progressively as verdicts land
--   · Campaign per-day enrollment cap config (default ON, platform default)
-- The suppression ledger stays authoritative — a verdict never un-suppresses.

ALTER TABLE "Contact" ADD COLUMN "emailVerdict" TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE "Contact" ADD COLUMN "emailVerdictCheckedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "emailVerdictSource" TEXT;
CREATE INDEX "Contact_workspaceId_emailVerdict_idx" ON "Contact"("workspaceId", "emailVerdict");

ALTER TABLE "Campaign" ADD COLUMN "enrollmentDailyCap" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "enrollmentCapEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "EmailValidationVerdict" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "subStatus" TEXT,
    "source" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "billedAt" TIMESTAMP(3),
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EmailValidationVerdict_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailValidationVerdict_workspaceId_address_key" ON "EmailValidationVerdict"("workspaceId", "address");
CREATE INDEX "EmailValidationVerdict_workspaceId_billedAt_idx" ON "EmailValidationVerdict"("workspaceId", "billedAt");
CREATE INDEX "EmailValidationVerdict_billedAt_idx" ON "EmailValidationVerdict"("billedAt");

CREATE TABLE "ValidationBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientKey" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "heldReason" TEXT,
    "listId" TEXT,
    "claimedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ValidationBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ValidationBatch_workspaceId_clientKey_key" ON "ValidationBatch"("workspaceId", "clientKey");
CREATE INDEX "ValidationBatch_workspaceId_status_idx" ON "ValidationBatch"("workspaceId", "status");

CREATE TABLE "ValidationBatchItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "via" TEXT,
    "detail" TEXT,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ValidationBatchItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ValidationBatchItem_batchId_contactId_key" ON "ValidationBatchItem"("batchId", "contactId");
CREATE INDEX "ValidationBatchItem_workspaceId_idx" ON "ValidationBatchItem"("workspaceId");
CREATE INDEX "ValidationBatchItem_batchId_outcome_idx" ON "ValidationBatchItem"("batchId", "outcome");
ALTER TABLE "ValidationBatchItem" ADD CONSTRAINT "ValidationBatchItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ValidationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EnrollmentHold" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "senderId" TEXT,
    "origin" JSONB,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "refusalCode" TEXT,
    "enrollmentId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnrollmentHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnrollmentHold_campaignId_contactId_key" ON "EnrollmentHold"("campaignId", "contactId");
CREATE INDEX "EnrollmentHold_workspaceId_status_idx" ON "EnrollmentHold"("workspaceId", "status");
CREATE INDEX "EnrollmentHold_campaignId_status_idx" ON "EnrollmentHold"("campaignId", "status");

-- Tenant isolation, same policy shape as 20260627231509_rls_policies.
ALTER TABLE "EmailValidationVerdict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailValidationVerdict" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmailValidationVerdict"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "ValidationBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ValidationBatch"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "ValidationBatchItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationBatchItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ValidationBatchItem"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "EnrollmentHold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnrollmentHold" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EnrollmentHold"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
