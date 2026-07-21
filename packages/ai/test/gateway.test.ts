import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiGateway } from "../src/gateway";
import {
  AiProviderError,
  AiTimeoutError,
  StructuredOutputError,
  type UsageRecord,
} from "../src/types";
import type {
  CompletionProvider,
  EmbeddingsProvider,
  StreamParams,
  TextParams,
  ToolParams,
} from "../src/provider";

const usage = { inputTokens: 10, outputTokens: 5 };

/** Config that keeps tests fast and deterministic. */
const fastConfig = { timeoutMs: 200, maxRetries: 2, backoffBaseMs: 1 };

function textProvider(impl: (p: TextParams) => Promise<string>): CompletionProvider {
  return {
    completeText: async (p) => ({ text: await impl(p), usage }),
    completeTool: async () => {
      throw new Error("not used");
    },
  };
}

function toolProvider(impl: (p: ToolParams, call: number) => unknown): CompletionProvider {
  let call = 0;
  return {
    completeText: async () => {
      throw new Error("not used");
    },
    completeTool: async (p) => ({ input: impl(p, call++), usage }),
  };
}

const PlanSchema = z.object({
  subject: z.string(),
  steps: z.array(z.object({ id: z.string(), body: z.string() })).min(1),
});

describe("completeStructured", () => {
  it("returns a typed object that passes its zod schema", async () => {
    const valid = { subject: "hi {{firstName}}", steps: [{ id: "n1", body: "…" }] };
    const gw = new AiGateway({ provider: toolProvider(() => valid), config: fastConfig });
    const result = await gw.completeStructured("planner", { prompt: "plan it" }, PlanSchema);
    expect(result.steps[0].id).toBe("n1");
    // Type-level check: result is inferred, not `unknown`.
    const _subject: string = result.subject;
    expect(_subject).toContain("{{firstName}}");
  });

  it("repairs a malformed reply once, feeding back the zod issues", async () => {
    const prompts: string[] = [];
    const gw = new AiGateway({
      provider: toolProvider((p, call) => {
        prompts.push(p.prompt);
        return call === 0
          ? { subject: 42, steps: [] }
          : { subject: "fixed", steps: [{ id: "n1", body: "b" }] };
      }),
      config: fastConfig,
    });
    const result = await gw.completeStructured("planner", { prompt: "plan it" }, PlanSchema);
    expect(result.subject).toBe("fixed");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("FAILED schema validation");
    expect(prompts[1]).toContain("steps");
  });

  it("rejects with a clear typed error when repair also fails", async () => {
    const gw = new AiGateway({
      provider: toolProvider(() => ({ nope: true })),
      config: fastConfig,
    });
    const err = await gw
      .completeStructured("planner", { prompt: "plan it" }, PlanSchema)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StructuredOutputError);
    const soe = err as StructuredOutputError;
    expect(soe.issues.length).toBeGreaterThan(0);
    expect(soe.rawOutput).toEqual({ nope: true });
    expect(soe.message).toMatch(/failed schema validation/i);
  });

  it("passes a JSON Schema (not a zod object) to the provider", async () => {
    let seen: Record<string, unknown> | undefined;
    const gw = new AiGateway({
      provider: toolProvider((p) => {
        seen = p.inputSchema;
        return { subject: "s", steps: [{ id: "1", body: "b" }] };
      }),
      config: fastConfig,
    });
    await gw.completeStructured("copy", { prompt: "x" }, PlanSchema);
    expect(seen).toMatchObject({ type: "object" });
    expect(JSON.stringify(seen)).toContain('"steps"');
  });
});

describe("model routing", () => {
  it("picks the configured model per task", async () => {
    const models: string[] = [];
    const gw = new AiGateway({
      provider: textProvider(async (p) => {
        models.push(p.model);
        return "ok";
      }),
      config: {
        ...fastConfig,
        models: {
          planner: "opus-test",
          copy: "sonnet-copy",
          classify: "sonnet-classify",
          voice: "haiku-voice",
        },
      },
    });
    await gw.complete("planner", { prompt: "a" });
    await gw.complete("copy", { prompt: "b" });
    await gw.complete("classify", { prompt: "c" });
    expect(models).toEqual(["opus-test", "sonnet-copy", "sonnet-classify"]);
  });

  it("applies per-task max tokens with per-call override", async () => {
    const maxTokens: number[] = [];
    const gw = new AiGateway({
      provider: textProvider(async (p) => {
        maxTokens.push(p.maxTokens);
        return "ok";
      }),
      config: {
        ...fastConfig,
        maxTokens: { planner: 1111, copy: 222, classify: 33, voice: 300 },
      },
    });
    await gw.complete("planner", { prompt: "a" });
    await gw.complete("classify", { prompt: "b", maxTokens: 77 });
    expect(maxTokens).toEqual([1111, 77]);
  });
});

describe("retry / timeout", () => {
  it("retries retryable provider errors with backoff, then succeeds", async () => {
    let calls = 0;
    const gw = new AiGateway({
      provider: textProvider(async () => {
        calls++;
        if (calls < 3) throw new AiProviderError("rate limited", 429, true, 1);
        return "finally";
      }),
      config: fastConfig,
    });
    await expect(gw.complete("copy", { prompt: "x" })).resolves.toBe("finally");
    expect(calls).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    const gw = new AiGateway({
      provider: textProvider(async () => {
        calls++;
        throw new AiProviderError("bad request", 400, false);
      }),
      config: fastConfig,
    });
    await expect(gw.complete("copy", { prompt: "x" })).rejects.toBeInstanceOf(AiProviderError);
    expect(calls).toBe(1);
  });

  it("times out a hung request and reports AiTimeoutError", async () => {
    const gw = new AiGateway({
      provider: {
        completeText: (p) =>
          new Promise((_resolve, reject) => {
            p.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        completeTool: async () => {
          throw new Error("not used");
        },
      },
      config: { ...fastConfig, timeoutMs: 25, maxRetries: 0 },
    });
    await expect(gw.complete("classify", { prompt: "x" })).rejects.toBeInstanceOf(AiTimeoutError);
  });
});

describe("usage logging", () => {
  it("emits a structured record per logical call with accumulated usage", async () => {
    const records: UsageRecord[] = [];
    let calls = 0;
    const gw = new AiGateway({
      provider: textProvider(async () => {
        calls++;
        if (calls === 1) throw new AiProviderError("blip", 500, true);
        return "ok";
      }),
      config: {
        ...fastConfig,
        models: { planner: "m", copy: "m", classify: "m", voice: "m" },
        prices: { m: { input: 1, output: 2 } },
      },
      onUsage: (r) => records.push(r),
    });
    await gw.complete("copy", { prompt: "x" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ task: "copy", model: "m", retries: 1, outcome: "ok" });
    expect(records[0].usage.inputTokens).toBe(10); // only the successful attempt reported usage
    expect(records[0].estimatedCostUsd).toBeCloseTo((10 * 1 + 5 * 2) / 1_000_000);
  });
});

describe("embed", () => {
  const mkEmbeddings = (_dims: number): EmbeddingsProvider => ({
    embed: async (texts, _model, dimensions) => ({
      vectors: texts.map(() => new Array(dimensions).fill(0.1)),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    }),
  });

  it("returns one vector per text at the pinned 1536 dimensions", async () => {
    const gw = new AiGateway({
      provider: textProvider(async () => "unused"),
      embeddings: mkEmbeddings(1536),
      config: fastConfig,
    });
    const vectors = await gw.embed(["a", "b"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(1536);
  });

  it("short-circuits empty input and errors without a provider", async () => {
    const gw = new AiGateway({ provider: textProvider(async () => "unused"), config: fastConfig });
    await expect(gw.embed([])).resolves.toEqual([]);
    await expect(gw.embed(["x"])).rejects.toThrow(/no embeddings provider/i);
  });
});

describe("streamVoice (P3.0 spike route)", () => {
  const streamingProvider = (
    events: Array<{ type: "delta"; text: string } | { type: "done"; usage: typeof usage }>,
    onStart?: (p: StreamParams) => void,
  ): CompletionProvider => ({
    completeText: async () => {
      throw new Error("not used");
    },
    completeTool: async () => {
      throw new Error("not used");
    },
    streamText: async function* (p) {
      onStart?.(p);
      for (const e of events) {
        if (p.signal.aborted) throw new AiProviderError("aborted", undefined, false);
        yield e;
      }
    },
  });

  it("yields deltas in order and records usage once at settle", async () => {
    const records: UsageRecord[] = [];
    const gw = new AiGateway({
      provider: streamingProvider([
        { type: "delta", text: "Hi " },
        { type: "delta", text: "there." },
        { type: "done", usage },
      ]),
      config: fastConfig,
      onUsage: (r) => records.push(r),
    });
    const chunks: string[] = [];
    for await (const c of gw.streamVoice({ turns: [{ role: "user", content: "hello" }] })) {
      chunks.push(c);
    }
    expect(chunks.join("")).toBe("Hi there.");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ task: "voice", retries: 0, outcome: "ok" });
    expect(records[0].usage).toEqual(usage);
  });

  it("routes to the voice model with voice max tokens and passes turns through", async () => {
    let seen: StreamParams | undefined;
    const gw = new AiGateway({
      provider: streamingProvider([{ type: "done", usage }], (p) => (seen = p)),
      config: {
        ...fastConfig,
        models: { planner: "p", copy: "c", classify: "cl", voice: "haiku-voice" },
        maxTokens: { planner: 1, copy: 1, classify: 1, voice: 321 },
      },
    });
    for await (const _ of gw.streamVoice({
      system: "be brief",
      turns: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "book me in" },
      ],
    })) {
      // drain
    }
    expect(seen?.model).toBe("haiku-voice");
    expect(seen?.maxTokens).toBe(321);
    expect(seen?.turns).toHaveLength(3);
    expect(seen?.system).toBe("be brief");
  });

  it("barge-in: aborting the caller signal aborts the provider stream, usage still logged", async () => {
    const records: UsageRecord[] = [];
    const abort = new AbortController();
    const gw = new AiGateway({
      provider: {
        completeText: async () => {
          throw new Error("not used");
        },
        completeTool: async () => {
          throw new Error("not used");
        },
        streamText: async function* (p) {
          yield { type: "delta", text: "one " };
          abort.abort(); // caller barges in mid-stream
          if (p.signal.aborted) throw new AiProviderError("aborted", undefined, false);
          yield { type: "delta", text: "two" };
        },
      },
      config: fastConfig,
      onUsage: (r) => records.push(r),
    });
    const chunks: string[] = [];
    const err = await (async () => {
      try {
        for await (const c of gw.streamVoice({
          turns: [{ role: "user", content: "x" }],
          signal: abort.signal,
        })) {
          chunks.push(c);
        }
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(chunks).toEqual(["one "]);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(records).toHaveLength(1);
    // A caller-driven abort is the session working as designed — the usage
    // record says `aborted`, never `error` (P3.1 deploy: the demo-call log
    // read two barged-in turns as failures).
    expect(records[0]).toMatchObject({ task: "voice", outcome: "aborted" });
  });

  it("a provider failure WITHOUT an abort stays outcome=error", async () => {
    const records: UsageRecord[] = [];
    const gw = new AiGateway({
      provider: {
        completeText: async () => {
          throw new Error("not used");
        },
        completeTool: async () => {
          throw new Error("not used");
        },
        streamText: async function* () {
          yield { type: "delta", text: "one " };
          throw new AiProviderError("socket dropped", undefined, false);
        },
      },
      config: fastConfig,
      onUsage: (r) => records.push(r),
    });
    const err = await (async () => {
      try {
        for await (const _ of gw.streamVoice({ turns: [{ role: "user", content: "x" }] })) {
          // drain
        }
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AiProviderError);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ task: "voice", outcome: "error" });
  });

  it("throws a typed error when the provider cannot stream", async () => {
    const gw = new AiGateway({ provider: textProvider(async () => "unused"), config: fastConfig });
    const iterate = async () => {
      for await (const _ of gw.streamVoice({ turns: [{ role: "user", content: "x" }] })) {
        // never reached
      }
    };
    await expect(iterate()).rejects.toThrow(/does not support streaming/i);
  });
});

describe("config env overrides", () => {
  it("honors AI_MODEL_* env vars", async () => {
    vi.stubEnv("AI_MODEL_PLANNER", "env-opus");
    try {
      const models: string[] = [];
      const gw = new AiGateway({
        provider: textProvider(async (p) => {
          models.push(p.model);
          return "ok";
        }),
        config: fastConfig,
      });
      await gw.complete("planner", { prompt: "x" });
      expect(models).toEqual(["env-opus"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
