-- B1 (DEC-104): campaign value model — Addendum-2 §D fields as nullable
-- columns on Agent, owner-editable in the Bold overview strip. Purely
-- additive. (The auto-generated diff also re-proposed
-- `DROP INDEX "KnowledgeChunk_embedding_hnsw_idx"` — the standing Prisma
-- drift on the raw-SQL pgvector index; stripped, same as B1-W1..W4 and every
-- wave since, to stay purely additive.)

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "valueEstCents" INTEGER,
ADD COLUMN     "valueGoalUnits" INTEGER,
ADD COLUMN     "valueSalesGoalCents" INTEGER;
