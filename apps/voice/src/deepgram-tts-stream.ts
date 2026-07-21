/**
 * Streaming Aura TTS over ONE persistent websocket per call (DEC-092, owner
 * fix ruling 2026-07-21). The measured cause of the audible start-stop was
 * the per-sentence HTTPS round-trip (connect + TTFB between every sentence);
 * here each sentence is a `Speak` + `Flush` on a hot socket — the
 * inter-sentence cost collapses to one flush round-trip and audio arrives as
 * one continuous ordered stream. Same vendor, same mulaw/8k passthrough, no
 * new adapter certification.
 *
 * Contract with the session:
 * - `speak(text)` resolves when the sentence's audio has fully arrived
 *   (`Flushed`) — ordering and per-sentence pre-TTS checks stay intact.
 * - `clear()` (barge-in) drops server-side buffered audio; in-flight speaks
 *   reject with `TtsStreamCleared` so the turn unwinds like an abort.
 * - Any transport failure rejects in-flight speaks and marks the stream
 *   dead — the session falls back to the proven HTTPS path (never a dead
 *   line; the fallback is logged and visible in the metrics summary).
 */
import WebSocket from "ws";

export class TtsStreamCleared extends Error {
  constructor() {
    super("tts stream cleared (barge-in)");
    this.name = "TtsStreamCleared";
  }
}

export interface TtsStreamDeps {
  apiKey: string;
  ttsModel: string;
  /** Ordered audio chunks for the CURRENT speak in flight. */
  onAudio: (chunk: Buffer) => void;
  /** Overridable for tests (ws://localhost) — defaults to Deepgram. */
  baseUrl?: string;
}

export interface TtsSentenceTiming {
  /** speak() → first audio byte, ms. */
  firstAudioMs: number;
  /** speak() → Flushed (audio fully delivered), ms. */
  flushedMs: number;
}

interface InFlight {
  resolve: (t: TtsSentenceTiming) => void;
  reject: (err: Error) => void;
  startedAt: number;
  firstAudioAt?: number;
}

export function ttsStreamUrl(baseUrl: string, ttsModel: string): string {
  const q = new URLSearchParams({
    model: ttsModel,
    encoding: "mulaw",
    sample_rate: "8000",
    container: "none",
  });
  return `${baseUrl}/v1/speak?${q.toString()}`;
}

export class TtsStream {
  private ws: WebSocket;
  private opened: Promise<void>;
  private queue: InFlight[] = [];
  private deadErr: Error | undefined;
  private closedByUs = false;

  constructor(private readonly deps: TtsStreamDeps) {
    const url = ttsStreamUrl(deps.baseUrl ?? "wss://api.deepgram.com", deps.ttsModel);
    this.ws = new WebSocket(url, { headers: { Authorization: `Token ${deps.apiKey}` } });
    this.opened = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
    });
    // Settled handler so an early error never surfaces as unhandled.
    this.opened.catch(() => {});
    this.ws.on("message", (data: Buffer, isBinary: boolean) => this.onMessage(data, isBinary));
    this.ws.on("error", (err) => this.die(err instanceof Error ? err : new Error(String(err))));
    this.ws.on("close", (code, reason) => {
      if (!this.closedByUs) this.die(new Error(`tts ws closed ${code} ${String(reason).slice(0, 120)}`));
    });
  }

  get alive(): boolean {
    return this.deadErr === undefined && !this.closedByUs;
  }

  /** Speak one (pre-checked) sentence; resolves when its audio is delivered. */
  async speak(text: string): Promise<TtsSentenceTiming> {
    if (this.deadErr) throw this.deadErr;
    await this.opened;
    if (this.deadErr) throw this.deadErr;
    return new Promise<TtsSentenceTiming>((resolve, reject) => {
      this.queue.push({ resolve, reject, startedAt: Date.now() });
      try {
        this.ws.send(JSON.stringify({ type: "Speak", text }));
        this.ws.send(JSON.stringify({ type: "Flush" }));
      } catch (err) {
        this.die(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Barge-in: drop server-side buffered audio + fail in-flight speaks. */
  clear(): void {
    if (!this.alive) return;
    try {
      this.ws.send(JSON.stringify({ type: "Clear" }));
    } catch {
      // dying transport — die() below via error/close handlers
    }
    const cleared = this.queue.splice(0);
    for (const f of cleared) f.reject(new TtsStreamCleared());
  }

  close(): void {
    this.closedByUs = true;
    const err = new Error("tts stream closed");
    for (const f of this.queue.splice(0)) f.reject(err);
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "Close" }));
      this.ws.close();
    } catch {
      // teardown only
    }
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    const head = this.queue[0];
    if (isBinary) {
      if (head && head.firstAudioAt === undefined) head.firstAudioAt = Date.now();
      if (data.length > 0) this.deps.onAudio(data);
      return;
    }
    let msg: { type?: string };
    try {
      msg = JSON.parse(String(data)) as { type?: string };
    } catch {
      return;
    }
    if (msg.type === "Flushed") {
      const done = this.queue.shift();
      if (done) {
        const now = Date.now();
        done.resolve({
          firstAudioMs: (done.firstAudioAt ?? now) - done.startedAt,
          flushedMs: now - done.startedAt,
        });
      }
    } else if (msg.type === "Error") {
      this.die(new Error(`tts ws error frame: ${JSON.stringify(msg).slice(0, 200)}`));
    }
    // Metadata / Cleared / Warning frames are informational.
  }

  private die(err: Error): void {
    if (this.deadErr || this.closedByUs) return;
    this.deadErr = err;
    for (const f of this.queue.splice(0)) f.reject(err);
    try {
      this.ws.close();
    } catch {
      // already gone
    }
  }
}
