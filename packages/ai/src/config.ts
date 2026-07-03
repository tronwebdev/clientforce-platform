import type { AiTask } from "./types";

/**
 * Per-task model routing — **Opus-class for planning, Sonnet-class for
 * copy/classification** (PHASE1_ISSUES P1.1 / ARCHITECTURE §2.4). Each entry is
 * env-overridable so staging can pin/upgrade models without a deploy.
 */
export interface AiConfig {
  models: Record<AiTask, string>;
  maxTokens: Record<AiTask, number>;
  /** Whole-request timeout per attempt, ms. */
  timeoutMs: number;
  /** Retry attempts on retryable failures (429/5xx/timeout). */
  maxRetries: number;
  /** Base backoff delay, ms (exponential + jitter). */
  backoffBaseMs: number;
  /** Embeddings: model + dimensions are pinned together (P1.2 hnsw needs 1536). */
  embeddingModel: string;
  embeddingDimensions: number;
  /**
   * USD per 1M tokens {input, output} — **logging estimates only**, never
   * billing-grade. Unknown models log cost 0.
   */
  prices: Record<string, { input: number; output: number }>;
}

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
};

const envInt = (name: string, fallback: number): number => {
  const v = env(name);
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  const base: AiConfig = {
    models: {
      planner: env("AI_MODEL_PLANNER") ?? "claude-opus-4-8",
      copy: env("AI_MODEL_COPY") ?? "claude-sonnet-5",
      classify: env("AI_MODEL_CLASSIFY") ?? "claude-sonnet-5",
    },
    maxTokens: {
      planner: envInt("AI_MAX_TOKENS_PLANNER", 8192),
      copy: envInt("AI_MAX_TOKENS_COPY", 2048),
      classify: envInt("AI_MAX_TOKENS_CLASSIFY", 1024),
    },
    timeoutMs: envInt("AI_TIMEOUT_MS", 60_000),
    maxRetries: envInt("AI_MAX_RETRIES", 3),
    backoffBaseMs: envInt("AI_BACKOFF_BASE_MS", 500),
    embeddingModel: env("AI_EMBEDDING_MODEL") ?? "text-embedding-3-large",
    // 1536 so the pgvector column can take an hnsw index (P1.2; T1's TODO).
    embeddingDimensions: envInt("AI_EMBEDDING_DIMENSIONS", 1536),
    prices: {
      "claude-opus-4-8": { input: 15, output: 75 },
      "claude-sonnet-5": { input: 3, output: 15 },
      "text-embedding-3-large": { input: 0.13, output: 0 },
    },
  };
  return { ...base, ...overrides, models: { ...base.models, ...overrides.models } };
}

export function estimateCostUsd(
  config: AiConfig,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const price = config.prices[model];
  if (!price) return 0;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
