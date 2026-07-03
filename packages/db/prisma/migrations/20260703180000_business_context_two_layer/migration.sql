-- P1.3 (DEC-024/025): BusinessContext v2 — two-layer, evidence-cited fields.
-- Safe pre-launch: the table has no rows in any environment.

CREATE TYPE "ContextStatus" AS ENUM ('DISTILLING', 'READY');

-- Two-layer: agentId becomes nullable (NULL = the workspace layer / Brand kit).
ALTER TABLE "BusinessContext" DROP CONSTRAINT "BusinessContext_agentId_fkey";
DROP INDEX "BusinessContext_agentId_key";
ALTER TABLE "BusinessContext" ALTER COLUMN "agentId" DROP NOT NULL;
ALTER TABLE "BusinessContext"
  ADD CONSTRAINT "BusinessContext_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Legacy fixed columns → the registry-keyed `fields` map
-- { value, citations: chunkId[], source: "distilled" | "typed" | "ai_decides" }.
ALTER TABLE "BusinessContext"
  DROP COLUMN "offer",
  DROP COLUMN "icp",
  DROP COLUMN "proofPoints",
  DROP COLUMN "tone",
  DROP COLUMN "constraints",
  ADD COLUMN "goal" TEXT,
  ADD COLUMN "status" "ContextStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "fields" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "proposedAsks" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "distilledAt" TIMESTAMP(3);
ALTER TABLE "BusinessContext" ALTER COLUMN "rawSummary" SET DEFAULT '';

-- Uniqueness (Prisma can't express partial unique indexes):
-- one row per agent, one workspace-layer row per workspace.
CREATE UNIQUE INDEX "BusinessContext_agentId_key"
  ON "BusinessContext"("agentId") WHERE "agentId" IS NOT NULL;
CREATE UNIQUE INDEX "BusinessContext_workspace_layer_key"
  ON "BusinessContext"("workspaceId") WHERE "agentId" IS NULL;
CREATE INDEX "BusinessContext_agentId_idx" ON "BusinessContext"("agentId");
