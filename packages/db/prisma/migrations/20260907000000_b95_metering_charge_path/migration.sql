-- B9.5 (DEC-157): the one charge path's idempotency key.
--
-- We charge AFTER the thing happened, so the row it produced already exists
-- and its id is the natural key. `(workspaceId, sourceType, sourceId, reason)`
-- therefore makes a replayed webhook or a retried worker leave exactly one
-- ledger row.
--
-- The uniqueness is PARTIAL because manual adjustments have no source: they
-- carry NULL sourceType and must stay unconstrained, as must every row written
-- before this migration. Prisma cannot express a partial unique index (same
-- limitation worked around in 20260703180000_business_context_two_layer), so
-- it is declared here in raw SQL and documented on the model.
ALTER TABLE "CreditLedger"
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT,
  -- What the charge was computed from, so a bill can be explained later.
  ADD COLUMN "meta" JSONB;

CREATE UNIQUE INDEX "CreditLedger_source_charge_key"
  ON "CreditLedger"("workspaceId", "sourceType", "sourceId", "reason")
  WHERE "sourceType" IS NOT NULL;

CREATE INDEX "CreditLedger_workspaceId_sourceType_sourceId_idx"
  ON "CreditLedger"("workspaceId", "sourceType", "sourceId");
