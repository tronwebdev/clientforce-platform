-- B6 (DEC-131): the lead-finder / intent-tier tables — watch topics (what
-- counts as buying intent for this workspace), the intent-signal ledger the
-- first-party pipeline writes, and hidden-profile exclusions. Standard
-- tenant RLS on all three.

CREATE TABLE "WatchTopic" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchTopic_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WatchTopic_workspaceId_idx" ON "WatchTopic"("workspaceId");
CREATE UNIQUE INDEX "WatchTopic_workspaceId_kind_label_key" ON "WatchTopic"("workspaceId", "kind", "label");

CREATE TABLE "IntentSignal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyKey" TEXT,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receipt" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntentSignal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IntentSignal_workspaceId_occurredAt_idx" ON "IntentSignal"("workspaceId", "occurredAt");
CREATE INDEX "IntentSignal_workspaceId_contactId_occurredAt_idx" ON "IntentSignal"("workspaceId", "contactId", "occurredAt");

CREATE TABLE "LeadExclusion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'hidden',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadExclusion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeadExclusion_workspaceId_provider_providerRef_key" ON "LeadExclusion"("workspaceId", "provider", "providerRef");

ALTER TABLE "WatchTopic" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WatchTopic" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WatchTopic"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "IntentSignal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntentSignal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntentSignal"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "LeadExclusion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadExclusion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeadExclusion"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
