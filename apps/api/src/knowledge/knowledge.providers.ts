import type { Provider } from "@nestjs/common";
import { AiGateway, AiProviderError, OpenAiEmbeddingsProvider } from "@clientforce/ai";
import {
  createIngestQueue,
  createUploadStoreFromEnv,
  type IngestJobPayload,
  type UploadStore,
} from "@clientforce/knowledge";

export const INGEST_ENQUEUER = "KNOWLEDGE_INGEST_ENQUEUER";
export const UPLOAD_STORE = "KNOWLEDGE_UPLOAD_STORE";
export const KNOWLEDGE_GATEWAY = "KNOWLEDGE_GATEWAY";

/** Seam between the controller and BullMQ so tests can run ingestion inline. */
export interface IngestEnqueuer {
  enqueue(payload: IngestJobPayload): Promise<void>;
}

/**
 * Default enqueuer: a lazily created BullMQ queue (`REDIS_URL`). Lazy so the
 * API boots — and the non-knowledge routes work — without Redis; the first
 * knowledge write is what needs the queue.
 */
class BullIngestEnqueuer implements IngestEnqueuer {
  private queue?: ReturnType<typeof createIngestQueue>;

  async enqueue(payload: IngestJobPayload): Promise<void> {
    this.queue ??= createIngestQueue();
    await this.queue.add("ingest", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}

/**
 * P1.2 only needs embeddings in the API (query embedding for /knowledge/retrieve),
 * so the completion side is a guard that fails loudly if something reaches for
 * it before P1.3 wires the real provider.
 */
function embeddingsOnlyGateway(): AiGateway {
  const notWired = async (): Promise<never> => {
    throw new AiProviderError(
      "Completions are not wired in the api process until P1.3",
      undefined,
      false,
    );
  };
  return new AiGateway({
    provider: { completeText: notWired, completeTool: notWired },
    embeddings: new OpenAiEmbeddingsProvider(),
  });
}

export const knowledgeProviders: Provider[] = [
  { provide: INGEST_ENQUEUER, useClass: BullIngestEnqueuer },
  { provide: UPLOAD_STORE, useFactory: (): UploadStore => createUploadStoreFromEnv() },
  { provide: KNOWLEDGE_GATEWAY, useFactory: embeddingsOnlyGateway },
];
