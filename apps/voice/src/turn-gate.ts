/**
 * TurnGate (P3.1, DEC-078) — the deterministic turn-commit engine, the fix
 * for the ADR's #1 finding (Deepgram endpointing fragmenting real speech into
 * "…we run" / "afternoon," / "sales." and the agent replying mid-utterance).
 *
 * Rules (the plan-comment proposal, revised by certification runs 3–5):
 * 1. A speech_final phrase ending in a QUESTION MARK → COMMIT NOW.
 *    Interrogative punctuation is structure-driven and safe to trust; the
 *    runs proved periods are NOT — smart_format's punctuator writes "." off
 *    the same mid-thought pause the endpointer saw ("…we run."), so a period
 *    fast-path replies mid-utterance.
 * 2. Everything else commits ONLY at UtteranceEnd — silence-anchored
 *    server-side on word timestamps, so it CANNOT fire while the caller is
 *    speaking. Run 5 killed the wall-clock backstop hold that remained:
 *    Deepgram doesn't always re-emit SpeechStarted for a resumed fragment,
 *    so any client-side timer eventually fires mid-utterance. No timer, no
 *    race surface. A caller who trails off gets a reply after
 *    utterance_end_ms of true silence; the ack clip masks the wait.
 *
 * Pure event machine — the ADR's real fragmented call is a deterministic
 * unit fixture.
 */

export type TurnCommitSource = "speech_final" | "utterance_end";

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

/** Interrogative ending, optionally inside a closing quote/bracket — the ONLY
 *  punctuation trusted for a fast commit (see the header). */
const QUESTION_RE = /\?["')\]]?$/;

export class TurnGate {
  private pending = "";
  private readonly now: () => number;

  constructor(private readonly opts: TurnGateOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** A finalized STT fragment (is_final). Accumulates; questions commit fast. */
  onFinal(text: string, speechFinal: boolean): void {
    const t = text.trim();
    if (t) this.pending = this.pending ? `${this.pending} ${t}` : t;
    if (!this.pending) return;
    if (speechFinal && QUESTION_RE.test(this.pending)) {
      this.commit("speech_final"); // rule 1 — a question, reply now
    }
  }

  /** Deepgram's silence-anchored stop — the caller is truly done. */
  onUtteranceEnd(): void {
    if (this.pending) this.commit("utterance_end");
  }

  /** VAD onset — nothing to cancel anymore; kept for interface clarity. */
  onSpeechStarted(): void {
    // rule 2: commits are silence-anchored server-side; no client state here.
  }

  /** Anything buffered but uncommitted (call teardown → transcript tail). */
  flushPending(): string {
    const rest = this.pending;
    this.pending = "";
    return rest;
  }

  private commit(source: TurnCommitSource): void {
    const text = this.pending;
    this.pending = "";
    this.opts.onCommit({ text, source, committedAt: this.now() });
  }
}
