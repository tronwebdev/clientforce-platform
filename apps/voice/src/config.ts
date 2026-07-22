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
  /** DEC-092 (fix b): one-shot "Sorry — are you still there?" after this much
   *  MUTUAL silence (agent idle + caller silent). 0 = off. */
  reengageAfterMs: number;
  /** DEC-092 (owner finding 1c): the post-disclosure bridge — if the closing
   *  question gets no caller speech within this window, the agent proceeds
   *  with the constant bridge line instead of waiting mute. */
  bridgeAfterMs: number;
  /** DEC-092 (owner finding 1a): a constant silence beat between the
   *  disclosure's sentences — paces the opening at the ear. */
  disclosureBeatMs: number;
  /** DEC-092 (owner finding 2): max outbound audio in flight at Twilio beyond
   *  realtime (the just-in-time pacer's lead window) — the un-cancellable
   *  tail a barge-in can leave at the caller's ear is bounded by this. */
  paceLeadMs: number;
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
    reengageAfterMs: envInt("VOICE_REENGAGE_AFTER_MS", 6000),
    bridgeAfterMs: envInt("VOICE_BRIDGE_AFTER_MS", 5000),
    disclosureBeatMs: envInt("VOICE_DISCLOSURE_BEAT_MS", 400),
    paceLeadMs: envInt("VOICE_PACE_LEAD_MS", 400),
    ackPhrases: ["Mm-hm.", "Right.", "Okay."],
    idleTimeoutMs: envInt("VOICE_IDLE_TIMEOUT_MS", 60_000),
    maxCallMs: envInt("VOICE_MAX_CALL_MS", 600_000),
    costAlertUsdPerCall: Number(process.env.VOICE_COST_ALERT_PER_CALL_USD ?? "") || 1,
  };
}
