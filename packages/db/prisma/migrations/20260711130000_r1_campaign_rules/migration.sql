-- R1 (DEC-073): per-agent automation rules (ARCHITECTURE §151) — additive
-- CampaignRule + CampaignRuleRun, the campaign-scoped siblings of the
-- Phase-6 standalone Automation/AutomationRun (§152, byte-untouched here).
-- Run idempotency: unique (ruleId, eventId) — bus redelivery can't double-fire.

CREATE TABLE "CampaignRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "trigger" JSONB NOT NULL,
    "condition" JSONB,
    "actions" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "seededFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CampaignRule_workspaceId_idx" ON "CampaignRule"("workspaceId");
CREATE INDEX "CampaignRule_campaignId_idx" ON "CampaignRule"("campaignId");
ALTER TABLE "CampaignRule" ADD CONSTRAINT "CampaignRule_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CampaignRuleRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "contactId" TEXT,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignRuleRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CampaignRuleRun_ruleId_eventId_key" ON "CampaignRuleRun"("ruleId", "eventId");
CREATE INDEX "CampaignRuleRun_workspaceId_idx" ON "CampaignRuleRun"("workspaceId");
CREATE INDEX "CampaignRuleRun_ruleId_idx" ON "CampaignRuleRun"("ruleId");
ALTER TABLE "CampaignRuleRun" ADD CONSTRAINT "CampaignRuleRun_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "CampaignRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy shape as 20260627231509_rls_policies.
ALTER TABLE "CampaignRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CampaignRule"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "CampaignRuleRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignRuleRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CampaignRuleRun"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
