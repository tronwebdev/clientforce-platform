-- P3.1 (DEC-078): additive Call model — one row per phone call (the Calls
-- tab's backing data). Transcript turns stay on Message(channel:"voice")
-- rows carrying meta.callId (the spike-proven mapping — no Message change);
-- this table holds call-level facts: status/outcome, duration, cost, and the
-- disclosure record. providerCallSid is the idempotency key against Twilio.
-- Message-style loose references (no FKs) + indexes.

CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'QUEUED',
    "outcome" TEXT,
    "providerCallSid" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Call_providerCallSid_key" ON "Call"("providerCallSid");
CREATE INDEX "Call_workspaceId_agentId_createdAt_idx" ON "Call"("workspaceId", "agentId", "createdAt");
CREATE INDEX "Call_workspaceId_contactId_createdAt_idx" ON "Call"("workspaceId", "contactId", "createdAt");

-- Tenant isolation, same policy shape as 20260627231509_rls_policies.
ALTER TABLE "Call" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Call" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Call"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
