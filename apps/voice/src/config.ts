/**
 * P3.1 (DEC-078) — every tunable of the production voice service in one
 * place, env-overridable, echoed into the certification table so a run is
 * always reproducible. Endpointing values are the plan-comment proposal
 * (owner sign-off): endpointing 300→500ms, utterance_end 1200→1500ms,
 * smart_format on, plus the application-level turn-commit rules (TurnGate).
 */

const envInt = (name: string, fallback: number): number => {
  const v = process.env[name];
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export interface VoiceServiceConfig {
  port: number;
  publicHost: string;
  /** Deepgram streaming-STT params (the wire-level endpointing knobs). */
  stt: {
    model: string;
    /** ms of silence before a final is speech_final. */
    endpointingMs: number;
    /** ms of true silence before UtteranceEnd — the hard stop. */
    utteranceEndMs: number;
    smartFormat: boolean;
  };
  /** Application-level turn-commit (TurnGate). */
  continuationWindowMs: number;
  /** Latency masking: ack clip plays if no reply audio within this window. */
  ackAfterMs: number;
  /** Rotating short verbal acknowledgments — pre-rendered per voice, constant. */
  ackPhrases: readonly string[];
  /** Hard safety timeouts — never a hung line. */
  idleTimeoutMs: number;
  maxCallMs: number;
  /** Per-call cost alert threshold (structured warning + Logs event). */
  costAlertUsdPerCall: number;
}

export function loadVoiceConfig(): VoiceServiceConfig {
  return {
    port: envInt("PORT", 8080),
    publicHost: process.env.PUBLIC_HOST ?? `localhost:${envInt("PORT", 8080)}`,
    stt: {
      model: process.env.VOICE_STT_MODEL ?? "nova-2",
      endpointingMs: envInt("VOICE_STT_ENDPOINTING_MS", 500),
      utteranceEndMs: envInt("VOICE_STT_UTTERANCE_END_MS", 1500),
      smartFormat: process.env.VOICE_STT_SMART_FORMAT !== "false",
    },
    // The FALLBACK hold for a mid-thought fragment. Deepgram's silence-
    // anchored UtteranceEnd (1500ms) is the primary commit path for
    // trailing-off callers; this wall-clock hold only backstops a missed
    // event. Cert run 3 (29381035994) proved 900ms races Deepgram's
    // SpeechStarted tail latency on adversarial intra-utterance pauses
    // (hold expiry ~1400ms vs pause 900ms + VAD tail >500ms → 12
    // mid-utterance commits); 2000ms puts expiry at ~2500ms, beyond any
    // observed VAD tail, while UtteranceEnd keeps the caller-visible
    // trailing-off latency at ~1500ms.
    continuationWindowMs: envInt("VOICE_CONTINUATION_WINDOW_MS", 2000),
    ackAfterMs: envInt("VOICE_ACK_AFTER_MS", 400),
    ackPhrases: ["Mm-hm.", "Right.", "Okay."],
    idleTimeoutMs: envInt("VOICE_IDLE_TIMEOUT_MS", 60_000),
    maxCallMs: envInt("VOICE_MAX_CALL_MS", 600_000),
    costAlertUsdPerCall: Number(process.env.VOICE_COST_ALERT_PER_CALL_USD ?? "") || 1,
  };
}
