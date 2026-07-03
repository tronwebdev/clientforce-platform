import type { TokenUsage } from "./types";

/** Parameters for a plain-text completion. */
export interface TextParams {
  model: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  signal: AbortSignal;
}

export interface TextResult {
  text: string;
  usage: TokenUsage;
}

/**
 * Parameters for a forced-tool completion (the structured-output mechanism):
 * the provider MUST make the model call `toolName` and return its arguments.
 */
export interface ToolParams {
  model: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  toolName: string;
  toolDescription: string;
  /** JSON Schema for the tool input (derived from the caller's zod schema). */
  inputSchema: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ToolResult {
  /** The tool-call arguments as the model produced them (unvalidated). */
  input: unknown;
  usage: TokenUsage;
}

/**
 * The seam the gateway talks through. Production = `AnthropicProvider`;
 * tests inject a mock — no network in CI, ever.
 */
export interface CompletionProvider {
  completeText(params: TextParams): Promise<TextResult>;
  completeTool(params: ToolParams): Promise<ToolResult>;
}

export interface EmbeddingsProvider {
  /** Returns one vector per input text, in order, at exactly `dimensions`. */
  embed(
    texts: string[],
    model: string,
    dimensions: number,
    signal: AbortSignal,
  ): Promise<{ vectors: number[][]; usage: TokenUsage }>;
}
