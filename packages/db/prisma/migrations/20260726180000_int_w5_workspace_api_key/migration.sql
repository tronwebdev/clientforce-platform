-- INT W5 (DEC-101): workspace API keys — v1 auth for the Zapier private app.
-- Additive; standard tenant RLS. The token secret is never stored: `prefix` is
-- the public lookup half and `hash` is SHA-256 of the whole token.

CREATE TABLE "WorkspaceApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceApiKey_prefix_key" ON "WorkspaceApiKey"("prefix");
CREATE INDEX "WorkspaceApiKey_workspaceId_revokedAt_idx" ON "WorkspaceApiKey"("workspaceId", "revokedAt");

ALTER TABLE "WorkspaceApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceApiKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkspaceApiKey"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
