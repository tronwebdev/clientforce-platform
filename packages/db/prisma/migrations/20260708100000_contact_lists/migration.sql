-- C2.8 (docs/PLAN_CONTACT_LISTS.md): lists become a working feature.
-- The Phase-0 tables already exist with RLS policies attached (which survive
-- the rename); this migration adds the plan's semantics — origin (future
-- origins reserved), archive-never-delete, per-workspace unique names,
-- addedBy provenance — and renames ListMembership to the plan's
-- ContactListMember.

-- ContactList: origin + archived + unique(workspaceId, name)
ALTER TABLE "ContactList" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "ContactList" ALTER COLUMN "origin" DROP DEFAULT;
ALTER TABLE "ContactList" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "ContactList_workspaceId_name_key" ON "ContactList"("workspaceId", "name");

-- ListMembership → ContactListMember (policies + FKs ride along; constraint
-- and index names are renamed to Prisma's convention for the new model name)
ALTER TABLE "ListMembership" RENAME TO "ContactListMember";
ALTER TABLE "ContactListMember" RENAME COLUMN "createdAt" TO "addedAt";
ALTER TABLE "ContactListMember" ADD COLUMN "addedBy" TEXT NOT NULL DEFAULT 'import';
ALTER TABLE "ContactListMember" ALTER COLUMN "addedBy" DROP DEFAULT;
ALTER TABLE "ContactListMember" RENAME CONSTRAINT "ListMembership_pkey" TO "ContactListMember_pkey";
ALTER TABLE "ContactListMember" RENAME CONSTRAINT "ListMembership_listId_fkey" TO "ContactListMember_listId_fkey";
ALTER TABLE "ContactListMember" RENAME CONSTRAINT "ListMembership_contactId_fkey" TO "ContactListMember_contactId_fkey";
ALTER INDEX "ListMembership_workspaceId_idx" RENAME TO "ContactListMember_workspaceId_idx";
ALTER INDEX "ListMembership_listId_contactId_key" RENAME TO "ContactListMember_listId_contactId_key";
