/**
 * TurnGate (P3.1, DEC-078) — the deterministic turn-commit engine, the fix
 * for the ADR's #1 finding (Deepgram endpointing fragmenting real speech into
 * "…we run" / "afternoon," / "sales." and the agent replying mid-utterance).
 *
 * Rules (the plan-comment proposal, revised by certification runs 3/4):
 * 1. A speech_final phrase ending in a QUESTION MARK → COMMIT NOW.
 *    Interrogative punctuation is structure-driven and safe to trust; runs
 *    3/4 proved periods are NOT — smart_format's punctuator writes "." off
 *    the same mid-thought pause the endpointer saw ("…we run." on the ADR's
 *    fragment), so a period fast-path replies mid-utterance.
 * 2. Everything else → wait for UtteranceEnd (silence-anchored server-side,
 *    word-timestamp-based — no client VAD race). A caller who trails off
 *    still gets a reply after utterance_end_ms of true silence; the ack clip
 *    masks the wait.
 * 3. The continuation-window hold remains ONLY as a wall-clock backstop for
 *    a missed UtteranceEnd event.
 * 4. SpeechStarted cancels a pending hold — the caller kept going.
 *
 * Pure event machine — timers injected, so the ADR's real fragmented call is
 * a deterministic unit fixture.
 */

export type TurnCommitSource = "speech_final" | "utterance_end" | "continuation_expiry";

export interface TurnCommit {
  text: string;
  source: TurnCommitSource;
  /** now() at the committing event — the TTFA anchor (ADR's anchor). */
  committedAt: number;
}

export interface TurnGateOptions {
  continuationWindowMs: number;
  onCommit: (commit: TurnCommit) => void;
  /** Injectable for deterministic tests; default real timers. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

/** Interrogative ending, optionally inside a closing quote/bracket — the ONLY
 *  punctuation trusted for a fast commit (see the header). */
const QUESTION_RE = /\?["')\]]?$/;

export class TurnGate {
  private pending = "";
  private holdHandle: unknown;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;

  constructor(private readonly opts: TurnGateOptions) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    this.now = opts.now ?? Date.now;
  }

  /** A finalized STT fragment (is_final). Accumulates; evaluates on speech_final. */
  onFinal(text: string, speechFinal: boolean): void {
    const t = text.trim();
    if (t) {
      this.pending = this.pending ? `${this.pending} ${t}` : t;
      this.clearHold();
    }
    if (!this.pending) return;
    if (speechFinal) this.evaluate();
  }

  /** Deepgram's hard stop — the caller is truly silent. Commit what's pending. */
  onUtteranceEnd(): void {
    if (this.pending) this.commit("utterance_end");
  }

  /** VAD onset — the caller resumed; whatever we were holding continues. */
  onSpeechStarted(): void {
    this.clearHold();
  }

  /** Anything buffered but uncommitted (call teardown → transcript tail). */
  flushPending(): string {
    const rest = this.pending;
    this.pending = "";
    this.clearHold();
    return rest;
  }

  private evaluate(): void {
    if (QUESTION_RE.test(this.pending)) {
      this.commit("speech_final"); // rule 1 — a question, reply now
    } else {
      this.armHold(); // rules 2/3 — UtteranceEnd commits; this hold backstops
    }
  }

  private armHold(): void {
    this.clearHold();
    this.holdHandle = this.setTimer(() => {
      this.holdHandle = undefined;
      if (this.pending) this.commit("continuation_expiry"); // rule 3's soft twin
    }, this.opts.continuationWindowMs);
  }

  private clearHold(): void {
    if (this.holdHandle !== undefined) {
      this.clearTimer(this.holdHandle);
      this.holdHandle = undefined;
    }
  }

  private commit(source: TurnCommitSource): void {
    this.clearHold();
    const text = this.pending;
    this.pending = "";
    this.opts.onCommit({ text, source, committedAt: this.now() });
  }
}
