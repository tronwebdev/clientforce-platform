/**
 * Spike metrics — everything the ADR's latency + cost tables need.
 * Anchors are server-side: the caller additionally hears PSTN transport
 * (~100–300ms each way), which only the recorded demo call captures.
 */

export interface TurnMetric {
  turn: number;
  /** Caller's words for this turn (never a phone number). */
  userText: string;
  assistantText: string;
  /** STT utterance-end → first LLM token, ms. */
  llmFirstTokenMs?: number;
  /** STT utterance-end → first TTS audio byte queued to the caller, ms (TTFA). */
  ttfaMs?: number;
  /** STT utterance-end → last TTS audio byte queued, ms (full-turn round trip). */
  roundTripMs?: number;
  bargedIn: boolean;
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
 * List prices (2026-07, USD) — spike estimates only, verify against billing.
 *  - Deepgram Nova-2 streaming STT: $0.0059 / audio-minute
 *  - Deepgram Aura-2 TTS: $0.030 / 1k characters
 *  - Claude Haiku 4.5: $1 / $5 per MTok (in/out) — tracked via the gateway hook
 *  - Twilio outbound US voice: $0.014 / minute
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

  report() {
    const ttfa = this.turns.map((t) => t.ttfaMs).filter((v): v is number => v !== undefined);
    const rtt = this.turns.map((t) => t.roundTripMs).filter((v): v is number => v !== undefined);
    const firstToken = this.turns
      .map((t) => t.llmFirstTokenMs)
      .filter((v): v is number => v !== undefined);
    const minutes = this.callSeconds / 60;
    const sttMinutes = this.sttAudioBytes / 8000 / 60;
    const cost = {
      sttUsd: sttMinutes * PRICES.sttPerMinute,
      ttsUsd: (this.ttsChars / 1000) * PRICES.ttsPer1kChars,
      llmUsd: this.llmCostUsd,
      twilioUsd: minutes * PRICES.twilioPerMinute,
    };
    const totalUsd = cost.sttUsd + cost.ttsUsd + cost.llmUsd + cost.twilioUsd;
    return {
      turns: this.turns.length,
      callSeconds: Math.round(this.callSeconds * 10) / 10,
      ttfaMs: { p50: percentile(ttfa, 50), p95: percentile(ttfa, 95), samples: ttfa.length },
      roundTripMs: { p50: percentile(rtt, 50), p95: percentile(rtt, 95), samples: rtt.length },
      llmFirstTokenMs: { p50: percentile(firstToken, 50), p95: percentile(firstToken, 95) },
      bargeIns: this.bargeIns,
      droppedAudio: this.droppedAudio,
      cost: {
        ...cost,
        totalUsd,
        perMinuteUsd: minutes > 0 ? totalUsd / minutes : 0,
      },
      transcript: this.turns.map((t) => ({
        turn: t.turn,
        user: t.userText,
        assistant: t.assistantText,
        bargedIn: t.bargedIn,
      })),
    };
  }
}
