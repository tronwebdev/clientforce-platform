/**
 * CallSession (P3.1) — the production session against fake providers (no
 * network, ever): the barge-in regression ported from the spike (clear +
 * abort + no round-trip on a cut turn), disclosure-first ordering, the
 * per-sentence check → constant fallback + typed refusal path, latency-mask
 * ack behavior, and the provider-failure goodbye (never a hung line).
 */
import { describe, expect, it, vi } from "vitest";
import { AiGateway } from "@clientforce/ai";
import type { CompletionProvider, StreamEvent, StreamParams } from "@clientforce/ai";
import { VOICE_FALLBACK_LINE, VOICE_FAILURE_GOODBYE } from "@clientforce/channels";
import { CallSession, type CallSessionDeps } from "../src/session";
import { MetricsCollector } from "../src/metrics";
import type { Synthesize } from "../src/deepgram";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Streams words with a delay so a mid-reply barge-in can land. */
function slowProvider(reply: string, perWordMs = 25): CompletionProvider {
  return {
    completeText: async () => {
      throw new Error("not used");
    },
    completeTool: async () => {
      throw new Error("not used");
    },
    streamText: async function* (p: StreamParams): AsyncIterable<StreamEvent> {
      for (const word of reply.split(" ")) {
        if (p.signal.aborted) return;
        await sleep(perWordMs);
        if (p.signal.aborted) return;
        yield { type: "delta", text: `${word} ` };
      }
      yield { type: "done", usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

function failingProvider(): CompletionProvider {
  return {
    completeText: async () => {
      throw new Error("not used");
    },
    completeTool: async () => {
      throw new Error("not used");
    },
    // eslint-disable-next-line require-yield
    streamText: async function* (): AsyncIterable<StreamEvent> {
      throw new Error("provider exploded");
    },
  };
}

const countingSynthesize = (counter: { frames: number; spoken: string[] }): Synthesize =>
  async function* (_key, _model, text, signal) {
    counter.spoken.push(text);
    const frames = Math.max(1, Math.ceil(text.length / 4));
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) return;
      await sleep(8);
      if (signal.aborted) return;
      counter.frames++;
      yield Buffer.alloc(160, 0xff);
    }
  };

function makeSession(over: Partial<CallSessionDeps> & { provider?: CompletionProvider } = {}) {
  const metrics = new MetricsCollector();
  const counter = { frames: 0, spoken: [] as string[] };
  const audio: Buffer[] = [];
  let clears = 0;
  const refusals: Array<{ turn: number; reason: string }> = [];
  const ends: string[] = [];
  const { provider, ...deps } = over;
  const session = new CallSession({
    gateway: new AiGateway({ provider: provider ?? slowProvider("Short reply."), onUsage: () => {} }),
    metrics,
    deepgramKey: "fake",
    ttsModel: "aura-2-thalia-en",
    systemPrompt: "SYSTEM",
    disclosure: "Hi, this is an AI assistant calling on behalf of Acme. Is now a quick moment?",
    neverSay: ["limited time"],
    sttParams: { model: "nova-2", endpointingMs: 500, utteranceEndMs: 1500, smartFormat: true },
    continuationWindowMs: 900,
    ackAfterMs: 0,
    ackClips: [],
    idleTimeoutMs: 0,
    maxCallMs: 0,
    sendAudio: (b) => audio.push(b),
    clearPlayback: () => {
      clears++;
      audio.splice(0);
    },
    onRefusal: (turn, reason) => refusals.push({ turn, reason }),
    onEnd: (reason) => ends.push(reason),
    openStt: () => ({ sendAudio: () => {}, close: () => {} }),
    synthesize: countingSynthesize(counter),
    ...deps,
  });
  return { session, metrics, counter, audio, refusals, ends, clears: () => clears };
}

describe("disclosure — spoken FIRST, a constant, before any composed turn", () => {
  it("start() speaks the disclosure before the brain is ever invoked", async () => {
    const streamCalls: string[] = [];
    const provider: CompletionProvider = {
      completeText: async () => {
        throw new Error("not used");
      },
      completeTool: async () => {
        throw new Error("not used");
      },
      streamText: async function* (): AsyncIterable<StreamEvent> {
        streamCalls.push("brain");
        yield { type: "done", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const s = makeSession({ provider });
    s.session.start();
    await vi.waitFor(() => expect(s.counter.spoken.length).toBeGreaterThan(0));
    expect(s.counter.spoken[0]).toContain("Hi, this is an AI assistant calling on behalf of Acme.");
    expect(streamCalls).toHaveLength(0); // no composed turn yet
    await vi.waitFor(() => expect(s.metrics.disclosureCompleted).toBe(true));
    const transcript = s.session.transcript();
    expect(transcript[0]!.role).toBe("assistant");
    s.session.close();
  });
});

describe("barge-in — ported EXACTLY from the spike (proven 0–3ms live)", () => {
  it("cancels in-flight TTS, sends clear, records the barge-in, no round-trip", async () => {
    const s = makeSession({
      provider: slowProvider("This is a fairly long reply that keeps going and going", 25),
    });
    s.metrics.markCallStart();
    await s.session.driveTurn("tell me everything about the product", 60);

    expect(s.clears()).toBe(1);
    expect(s.metrics.bargeIns).toHaveLength(1);
    expect(s.metrics.turns[0]!.bargedIn).toBe(true);
    // The turn was cut short, so no full round-trip is recorded.
    expect(s.metrics.turns[0]!.roundTripMs).toBeUndefined();
  });

  it("completes a clean turn with no clear and a recorded round trip", async () => {
    const s = makeSession({
      clearPlayback: () => {
        throw new Error("should not clear on a clean turn");
      },
    });
    s.metrics.markCallStart();
    await s.session.driveTurn("hi");
    expect(s.metrics.bargeIns).toHaveLength(0);
    expect(s.metrics.turns[0]!.ttfaMs).toBeGreaterThanOrEqual(0);
    expect(s.metrics.turns[0]!.roundTripMs).toBeGreaterThanOrEqual(0);
    expect(s.counter.frames).toBeGreaterThan(0);
  });
});

describe("per-sentence checks — violation → constant fallback + typed refusal", () => {
  it("a neverSay hit aborts the composed turn and speaks VOICE_FALLBACK_LINE", async () => {
    const s = makeSession({
      provider: slowProvider("This is a limited time offer you cannot miss.", 5),
    });
    s.metrics.markCallStart();
    await s.session.driveTurn("what's the price?");

    expect(s.refusals).toEqual([{ turn: 1, reason: "NEVER_SAY_VIOLATION" }]);
    expect(s.counter.spoken).toContain(VOICE_FALLBACK_LINE);
    expect(s.metrics.turns[0]!.refusalReason).toBe("NEVER_SAY_VIOLATION");
    const assistantTurns = s.session.transcript().filter((t) => t.role === "assistant");
    expect(assistantTurns.at(-1)!.content).toBe(VOICE_FALLBACK_LINE);
    // The banned sentence itself never reached TTS.
    expect(s.counter.spoken.some((t) => t.toLowerCase().includes("limited time"))).toBe(false);
  });
});

describe("latency masking — the ack clip", () => {
  it("plays one pre-rendered clip when the reply outlasts ackAfterMs — never counted as TTFA", async () => {
    const clip = Buffer.alloc(320, 0x7f);
    const s = makeSession({
      provider: slowProvider("Slow reply that takes a while to start speaking.", 40),
      ackAfterMs: 30,
      ackClips: [clip],
    });
    s.metrics.markCallStart();
    await s.session.driveTurn("hello?");
    const m = s.metrics.turns[0]!;
    expect(m.ackAtMs).toBeGreaterThanOrEqual(0);
    expect(m.ttfaMs).toBeGreaterThan(m.ackAtMs!); // reply TTFA measured honestly
    expect(s.audio.some((b) => b.equals(clip))).toBe(true);
  });

  it("no ack when the reply is already speaking", async () => {
    const clip = Buffer.alloc(320, 0x7f);
    const s = makeSession({
      provider: slowProvider("Fast. Reply.", 1),
      ackAfterMs: 5_000,
      ackClips: [clip],
    });
    s.metrics.markCallStart();
    await s.session.driveTurn("hello?");
    expect(s.metrics.turns[0]!.ackAtMs).toBeUndefined();
  });
});

describe("provider failure — never a hung line", () => {
  it("speaks the constant goodbye and ends the call with provider_failure", async () => {
    const s = makeSession({ provider: failingProvider() });
    s.metrics.markCallStart();
    await s.session.driveTurn("hi there");
    await vi.waitFor(() => expect(s.ends).toContain("provider_failure"), { timeout: 5000 });
    expect(s.counter.spoken).toContain(VOICE_FAILURE_GOODBYE);
  });
});
