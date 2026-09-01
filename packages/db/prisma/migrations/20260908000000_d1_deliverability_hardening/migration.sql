-- D1 · Deliverability hardening (backend) — DEC-170…DEC-174.
--
-- Additive only: three new tables, no rename, no drop, no re-default of
-- anything that exists. `DeliverabilityRule` and `SoftBounce` are tenant-scoped
-- and carry the standard `app.workspace_id` policy; the `clientforce_app` and
-- `clientforce_backoffice` grants arrive through the ALTER DEFAULT PRIVILEGES
-- set in the original RLS migration.
--
-- `ProviderEventReceipt` is deliberately NOT tenant-scoped and gets NO policy:
-- a provider event carries no tenant, and the receipt has to be written before
-- the tenant is resolved through `Message`. Owner/admin client only.

-- DEC-173: the 2% ruling toggle, stored per workspace, evaluated per sender.
CREATE TABLE "DeliverabilityRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pauseOnBounceRate" BOOLEAN NOT NULL DEFAULT true,
    "bounceRateThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "softBounceThreshold" INTEGER NOT NULL DEFAULT 3,
    "softBounceWindowDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverabilityRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliverabilityRule_workspaceId_key" ON "DeliverabilityRule"("workspaceId");

-- DEC-171: the soft-bounce tally. Not a suppression store — the counter that
-- decides when to call the one suppression path.
CREATE TABLE "SoftBounce" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReason" TEXT,
    "suppressedAt" TIMESTAMP(3),

    CONSTRAINT "SoftBounce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SoftBounce_workspaceId_channel_address_key"
  ON "SoftBounce"("workspaceId", "channel", "address");
CREATE INDEX "SoftBounce_workspaceId_idx" ON "SoftBounce"("workspaceId");

-- DEC-174: webhook idempotency. A retried SendGrid batch must not re-publish
-- its events and inflate the rates that now pause senders.
CREATE TABLE "ProviderEventReceipt" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEventReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderEventReceipt_provider_eventId_key"
  ON "ProviderEventReceipt"("provider", "eventId");
CREATE INDEX "ProviderEventReceipt_receivedAt_idx" ON "ProviderEventReceipt"("receivedAt");

-- Tenant isolation for the two workspace-scoped tables.
ALTER TABLE "DeliverabilityRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliverabilityRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DeliverabilityRule"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "SoftBounce" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SoftBounce" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SoftBounce"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
