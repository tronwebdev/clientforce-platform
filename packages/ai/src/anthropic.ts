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

  /** Streaming multi-turn completion — the gateway's `voice` route (P3.0). */
  async *streamText(params: StreamParams): AsyncIterable<StreamEvent> {
    const usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const stream = await this.client.messages.create(
        {
          model: params.model,
          max_tokens: params.maxTokens,
          ...(params.system ? { system: params.system } : {}),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          messages: params.turns.map((t) => ({ role: t.role, content: t.content })),
          stream: true,
        },
        { signal: params.signal },
      );
      for await (const event of stream) {
        if (event.type === "message_start") {
          usage.inputTokens = event.message.usage.input_tokens;
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
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
          ...(params.system ? { system: params.system } : {}),
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
