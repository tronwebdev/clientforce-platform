/**
 * OutboundPacer (DEC-092 owner finding 2) — just-in-time delivery of outbound
 * μ-law audio to the transport.
 *
 * The streaming TTS transport delivers sentence audio FASTER than realtime,
 * so pushing chunks straight to Twilio runs its playout buffer seconds deep —
 * and audio already inside Twilio survives any moment we fail to `clear`
 * (the owner heard interrupted sentences play to their end). The pacer keeps
 * the un-cancellable window structurally small: audio waits HERE, in a
 * server-side frame queue we can drop instantly, and only ever `leadCapMs`
 * of it is in flight beyond realtime at the transport.
 *
 * Model (no transport feedback needed): `playheadAt` estimates the wall-clock
 * moment the transport's buffer runs dry — each sent frame advances it by the
 * frame's duration from `max(now, playheadAt)`. A frame is sent only while
 * `playheadAt - now < leadCapMs`. Sends happen synchronously on enqueue up to
 * the cap (so short clips behave exactly as before), then on a frame-interval
 * timer. The caller-facing effect of `clearNow()` + a transport `clear` is a
 * tail bounded by `leadCapMs` + network/device — measurable, reported.
 */

/** μ-law/8k: 8 bytes per ms. */
const BYTES_PER_MS = 8;

export interface OutboundPacerDeps {
  /** Deliver one paced frame to the transport. */
  send: (frame: Buffer) => void;
  /** Every wire send — pacing telemetry + audible-progress clocks live here. */
  onWireSend?: () => void;
  /** Frame duration sliced onto the wire (Twilio-conventional 20ms). */
  frameMs?: number;
  /** Max audio in flight at the transport beyond realtime. */
  leadCapMs?: number;
  now?: () => number;
}

export class OutboundPacer {
  private readonly frameMs: number;
  private readonly frameBytes: number;
  private readonly leadCapMs: number;
  private readonly now: () => number;
  private queue: Buffer[] = [];
  private queuedMs = 0;
  /** Wall-clock when the transport's playout buffer is estimated dry. */
  private playheadAt = 0;
  private timer?: NodeJS.Timeout;
  private closed = false;

  constructor(private readonly deps: OutboundPacerDeps) {
    this.frameMs = deps.frameMs ?? 20;
    this.frameBytes = this.frameMs * BYTES_PER_MS;
    this.leadCapMs = deps.leadCapMs ?? 400;
    this.now = deps.now ?? Date.now;
  }

  /** Slice a chunk into frames and deliver as the lead window allows. */
  enqueueAudio(chunk: Buffer): void {
    if (this.closed || chunk.length === 0) return;
    for (let off = 0; off < chunk.length; off += this.frameBytes) {
      const frame = chunk.subarray(off, Math.min(off + this.frameBytes, chunk.length));
      this.queue.push(frame);
      this.queuedMs += frame.length / BYTES_PER_MS;
    }
    this.pump();
  }

  /** A deterministic pause the caller actually hears (μ-law silence frames) —
   *  the disclosure beat rides the same queue/cadence as speech. */
  enqueueSilence(ms: number): void {
    if (this.closed || ms <= 0) return;
    let rest = Math.round(ms);
    while (rest > 0) {
      const frameLen = Math.min(this.frameMs, rest);
      this.queue.push(Buffer.alloc(frameLen * BYTES_PER_MS, 0xff));
      this.queuedMs += frameLen;
      rest -= frameLen;
    }
    this.pump();
  }

  /** Audio in flight at the transport (sent beyond realtime), ms. */
  inFlightMs(): number {
    return Math.max(0, this.playheadAt - this.now());
  }

  /** Everything not yet played at the caller's ear that WE control or sent:
   *  server queue + transport lead. Drives barge/clear eligibility. */
  outstandingMs(): number {
    return Math.round(this.queuedMs + this.inFlightMs());
  }

  /**
   * Barge-in/tail clear: drop the server queue INSTANTLY and report what was
   * outstanding — the caller must also send the transport `clear` to wipe the
   * in-flight lead. `bufferedMsAtInterrupt` = droppedMs + inFlightMs.
   */
  clearNow(): { droppedMs: number; inFlightMs: number } {
    const dropped = Math.round(this.queuedMs);
    const inFlight = Math.round(this.inFlightMs());
    this.queue = [];
    this.queuedMs = 0;
    // The transport `clear` (sent by the caller alongside this) empties its
    // buffer — the playhead model resets to "dry now".
    this.playheadAt = this.now();
    return { droppedMs: dropped, inFlightMs: inFlight };
  }

  close(): void {
    this.closed = true;
    this.queue = [];
    this.queuedMs = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private pump(): void {
    if (this.closed) return;
    const now = this.now();
    while (this.queue.length > 0 && this.playheadAt - now < this.leadCapMs) {
      const frame = this.queue.shift()!;
      this.queuedMs -= frame.length / BYTES_PER_MS;
      this.playheadAt = Math.max(now, this.playheadAt) + frame.length / BYTES_PER_MS;
      this.deps.send(frame);
      this.deps.onWireSend?.();
    }
    if (this.queuedMs < 0) this.queuedMs = 0; // float dust
    if (this.queue.length > 0 && !this.timer) {
      this.timer = setInterval(() => {
        this.pump();
        if (this.queue.length === 0 && this.timer) {
          clearInterval(this.timer);
          this.timer = undefined;
        }
      }, this.frameMs);
      // A draining queue must never hold the process open on its own.
      this.timer.unref?.();
    }
  }
}
