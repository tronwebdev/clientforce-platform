/**
 * @clientforce/ai — the LLM gateway (P1.1).
 *
 * The ONLY package allowed to touch the Anthropic SDK (root eslint enforces
 * it). Everything AI-shaped flows through `AiGateway`: per-task model routing
 * (Opus-class planning / Sonnet-class copy+classification), zod-validated
 * structured output with a bounded repair path, retries/timeouts, versioned
 * prompts, and token/cost logging.
 */
export { AiGateway, type AiGatewayOptions } from "./gateway";
export { loadConfig, estimateCostUsd, type AiConfig } from "./config";
export { AnthropicProvider } from "./anthropic";
export { OpenAiEmbeddingsProvider } from "./openai-embeddings";
export {
  registerPrompt,
  getPrompt,
  renderPrompt,
  clearPromptsForTest,
  type PromptTemplate,
} from "./prompts";
export type {
  CompletionProvider,
  EmbeddingsProvider,
  StreamEvent,
  StreamParams,
  TextParams,
  TextResult,
  ToolParams,
  ToolResult,
} from "./provider";
export {
  AiGatewayError,
  AiProviderError,
  AiTimeoutError,
  StructuredOutputError,
  MissingPromptVarError,
  type AiTask,
  type CompleteRequest,
  type StreamVoiceRequest,
  type VoiceTurn,
  type TokenUsage,
  type UsageRecord,
  type UsageHook,
} from "./types";

import { AnthropicProvider } from "./anthropic";
import { AiGateway, type AiGatewayOptions } from "./gateway";
import { OpenAiEmbeddingsProvider } from "./openai-embeddings";

/**
 * Production factory: Anthropic completions + OpenAI embeddings, keys from env
 * (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, resolved from Key Vault in deployed
 * environments). Construct lazily at the call site — importing this module
 * never requires keys.
 */
export function createDefaultGateway(
  options: Omit<AiGatewayOptions, "provider" | "embeddings"> = {},
): AiGateway {
  return new AiGateway({
    provider: new AnthropicProvider(),
    embeddings: new OpenAiEmbeddingsProvider(),
    ...options,
  });
}
