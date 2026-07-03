-- P1.2 (resolves T1's TODO(phase-1)): 1536-dim embeddings (text-embedding-3-large
-- with dimensions=1536, via @clientforce/ai) so the column can take an hnsw index.
-- Drop/re-add is safe: KnowledgeChunk has no rows anywhere pre-P1.2 (ingestion
-- did not exist), and the column is NOT NULL either way.
ALTER TABLE "KnowledgeChunk" DROP COLUMN "embedding";
ALTER TABLE "KnowledgeChunk" ADD COLUMN "embedding" vector(1536) NOT NULL;

CREATE INDEX "KnowledgeChunk_embedding_hnsw_idx"
  ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);
