import { describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import type { CompletionProvider, StreamEvent, StreamParams } from "@clientforce/ai";
import { CallSession } from "../src/call-session";
import { MetricsCollector } from "../src/metrics";
import { SentenceChunker } from "../src/brain";

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

async function* countingSynthesize(
  counter: { frames: number },
  _key: string,
  text: string,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  const frames = Math.max(1, Math.ceil(text.length / 4));
  for (let i = 0; i < frames; i++) {
    if (signal.aborted) return;
    await sleep(8);
    if (signal.aborted) return;
    counter.frames++;
    yield Buffer.alloc(160, 0xff);
  }
}

describe("SentenceChunker", () => {
  it("emits complete sentences as they close, holding partials", () => {
    const c = new SentenceChunker();
    expect(c.push("Hello there")).toEqual([]);
    expect(c.push(". How are ")).toEqual(["Hello there."]);
    expect(c.push("you? Good")).toEqual(["How are you?"]);
    expect(c.flush()).toBe("Good");
  });
});

describe("CallSession barge-in", () => {
  it("cancels in-flight TTS, sends clear, and records a barge-in", async () => {
    const metrics = new MetricsCollector();
    const gateway = new AiGateway({
      provider: slowProvider("This is a fairly long reply that keeps going and going", 25),
      onUsage: () => {},
    });
    let clears = 0;
    const framesCounter = { frames: 0 };
    const session = new CallSession({
      gateway,
      metrics,
      deepgramKey: "fake",
      sendAudio: () => {},
      clearPlayback: () => clears++,
      synthesize: (key, text, signal) => countingSynthesize(framesCounter, key, text, signal),
    });

    metrics.markCallStart();
    await session.driveTurn("tell me everything about the product", 60);

    expect(clears).toBe(1);
    expect(metrics.bargeIns).toHaveLength(1);
    expect(metrics.bargeIns[0].turn).toBe(1);
    expect(metrics.turns[0].bargedIn).toBe(true);
    // The turn was cut short, so no full round-trip is recorded.
    expect(metrics.turns[0].roundTripMs).toBeUndefined();
  });

  it("completes a turn cleanly with no barge-in and records a round trip", async () => {
    const metrics = new MetricsCollector();
    const gateway = new AiGateway({
      provider: slowProvider("Short reply.", 10),
      onUsage: () => {},
    });
    const framesCounter = { frames: 0 };
    const session = new CallSession({
      gateway,
      metrics,
      deepgramKey: "fake",
      sendAudio: () => {},
      clearPlayback: () => {
        throw new Error("should not clear on a clean turn");
      },
      synthesize: (key, text, signal) => countingSynthesize(framesCounter, key, text, signal),
    });

    metrics.markCallStart();
    await session.driveTurn("hi");

    expect(metrics.bargeIns).toHaveLength(0);
    expect(metrics.turns[0].bargedIn).toBe(false);
    expect(metrics.turns[0].ttfaMs).toBeGreaterThanOrEqual(0);
    expect(metrics.turns[0].roundTripMs).toBeGreaterThanOrEqual(0);
    expect(framesCounter.frames).toBeGreaterThan(0);
  });
});
