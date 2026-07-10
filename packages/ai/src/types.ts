import type { ZodIssue } from "zod";

/**
 * The AI tasks the platform performs. Routing (which model serves which task)
 * is config-driven — see `config.ts`. Later phases extend this union (voice
 * brain, widget chat) without changing the gateway interface.
 */
export type AiTask = "planner" | "copy" | "classify" | "voice";

export interface CompleteRequest {
  /** System prompt (optional). */
  system?: string;
  /** User prompt. Use the prompt registry to render versioned templates. */
  prompt: string;
  /** Override the task's default max output tokens. */
  maxTokens?: number;
  /** Sampling temperature; provider default when omitted. */
  temperature?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// ── Voice streaming (P3.0 spike — `voice` is the only streaming route) ───────

/** One turn of a live call transcript, oldest first. */
export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

export interface StreamVoiceRequest {
  system?: string;
  /** Full call transcript so far; must start with a user turn. */
  turns: VoiceTurn[];
  maxTokens?: number;
  temperature?: number;
  /** Barge-in: aborting this signal cancels the in-flight generation. */
  signal?: AbortSignal;
}

/** One structured record per provider call, emitted through `onUsage`. */
export interface UsageRecord {
  task: AiTask | "embed";
  model: string;
  latencyMs: number;
  usage: TokenUsage;
  /** Estimated cost in USD (logging only — from the config price table). */
  estimatedCostUsd: number;
  retries: number;
  outcome: "ok" | "error";
}

export type UsageHook = (record: UsageRecord) => void;

// ── Error hierarchy ──────────────────────────────────────────────────────────

/** Base class for every error the gateway throws. */
export class AiGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The provider returned an error response (carries retryability). */
export class AiProviderError extends AiGatewayError {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** A request exceeded its timeout budget. */
export class AiTimeoutError extends AiGatewayError {
  constructor(readonly timeoutMs: number) {
    super(`AI request timed out after ${timeoutMs}ms`);
  }
}

/**
 * Structured output failed zod validation even after the bounded repair
 * round-trip. Carries the zod issues + the raw model output so callers can
 * log/inspect — the gateway never returns unvalidated data.
 */
export class StructuredOutputError extends AiGatewayError {
  constructor(
    readonly issues: ZodIssue[],
    readonly rawOutput: unknown,
  ) {
    super(
      `Model output failed schema validation after repair: ${issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
}

/** A prompt template referenced a variable that wasn't supplied. */
export class MissingPromptVarError extends AiGatewayError {
  constructor(
    readonly promptName: string,
    readonly variable: string,
  ) {
    super(`Prompt "${promptName}" is missing variable "${variable}"`);
  }
}
