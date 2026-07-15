/**
 * TurnGate (P3.1) — deterministic unit fixtures for the turn-commit rules,
 * including the ADR's REAL fragmented-call transcript ("…we run" /
 * "afternoon," / "sales.") which must produce exactly ONE commit. Timers are
 * injected — no wall-clock in the loop.
 */
import { describe, expect, it } from "vitest";
import { TurnGate, type TurnCommit } from "../src/turn-gate";

/** Manual timer harness — fire() runs the pending hold synchronously. */
function harness(continuationWindowMs = 900) {
  const commits: TurnCommit[] = [];
  let pendingTimer: (() => void) | undefined;
  let clock = 1_000;
  const gate = new TurnGate({
    continuationWindowMs,
    onCommit: (c) => commits.push(c),
    setTimer: (fn) => {
      pendingTimer = fn;
      return fn;
    },
    clearTimer: () => {
      pendingTimer = undefined;
    },
    now: () => clock,
  });
  return {
    gate,
    commits,
    fireHold: () => {
      const fn = pendingTimer;
      pendingTimer = undefined;
      fn?.();
    },
    holdArmed: () => pendingTimer !== undefined,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe("TurnGate — rule 1: only QUESTIONS commit immediately (runs 3/4)", () => {
  it("a speech_final phrase ending in ? commits with zero added latency", () => {
    const h = harness();
    h.gate.onFinal("Hey, who is this?", true);
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.text).toBe("Hey, who is this?");
    expect(h.commits[0]!.source).toBe("speech_final");
    expect(h.holdArmed()).toBe(false);
  });

  it("a question mark inside a closing quote still counts", () => {
    const h = harness();
    h.gate.onFinal('You mean "now?"', true);
    expect(h.commits).toHaveLength(1);
  });

  it("a PERIOD does NOT fast-commit — smart_format writes '.' off mid-thought pauses", () => {
    const h = harness();
    h.gate.onFinal("So we are doing currently, we run.", true);
    expect(h.commits).toHaveLength(0);
    expect(h.holdArmed()).toBe(true); // the backstop — UtteranceEnd is the commit path
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.source).toBe("utterance_end");
  });
});

describe("TurnGate — the ADR fragmentation case (the #1 finding)", () => {
  it('"…we run." / "afternoon," / "sales." → exactly ONE merged commit at true silence', () => {
    const h = harness();
    // Fragment 1: speech_final, punctuator may even write "." — NEVER a
    // commit (runs 3/4: the period is pause-derived, not semantic).
    h.gate.onFinal("So we are doing currently, we run.", true);
    expect(h.commits).toHaveLength(0);
    expect(h.holdArmed()).toBe(true);
    // Caller resumes — the backstop hold is cancelled.
    h.gate.onSpeechStarted();
    expect(h.holdArmed()).toBe(false);
    // Fragment 2: still mid-thought ("afternoon,") → still nothing.
    h.gate.onFinal("afternoon,", true);
    expect(h.commits).toHaveLength(0);
    h.gate.onSpeechStarted();
    // Fragment 3 + Deepgram's silence-anchored UtteranceEnd → ONE merged commit.
    h.gate.onFinal("sales.", true);
    expect(h.commits).toHaveLength(0);
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.text).toBe("So we are doing currently, we run. afternoon, sales.");
    expect(h.commits[0]!.source).toBe("utterance_end");
  });
});

describe("TurnGate — rule 2/3: holds and fallbacks", () => {
  it("a trailing-off caller still gets a reply (continuation window expiry)", () => {
    const h = harness();
    h.gate.onFinal("I guess we could", true);
    expect(h.commits).toHaveLength(0);
    h.fireHold();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.source).toBe("continuation_expiry");
    expect(h.commits[0]!.text).toBe("I guess we could");
  });

  it("UtteranceEnd (true silence) hard-commits whatever is pending", () => {
    const h = harness();
    h.gate.onFinal("well maybe", false); // interim finalization, no speech_final
    expect(h.commits).toHaveLength(0);
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.source).toBe("utterance_end");
  });

  it("UtteranceEnd with nothing pending is a no-op (no empty replies)", () => {
    const h = harness();
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(0);
  });

  it("interim (non-speech_final) finals accumulate silently until silence commits", () => {
    const h = harness();
    h.gate.onFinal("we are on a", false);
    expect(h.commits).toHaveLength(0);
    expect(h.holdArmed()).toBe(false); // interim finals never arm the backstop
    h.gate.onFinal("legacy tool.", true);
    expect(h.commits).toHaveLength(0); // a period never fast-commits (runs 3/4)
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.text).toBe("we are on a legacy tool.");
  });

  it("empty finals never commit or arm anything", () => {
    const h = harness();
    h.gate.onFinal("", true);
    h.gate.onFinal("   ", false);
    expect(h.commits).toHaveLength(0);
    expect(h.holdArmed()).toBe(false);
  });

  it("commit anchors at the committing event's clock (the ADR anchor)", () => {
    const h = harness();
    h.tick(500);
    h.gate.onFinal("Is that right?", true);
    expect(h.commits[0]!.committedAt).toBe(1_500);
  });

  it("flushPending returns the tail for the transcript and clears state", () => {
    const h = harness();
    h.gate.onFinal("one last", true);
    expect(h.gate.flushPending()).toBe("one last");
    expect(h.gate.flushPending()).toBe("");
    h.fireHold(); // a stale hold must not commit after flush
    expect(h.commits).toHaveLength(0);
  });
});
