/**
 * CallSession (P3.1, DEC-078) — one phone call's real-time loop, production
 * build of the ADR-proven spike. Transport-agnostic: the server feeds caller
 * mulaw frames and an audio sink; this class runs STT → TurnGate → brain →
 * sentence-chunked TTS.
 *
 * Owner-locked behavior:
 * - The DISCLOSURE is spoken FIRST, before any composed turn — a constant,
 *   never composed (rendered upstream by `renderVoiceDisclosure`).
 *   Interruptible (D10); completion recorded for the compliance record.
 * - Barge-in ported EXACTLY from the spike (0–3ms clear + zero dropped audio
 *   proven live): caller speech onset → Twilio `clear` + abort of the
 *   in-flight LLM+TTS (the gateway still logs usage on abort).
 * - Deterministic per-sentence checks pre-TTS (`checkComposedVoiceTurn`):
 *   a violation aborts the turn to the constant fallback line and reports a
 *   typed refusal — a live call can't pause like an enrollment.
 * - Never a hung line: provider failure → ONE recovery attempt where the
 *   client allows it, else the constant goodbye + onEnd("failed"); idle and
 *   max-duration timeouts close politely.
 * - Latency masking: if no reply audio within `ackAfterMs` of turn commit, a
 *   short pre-rendered ack clip plays (rotating by turn index — deterministic,
 *   interruptible, never counted as reply TTFA).
 */
import type { AiGateway } from "@clientforce/ai";
import { checkComposedVoiceTurn, VOICE_FALLBACK_LINE, VOICE_FAILURE_GOODBYE, VOICE_REENGAGE_LINE, VOICE_BRIDGE_LINE } from "@clientforce/channels";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { openSttStream, synthesizeAura, type SttParams, type SttStream, type Synthesize } from "./deepgram";
import { TtsStream, TtsStreamCleared, type TtsStreamDeps } from "./deepgram-tts-stream";
import { OutboundPacer } from "./outbound-pacer";
import { SentenceChunker } from "./sentence-chunker";
import { TurnGate, type TurnCommit } from "./turn-gate";
import type { MetricsCollector, TurnMetric } from "./metrics";

export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
  /** Session-relative ms when the turn text was fixed (persist timestamps). */
  atMs?: number;
  commitSource?: TurnCommit["source"];
  refusalReason?: string;
}

export type CallEndReason = "caller_hangup" | "idle_timeout" | "max_duration" | "provider_failure";

export interface CallSessionDeps {
  gateway: AiGateway;
  metrics: MetricsCollector;
  deepgramKey: string;
  /** The persona's Aura-2 model (VOICE_PERSONAS in core). */
  ttsModel: string;
  /** The full call system prompt (composer.voice@v1, built upstream). */
  systemPrompt: string;
  /** The locked disclosure literal, rendered upstream — spoken first, never composed. */
  disclosure: string;
  /** Deterministic ban list for the per-sentence checks. */
  neverSay: string[];
  sttParams: SttParams;
  ackAfterMs: number;
  /** Pre-rendered ack clips (mulaw) — empty disables masking (tests/cert modes). */
  ackClips: Buffer[];
  /** Yield the floor when a reply makes no audio progress for this long
   *  (cert run 6: never resume speech over a caller after a stall). 0 = off. */
  stallAbandonMs: number;
  idleTimeoutMs: number;
  maxCallMs: number;
  /** Queue mulaw/8k audio to the caller. */
  sendAudio: (mulaw: Buffer) => void;
  /** Empty the caller's playback buffer (Twilio `clear`) — barge-in. */
  clearPlayback: () => void;
  /** A per-turn check tripped — the audit trail (voice.compose_refused.v1). */
  onRefusal?: (turn: number, reason: string, detail: string) => void;
  /** The session decided the call must end (timeouts, provider failure). */
  onEnd?: (reason: CallEndReason) => void;
  /** Injectable for the harness/tests; default the real Deepgram clients. */
  openStt?: typeof openSttStream;
  synthesize?: Synthesize;
  /** DEC-092: reply TTS transport (default `stream`); https = legacy/fallback. */
  ttsTransport?: "stream" | "https";
  /** DEC-092 (fix b): ms of MUTUAL silence before the one-shot re-engage.
   *  Absent/0 = off (tests/harness unaffected unless wired). */
  reengageAfterMs?: number;
  /** DEC-092 (owner finding 1c): post-disclosure quiet window before the
   *  one-shot bridge line. Absent/0 = off. */
  bridgeAfterMs?: number;
  /** DEC-092 (owner finding 1a): silence beat between disclosure sentences.
   *  Absent/0 = off. */
  disclosureBeatMs?: number;
  /** DEC-092 (owner finding 2): the pacer's lead window at the transport —
   *  bounds the un-cancellable barge-in tail. Default 400. */
  paceLeadMs?: number;
  /** Finding 1b noise grace override (tests) — see ONSET_GRACE_MS. */
  onsetGraceMs?: number;
  /** Injectable stream factory for tests. */
  openTtsStream?: (deps: TtsStreamDeps) => TtsStream;
}

/** A VAD onset that produces no WORDS within this window is line noise — it
 *  must not suppress the silence ladder (bridge/re-engage) forever (owner
 *  finding 1b: VoIP legs fire onsets from breath/noise; the re-demo showed
 *  `reengagedAtMs:null` through a long post-disclosure mute). Applies to the
 *  whole wordless STREAK: repeated noise onsets don't restart the hold —
 *  only real words (a final) do. */
const ONSET_GRACE_MS = 4000;

export class CallSession {
  private readonly turns: VoiceTurn[] = [];
  private stt?: SttStream;
  private speaking = false;
  /** Aborts the in-flight LLM+TTS on barge-in — the spike-proven pattern. */
  private ttsAbort?: AbortController;
  private speechStartedAt = 0;
  private turnCount = 0;
  /** The reply turn currently being spoken (0 = disclosure). */
  private speakingTurn = 0;
  private closed = false;
  private gate: TurnGate;
  private idleTimer?: NodeJS.Timeout;
  private maxTimer?: NodeJS.Timeout;
  private startedAtMs = 0;
  private turnLastAudioAt = 0;
  private readonly openStt: typeof openSttStream;
  private readonly synthesize: Synthesize;
  // ── DEC-092: streaming TTS transport + pacing instrumentation ──
  private ttsStream?: TtsStream;
  private ttsStreamFailed = false;
  /** Routing context for stream audio: the speak currently in flight. */
  private speechCtx?: { metric?: TurnMetric; anchor: number; signal: AbortSignal };
  private lastAudioSentAt = 0;
  private loopDelay?: IntervalHistogram;
  // ── DEC-092 (fix b): one-shot silence re-engage ──
  private reengaged = false;
  private reengageTimer?: NodeJS.Timeout;
  private lastCallerFinalAt = 0;
  /** Finding 1b: start of the current WORDLESS onset streak (0 = none) —
   *  onsets in a streak older than the grace stop holding the ladder. */
  private wordlessOnsetSince = 0;
  private sttFirstFinalLogged = false;
  // ── DEC-092 (owner findings 1c + 2): bridge state + the JIT pacer ──
  private bridged = false;
  private disclosureDone = false;
  /** When the disclosure's last frame finished at the EAR (wire drain). */
  private disclosureWireEndAt = 0;
  private readonly pacer: OutboundPacer;

  constructor(private readonly deps: CallSessionDeps) {
    this.openStt = deps.openStt ?? openSttStream;
    this.synthesize = deps.synthesize ?? synthesizeAura;
    this.gate = new TurnGate({ onCommit: (commit) => this.onTurnCommit(commit) });
    // Owner finding 2: audio waits SERVER-side (droppable instantly), only
    // ~leadCap ever in flight at Twilio — the un-cancellable tail is bounded.
    this.pacer = new OutboundPacer({
      send: (frame) => this.deps.sendAudio(frame),
      onWireSend: () => this.recordAudioSend(),
      leadCapMs: this.deps.paceLeadMs ?? 400,
    });
  }

  /** stream transport EXPLICITLY enabled (config-wired — absent = legacy
   *  https, so tests/harnesses never open a real socket) and never failed. */
  private get streamTransportOn(): boolean {
    return this.deps.ttsTransport === "stream" && !this.ttsStreamFailed;
  }

  /** Lazily (re)open the per-call TTS stream; null when unavailable. */
  private ensureTtsStream(): TtsStream | null {
    if (!this.streamTransportOn) return null;
    if (this.ttsStream?.alive) return this.ttsStream;
    if (this.ttsStream) console.log("[tts] stream reconnect (previous socket gone)");
    try {
      const make =
        this.deps.openTtsStream ?? ((d: TtsStreamDeps) => new TtsStream(d));
      this.ttsStream = make({
        apiKey: this.deps.deepgramKey,
        ttsModel: this.deps.ttsModel,
        onAudio: (chunk) => this.onStreamAudio(chunk),
      });
      return this.ttsStream;
    } catch (err) {
      this.ttsStreamFailed = true;
      console.error("[tts] stream transport unavailable — https fallback:", (err as Error).message);
      return null;
    }
  }

  /** Ordered audio from the TTS stream → the pacer (TTFA stamps at enqueue —
   *  "first reply byte queued", the metric's contract). */
  private onStreamAudio(chunk: Buffer): void {
    const ctx = this.speechCtx;
    if (!ctx || ctx.signal.aborted) return; // stale/cleared speak — drop
    if (ctx.metric && ctx.metric.ttfaMs === undefined) {
      ctx.metric.ttfaMs = Date.now() - ctx.anchor;
    }
    this.pacer.enqueueAudio(chunk);
  }

  /** WIRE-side telemetry — called by the pacer per frame actually sent:
   *  send-gap pacing truth + the audible-progress clocks (stall watchdog,
   *  silence ladder). Audio draining the queue IS audible progress. */
  private recordAudioSend(): void {
    const now = Date.now();
    if (this.speaking && this.lastAudioSentAt > 0) {
      this.deps.metrics.audioSendGap(now - this.lastAudioSentAt);
    }
    this.lastAudioSentAt = now;
    this.turnLastAudioAt = now;
  }

  start(): void {
    this.deps.metrics.markCallStart();
    this.startedAtMs = Date.now();
    // DEC-092 instrumentation: event-loop stalls are the invisible half of
    // audible choppiness on a shared/fractional core — measured per call.
    this.loopDelay = monitorEventLoopDelay({ resolution: 10 });
    this.loopDelay.enable();
    // Pre-warm the TTS stream immediately — the disclosure itself speaks into
    // a hot socket (start-window wave; connect measured at ~34ms live).
    if (this.streamTransportOn) this.ensureTtsStream();
    this.stt = this.openStt(this.deps.deepgramKey, this.deps.sttParams, {
      onSpeechStarted: () => this.onSpeechStarted(),
      onFinal: (text, speechFinal) => this.onCallerFinal(text, speechFinal),
      onUtteranceEnd: () => this.gate.onUtteranceEnd(),
      onError: (err) => console.error("[stt]", err.message),
      onFatal: () => this.failCall("stt stream lost"),
    });
    this.armIdleTimer();
    if (this.deps.maxCallMs > 0) {
      this.maxTimer = setTimeout(() => this.endPolitely("max_duration"), this.deps.maxCallMs);
    }
    if ((this.deps.reengageAfterMs ?? 0) > 0 || (this.deps.bridgeAfterMs ?? 0) > 0) {
      this.reengageTimer = setInterval(() => this.silenceLadderTick(), 500);
    }
    void this.warmBrainConnection();
    void this.speakDisclosure();
  }

  /**
   * Pre-warm the LLM connection while the disclosure plays — the call's first
   * real reply then rides a pooled connection instead of paying TLS setup
   * (a first-turn TTFA tail the certification run surfaced). Usage logs
   * through the same hook, so cost stays honest; failures are irrelevant.
   */
  private async warmBrainConnection(): Promise<void> {
    try {
      const stream = this.deps.gateway.streamVoice({
        system: "Reply with exactly: ok",
        turns: [{ role: "user", content: "ok" }],
        maxTokens: 4,
      });
      for await (const delta of stream) void delta;
    } catch {
      // a warm-up must never affect the call
    }
  }

  /**
   * The locked opening disclosure — turn 0, spoken before ANY composed turn.
   * Interruptible (D10); completion lands in metrics for the compliance
   * record (Call.meta.disclosureCompleted).
   */
  private async speakDisclosure(): Promise<void> {
    const abort = new AbortController();
    this.ttsAbort = abort;
    this.speaking = true;
    this.speakingTurn = 0;
    this.turns.push({ role: "assistant", content: this.deps.disclosure, atMs: 0 });
    let interrupted = false;
    try {
      const sentences = [...new SentenceChunker().push(`${this.deps.disclosure} `)];
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i]!;
        // Owner finding 1a: a constant BEAT between the opening's sentences —
        // queued as real silence frames so the ear hears exactly this pause
        // regardless of buffering. The literal itself is untouched.
        if (i > 0 && (this.deps.disclosureBeatMs ?? 0) > 0) {
          this.pacer.enqueueSilence(this.deps.disclosureBeatMs!);
        }
        this.deps.metrics.addTtsChars(sentence.length);
        // DEC-092 start-window wave (owner PARTIAL PASS ruling): the
        // disclosure rides the SAME hot streaming transport as replies — the
        // open was the one remaining per-sentence HTTPS window (the crackle
        // heard only at call start). https stays the automatic fallback.
        const stream = this.ensureTtsStream();
        if (stream) {
          try {
            this.speechCtx = { anchor: Date.now(), signal: abort.signal };
            const timing = await stream.speak(sentence);
            this.deps.metrics.addTtsSentence(timing.firstAudioMs, timing.flushedMs);
            if (this.deps.metrics.ttsTransportUsed === "https") {
              this.deps.metrics.ttsTransportUsed = "stream";
            }
            continue;
          } catch (err) {
            if (abort.signal.aborted || err instanceof TtsStreamCleared) {
              interrupted = true;
              return;
            }
            this.ttsStreamFailed = true;
            this.deps.metrics.ttsTransportUsed = "stream→https";
            console.error(
              "[tts] stream transport failed on disclosure — https fallback:",
              (err as Error).message,
            );
            try {
              this.ttsStream?.close();
            } catch {
              // already dead
            }
          }
        }
        for await (const chunk of this.synthesize(this.deps.deepgramKey, this.deps.ttsModel, sentence, abort.signal)) {
          if (abort.signal.aborted) {
            interrupted = true;
            return;
          }
          this.pacer.enqueueAudio(chunk);
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("[disclosure]", (err as Error).message);
        this.failCall(`disclosure tts: ${(err as Error).message}`);
      } else {
        interrupted = true;
      }
    } finally {
      if (!interrupted && !abort.signal.aborted) this.deps.metrics.disclosureCompleted = true;
      // Owner finding 1c: the bridge window opens at the disclosure's WIRE
      // end (stamped by the ladder tick once the pacer drains) — set here
      // even when interrupted, so a noise-aborted open still gets bridged.
      this.disclosureDone = true;
      if (this.ttsAbort === abort) {
        this.speaking = false;
        this.ttsAbort = undefined;
      }
    }
  }

  /** Caller audio frame from the transport. */
  pushCallerAudio(mulaw: Buffer): void {
    this.deps.metrics.addSttAudio(mulaw.byteLength);
    this.stt?.sendAudio(mulaw);
  }

  /** A finalized STT fragment — the ladder clocks stamp only on WORDS (an
   *  empty final is line noise and must not hold the silence ladder). */
  private onCallerFinal(text: string, speechFinal: boolean): void {
    if (!this.sttFirstFinalLogged) {
      this.sttFirstFinalLogged = true; // cold-path proof — any final counts
      console.log(`[stt] first final after ${Date.now() - this.startedAtMs}ms`);
    }
    if (text.trim()) {
      this.lastCallerFinalAt = Date.now();
      this.wordlessOnsetSince = 0; // real words — the onset streak was speech
    }
    this.gate.onFinal(text, speechFinal);
  }

  /** VAD onset — mid-utterance it's a barge-in; after the utterance it can
   *  still be an interrupt of the DRAINING tail (owner finding 2: the clear
   *  invariant holds at the caller's ear, not just while `speaking`). */
  private onSpeechStarted(): void {
    this.speechStartedAt = Date.now();
    if (this.wordlessOnsetSince === 0) this.wordlessOnsetSince = Date.now();
    this.armIdleTimer();
    if (this.speaking) this.bargeIn();
    else if (this.pacer.outstandingMs() > 0) this.clearTail();
  }

  private bargeIn(): void {
    const turn = this.speakingTurn;
    // Server queue first (instant), then the transport buffer — together they
    // are everything the caller has not yet heard.
    const cleared = this.pacer.clearNow();
    const bufferedMs = cleared.droppedMs + cleared.inFlightMs;
    this.deps.metrics.bufferedMsAtInterrupt.push(bufferedMs);
    this.deps.clearPlayback(); // Twilio `clear` — wipe the in-flight lead
    this.ttsAbort?.abort(); // cancel LLM+TTS generation
    this.ttsStream?.clear(); // drop server-side buffered TTS audio (DEC-092)
    this.speaking = false;
    this.deps.metrics.bargeIns.push({
      turn,
      clearLatencyMs: Date.now() - this.speechStartedAt,
      bufferedMs,
    });
    const current = this.turns[this.turns.length - 1];
    if (current?.role === "assistant") current.content += " [interrupted]";
  }

  /** Owner finding 2 (the race the ear caught): the reply finished DELIVERING
   *  (`speaking` false) while paced audio was still playing out — a caller
   *  interrupt must still cut it. No turn abort (nothing in flight), no
   *  transcript mark (the reply text WAS fully delivered), just the cut. */
  private clearTail(): void {
    const cleared = this.pacer.clearNow();
    this.deps.metrics.bufferedMsAtInterrupt.push(cleared.droppedMs + cleared.inFlightMs);
    this.deps.clearPlayback();
    this.ttsStream?.clear(); // safety — nothing should be in flight here
  }

  /** The TurnGate committed a caller utterance — respond. */
  private onTurnCommit(commit: TurnCommit): void {
    if (this.closed || !commit.text) return;
    this.armIdleTimer();
    this.turns.push({
      role: "user",
      content: commit.text,
      atMs: commit.committedAt - this.startedAtMs,
      commitSource: commit.source,
    });
    void this.respond(commit);
  }

  private async respond(commit: TurnCommit): Promise<void> {
    const turn = ++this.turnCount;
    const anchor = commit.committedAt; // the ADR's TTFA anchor
    const chunker = new SentenceChunker(true); // eager first chunk — TTFA lever
    const abort = new AbortController();
    this.ttsAbort = abort;
    this.speaking = true;
    this.speakingTurn = turn;

    let assistantText = "";
    // Pacing gaps are INTRA-turn only — across turns the caller is speaking
    // and silence is correct (the first run counted those as 31s "gaps").
    this.lastAudioSentAt = 0;
    const metric: TurnMetric = {
      turn,
      userText: commit.text,
      assistantText: "",
      commitSource: commit.source,
      bargedIn: false,
    };
    this.deps.metrics.turns.push(metric);

    // Latency masking: one short pre-rendered ack if the reply keeps the
    // caller waiting past ackAfterMs. Deterministic rotation by turn index;
    // interruptible (queued audio — `clear` flushes it); NEVER reply TTFA.
    let ackTimer: NodeJS.Timeout | undefined;
    if (this.deps.ackClips.length > 0 && this.deps.ackAfterMs > 0) {
      ackTimer = setTimeout(() => {
        if (abort.signal.aborted || metric.ttfaMs !== undefined) return;
        const clip = this.deps.ackClips[(turn - 1) % this.deps.ackClips.length]!;
        metric.ackAtMs = Date.now() - anchor;
        this.pacer.enqueueAudio(clip);
      }, this.deps.ackAfterMs);
    }

    // Stall-abandon (cert run 6): a reply that makes no AUDIO progress for
    // stallAbandonMs yields the floor — a stalled agent must NEVER resume
    // speaking over a caller who has mentally taken the turn (the run showed
    // exactly that: vendor token-rate stalls >2.5s, then a resume burst the
    // caller talks over). The turn is counted honestly (stalledTurns).
    this.turnLastAudioAt = Date.now();
    let stallTimer: NodeJS.Timeout | undefined;
    if (this.deps.stallAbandonMs > 0) {
      stallTimer = setInterval(() => {
        if (abort.signal.aborted) return;
        if (Date.now() - this.turnLastAudioAt > this.deps.stallAbandonMs) {
          metric.stalled = true;
          abort.abort();
          this.ttsStream?.clear(); // a stalled stream must not resume later (DEC-092)
        }
      }, 250);
    }

    try {
      const stream = this.deps.gateway.streamVoice({
        system: this.deps.systemPrompt,
        turns: this.turns.map(({ role, content }) => ({ role, content })),
        signal: abort.signal,
      });
      for await (const delta of stream) {
        if (abort.signal.aborted) break;
        if (metric.llmFirstTokenMs === undefined) {
          metric.llmFirstTokenMs = Date.now() - anchor;
        }
        assistantText += delta;
        for (const sentence of chunker.push(delta)) {
          if (!(await this.checkAndSpeak(sentence, metric, anchor, abort))) return;
        }
      }
      const tail = chunker.flush();
      if (tail && !abort.signal.aborted) {
        if (!(await this.checkAndSpeak(tail, metric, anchor, abort))) return;
      }
      // DEC-092 (fix a, owner-approved): an EMPTY completion must never
      // produce silence — no audio queued for this turn, nothing refused,
      // not aborted ⇒ speak the locked fallback and keep the call alive.
      if (!abort.signal.aborted && !metric.refusalReason && metric.ttfaMs === undefined) {
        metric.emptyReply = true;
        await this.speakChunk(VOICE_FALLBACK_LINE, metric, anchor, abort.signal);
        assistantText = VOICE_FALLBACK_LINE;
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("[respond]", (err as Error).message);
        this.deps.metrics.dropped(turn, `llm/tts error: ${(err as Error).message}`);
        this.failCall(`respond: ${(err as Error).message}`);
        return;
      }
    } finally {
      if (ackTimer) clearTimeout(ackTimer);
      if (stallTimer) clearInterval(stallTimer);
      // A refused turn already recorded its fallback text + assistant turn in
      // checkAndSpeak — don't double-push or mislabel it as a barge-in.
      if (!metric.refusalReason) {
        metric.assistantText = assistantText;
        metric.bargedIn = abort.signal.aborted && !metric.stalled;
        if (!abort.signal.aborted) metric.roundTripMs = Date.now() - anchor;
        this.turns.push({
          role: "assistant",
          content: metric.stalled
            ? `${assistantText} [stalled]`.trim()
            : assistantText || "[no reply]",
          atMs: Date.now() - this.startedAtMs,
        });
      }
      if (this.ttsAbort === abort) {
        this.speaking = false;
        this.ttsAbort = undefined;
      }
    }
  }

  /**
   * Deterministic checks per sentence BEFORE TTS. Clean → speak. Violation →
   * abort the turn, speak the constant fallback line, report the refusal.
   * Returns false when the turn was cut over to the fallback (caller stops
   * streaming this turn).
   */
  private async checkAndSpeak(
    sentence: string,
    metric: TurnMetric,
    anchor: number,
    abort: AbortController,
  ): Promise<boolean> {
    const violations = checkComposedVoiceTurn(sentence, { neverSay: this.deps.neverSay });
    if (violations.length === 0) {
      await this.speakChunk(sentence, metric, anchor, abort.signal);
      return true;
    }
    const v = violations[0]!;
    metric.refusalReason = v.reason;
    abort.abort(); // stop the LLM stream — the composed turn is dead
    this.deps.onRefusal?.(metric.turn, v.reason, v.detail);
    // The fallback is a CONSTANT (never composed) — speak it on a fresh signal.
    const fallbackAbort = new AbortController();
    this.ttsAbort = fallbackAbort;
    metric.assistantText = VOICE_FALLBACK_LINE;
    this.turns.push({
      role: "assistant",
      content: VOICE_FALLBACK_LINE,
      atMs: Date.now() - this.startedAtMs,
      refusalReason: v.reason,
    });
    try {
      await this.speakChunk(VOICE_FALLBACK_LINE, metric, anchor, fallbackAbort.signal);
    } finally {
      if (this.ttsAbort === fallbackAbort) {
        this.speaking = false;
        this.ttsAbort = undefined;
      }
    }
    return false;
  }

  /** Speak one sentence; first REPLY audio byte of the turn stamps TTFA.
   *  One retry on a transient TTS failure (idempotent — same sentence) before
   *  the event counts as dropped audio (cert run 6's Aura hiccups). */
  private async speakChunk(
    text: string,
    metric: TurnMetric,
    anchor: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || !text) return;
    this.deps.metrics.addTtsChars(text.length);
    // DEC-092: streaming transport first — ONE hot socket per call, each
    // sentence a Speak+Flush; the inter-sentence cost collapses from an
    // HTTPS connect+TTFB to a flush round-trip (the audible-gap killer).
    const stream = this.ensureTtsStream();
    if (stream) {
      this.speechCtx = { metric, anchor, signal };
      try {
        const timing = await stream.speak(text);
        this.deps.metrics.addTtsSentence(timing.firstAudioMs, timing.flushedMs);
        // Stamped on first proven stream sentence ("https" until then; a
        // later transport death flips it to "stream→https").
        if (this.deps.metrics.ttsTransportUsed === "https") {
          this.deps.metrics.ttsTransportUsed = "stream";
        }
        return;
      } catch (err) {
        if (signal.aborted || err instanceof TtsStreamCleared) return;
        // Transport death mid-call → PERMANENT https fallback for this call —
        // never a dead line; visible in logs + the summary transport field.
        this.ttsStreamFailed = true;
        this.deps.metrics.ttsTransportUsed = "stream→https";
        console.error("[tts] stream transport failed — https fallback:", (err as Error).message);
        try {
          this.ttsStream?.close();
        } catch {
          // already dead
        }
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const t0 = Date.now();
        let tFirst = 0;
        for await (const chunk of this.synthesize(this.deps.deepgramKey, this.deps.ttsModel, text, signal)) {
          if (signal.aborted) return;
          if (tFirst === 0) tFirst = Date.now();
          if (metric.ttfaMs === undefined) metric.ttfaMs = Date.now() - anchor;
          this.pacer.enqueueAudio(chunk);
        }
        if (tFirst > 0) this.deps.metrics.addTtsSentence(tFirst - t0, Date.now() - t0);
        return;
      } catch (err) {
        if (signal.aborted) return;
        if (attempt === 0 && metric.ttfaMs === undefined) {
          // Nothing spoken yet — a clean regenerate is inaudible to the caller.
          console.error(`[tts] retrying sentence after: ${(err as Error).message}`);
          continue;
        }
        this.deps.metrics.dropped(metric.turn, `tts: ${(err as Error).message}`);
        throw err;
      }
    }
  }

  /** Provider failure — constant goodbye, then end. NEVER a hung line. */
  private failCall(detail: string): void {
    if (this.closed) return;
    console.error("[session] provider failure:", detail);
    void this.sayConstantAndEnd(VOICE_FAILURE_GOODBYE, "provider_failure");
  }

  private endPolitely(reason: Extract<CallEndReason, "idle_timeout" | "max_duration">): void {
    if (this.closed) return;
    void this.sayConstantAndEnd(
      "Thanks for your time — I'll let you go. Goodbye!",
      reason,
    );
  }

  private async sayConstantAndEnd(line: string, reason: CallEndReason): Promise<void> {
    const abort = new AbortController();
    this.ttsAbort?.abort();
    this.ttsAbort = abort;
    this.speaking = true;
    this.turns.push({ role: "assistant", content: line, atMs: Date.now() - this.startedAtMs });
    try {
      await Promise.race([
        (async () => {
          for await (const chunk of this.synthesize(this.deps.deepgramKey, this.deps.ttsModel, line, abort.signal)) {
            if (abort.signal.aborted) return;
            this.pacer.enqueueAudio(chunk);
          }
          this.deps.metrics.addTtsChars(line.length);
          // Let the paced goodbye actually reach the ear before hanging up
          // (bounded — the outer race still hard-caps the whole farewell).
          const drainFrom = Date.now();
          while (this.pacer.outstandingMs() > 0 && Date.now() - drainFrom < 4500) {
            await new Promise((r) => setTimeout(r, 100));
          }
          await new Promise((r) => setTimeout(r, 250));
        })(),
        new Promise((r) => setTimeout(r, 6000)), // hard bound — never hang here
      ]);
    } catch {
      // best-effort goodbye — the end signal below is what matters
    } finally {
      this.deps.onEnd?.(reason);
    }
  }

  private armIdleTimer(): void {
    if (this.deps.idleTimeoutMs <= 0) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.endPolitely("idle_timeout"), this.deps.idleTimeoutMs);
  }

  /**
   * Harness entry point: deliver a full caller utterance and await the reply.
   * `bargeInAfterMs` fires a barge-in mid-reply so cancellation is measured
   * deterministically without telephony (spike-proven; the cert harness and
   * the barge-in regression test both drive this).
   */
  async driveTurn(userText: string, bargeInAfterMs?: number): Promise<void> {
    let bargeTimer: ReturnType<typeof setTimeout> | undefined;
    if (bargeInAfterMs !== undefined) {
      bargeTimer = setTimeout(() => {
        this.speechStartedAt = Date.now();
        if (this.speaking) this.bargeIn();
      }, bargeInAfterMs);
    }
    try {
      const commit: TurnCommit = { text: userText, source: "utterance_end", committedAt: Date.now() };
      this.turns.push({ role: "user", content: userText, atMs: Date.now() - (this.startedAtMs || Date.now()) });
      await this.respond(commit);
    } finally {
      if (bargeTimer) clearTimeout(bargeTimer);
    }
  }

  transcript(): VoiceTurn[] {
    return [...this.turns];
  }

  /**
   * Owner finding 1b: live caller activity for the silence ladder. A FINAL
   * (words) always counts; a bare VAD onset counts only while young
   * (ONSET_GRACE_MS) — on a VoIP leg, breath/line noise fires onsets with no
   * words, and before this fix each one slid the re-engage clock forever
   * (measured: `reengagedAtMs:null` through an 18s post-disclosure mute).
   */
  private callerActivityAt(): number {
    const grace = this.deps.onsetGraceMs ?? ONSET_GRACE_MS;
    const onsetLive =
      this.speechStartedAt > 0 &&
      Date.now() - this.speechStartedAt < grace &&
      // The whole wordless streak ages out together — repeated noise onsets
      // must not each restart the hold; only real words reset the streak.
      !(this.wordlessOnsetSince > 0 && Date.now() - this.wordlessOnsetSince >= grace);
    return Math.max(this.lastCallerFinalAt, onsetLive ? this.speechStartedAt : 0);
  }

  /** The 500ms silence-ladder tick: disclosure wire-end stamp → bridge (1c)
   *  → re-engage (fix b). Each rung one-shot; both suppressed by pending or
   *  live caller speech. */
  private silenceLadderTick(): void {
    if (this.disclosureDone && this.disclosureWireEndAt === 0 && this.pacer.outstandingMs() === 0) {
      this.disclosureWireEndAt = Date.now();
    }
    this.maybeBridge();
    this.maybeReengage();
  }

  /** Owner finding 1c: the disclosure's closing question got no caller words
   *  — proceed with the constant bridge line instead of waiting mute. Only
   *  before turn 1; once the conversation carries itself the window is over. */
  private maybeBridge(): void {
    if (this.closed || this.bridged || this.reengaged || this.speaking) return;
    if (this.turnCount > 0) {
      this.bridged = true; // conversation reached turn 1 — window closed for good
      return;
    }
    const ms = this.deps.bridgeAfterMs ?? 0;
    if (ms <= 0) return;
    if (this.disclosureWireEndAt === 0) return; // opening still playing out
    if (this.gate.hasPending()) return; // caller words being merged — hold
    const base = Math.max(this.disclosureWireEndAt, this.turnLastAudioAt, this.callerActivityAt());
    if (Date.now() - base < ms) return;
    void this.speakBridge();
  }

  /** DEC-092 (fix b): one-shot re-engage after MUTUAL silence — agent idle,
   *  no turn in flight, no committed-or-pending caller speech. Cancelled by
   *  LIVE caller speech (finding 1b: stale wordless onsets no longer count);
   *  never fires twice. */
  private maybeReengage(): void {
    if (this.closed || this.reengaged || this.speaking) return;
    if (this.gate.hasPending()) return; // uncommitted caller speech — hold
    const ms = this.deps.reengageAfterMs ?? 0;
    if (ms <= 0) return;
    const base = Math.max(this.turnLastAudioAt, this.callerActivityAt());
    if (base === 0) return; // nothing has happened yet
    if (Date.now() - base < ms) return;
    void this.speakReengage();
  }

  /** Speak the constant bridge line — best-effort, interruptible, once. */
  private async speakBridge(): Promise<void> {
    if (this.closed || this.speaking || this.bridged || this.reengaged) return;
    this.bridged = true;
    this.deps.metrics.bridgedAtMs = Date.now() - this.startedAtMs;
    const abort = new AbortController();
    this.ttsAbort = abort;
    this.speaking = true;
    this.speakingTurn = this.turnCount;
    this.turns.push({ role: "assistant", content: VOICE_BRIDGE_LINE, atMs: Date.now() - this.startedAtMs });
    this.deps.metrics.addTtsChars(VOICE_BRIDGE_LINE.length);
    try {
      const stream = this.ensureTtsStream();
      if (stream) {
        this.speechCtx = { anchor: Date.now(), signal: abort.signal };
        const timing = await stream.speak(VOICE_BRIDGE_LINE);
        this.deps.metrics.addTtsSentence(timing.firstAudioMs, timing.flushedMs);
      } else {
        for await (const chunk of this.synthesize(this.deps.deepgramKey, this.deps.ttsModel, VOICE_BRIDGE_LINE, abort.signal)) {
          if (abort.signal.aborted) return;
          this.pacer.enqueueAudio(chunk);
        }
      }
    } catch {
      // best-effort — a failed bridge must never fail the call
    } finally {
      if (this.ttsAbort === abort) {
        this.speaking = false;
        this.ttsAbort = undefined;
      }
    }
  }

  private async speakReengage(): Promise<void> {
    if (this.closed || this.speaking || this.reengaged) return;
    this.reengaged = true;
    this.deps.metrics.reengagedAtMs = Date.now() - this.startedAtMs;
    const abort = new AbortController();
    this.ttsAbort = abort;
    this.speaking = true;
    this.speakingTurn = this.turnCount;
    this.turns.push({ role: "assistant", content: VOICE_REENGAGE_LINE, atMs: Date.now() - this.startedAtMs });
    this.deps.metrics.addTtsChars(VOICE_REENGAGE_LINE.length);
    try {
      const stream = this.ensureTtsStream();
      if (stream) {
        this.speechCtx = { anchor: Date.now(), signal: abort.signal };
        const timing = await stream.speak(VOICE_REENGAGE_LINE);
        this.deps.metrics.addTtsSentence(timing.firstAudioMs, timing.flushedMs);
      } else {
        for await (const chunk of this.synthesize(this.deps.deepgramKey, this.deps.ttsModel, VOICE_REENGAGE_LINE, abort.signal)) {
          if (abort.signal.aborted) return;
          this.pacer.enqueueAudio(chunk);
        }
      }
    } catch {
      // best-effort — a failed re-engage must never fail the call
    } finally {
      if (this.ttsAbort === abort) {
        this.speaking = false;
        this.ttsAbort = undefined;
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const tail = this.gate.flushPending();
    if (tail) this.turns.push({ role: "user", content: tail, atMs: Date.now() - this.startedAtMs });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.reengageTimer) clearInterval(this.reengageTimer);
    this.ttsAbort?.abort();
    this.ttsStream?.close();
    this.pacer.close();
    this.stt?.close();
    if (this.loopDelay) {
      this.loopDelay.disable();
      const ns = this.loopDelay;
      this.deps.metrics.eventLoopMs = {
        p50: Math.round(ns.percentile(50) / 1e6),
        p95: Math.round(ns.percentile(95) / 1e6),
        max: Math.round(ns.max / 1e6),
      };
    }
  }

  /** Test/harness hooks — drive the STT callbacks without a socket. */
  get testHooks() {
    return {
      speechStarted: () => this.onSpeechStarted(),
      /** Routes through the REAL final path (ladder clocks + gate) — tests
       *  exercise what the wire exercises. */
      final: (t: string, speechFinal = true) => this.onCallerFinal(t, speechFinal),
      utteranceEnd: () => this.gate.onUtteranceEnd(),
      isSpeaking: () => this.speaking,
      outstandingMs: () => this.pacer.outstandingMs(),
    };
  }
}
