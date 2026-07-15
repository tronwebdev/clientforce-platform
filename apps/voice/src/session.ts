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
import { checkComposedVoiceTurn, VOICE_FALLBACK_LINE, VOICE_FAILURE_GOODBYE } from "@clientforce/channels";
import { openSttStream, synthesizeAura, type SttParams, type SttStream, type Synthesize } from "./deepgram";
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
}

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
  private readonly openStt: typeof openSttStream;
  private readonly synthesize: Synthesize;

  constructor(private readonly deps: CallSessionDeps) {
    this.openStt = deps.openStt ?? openSttStream;
    this.synthesize = deps.synthesize ?? synthesizeAura;
    this.gate = new TurnGate({ onCommit: (commit) => this.onTurnCommit(commit) });
  }

  start(): void {
    this.deps.metrics.markCallStart();
    this.startedAtMs = Date.now();
    this.stt = this.openStt(this.deps.deepgramKey, this.deps.sttParams, {
      onSpeechStarted: () => this.onSpeechStarted(),
      onFinal: (text, speechFinal) => this.gate.onFinal(text, speechFinal),
      onUtteranceEnd: () => this.gate.onUtteranceEnd(),
      onError: (err) => console.error("[stt]", err.message),
      onFatal: () => this.failCall("stt stream lost"),
    });
    this.armIdleTimer();
    if (this.deps.maxCallMs > 0) {
      this.maxTimer = setTimeout(() => this.endPolitely("max_duration"), this.deps.maxCallMs);
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
      for (const sentence of new SentenceChunker().push(`${this.deps.disclosure} `)) {
        this.deps.metrics.addTtsChars(sentence.length);
        for await (const chunk of this.synthesize(this.deps.deepgramKey, this.deps.ttsModel, sentence, abort.signal)) {
          if (abort.signal.aborted) {
            interrupted = true;
            return;
          }
          this.deps.sendAudio(chunk);
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

  /** VAD onset — if the agent is mid-utterance, this is a barge-in. */
  private onSpeechStarted(): void {
    this.speechStartedAt = Date.now();
    this.armIdleTimer();
    if (this.speaking) this.bargeIn();
  }

  private bargeIn(): void {
    const turn = this.speakingTurn;
    this.deps.clearPlayback(); // drop already-queued audio immediately
    this.ttsAbort?.abort(); // cancel LLM+TTS generation
    this.speaking = false;
    this.deps.metrics.bargeIns.push({
      turn,
      clearLatencyMs: Date.now() - this.speechStartedAt,
    });
    const current = this.turns[this.turns.length - 1];
    if (current?.role === "assistant") current.content += " [interrupted]";
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
        this.deps.sendAudio(clip);
      }, this.deps.ackAfterMs);
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
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("[respond]", (err as Error).message);
        this.deps.metrics.dropped(turn, `llm/tts error: ${(err as Error).message}`);
        this.failCall(`respond: ${(err as Error).message}`);
        return;
      }
    } finally {
      if (ackTimer) clearTimeout(ackTimer);
      // A refused turn already recorded its fallback text + assistant turn in
      // checkAndSpeak — don't double-push or mislabel it as a barge-in.
      if (!metric.refusalReason) {
        metric.assistantText = assistantText;
        metric.bargedIn = abort.signal.aborted;
        if (!abort.signal.aborted) metric.roundTripMs = Date.now() - anchor;
        this.turns.push({
          role: "assistant",
          content: assistantText || "[no reply]",
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

  /** Speak one sentence; first REPLY audio byte of the turn stamps TTFA. */
  private async speakChunk(
    text: string,
    metric: TurnMetric,
    anchor: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || !text) return;
    this.deps.metrics.addTtsChars(text.length);
    try {
      for await (const chunk of this.synthesize(this.deps.deepgramKey, this.deps.ttsModel, text, signal)) {
        if (signal.aborted) return;
        if (metric.ttfaMs === undefined) metric.ttfaMs = Date.now() - anchor;
        this.deps.sendAudio(chunk);
      }
    } catch (err) {
      if (!signal.aborted) {
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
            this.deps.sendAudio(chunk);
          }
          this.deps.metrics.addTtsChars(line.length);
          // Give Twilio's buffer a moment to drain the goodbye.
          await new Promise((r) => setTimeout(r, 1500));
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
      const commit: TurnCommit = { text: userText, source: "speech_final", committedAt: Date.now() };
      this.turns.push({ role: "user", content: userText, atMs: Date.now() - (this.startedAtMs || Date.now()) });
      await this.respond(commit);
    } finally {
      if (bargeTimer) clearTimeout(bargeTimer);
    }
  }

  transcript(): VoiceTurn[] {
    return [...this.turns];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const tail = this.gate.flushPending();
    if (tail) this.turns.push({ role: "user", content: tail, atMs: Date.now() - this.startedAtMs });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.ttsAbort?.abort();
    this.stt?.close();
  }

  /** Test/harness hooks — drive the STT callbacks without a socket. */
  get testHooks() {
    return {
      speechStarted: () => this.onSpeechStarted(),
      final: (t: string, speechFinal = true) => this.gate.onFinal(t, speechFinal),
      utteranceEnd: () => this.gate.onUtteranceEnd(),
      isSpeaking: () => this.speaking,
    };
  }
}
