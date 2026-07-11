/**
 * One phone call's real-time loop, transport-agnostic so the same logic drives
 * a live Twilio Media Stream and the local fake-provider harness (the barge-in
 * unit test). The bridge feeds it caller mulaw frames and an audio sink; this
 * class runs STT → Claude → TTS and cancels in-flight TTS on barge-in.
 */
import type { AiGateway } from "@clientforce/ai";
import { openSttStream, synthesizeAura, type SttStream } from "./deepgram";
import { SentenceChunker, SYSTEM_PROMPT, type VoiceTurn } from "./brain";
import type { MetricsCollector, TurnMetric } from "./metrics";

export interface CallSessionDeps {
  gateway: AiGateway;
  metrics: MetricsCollector;
  deepgramKey: string;
  /** Queue mulaw/8k audio to the caller. */
  sendAudio: (mulaw: Buffer) => void;
  /** Empty the caller's playback buffer (Twilio `clear`) — barge-in. */
  clearPlayback: () => void;
  /** Optional greeting spoken as soon as the call connects. */
  greeting?: string;
  /** Injectable for the local harness; defaults to the real Deepgram clients. */
  openStt?: typeof openSttStream;
  synthesize?: typeof synthesizeAura;
}

export class CallSession {
  private readonly turns: VoiceTurn[] = [];
  private stt?: SttStream;
  private speaking = false;
  /** Aborts the in-flight LLM+TTS on barge-in. */
  private ttsAbort?: AbortController;
  private utteranceStartedAt = 0;
  private speechStartedAt = 0;
  private turnCount = 0;
  /** The reply turn currently being spoken (0 = greeting). */
  private speakingTurn = 0;
  private pendingFinal = "";
  private closed = false;
  private readonly openStt: typeof openSttStream;
  private readonly synthesize: typeof synthesizeAura;

  constructor(private readonly deps: CallSessionDeps) {
    this.openStt = deps.openStt ?? openSttStream;
    this.synthesize = deps.synthesize ?? synthesizeAura;
  }

  start(): void {
    this.deps.metrics.markCallStart();
    this.stt = this.openStt(this.deps.deepgramKey, {
      onSpeechStarted: () => this.onSpeechStarted(),
      onFinal: (text) => this.onFinal(text),
      onUtteranceEnd: () => this.onUtteranceEnd(),
      onError: (err) => console.error("[stt]", err.message),
      onClose: () => {},
    });
    if (this.deps.greeting) {
      this.turns.push({ role: "assistant", content: this.deps.greeting });
      void this.speakGreeting(this.deps.greeting);
    }
  }

  /** Speak the opening line — interruptible, but not counted as a reply turn. */
  private async speakGreeting(text: string): Promise<void> {
    const abort = new AbortController();
    this.ttsAbort = abort;
    this.speaking = true;
    try {
      for (const sentence of new SentenceChunker().push(`${text} `)) {
        for await (const chunk of this.synthesize(this.deps.deepgramKey, sentence, abort.signal)) {
          if (abort.signal.aborted) return;
          this.deps.sendAudio(chunk);
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) console.error("[greeting]", (err as Error).message);
    } finally {
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

  /** VAD onset. If the agent is mid-utterance, this is a barge-in. */
  private onSpeechStarted(): void {
    this.speechStartedAt = Date.now();
    if (this.speaking) this.bargeIn();
    if (this.utteranceStartedAt === 0) this.utteranceStartedAt = Date.now();
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

  private onFinal(text: string): void {
    if (text.trim()) {
      this.pendingFinal = `${this.pendingFinal} ${text}`.trim();
      if (this.utteranceStartedAt === 0) this.utteranceStartedAt = Date.now();
    }
  }

  /** Endpointing fired — the caller's turn is complete; respond. */
  private onUtteranceEnd(): void {
    const userText = this.pendingFinal.trim();
    this.pendingFinal = "";
    if (!userText) return;
    const utteranceEndAt = this.utteranceStartedAt || Date.now();
    this.utteranceStartedAt = 0;
    this.turns.push({ role: "user", content: userText });
    void this.respond(userText, utteranceEndAt);
  }

  private async respond(userText: string, _utteranceStartAt: number): Promise<void> {
    const turn = ++this.turnCount;
    const anchor = Date.now(); // utterance-end → first audio is TTFA
    const chunker = new SentenceChunker();
    const abort = new AbortController();
    this.ttsAbort = abort;
    this.speaking = true;
    this.speakingTurn = turn;

    let assistantText = "";
    const metric: TurnMetric = { turn, userText, assistantText: "", bargedIn: false };
    this.deps.metrics.turns.push(metric);

    try {
      const stream = this.deps.gateway.streamVoice({
        system: SYSTEM_PROMPT,
        turns: this.turns,
        signal: abort.signal,
      });
      for await (const delta of stream) {
        if (abort.signal.aborted) break;
        if (metric.llmFirstTokenMs === undefined) {
          metric.llmFirstTokenMs = Date.now() - anchor;
        }
        assistantText += delta;
        for (const sentence of chunker.push(delta)) {
          await this.speakChunk(sentence, metric, anchor, abort.signal);
        }
      }
      const tail = chunker.flush();
      if (tail && !abort.signal.aborted) await this.speakChunk(tail, metric, anchor, abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error("[respond]", (err as Error).message);
        this.deps.metrics.dropped(turn, `llm/tts error: ${(err as Error).message}`);
      }
    } finally {
      metric.assistantText = assistantText;
      metric.bargedIn = abort.signal.aborted;
      if (!abort.signal.aborted) metric.roundTripMs = Date.now() - anchor;
      this.turns.push({ role: "assistant", content: assistantText || "[no reply]" });
      if (this.ttsAbort === abort) {
        this.speaking = false;
        this.ttsAbort = undefined;
      }
    }
  }

  /** Speak one sentence; first audio byte of the turn stamps TTFA. */
  private async speakChunk(
    text: string,
    metric: TurnMetric,
    anchor: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || !text) return;
    this.deps.metrics.addTtsChars(text.length);
    try {
      for await (const chunk of this.synthesize(this.deps.deepgramKey, text, signal)) {
        if (signal.aborted) return;
        if (metric.ttfaMs === undefined) metric.ttfaMs = Date.now() - anchor;
        this.deps.sendAudio(chunk);
      }
    } catch (err) {
      if (!signal.aborted) {
        this.deps.metrics.dropped(metric.turn, `tts: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Synthetic-harness entry point: deliver a full caller utterance and await
   * the agent's reply. `bargeInAfterMs`, if set, fires a barge-in mid-reply so
   * the harness can measure cancellation deterministically without telephony.
   */
  async driveTurn(userText: string, bargeInAfterMs?: number): Promise<void> {
    this.turns.push({ role: "user", content: userText });
    this.utteranceStartedAt = Date.now();
    let bargeTimer: ReturnType<typeof setTimeout> | undefined;
    if (bargeInAfterMs !== undefined) {
      bargeTimer = setTimeout(() => {
        this.speechStartedAt = Date.now();
        if (this.speaking) this.bargeIn();
      }, bargeInAfterMs);
    }
    try {
      await this.respond(userText, this.utteranceStartedAt);
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
    this.ttsAbort?.abort();
    this.stt?.close();
  }

  /** For local drive-in of the harness: expose the STT callbacks. */
  get testHooks() {
    return {
      speechStarted: () => this.onSpeechStarted(),
      final: (t: string) => this.onFinal(t),
      utteranceEnd: () => this.onUtteranceEnd(),
      isSpeaking: () => this.speaking,
    };
  }
}
