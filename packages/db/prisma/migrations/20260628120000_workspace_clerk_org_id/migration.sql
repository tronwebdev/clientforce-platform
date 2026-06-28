-- Add the immutable Clerk Organization id used to resolve the active workspace.
ALTER TABLE "Workspace" ADD COLUMN "clerkOrgId" TEXT;

-- Unique (nullable allows many NULLs until orgs are provisioned).
CREATE UNIQUE INDEX "Workspace_clerkOrgId_key" ON "Workspace"("clerkOrgId");
