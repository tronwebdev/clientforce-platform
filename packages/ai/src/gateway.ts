import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { estimateCostUsd, loadConfig, type AiConfig } from "./config";
import type { CompletionProvider, EmbeddingsProvider } from "./provider";
import {
  AiProviderError,
  AiTimeoutError,
  StructuredOutputError,
  type AiTask,
  type CompleteRequest,
  type TokenUsage,
  type UsageHook,
} from "./types";

export interface AiGatewayOptions {
  provider: CompletionProvider;
  embeddings?: EmbeddingsProvider;
  config?: Partial<AiConfig>;
  /** Structured per-call usage records; defaults to a compact console line. */
  onUsage?: UsageHook;
}

/**
 * zod → JSON Schema for the forced tool's input. Cast through `unknown`
 * deliberately: instantiating zodToJsonSchema's conditional return type
 * against a caller-supplied generic blows TS's recursion limit (TS2589);
 * the output is provider-bound JSON either way.
 */
const toJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> =>
  (zodToJsonSchema as unknown as (s: z.ZodTypeAny, o: object) => Record<string, unknown>)(schema, {
    $refStrategy: "none", // inline everything — providers want self-contained input_schema
  });

const defaultUsageHook: UsageHook = (r) => {
  // Structured single-line log — swappable for OTel later via the hook.
  console.log(
    `[ai] task=${r.task} model=${r.model} in=${r.usage.inputTokens} out=${r.usage.outputTokens} ` +
      `cost=$${r.estimatedCostUsd.toFixed(6)} latencyMs=${r.latencyMs} retries=${r.retries} outcome=${r.outcome}`,
  );
};

/**
 * The single chokepoint for model access (P1.1). Routing, retries, timeouts,
 * schema enforcement, and cost accounting all live here — callers get typed
 * results or typed errors, nothing in between.
 */
export class AiGateway {
  private readonly provider: CompletionProvider;
  private readonly embeddings?: EmbeddingsProvider;
  private readonly config: AiConfig;
  private readonly onUsage: UsageHook;

  constructor(options: AiGatewayOptions) {
    this.provider = options.provider;
    this.embeddings = options.embeddings;
    this.config = loadConfig(options.config);
    this.onUsage = options.onUsage ?? defaultUsageHook;
  }

  /** Plain text completion, routed per task. */
  async complete(task: AiTask, request: CompleteRequest): Promise<string> {
    const model = this.config.models[task];
    const { value } = await this.instrumented(task, model, (signal, attemptUsage) =>
      this.provider
        .completeText({
          model,
          system: request.system,
          prompt: request.prompt,
          maxTokens: request.maxTokens ?? this.config.maxTokens[task],
          temperature: request.temperature,
          signal,
        })
        .then((r) => {
          attemptUsage(r.usage);
          return r.text;
        }),
    );
    return value;
  }

  /**
   * Structured completion: forced tool-use against a JSON Schema derived from
   * `schema`, then zod-validated. On validation failure, ONE bounded repair
   * round-trip (the model sees its own output + the zod issues); if that still
   * fails, throws `StructuredOutputError`. Never returns unvalidated data.
   */
  async completeStructured<S extends z.ZodTypeAny>(
    task: AiTask,
    request: CompleteRequest,
    schema: S,
  ): Promise<z.infer<S>> {
    const model = this.config.models[task];
    const inputSchema = toJsonSchema(schema);
    const toolParams = {
      model,
      system: request.system,
      maxTokens: request.maxTokens ?? this.config.maxTokens[task],
      temperature: request.temperature,
      toolName: "emit_result",
      toolDescription: "Emit the final result in exactly the required schema.",
      inputSchema,
    };

    const first = await this.instrumented(task, model, (signal, attemptUsage) =>
      this.provider.completeTool({ ...toolParams, prompt: request.prompt, signal }).then((r) => {
        attemptUsage(r.usage);
        return r.input;
      }),
    );
    const parsed = schema.safeParse(first.value);
    if (parsed.success) return parsed.data;

    // Repair path: one corrective round-trip, still forced tool-use.
    const repairPrompt =
      `${request.prompt}\n\n---\nYour previous attempt produced arguments that FAILED schema validation.\n` +
      `Previous arguments (JSON):\n${JSON.stringify(first.value)}\n` +
      `Validation errors:\n${parsed.error.issues
        .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n")}\n` +
      `Call ${toolParams.toolName} again with corrected arguments that satisfy the schema exactly.`;
    const repaired = await this.instrumented(task, model, (signal, attemptUsage) =>
      this.provider.completeTool({ ...toolParams, prompt: repairPrompt, signal }).then((r) => {
        attemptUsage(r.usage);
        return r.input;
      }),
    );
    const reparsed = schema.safeParse(repaired.value);
    if (reparsed.success) return reparsed.data;
    throw new StructuredOutputError(reparsed.error.issues, repaired.value);
  }

  /** Embeddings at the pinned model + dimensions (1536 → hnsw-indexable). */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.embeddings) {
      throw new AiProviderError(
        "No embeddings provider configured on this gateway",
        undefined,
        false,
      );
    }
    const { embeddingModel, embeddingDimensions } = this.config;
    const { value } = await this.instrumented("embed", embeddingModel, (signal, attemptUsage) =>
      this.embeddings!.embed(texts, embeddingModel, embeddingDimensions, signal).then((r) => {
        attemptUsage(r.usage);
        return r.vectors;
      }),
    );
    return value;
  }

  // ── Retry / timeout / usage instrumentation ───────────────────────────────

  private async instrumented<T>(
    task: AiTask | "embed",
    model: string,
    attempt: (signal: AbortSignal, attemptUsage: (u: TokenUsage) => void) => Promise<T>,
  ): Promise<{ value: T }> {
    const started = Date.now();
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const record = (retries: number, outcome: "ok" | "error") =>
      this.onUsage({
        task,
        model,
        latencyMs: Date.now() - started,
        usage,
        estimatedCostUsd: estimateCostUsd(this.config, model, usage),
        retries,
        outcome,
      });

    let lastError: unknown;
    for (let attemptNo = 0; attemptNo <= this.config.maxRetries; attemptNo++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const value = await attempt(controller.signal, (u) => {
          usage.inputTokens += u.inputTokens;
          usage.outputTokens += u.outputTokens;
        });
        clearTimeout(timer);
        record(attemptNo, "ok");
        return { value };
      } catch (err) {
        clearTimeout(timer);
        lastError = controller.signal.aborted ? new AiTimeoutError(this.config.timeoutMs) : err;
        const retryable =
          lastError instanceof AiTimeoutError ||
          (lastError instanceof AiProviderError && lastError.retryable);
        if (!retryable || attemptNo === this.config.maxRetries) {
          record(attemptNo, "error");
          throw lastError;
        }
        const retryAfter =
          lastError instanceof AiProviderError ? lastError.retryAfterMs : undefined;
        await sleep(retryAfter ?? backoffMs(this.config.backoffBaseMs, attemptNo));
      }
    }
    /* istanbul ignore next -- loop always returns or throws */
    throw lastError;
  }
}

const backoffMs = (base: number, attemptNo: number): number =>
  base * 2 ** attemptNo + Math.floor(Math.random() * base);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
