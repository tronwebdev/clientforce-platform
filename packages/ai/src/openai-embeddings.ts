import { AiProviderError, type TokenUsage } from "./types";
import type { EmbeddingsProvider } from "./provider";

/**
 * Embeddings via OpenAI `text-embedding-3-large` pinned to 1536 dimensions
 * (config) so the pgvector column can carry an hnsw index (P1.2). One endpoint
 * → plain fetch; no SDK dependency.
 */
export class OpenAiEmbeddingsProvider implements EmbeddingsProvider {
  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY,
    private readonly baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  ) {}

  async embed(
    texts: string[],
    model: string,
    dimensions: number,
    signal: AbortSignal,
  ): Promise<{ vectors: number[][]; usage: TokenUsage }> {
    if (!this.apiKey) {
      throw new AiProviderError(
        "OPENAI_API_KEY is not set. In deployed environments it resolves from Key Vault secret OPENAI-API-KEY.",
        undefined,
        false,
      );
    }
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model, input: texts, dimensions }),
      signal,
    });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const retryAfterSec = Number.parseFloat(res.headers.get("retry-after") ?? "");
      const body = await res.text().catch(() => "");
      throw new AiProviderError(
        `OpenAI embeddings error (${res.status}): ${body.slice(0, 300)}`,
        res.status,
        retryable,
        Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : undefined,
      );
    }
    const json = (await res.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    const vectors = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== dimensions)) {
      throw new AiProviderError(
        `Embeddings response shape mismatch: expected ${texts.length}×${dimensions}`,
        undefined,
        false,
      );
    }
    return {
      vectors,
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: 0 },
    };
  }
}
