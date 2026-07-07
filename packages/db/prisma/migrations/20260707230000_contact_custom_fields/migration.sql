-- C2.7 (docs/PLAN_CUSTOM_FIELDS.md): workspace-defined custom fields.
-- ContactFieldDef: key immutable slug, archive-never-delete; values live in
-- Contact.custom keyed by def key — Contact.enrichment stays reserved for
-- machine enrichment.

CREATE TYPE "FieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT');

CREATE TABLE "ContactFieldDef" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "origin" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactFieldDef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContactFieldDef_workspaceId_key_key" ON "ContactFieldDef"("workspaceId", "key");
CREATE INDEX "ContactFieldDef_workspaceId_idx" ON "ContactFieldDef"("workspaceId");

ALTER TABLE "Contact" ADD COLUMN "custom" JSONB NOT NULL DEFAULT '{}';

-- Tenant isolation, same policy shape as 20260627231509_rls_policies.
ALTER TABLE "ContactFieldDef" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactFieldDef" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ContactFieldDef"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
