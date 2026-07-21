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
import { VOICE_FALLBACK_LINE, VOICE_FAILURE_GOODBYE, VOICE_REENGAGE_LINE } from "@clientforce/channels";
import { CallSession, type CallSessionDeps } from "../src/session";
import type { TtsStream, TtsStreamDeps } from "../src/deepgram-tts-stream";
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
    ackAfterMs: 0,
    ackClips: [],
    stallAbandonMs: 0,
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
  it("start() speaks the disclosure before any COMPOSED turn (the warm-up primer is not one)", async () => {
    const systemsSeen: string[] = [];
    const provider: CompletionProvider = {
      completeText: async () => {
        throw new Error("not used");
      },
      completeTool: async () => {
        throw new Error("not used");
      },
      streamText: async function* (p: StreamParams): AsyncIterable<StreamEvent> {
        systemsSeen.push(p.system ?? "");
        yield { type: "done", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const s = makeSession({ provider });
    s.session.start();
    await vi.waitFor(() => expect(s.counter.spoken.length).toBeGreaterThan(0));
    expect(s.counter.spoken[0]).toContain("Hi, this is an AI assistant calling on behalf of Acme.");
    // The connection warm-up may run (fixed primer prompt, never the call's
    // system prompt) — but NO composed turn exists before the disclosure.
    expect(systemsSeen.filter((sys) => sys === "SYSTEM")).toHaveLength(0);
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

describe("stall-abandon — never resume speech over the caller", () => {
  it("a reply with no audio progress past stallAbandonMs yields the floor", async () => {
    // The provider stalls 600ms before its first token — past the 200ms
    // abandon bound, the turn is cut and marked stalled (not a barge-in).
    const s = makeSession({
      provider: slowProvider("This reply arrives far too late to speak.", 600),
      stallAbandonMs: 200,
    });
    s.metrics.markCallStart();
    await s.session.driveTurn("are you still there");
    const m = s.metrics.turns[0]!;
    expect(m.stalled).toBe(true);
    expect(m.bargedIn).toBe(false);
    expect(m.ttfaMs).toBeUndefined(); // it never spoke — no TTFA sample
    expect(s.metrics.report().stalledTurns).toBe(1);
    const last = s.session.transcript().at(-1)!;
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("[stalled]");
  });

  it("a healthy reply is never cut by the watchdog", async () => {
    const s = makeSession({
      provider: slowProvider("Quick. Reply.", 5),
      stallAbandonMs: 500,
    });
    s.metrics.markCallStart();
    await s.session.driveTurn("hi");
    expect(s.metrics.turns[0]!.stalled).toBeUndefined();
    expect(s.metrics.turns[0]!.roundTripMs).toBeGreaterThanOrEqual(0);
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

describe("DEC-092 — streaming TTS transport (hot socket per call)", () => {
  const fakeStream = (opts: { failSpeak?: boolean } = {}) => {
    const state = { spoken: [] as string[], cleared: 0, closed: 0 };
    const make = (deps: TtsStreamDeps) =>
      ({
        get alive() {
          return !opts.failSpeak;
        },
        speak: async (text: string) => {
          if (opts.failSpeak) throw new Error("stream transport down");
          state.spoken.push(text);
          for (let i = 0; i < 3; i++) {
            await sleep(5);
            deps.onAudio(Buffer.alloc(160, 0x7f));
          }
          return { firstAudioMs: 5, flushedMs: 15 };
        },
        clear: () => {
          state.cleared++;
        },
        close: () => {
          state.closed++;
        },
      }) as unknown as TtsStream;
    return { state, make };
  };

  it("replies speak through the stream — one speak per sentence, audio forwarded, https carries only the disclosure", async () => {
    const fake = fakeStream();
    const s = makeSession({ ttsTransport: "stream", openTtsStream: fake.make });
    s.metrics.markCallStart();
    await s.session.driveTurn("hi");
    expect(fake.state.spoken.length).toBeGreaterThan(0);
    for (const replySentence of fake.state.spoken) {
      expect(s.counter.spoken).not.toContain(replySentence);
    }
    expect(s.metrics.ttsTransportUsed).toBe("stream");
    expect(s.metrics.ttsSentenceStats().n).toBeGreaterThan(0);
    expect(s.metrics.turns[0]!.ttfaMs).toBeGreaterThanOrEqual(0);
    s.session.close();
    expect(fake.state.closed).toBeGreaterThan(0);
  });

  it("stream death falls back to https mid-call — never a dead line, honestly labeled", async () => {
    const fake = fakeStream({ failSpeak: true });
    const s = makeSession({ ttsTransport: "stream", openTtsStream: fake.make });
    s.metrics.markCallStart();
    await s.session.driveTurn("hi");
    expect(s.metrics.turns[0]!.ttfaMs).toBeGreaterThanOrEqual(0);
    expect(s.counter.spoken.length).toBeGreaterThan(0); // the reply reached https synthesis
    expect(s.metrics.ttsTransportUsed).toBe("stream→https");
    s.session.close();
  });

  it("barge-in clears the stream's server-side buffer too", async () => {
    const state = { cleared: 0 };
    const make = (deps: TtsStreamDeps) =>
      ({
        alive: true,
        speak: async (_text: string) => {
          for (let i = 0; i < 12; i++) {
            await sleep(10); // slow in-flight speak so the barge lands mid-sentence
            deps.onAudio(Buffer.alloc(160, 0x7f));
          }
          return { firstAudioMs: 10, flushedMs: 120 };
        },
        clear: () => {
          state.cleared++;
        },
        close: () => {},
      }) as unknown as TtsStream;
    const s = makeSession({
      ttsTransport: "stream",
      openTtsStream: make,
      provider: slowProvider("First bit done. And then it keeps going and going", 10),
    });
    s.metrics.markCallStart();
    await s.session.driveTurn("tell me everything", 80);
    expect(state.cleared).toBeGreaterThan(0);
    expect(s.metrics.bargeIns).toHaveLength(1);
  });
});

describe("DEC-092 owner-approved fixes — never silence", () => {
  it("(a) an EMPTY completion speaks the locked fallback — audible, call continues", async () => {
    const provider: CompletionProvider = {
      completeText: async () => {
        throw new Error("not used");
      },
      completeTool: async () => {
        throw new Error("not used");
      },
      // eslint-disable-next-line require-yield
      streamText: async function* (): AsyncIterable<StreamEvent> {
        yield { type: "done", usage: { inputTokens: 5, outputTokens: 0 } };
      },
    };
    const s = makeSession({ provider });
    s.metrics.markCallStart();
    await s.session.driveTurn("hello?");
    expect(s.counter.spoken).toContain(VOICE_FALLBACK_LINE);
    expect(s.metrics.turns[0]!.emptyReply).toBe(true);
    expect(s.metrics.turns[0]!.ttfaMs).toBeGreaterThanOrEqual(0);
    expect(s.ends).toHaveLength(0); // the call continues — never a hung line
    const assistant = s.session.transcript().filter((t) => t.role === "assistant");
    expect(assistant.at(-1)!.content).toBe(VOICE_FALLBACK_LINE);
  });

  it("(b) mutual silence fires the one-shot re-engage; caller speech refreshes the base; never twice", async () => {
    const s = makeSession({ reengageAfterMs: 250 });
    s.metrics.markCallStart();
    s.session.start();
    await vi.waitFor(() => expect(s.metrics.disclosureCompleted).toBe(true));
    s.session.testHooks.speechStarted(); // caller activity — base refreshes
    await sleep(120);
    expect(s.counter.spoken).not.toContain(VOICE_REENGAGE_LINE);
    await vi.waitFor(() => expect(s.counter.spoken).toContain(VOICE_REENGAGE_LINE), {
      timeout: 2500,
    });
    expect(s.metrics.reengagedAtMs).toBeGreaterThan(0);
    const fired = s.counter.spoken.filter((t) => t === VOICE_REENGAGE_LINE).length;
    expect(fired).toBe(1);
    await sleep(900); // several more ticks — the one-shot never repeats
    expect(s.counter.spoken.filter((t) => t === VOICE_REENGAGE_LINE).length).toBe(1);
    s.session.close();
  });
});

describe("DEC-092 start-window wave — the disclosure rides the stream transport", () => {
  it("disclosure sentences speak through the hot stream; https untouched; interruptible; completion recorded", async () => {
    const state = { spoken: [] as string[] };
    const make = (deps: TtsStreamDeps) =>
      ({
        alive: true,
        speak: async (text: string) => {
          state.spoken.push(text);
          await sleep(5);
          deps.onAudio(Buffer.alloc(160, 0x7f));
          return { firstAudioMs: 5, flushedMs: 10 };
        },
        clear: () => {},
        close: () => {},
      }) as unknown as TtsStream;
    const s = makeSession({ ttsTransport: "stream", openTtsStream: make });
    s.metrics.markCallStart();
    s.session.start();
    await vi.waitFor(() => expect(s.metrics.disclosureCompleted).toBe(true));
    expect(state.spoken.join(" ")).toContain("Hi, this is an AI assistant calling on behalf of Acme.");
    expect(s.counter.spoken).toHaveLength(0); // https path never used
    expect(s.metrics.ttsTransportUsed).toBe("stream");
    s.session.close();
  });

  it("stream death on the disclosure falls back to https — the disclosure still plays", async () => {
    const make = () =>
      ({
        alive: false,
        speak: async () => {
          throw new Error("stream down at start");
        },
        clear: () => {},
        close: () => {},
      }) as unknown as TtsStream;
    const s = makeSession({ ttsTransport: "stream", openTtsStream: make });
    s.metrics.markCallStart();
    s.session.start();
    await vi.waitFor(() => expect(s.metrics.disclosureCompleted).toBe(true));
    expect(s.counter.spoken.join(" ")).toContain("Hi, this is an AI assistant calling on behalf of Acme.");
    expect(s.metrics.ttsTransportUsed).toBe("stream→https");
    s.session.close();
  });
});
