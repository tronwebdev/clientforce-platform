-- B7.5: the settings WRITE layer (SURFACE_SPEC_SETTINGS §6–§7).
--
-- Additive only: two new tenant-scoped tables and their enums. Nothing
-- existing is renamed, dropped or re-defaulted. Both tables carry the standard
-- `app.workspace_id` tenant policy; the `clientforce_app` grants arrive through
-- the ALTER DEFAULT PRIVILEGES set in the original RLS migration, and
-- `clientforce_backoffice` likewise (BYPASSRLS, DEC-079).

CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');
CREATE TYPE "NumberRequestStatus" AS ENUM ('REQUESTED', 'RESERVED', 'ACTIVE', 'CANCELLED');

-- Invitations. The token is stored hashed — the plaintext leaves once, in the
-- link, and is never readable from the database again. Expiry is DERIVED from
-- `expiresAt` rather than stored, so a lapsed invite is honest with no sweeper.
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT,
    "acceptedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");
CREATE INDEX "WorkspaceInvite_workspaceId_status_idx" ON "WorkspaceInvite"("workspaceId", "status");
CREATE INDEX "WorkspaceInvite_workspaceId_email_idx" ON "WorkspaceInvite"("workspaceId", "email");

-- Number requests. Provisioning and A2P filing are not connected yet; this
-- records the real ask and its true state instead of an invented badge.
CREATE TABLE "NumberRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "areaCode" TEXT NOT NULL,
    "carries" TEXT NOT NULL,
    "status" "NumberRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "a2pState" TEXT NOT NULL DEFAULT 'not_filed',
    "senderId" TEXT,
    "note" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NumberRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NumberRequest_workspaceId_status_idx" ON "NumberRequest"("workspaceId", "status");

ALTER TABLE "WorkspaceInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceInvite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkspaceInvite"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "NumberRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NumberRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NumberRequest"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
