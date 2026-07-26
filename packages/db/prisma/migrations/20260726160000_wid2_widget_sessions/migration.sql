-- WID2 (DEC-101): the widget's server half — the public credential + sessions.
--
-- Additive on the pre-existing (never-written) "Widget" table, the INT W1
-- `credentialsEnc` precedent: every new column is nullable or defaulted, so a
-- deployed database with rows migrates without a rewrite and every existing
-- query behaves byte-identically.
--
-- `publicId` is the `wgt_…` a host page carries — the ONLY widget identifier
-- that leaves the platform. The server resolves it to workspace/agent, which is
-- what keeps tenant ids off the embedding page. Nullable for additive safety;
-- the builder mints one at create and the resolver refuses a row without one.
--
-- `WidgetSession` is one visitor conversation. It is anonymous by construction:
-- `contactId` stays NULL until a capture flow identifies the visitor (the
-- FormSubmission precedent). Turns live as JSONB on the row because "Message"
-- requires BOTH a campaignId and a contactId, and a stranger on a marketing
-- page has neither — promoting a captured thread into Message rows belongs to
-- the capture flows, not here.

ALTER TABLE "Widget" ADD COLUMN "publicId" TEXT;
ALTER TABLE "Widget" ADD COLUMN "flows" JSONB;
ALTER TABLE "Widget" ADD COLUMN "allowedOrigins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "Widget_publicId_key" ON "Widget"("publicId");

CREATE TABLE "WidgetSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "widgetId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "campaignId" TEXT,
    "contactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "turns" JSONB NOT NULL DEFAULT '[]',
    "agentTurns" INTEGER NOT NULL DEFAULT 0,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "locale" TEXT,
    "originHost" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "meta" JSONB,

    CONSTRAINT "WidgetSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WidgetSession_workspaceId_startedAt_idx" ON "WidgetSession"("workspaceId", "startedAt");
CREATE INDEX "WidgetSession_widgetId_startedAt_idx" ON "WidgetSession"("widgetId", "startedAt");
CREATE INDEX "WidgetSession_workspaceId_contactId_idx" ON "WidgetSession"("workspaceId", "contactId");

ALTER TABLE "WidgetSession" ADD CONSTRAINT "WidgetSession_widgetId_fkey" FOREIGN KEY ("widgetId") REFERENCES "Widget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy shape as 20260627231509_rls_policies. The
-- public endpoint resolves publicId → workspaceId with the owner client and
-- then does EVERY session read/write through withTenant, so a visitor's
-- request is as tenant-scoped as an authenticated one.
ALTER TABLE "WidgetSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WidgetSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WidgetSession"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
