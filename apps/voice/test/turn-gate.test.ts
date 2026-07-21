/**
 * TurnGate (P3.1) — deterministic unit fixtures for THE commit rule arrived
 * at by certification runs 3–7: a turn commits ONLY at the silence-anchored
 * UtteranceEnd; every punctuation/timer fast path was falsified in a real
 * run (see the source header). The ADR's real fragmented call must produce
 * exactly ONE merged commit.
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

describe("TurnGate — silence-anchored commits only (runs 3-7)", () => {
  it("no punctuation ever fast-commits — periods and question marks alike", () => {
    const h = harness();
    // Run 4's falsifier: pause-derived period on a fragment.
    h.gate.onFinal("So we are doing currently, we run.", true);
    expect(h.commits).toHaveLength(0);
    // Run 7's falsifier: pause-derived "?" on an interrogative prefix.
    const h2 = harness();
    h2.gate.onFinal("How is that different from?", true);
    expect(h2.commits).toHaveLength(0);
    h2.gate.onFinal("what we use now?", true);
    h2.gate.onUtteranceEnd();
    expect(h2.commits).toHaveLength(1);
    expect(h2.commits[0]!.text).toBe("How is that different from? what we use now?");
  });

  it('the ADR fragmentation case: "…we run." / "afternoon," / "sales." → ONE merged commit', () => {
    const h = harness();
    h.gate.onFinal("So we are doing currently, we run.", true);
    h.gate.onSpeechStarted(); // caller resumes — a no-op for the gate
    h.gate.onFinal("afternoon,", true);
    h.gate.onSpeechStarted();
    h.gate.onFinal("sales.", true);
    expect(h.commits).toHaveLength(0);
    h.gate.onUtteranceEnd(); // 1500ms of TRUE silence — now, and only now
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.text).toBe("So we are doing currently, we run. afternoon, sales.");
    expect(h.commits[0]!.source).toBe("utterance_end");
  });

  it("a trailing-off caller still gets a reply at UtteranceEnd", () => {
    const h = harness();
    h.gate.onFinal("I guess we could", true);
    expect(h.commits).toHaveLength(0);
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]!.text).toBe("I guess we could");
  });

  it("UtteranceEnd with nothing pending is a no-op (no empty replies)", () => {
    const h = harness();
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(0);
  });

  it("interim and speech_final finals accumulate identically until silence", () => {
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
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(0);
  });

  it("commit anchors at the committing event's clock (the ADR anchor)", () => {
    const h = harness();
    h.gate.onFinal("Sounds good.", true);
    h.tick(500);
    h.gate.onUtteranceEnd();
    expect(h.commits[0]!.committedAt).toBe(1_500);
  });

  it("flushPending returns the tail for the transcript and clears state", () => {
    const h = harness();
    h.gate.onFinal("one last", true);
    expect(h.gate.flushPending()).toBe("one last");
    expect(h.gate.flushPending()).toBe("");
    h.gate.onUtteranceEnd();
    expect(h.commits).toHaveLength(0);
  });
});
