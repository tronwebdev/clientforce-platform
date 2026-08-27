-- B3b (DEC-117): the reply-hold (a human reply pauses Ada until explicit
-- Resume — owner ruling) and per-thread assign/snooze state. Additive;
-- standard tenant RLS on both.

CREATE TABLE "EnrollmentReplyHold" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'human_reply',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "EnrollmentReplyHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EnrollmentReplyHold_enrollmentId_releasedAt_idx" ON "EnrollmentReplyHold"("enrollmentId", "releasedAt");
CREATE INDEX "EnrollmentReplyHold_workspaceId_contactId_releasedAt_idx" ON "EnrollmentReplyHold"("workspaceId", "contactId", "releasedAt");

ALTER TABLE "EnrollmentReplyHold" ADD CONSTRAINT "EnrollmentReplyHold_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EnrollmentReplyHold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnrollmentReplyHold" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EnrollmentReplyHold"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

CREATE TABLE "ThreadState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreadState_campaignId_contactId_key" ON "ThreadState"("campaignId", "contactId");
CREATE INDEX "ThreadState_workspaceId_idx" ON "ThreadState"("workspaceId");

ALTER TABLE "ThreadState" ADD CONSTRAINT "ThreadState_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreadState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ThreadState" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ThreadState"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
