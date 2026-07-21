-- INT W2 (DEC-094): the Meeting model — current booking state + the
-- before_meeting sweep anchor. Additive; standard tenant RLS.

CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "enrollmentId" TEXT,
    "campaignId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "title" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "timezone" TEXT,
    "inviteeEmail" TEXT,
    "rescheduleUrl" TEXT,
    "cancelUrl" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Meeting_workspaceId_provider_externalId_key" ON "Meeting"("workspaceId", "provider", "externalId");
CREATE INDEX "Meeting_workspaceId_status_startAt_idx" ON "Meeting"("workspaceId", "status", "startAt");
CREATE INDEX "Meeting_workspaceId_idx" ON "Meeting"("workspaceId");

ALTER TABLE "Meeting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Meeting" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Meeting"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
