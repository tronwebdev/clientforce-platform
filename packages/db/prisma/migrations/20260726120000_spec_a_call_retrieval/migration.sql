-- SPEC A (DEC-099): on-call contact awareness — the retrieval RECEIPT ledger.
--
-- Purely additive: one new workspace-scoped table. Nothing existing is
-- altered, so every pre-DEC-099 call row and query behaves byte-identically.
--
-- `CallRetrieval` records one row per mid-call `lookup_contact_context` call:
-- the facet scoped, the model's own phrasing of the question, whether the
-- record held an answer, and what grounded it. Append-only (the CreditLedger
-- stance — enforced in code). Loose `callId` reference with no FK, matching
-- the `Call` model's own "Message-style loose references" choice.

CREATE TABLE "CallRetrieval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "facet" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "refusalReason" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallRetrieval_pkey" PRIMARY KEY ("id")
);

-- (callId, seq) is the idempotency key: a retried finalize flush writes each
-- receipt exactly once, the persistTranscript precedent.
CREATE UNIQUE INDEX "CallRetrieval_callId_seq_key" ON "CallRetrieval"("callId", "seq");
CREATE INDEX "CallRetrieval_workspaceId_callId_seq_idx" ON "CallRetrieval"("workspaceId", "callId", "seq");

-- Tenant isolation, same policy shape as 20260627231509_rls_policies.
ALTER TABLE "CallRetrieval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallRetrieval" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CallRetrieval"
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));
