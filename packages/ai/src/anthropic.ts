import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { AiProviderError } from "./types";
import type {
  CompletionProvider,
  StreamEvent,
  StreamParams,
  TextParams,
  TextResult,
  ToolParams,
  ToolResult,
} from "./provider";

/**
 * The ONLY place in the monorepo that touches the Anthropic SDK — enforced by
 * the root eslint `no-restricted-imports` rule (P1.1 acceptance #3).
 */
export class AnthropicProvider implements CompletionProvider {
  private readonly client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) {
      throw new AiProviderError(
        "ANTHROPIC_API_KEY is not set. In deployed environments it resolves from Key Vault secret ANTHROPIC-API-KEY.",
        undefined,
        false,
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async completeText(params: TextParams): Promise<TextResult> {
    const res = await this.request(params, undefined);
    const text = res.content
      .filter(
        (b): b is Extract<(typeof res.content)[number], { type: "text" }> => b.type === "text",
      )
      .map((b) => b.text)
      .join("");
    return {
      text,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }

  async completeTool(params: ToolParams): Promise<ToolResult> {
    const res = await this.request(params, {
      tools: [
        {
          name: params.toolName,
          description: params.toolDescription,
          input_schema: params.inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: params.toolName },
    });
    const toolUse = res.content.find(
      (b): b is Extract<(typeof res.content)[number], { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    if (!toolUse) {
      // tool_choice forces a call; treat its absence as a malformed (retryable-by-repair) reply.
      throw new AiProviderError(
        "Model returned no tool_use block despite forced tool_choice",
        undefined,
        false,
      );
    }
    return {
      input: toolUse.input,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }

  /**
   * Streaming multi-turn completion — the gateway's `voice` route (P3.0).
   *
   * SPEC A (DEC-099): when `tools` is present the model may open a `tool_use`
   * block, whose JSON arguments arrive as a delta stream and are only complete
   * at `content_block_stop`. Text deltas keep flowing exactly as before — a
   * model that speaks a sentence and THEN calls a tool gets that sentence to
   * the caller's ear immediately, which is the whole latency story.
   */
  async *streamText(params: StreamParams): AsyncIterable<StreamEvent> {
    const usage = { inputTokens: 0, outputTokens: 0 };
    /** Partial tool_use blocks by stream index, accumulating their JSON. */
    const pending = new Map<number, { id: string; name: string; json: string }>();
    try {
      const stream = await this.client.messages.create(
        {
          model: params.model,
          max_tokens: params.maxTokens,
          ...(params.system ? { system: params.system } : {}),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          messages: params.turns.map((t) => ({
            role: t.role,
            content: t.content as Anthropic.MessageParam["content"],
          })),
          // Omitted entirely when absent — a tool-free request is unchanged.
          ...(params.tools?.length
            ? {
                tools: params.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
                })),
              }
            : {}),
          stream: true,
        },
        { signal: params.signal },
      );
      for await (const event of stream) {
        if (event.type === "message_start") {
          usage.inputTokens = event.message.usage.input_tokens;
        } else if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          pending.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            json: "",
          });
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "input_json_delta"
        ) {
          const block = pending.get(event.index);
          if (block) block.json += event.delta.partial_json;
        } else if (event.type === "content_block_stop") {
          const block = pending.get(event.index);
          if (block) {
            pending.delete(event.index);
            // An empty argument stream is a zero-arg call, not malformed JSON.
            let input: unknown = {};
            try {
              if (block.json.trim()) input = JSON.parse(block.json);
            } catch {
              // Unparsable arguments are the model's error, not the transport's.
              // Surface the call with empty input and let the tool's own schema
              // validation produce the typed refusal — never crash the turn.
              input = {};
            }
            yield { type: "tool_use", id: block.id, name: block.name, input };
          }
        } else if (event.type === "message_delta") {
          usage.outputTokens = event.usage.output_tokens;
        }
      }
    } catch (err) {
      throw toProviderError(err);
    }
    yield { type: "done", usage };
  }

  private async request(
    params: TextParams | ToolParams,
    toolFields: Pick<Anthropic.MessageCreateParams, "tools" | "tool_choice"> | undefined,
  ): Promise<Anthropic.Message> {
    try {
      return await this.client.messages.create(
        {
          model: params.model,
          max_tokens: params.maxTokens,
          ...systemBlocks(params),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          messages: [{ role: "user", content: params.prompt }],
          ...(toolFields ?? {}),
        },
        { signal: params.signal },
      );
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

/**
 * G1 (DEC-070): when a cacheable context rides the call, `system` becomes an
 * ordered block array — the static prompt first, the per-caller-stable context
 * second with `cache_control` — so a fan-out over the same agent reuses the
 * cached prefix and only the per-lead user turn is new tokens.
 */
function systemBlocks(
  params: Pick<TextParams, "system" | "cachedContext">,
): Pick<Anthropic.MessageCreateParams, "system"> | Record<string, never> {
  if (params.cachedContext) {
    return {
      system: [
        ...(params.system ? [{ type: "text" as const, text: params.system }] : []),
        {
          type: "text" as const,
          text: params.cachedContext,
          cache_control: { type: "ephemeral" as const },
        },
      ],
    };
  }
  return params.system ? { system: params.system } : {};
}

/** Map SDK failures onto the gateway's typed, retryability-aware error. */
function toProviderError(err: unknown): AiProviderError {
  if (err instanceof APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    const retryable = status === 429 || status === 408 || (status !== undefined && status >= 500);
    const retryAfterHeader = err.headers?.["retry-after"];
    const retryAfterSec = retryAfterHeader ? Number.parseFloat(String(retryAfterHeader)) : NaN;
    return new AiProviderError(
      `Anthropic API error${status ? ` (${status})` : ""}: ${err.message}`,
      status,
      retryable,
      Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : undefined,
    );
  }
  if (err instanceof AiProviderError) return err;
  // Connection resets etc. from the SDK arrive as generic errors — retryable.
  return new AiProviderError(err instanceof Error ? err.message : String(err), undefined, true);
}
