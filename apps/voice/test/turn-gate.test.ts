/**
 * TurnGate (P3.1) — deterministic unit fixtures for the turn-commit rules as
 * revised by certification runs 3–5: a speech_final QUESTION commits fast;
 * everything else commits ONLY at the silence-anchored UtteranceEnd (no
 * client-side timer exists — no race surface). The ADR's real fragmented
 * call must produce exactly ONE merged commit.
 */
import { describe, expect, it } from "vitest";
import { TurnGate, type TurnCommit } from "../src/turn-gate";

function harness() {
  const commits: TurnCommit[] = [];
  let clock = 1_000;
  const gate = new TurnGate({ onCommit: (c) => commits.push(c), now: () => clock });
  return {
    gate,
    commits,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe("TurnGate — rule 1: only QUESTIONS commit immediately (runs 3-5)", () => {
  it("a speech_final phrase ending in ? commits with zero added latency", () => {
    const h = harness();
    h.gate.onFinal("Hey, who is this?", true);
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.text).toBe("Hey, who is this?");
    expect(h.commits[0]!.source).toBe("speech_final");
  });

  it("a question mark inside a closing quote still counts", () => {
    const h = harness();
    h.gate.onFinal('You mean "now?"', true);
    expect(h.commits).toHaveLength(1);
  });

  it("a PERIOD never fast-commits — smart_format writes '.' off mid-thought pauses", () => {
    const h = harness();
    h.gate.onFinal("So we are doing currently, we run.", true);
    expect(h.commits).toHaveLength(0);
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.source).toBe("utterance_end");
  });

  it("an interim (non-speech_final) question does not fast-commit yet", () => {
    const h = harness();
    h.gate.onFinal("what does it do?", false);
    expect(h.commits).toHaveLength(0);
    h.gate.onFinal("", true); // the closing speech_final arrives empty
    expect(h.commits).toHaveLength(1); // pending ends with ? and is now final
  });
});

describe("TurnGate — the ADR fragmentation case (the #1 finding)", () => {
  it('"…we run." / "afternoon," / "sales." → exactly ONE merged commit at true silence', () => {
    const h = harness();
    // Fragment 1: speech_final, punctuator may even write "." — NEVER a
    // commit (runs 3-5: the period is pause-derived, not semantic).
    h.gate.onFinal("So we are doing currently, we run.", true);
    expect(h.commits).toHaveLength(0);
    h.gate.onSpeechStarted(); // caller resumes — a no-op for the gate
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

describe("TurnGate — rule 2: silence-anchored commits", () => {
  it("a trailing-off caller still gets a reply at UtteranceEnd", () => {
    const h = harness();
    h.gate.onFinal("I guess we could", true);
    expect(h.commits).toHaveLength(0);
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.source).toBe("utterance_end");
    expect(h.commits[0]!.text).toBe("I guess we could");
  });

  it("UtteranceEnd with nothing pending is a no-op (no empty replies)", () => {
    const h = harness();
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(0);
  });

  it("interim finals accumulate silently until silence commits the merge", () => {
    const h = harness();
    h.gate.onFinal("we are on a", false);
    h.gate.onFinal("legacy tool.", true);
    expect(h.commits).toHaveLength(0);
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.text).toBe("we are on a legacy tool.");
  });

  it("empty finals never commit", () => {
    const h = harness();
    h.gate.onFinal("", true);
    h.gate.onFinal("   ", false);
    expect(h.commits).toHaveLength(0);
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
    h.gate.onUtteranceEnd(); // nothing left to commit
    expect(h.commits).toHaveLength(0);
  });
});
