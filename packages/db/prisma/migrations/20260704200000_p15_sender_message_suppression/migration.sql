-- P1.5 (handoff A6/A7 + issue P1.5): SenderConnection (three-tier sender
-- model, replaces the T1 `Sender` placeholder — DEC-030), Message (outbound
-- persisted as rendered), Suppression (send-boundary blocklist).
-- Safe pre-launch: `Sender` has no rows in any environment.

DROP TABLE "Sender";

CREATE TYPE "SenderType" AS ENUM ('CF_MANAGED', 'GMAIL_OAUTH', 'OUTLOOK_OAUTH', 'SMTP');
CREATE TYPE "SenderStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'BOUNCED', 'SPAM_COMPLAINT', 'MANUAL');

CREATE TABLE "SenderConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "SenderType" NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "replyTo" TEXT,
    "status" "SenderStatus" NOT NULL DEFAULT 'ACTIVE',
    "domainAuthStatus" JSONB NOT NULL DEFAULT '{}',
    "dailyLimit" INTEGER NOT NULL DEFAULT 200,
    "sendingWindow" JSONB,
    "credentialsEnc" BYTEA,
    "warmupState" JSONB,
    "dedicatedIp" TEXT,
    "ipPoolId" TEXT,
    "subuser" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SenderConnection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SenderConnection_workspaceId_idx" ON "SenderConnection"("workspaceId");

CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "inReplyToId" TEXT,
    "intent" TEXT,
    "stepNodeId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Message_providerMessageId_key" ON "Message"("providerMessageId");
CREATE INDEX "Message_workspaceId_contactId_sentAt_idx" ON "Message"("workspaceId", "contactId", "sentAt");
CREATE INDEX "Message_workspaceId_campaignId_sentAt_idx" ON "Message"("workspaceId", "campaignId", "sentAt");

CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Suppression_workspaceId_channel_address_key" ON "Suppression"("workspaceId", "channel", "address");
CREATE INDEX "Suppression_workspaceId_idx" ON "Suppression"("workspaceId");

-- Tenant isolation, same policy shape as 20260627231509_rls_policies.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['SenderConnection', 'Message', 'Suppression'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("workspaceId" = current_setting(''app.workspace_id'', true)) '
      'WITH CHECK ("workspaceId" = current_setting(''app.workspace_id'', true));',
      t
    );
  END LOOP;
END $$;
