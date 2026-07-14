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
  /** Set when the per-turn checks tripped and the fallback line was spoken. */
  refusalReason?: string;
}

export interface BargeInMetric {
  turn: number;
  /** Caller speech onset → `clear` sent to Twilio, ms. */
  clearLatencyMs: number;
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

  markCallStart(): void {
    this.startedAt = Date.now();
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
      disclosureCompleted: this.disclosureCompleted,
      cost: this.cost(),
      config: this.configEcho,
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
