/**
 * DEC-091 — the streaming Aura TTS transport against a local mock of the
 * Deepgram speak-websocket protocol (Speak/Flush/Clear/Close in, binary
 * audio + Flushed/Cleared out). The live API contract itself is proven by
 * the preflight ws probe; these tests pin OUR client's semantics: ordered
 * delivery, per-sentence resolution at Flushed, barge-in Clear rejection,
 * and transport-death rejection (the session's https-fallback trigger).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { TtsStream, TtsStreamCleared, ttsStreamUrl } from "../src/deepgram-tts-stream";

let wss: WebSocketServer;
let port: number;
let serverBehavior: (ws: WebSocket) => void;

beforeEach(async () => {
  wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", r));
  port = (wss.address() as { port: number }).port;
  wss.on("connection", (ws) => serverBehavior(ws));
});

afterEach(async () => {
  await new Promise<void>((r) => wss.close(() => r()));
});

const audioEcho = (ws: WebSocket): void => {
  let pending: string[] = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as { type: string; text?: string };
    if (msg.type === "Speak") pending.push(msg.text ?? "");
    else if (msg.type === "Flush") {
      for (const text of pending.splice(0)) ws.send(Buffer.from(`mulaw:${text}`));
      ws.send(JSON.stringify({ type: "Flushed" }));
    } else if (msg.type === "Clear") {
      pending = [];
      ws.send(JSON.stringify({ type: "Cleared" }));
    }
  });
};

const open = (onAudio: (chunk: Buffer) => void): TtsStream =>
  new TtsStream({ apiKey: "test", ttsModel: "aura-2-thalia-en", baseUrl: `ws://127.0.0.1:${port}`, onAudio });

describe("ttsStreamUrl", () => {
  it("pins the mulaw/8k containerless query", () => {
    expect(ttsStreamUrl("wss://api.deepgram.com", "aura-2-thalia-en")).toBe(
      "wss://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mulaw&sample_rate=8000&container=none",
    );
  });
});

describe("TtsStream", () => {
  it("speaks sentences in order and resolves each at Flushed with timings", async () => {
    serverBehavior = audioEcho;
    const chunks: string[] = [];
    const s = open((c) => chunks.push(String(c)));
    const t1 = await s.speak("one.");
    const t2 = await s.speak("two.");
    expect(chunks).toEqual(["mulaw:one.", "mulaw:two."]);
    expect(t1.firstAudioMs).toBeGreaterThanOrEqual(0);
    expect(t1.flushedMs).toBeGreaterThanOrEqual(t1.firstAudioMs);
    expect(t2.flushedMs).toBeGreaterThanOrEqual(0);
    s.close();
  });

  it("clear() rejects the in-flight speak with TtsStreamCleared (barge-in)", async () => {
    serverBehavior = (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string };
        if (msg.type === "Clear") ws.send(JSON.stringify({ type: "Cleared" }));
        // Never flush — the speak hangs until cleared, like mid-synthesis.
      });
    };
    const s = open(() => {});
    const speak = s.speak("interrupted sentence");
    await new Promise((r) => setTimeout(r, 50));
    s.clear();
    await expect(speak).rejects.toBeInstanceOf(TtsStreamCleared);
    expect(s.alive).toBe(true); // cleared, not dead — the call continues
    s.close();
  });

  it("transport death rejects in-flight speaks and marks the stream dead", async () => {
    serverBehavior = (ws) => {
      ws.on("message", () => ws.terminate()); // die mid-sentence
    };
    const s = open(() => {});
    await expect(s.speak("doomed")).rejects.toThrow(/closed|error/i);
    expect(s.alive).toBe(false);
    await expect(s.speak("after death")).rejects.toThrow();
  });

  it("connection refusal rejects speak (the session's fallback trigger)", async () => {
    const s = new TtsStream({
      apiKey: "test",
      ttsModel: "aura-2-thalia-en",
      baseUrl: "ws://127.0.0.1:1", // nothing listens
      onAudio: () => {},
    });
    await expect(s.speak("no transport")).rejects.toThrow();
    expect(s.alive).toBe(false);
  });
});
