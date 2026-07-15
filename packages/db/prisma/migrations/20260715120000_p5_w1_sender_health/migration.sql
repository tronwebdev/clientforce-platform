-- P5 W1 (DEC-083): sender health engine + warmup scheduler — additive only.
--
-- 1. `SenderConnection.healthState` — the deterministic ledger-derived health
--    snapshot (worker sweep + webhook fast path write it; the send boundary
--    reads `state` only).
-- 2. `Message.senderId` / `Event.senderId` — sender attribution as real,
--    indexed columns. Attribution previously lived ONLY in `Message.meta`
--    JSON, so every per-sender rollup (warmup caps, bounce/spam windows) was
--    an unindexed JSON-path scan through a Message join. Both columns are
--    backfilled below (idempotent UPDATEs); `meta.senderId` stays for compat.
--
-- No RLS changes: columns ride tables whose `tenant_isolation` policies key on
-- `workspaceId`, which is untouched.

-- AlterTable
ALTER TABLE "SenderConnection" ADD COLUMN "healthState" JSONB;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "senderId" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "senderId" TEXT;

-- CreateIndex
CREATE INDEX "Message_workspaceId_senderId_channel_sentAt_idx" ON "Message"("workspaceId", "senderId", "channel", "sentAt");

-- CreateIndex
CREATE INDEX "Event_workspaceId_senderId_type_occurredAt_idx" ON "Event"("workspaceId", "senderId", "type", "occurredAt");

-- Backfill: every send since P1.5 wrote meta.senderId at the boundary.
UPDATE "Message"
SET "senderId" = meta->>'senderId'
WHERE "senderId" IS NULL AND meta ? 'senderId';

-- Backfill: provider-lifecycle events reference their Message in the payload.
UPDATE "Event" e
SET "senderId" = m."senderId"
FROM "Message" m
WHERE e."senderId" IS NULL
  AND m."senderId" IS NOT NULL
  AND e.payload->>'messageId' = m.id;
