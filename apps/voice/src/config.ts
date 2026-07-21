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
  /** DEC-092: reply TTS transport — `stream` (persistent Aura websocket, the
   *  inter-sentence-gap killer) or `https` (per-sentence fetch; also the
   *  automatic in-call fallback when the stream transport fails). */
  ttsTransport: "stream" | "https";
  /** Latency masking: ack clip plays if no reply audio within this window. */
  ackAfterMs: number;
  /** Yield the floor when a reply makes no audio progress for this long —
   *  a stalled agent must never resume speech over the caller (cert run 6). */
  stallAbandonMs: number;
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
    ttsTransport: process.env.VOICE_TTS_TRANSPORT === "https" ? "https" : "stream",
    ackAfterMs: envInt("VOICE_ACK_AFTER_MS", 400),
    stallAbandonMs: envInt("VOICE_STALL_ABANDON_MS", 3000),
    ackPhrases: ["Mm-hm.", "Right.", "Okay."],
    idleTimeoutMs: envInt("VOICE_IDLE_TIMEOUT_MS", 60_000),
    maxCallMs: envInt("VOICE_MAX_CALL_MS", 600_000),
    costAlertUsdPerCall: Number(process.env.VOICE_COST_ALERT_PER_CALL_USD ?? "") || 1,
  };
}
