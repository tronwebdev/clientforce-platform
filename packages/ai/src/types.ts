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
  /**
   * G1 (DEC-070): stable-per-caller context appended as a SECOND system block
   * with provider prompt caching (`cache_control: ephemeral`) — a fan-out of
   * calls sharing the same system + context reuses the cached prefix. Keep
   * per-call material in `prompt`, never here. Ignored by providers without
   * caching (test fakes).
   */
  cachedContext?: string;
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

/**
 * SPEC A (DEC-094): structured turn content, so a tool round trip can be
 * replayed back to the model. A plain `string` stays legal everywhere and is
 * what every pre-DEC-094 caller passes — the tool path is purely additive.
 */
export type VoiceContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

/** One turn of a live call transcript, oldest first. */
export interface VoiceTurn {
  role: "user" | "assistant";
  content: string | VoiceContentBlock[];
}

/** A tool the voice brain may call mid-turn (SPEC A, DEC-094). */
export interface VoiceTool {
  name: string;
  description: string;
  /** JSON Schema for the tool input (derived from a zod schema by the caller). */
  inputSchema: Record<string, unknown>;
}

/**
 * What a tool-enabled voice stream yields. `streamVoice` (text-only) stays the
 * default surface; callers that pass tools use `streamVoiceEvents` and handle
 * both variants.
 */
export type VoiceStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface StreamVoiceRequest {
  system?: string;
  /** Full call transcript so far; must start with a user turn. */
  turns: VoiceTurn[];
  maxTokens?: number;
  temperature?: number;
  /** Barge-in: aborting this signal cancels the in-flight generation. */
  signal?: AbortSignal;
  /** SPEC A: tools the model may call this turn. Absent ⇒ the pre-DEC-094
   *  request is sent verbatim, so a tool-free call is byte-identical. */
  tools?: VoiceTool[];
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
  /** `aborted` = the caller cancelled a voice stream (barge-in / stall-abandon /
   *  teardown) mid-flight — expected behavior, distinct from a provider error
   *  so demo/cert logs never read a yielded turn as a failure. */
  outcome: "ok" | "error" | "aborted";
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
