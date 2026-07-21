/**
 * TurnGate (P3.1, DEC-078) — the deterministic turn-commit engine, the fix
 * for the ADR's #1 finding (Deepgram endpointing fragmenting real speech into
 * "…we run" / "afternoon," / "sales." and the agent replying mid-utterance).
 *
 * THE rule, arrived at empirically (certification runs 3–7): a turn commits
 * ONLY at UtteranceEnd — Deepgram's silence-anchored stop, computed
 * server-side from word timestamps, which structurally cannot fire while the
 * caller is speaking. Every punctuation- or timer-based fast path was
 * falsified in a real run:
 * - terminal-punctuation commits: smart_format writes "." off the SAME
 *   mid-thought pause the endpointer saw ("…we run." — run 4, 17 events);
 * - question-mark commits: an interrogative PREFIX gets "?" at a pause
 *   ("How is that different from?" — run 7, 8 events);
 * - any client-side wall-clock hold: SpeechStarted is not re-emitted for
 *   resumed fragments, so the timer eventually expires mid-utterance
 *   (run 5, 4 events).
 * Finals accumulate and MERGE across fragments; the ack clip masks the
 * utterance_end_ms wait. Real pauses longer than utterance_end_ms still
 * commit — that is the inherent tradeoff of silence-anchored turn-taking,
 * shared with every production voice stack, and tunable via
 * VOICE_STT_UTTERANCE_END_MS.
 *
 * Pure event machine — the ADR's real fragmented call is a deterministic
 * unit fixture.
 */

export type TurnCommitSource = "utterance_end";

export interface TurnCommit {
  text: string;
  source: TurnCommitSource;
  /** now() at the committing event — the TTFA anchor (ADR's anchor). */
  committedAt: number;
}

export interface TurnGateOptions {
  onCommit: (commit: TurnCommit) => void;
  /** Injectable for deterministic tests. */
  now?: () => number;
}

export class TurnGate {
  private pending = "";
  private readonly now: () => number;

  constructor(private readonly opts: TurnGateOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** A finalized STT fragment (is_final) — accumulate and merge. */
  onFinal(text: string, _speechFinal: boolean): void {
    const t = text.trim();
    if (t) this.pending = this.pending ? `${this.pending} ${t}` : t;
  }

  /** Deepgram's silence-anchored stop — the caller is truly done. Commit. */
  onUtteranceEnd(): void {
    if (!this.pending) return;
    const text = this.pending;
    this.pending = "";
    this.opts.onCommit({ text, source: "utterance_end", committedAt: this.now() });
  }

  /** VAD onset — the gate holds no client-side state to cancel. */
  onSpeechStarted(): void {
    // commits are silence-anchored server-side; nothing to do.
  }

  /** Anything buffered but uncommitted (call teardown → transcript tail). */
  flushPending(): string {
    const rest = this.pending;
    this.pending = "";
    return rest;
  }

  /** Peek: the caller said something not yet committed (blocks re-engage —
   *  DEC-092: never speak over speech the gate is still merging). */
  hasPending(): boolean {
    return this.pending.length > 0;
  }
}
