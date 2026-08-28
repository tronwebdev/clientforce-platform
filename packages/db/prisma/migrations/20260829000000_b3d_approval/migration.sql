-- B3d (DEC-122): the ONE approval spine — everything that waits on a human
-- tap. Level-1 step parks write rows now; budget/branch kinds join when
-- their emitters exist. Standard tenant RLS.

CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "contactId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "meta" JSONB,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Approval_enrollmentId_status_idx" ON "Approval"("enrollmentId", "status");
CREATE INDEX "Approval_workspaceId_campaignId_status_idx" ON "Approval"("workspaceId", "campaignId", "status");
CREATE INDEX "Approval_workspaceId_status_createdAt_idx" ON "Approval"("workspaceId", "status", "createdAt");

ALTER TABLE "Approval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Approval" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Approval"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

