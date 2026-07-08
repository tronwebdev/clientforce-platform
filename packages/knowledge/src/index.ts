/**
 * @clientforce/knowledge — ingestion + RAG (P1.2).
 *
 * Source kinds (DEC-023): WEBSITE · DOCUMENT (blob upload) · TEXT live;
 * CONNECTOR designed-but-inert. Pipeline: extract → chunk → embed (1536 via
 * @clientforce/ai) → pgvector chunks under RLS; retrieval over the hnsw index.
 */
export { chunkText, estimateTokens, type Chunk } from "./chunk";
export {
  ExtractionError,
  extractFromDocument,
  extractFromHtml,
  extractFromUrl,
  MAX_UPLOAD_BYTES,
} from "./extract";
export { ingestSource, type IngestDeps, type IngestJobPayload } from "./pipeline";
export { retrieve, type RetrievedChunk, type RetrieveOptions } from "./retrieve";
export { createIngestQueue, createIngestWorker, KNOWLEDGE_QUEUE_NAME } from "./queue";
export {
  AzureBlobUploadStore,
  createUploadStoreFromEnv,
  FileUploadStore,
  MemoryUploadStore,
  STORAGE_OP_TIMEOUT_MS,
  StorageUnavailableError,
  uploadPathFor,
  type UploadStore,
} from "./storage";
