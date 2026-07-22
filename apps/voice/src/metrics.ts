/**
 * Call metrics (P3.1) — everything the certification table needs. Anchors are
 * server-side at the turn-committing STT event (the ADR's anchor); the caller
 * additionally hears PSTN transport, which only recorded calls capture.
 *
 * Production deltas over the spike collector: per-turn commit source
 * (speech_final / utterance_end / continuation_expiry), ack usage (latency
 * masking is reported HONESTLY — ack audio never counts as reply TTFA),
 * per-turn refusals, and the config echo so any run is reproducible.
 */
import type { TurnCommitSource } from "./turn-gate";

export interface TurnMetric {
  turn: number;
  /** Caller's words for this turn (never a phone number). */
  userText: string;
  assistantText: string;
  commitSource?: TurnCommitSource;
  /** Turn commit → first LLM token, ms. */
  llmFirstTokenMs?: number;
  /** Turn commit → first REPLY TTS byte queued, ms (TTFA — ack excluded). */
  ttfaMs?: number;
  /** Turn commit → ack clip queued, ms (only when the ack fired). */
  ackAtMs?: number;
  /** Turn commit → last reply byte queued, ms (full-turn round trip). */
  roundTripMs?: number;
  bargedIn: boolean;
  /** The reply made no audio progress and yielded the floor (stall-abandon). */
  stalled?: boolean;
  /** Set when the per-turn checks tripped and the fallback line was spoken. */
  refusalReason?: string;
  /** DEC-092 (fix a): the model returned an EMPTY completion — the locked
   *  fallback line was spoken instead of silence. */
  emptyReply?: boolean;
}

export interface BargeInMetric {
  turn: number;
  /** Caller speech onset → `clear` sent to Twilio, ms. */
  clearLatencyMs: number;
  /** DEC-092 (owner finding 2): audio outstanding at the interrupt — server
   *  queue dropped + transport lead the `clear` wipes. Bounded by the pacer's
   *  lead cap at the transport side. */
  bufferedMs?: number;
}

export interface DroppedAudioEvent {
  turn: number;
  reason: string;
  atMs: number;
}

/**
 * List prices (2026-07, USD) — logging estimates only, verify against billing.
 */
export const PRICES = {
  sttPerMinute: 0.0059,
  ttsPer1kChars: 0.03,
  twilioPerMinute: 0.014,
} as const;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

export class MetricsCollector {
  readonly turns: TurnMetric[] = [];
  readonly bargeIns: BargeInMetric[] = [];
  readonly droppedAudio: DroppedAudioEvent[] = [];
  private startedAt = Date.now();
  private sttAudioBytes = 0;
  private ttsChars = 0;
  llmCostUsd = 0; // accumulated by the gateway usage hook
  disclosureCompleted = false;
  /** Echoed into the report so every run is reproducible. */
  configEcho: Record<string, unknown> = {};
  // ── DEC-092 pacing instrumentation — makes the audible layer measurable ──
  /** Per-sentence TTS delivery timings (speak → first audio / fully flushed). */
  private ttsSentenceFirstAudioMs: number[] = [];
  private ttsSentenceFlushedMs: number[] = [];
  /** Call-relative ms of each sentence — the first-60s vs steady split
   *  (owner finding 3) is computed from these, no container access needed. */
  private ttsSentenceAtMs: number[] = [];
  /** Outbound-audio pacing: gaps >200ms between queued chunks mid-speech. */
  audioSendGapsOver200 = 0;
  maxAudioSendGapMs = 0;
  /** Event-loop delay percentiles (ms), set once at session close. */
  eventLoopMs: { p50: number; p95: number; max: number } | undefined;
  /** The TTS transport the call actually used (stream | https | stream→https). */
  ttsTransportUsed = "https";
  /** DEC-092 (fix b): the one-shot silence re-engage fired (ms into call). */
  reengagedAtMs: number | undefined;
  /** DEC-092 (owner finding 1c): the post-disclosure bridge fired (ms into call). */
  bridgedAtMs: number | undefined;
  /** DEC-092 (owner finding 2): outstanding audio per clear event (barge-in
   *  or post-turn tail clear) — the owner's buffered-ms-at-interrupt. */
  readonly bufferedMsAtInterrupt: number[] = [];

  markCallStart(): void {
    this.startedAt = Date.now();
  }

  addTtsSentence(firstAudioMs: number, flushedMs: number): void {
    this.ttsSentenceFirstAudioMs.push(firstAudioMs);
    this.ttsSentenceFlushedMs.push(flushedMs);
    this.ttsSentenceAtMs.push(Date.now() - this.startedAt);
  }

  audioSendGap(gapMs: number): void {
    if (gapMs > 200) this.audioSendGapsOver200 += 1;
    if (gapMs > this.maxAudioSendGapMs) this.maxAudioSendGapMs = gapMs;
  }

  ttsSentenceStats() {
    return {
      n: this.ttsSentenceFirstAudioMs.length,
      firstAudioP50: percentile(this.ttsSentenceFirstAudioMs, 50),
      firstAudioMax: Math.max(0, ...this.ttsSentenceFirstAudioMs),
      flushedP50: percentile(this.ttsSentenceFlushedMs, 50),
    };
  }

  /** Owner finding 3: the start-window vs settled-state per-sentence split —
   *  every call posts its own first-60s diff in the summary line. */
  ttsSentenceWindowStats(windowMs = 60_000) {
    const win = (inWindow: boolean) =>
      this.ttsSentenceFirstAudioMs.filter((_, i) => (this.ttsSentenceAtMs[i]! < windowMs) === inWindow);
    const stat = (vals: number[]) => ({
      n: vals.length,
      firstAudioP50: percentile(vals, 50),
      firstAudioMax: Math.max(0, ...vals),
    });
    return { first60s: stat(win(true)), steady: stat(win(false)) };
  }

  addSttAudio(bytes: number): void {
    this.sttAudioBytes += bytes;
  }

  addTtsChars(chars: number): void {
    this.ttsChars += chars;
  }

  dropped(turn: number, reason: string): void {
    this.droppedAudio.push({ turn, reason, atMs: Date.now() - this.startedAt });
  }

  get callSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  cost() {
    const minutes = this.callSeconds / 60;
    const sttMinutes = this.sttAudioBytes / 8000 / 60;
    const parts = {
      sttUsd: sttMinutes * PRICES.sttPerMinute,
      ttsUsd: (this.ttsChars / 1000) * PRICES.ttsPer1kChars,
      llmUsd: this.llmCostUsd,
      twilioUsd: minutes * PRICES.twilioPerMinute,
    };
    const totalUsd = parts.sttUsd + parts.ttsUsd + parts.llmUsd + parts.twilioUsd;
    return { ...parts, totalUsd, perMinuteUsd: minutes > 0 ? totalUsd / minutes : 0 };
  }

  report() {
    const ttfa = this.turns.map((t) => t.ttfaMs).filter((v): v is number => v !== undefined);
    const rtt = this.turns.map((t) => t.roundTripMs).filter((v): v is number => v !== undefined);
    const firstToken = this.turns
      .map((t) => t.llmFirstTokenMs)
      .filter((v): v is number => v !== undefined);
    const acked = this.turns.filter((t) => t.ackAtMs !== undefined).length;
    const sources: Record<string, number> = {};
    for (const t of this.turns) {
      if (t.commitSource) sources[t.commitSource] = (sources[t.commitSource] ?? 0) + 1;
    }
    return {
      turns: this.turns.length,
      callSeconds: Math.round(this.callSeconds * 10) / 10,
      ttfaMs: { p50: percentile(ttfa, 50), p95: percentile(ttfa, 95), samples: ttfa.length },
      /** Raw per-turn samples — the certification aggregate pools these
       *  across sessions so gate percentiles cover ALL ≥100 turns. */
      ttfaSamplesMs: ttfa,
      roundTripMs: { p50: percentile(rtt, 50), p95: percentile(rtt, 95), samples: rtt.length },
      llmFirstTokenMs: { p50: percentile(firstToken, 50), p95: percentile(firstToken, 95) },
      ackRate: this.turns.length > 0 ? acked / this.turns.length : 0,
      commitSources: sources,
      bargeIns: this.bargeIns,
      droppedAudio: this.droppedAudio,
      refusals: this.turns.filter((t) => t.refusalReason).map((t) => ({ turn: t.turn, reason: t.refusalReason })),
      stalledTurns: this.turns.filter((t) => t.stalled).length,
      disclosureCompleted: this.disclosureCompleted,
      cost: this.cost(),
      config: this.configEcho,
      // DEC-092 pacing block — the layer the ear hears, now measured.
      ttsTransport: this.ttsTransportUsed,
      emptyReplies: this.turns.filter((t) => t.emptyReply).length,
      reengagedAtMs: this.reengagedAtMs ?? null,
      bridgedAtMs: this.bridgedAtMs ?? null,
      bufferedMsAtInterrupt: [...this.bufferedMsAtInterrupt],
      ttsSentences: this.ttsSentenceStats(),
      ttsSentenceWindows: this.ttsSentenceWindowStats(),
      /** Raw per-sentence speak→first-audio samples in call order — the
       *  start-window vs mid-call split is computed from these (DEC-092). */
      ttsSentenceFirstAudioSamples: [...this.ttsSentenceFirstAudioMs],
      audioSendGaps: { over200: this.audioSendGapsOver200, maxMs: this.maxAudioSendGapMs },
      eventLoopMs: this.eventLoopMs ?? null,
      transcript: this.turns.map((t) => ({
        turn: t.turn,
        user: t.userText,
        assistant: t.assistantText,
        bargedIn: t.bargedIn,
        commitSource: t.commitSource,
      })),
    };
  }
}
