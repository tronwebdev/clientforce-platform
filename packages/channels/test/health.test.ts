/**
 * P5 W1 (DEC-083): the score fixture matrix — the documented formula pinned
 * case by case (weights, component zero-points, the DEC-019 breach anchors,
 * delivery-signal renormalization, F1 sample floors, hysteresis band).
 */
import { describe, expect, it } from "vitest";
import {
  BOUNCE_ZERO_AT,
  computeSenderHealth,
  HEALTH_COLLAPSE_BELOW,
  HEALTH_RECOVER_AT,
  HEALTH_WEIGHTS,
  SPAM_ZERO_AT,
  type LedgerSample,
} from "../src/health";

const sample = (over: Partial<LedgerSample> = {}): LedgerSample => ({
  sent: 100,
  delivered: 0,
  bounced: 0,
  spam: 0,
  replied: 0,
  ...over,
});

describe("computeSenderHealth — the fixture matrix", () => {
  it("below the sample floor (<20 sent): NO score, low_data, no rates — never a fake number", () => {
    for (const sent of [0, 1, 19]) {
      const r = computeSenderHealth(sample({ sent, bounced: sent }));
      expect(r).toMatchObject({ score: null, state: "low_data", floor: "none", rates: null });
    }
  });

  it("floor bands mirror F1's min-n gates: 20–49 low, ≥50 ok", () => {
    expect(computeSenderHealth(sample({ sent: 20 })).floor).toBe("low");
    expect(computeSenderHealth(sample({ sent: 49 })).floor).toBe("low");
    expect(computeSenderHealth(sample({ sent: 50 })).floor).toBe("ok");
  });

  it("clean sender with no negative signals scores 100-ish (reply-only shortfall)", () => {
    // No delivery signal (delivered+bounced = 0) → delivery excluded, weights
    // renormalized over bounce/spam/reply; zero replies costs the reply weight.
    const r = computeSenderHealth(sample({ sent: 100 }));
    // (0.40·100 + 0.35·100 + 0.10·0) / 0.85 ≈ 88
    expect(r.score).toBe(88);
    expect(r.state).toBe("healthy");
  });

  it("fully engaged sender scores 100", () => {
    const r = computeSenderHealth(sample({ sent: 100, delivered: 98, replied: 2 }));
    expect(r.score).toBe(100);
    expect(r.state).toBe("healthy");
  });

  it("DEC-019 bounce breach (3%) reads degraded, not collapsed — half the bounce component", () => {
    const r = computeSenderHealth(sample({ sent: 200, delivered: 190, bounced: 6, replied: 4 }));
    // bounce 3% → 50 · spam 100 · delivery 95% → ~77 · reply 2% → 100
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.score).toBeLessThan(90);
    expect(r.state).toBe("healthy");
  });

  it("compounding breaches collapse: 2× bounce breach + 2× spam breach + weak delivery < 40", () => {
    // bounce 6% → 0 · spam 0.2% → 0 · delivery 85% → 0 · reply 0.5% → 25
    const r = computeSenderHealth(
      sample({ sent: 1000, delivered: 850, bounced: 60, spam: 2, replied: 5 }),
    );
    expect(r.score).toBeLessThan(HEALTH_COLLAPSE_BELOW);
    expect(r.state).toBe("unhealthy");
  });

  it("catastrophic bounce storm collapses even with zero spam", () => {
    // 25/25 bounced: bounce 0 · spam 100 · delivery 0 · reply 0 → 0.35·100/1.0 = 35
    const r = computeSenderHealth(sample({ sent: 25, bounced: 25 }));
    expect(r.score).toBe(35);
    expect(r.state).toBe("unhealthy");
  });

  it("missing delivery instrumentation never reads as failure (renormalized, not zeroed)", () => {
    const withSignal = computeSenderHealth(sample({ sent: 100, delivered: 1, replied: 2 }));
    const withoutSignal = computeSenderHealth(sample({ sent: 100, replied: 2 }));
    // delivered=1/100 with the signal present is a real (terrible) delivery rate;
    // no signal at all must score HIGHER than terrible delivery, not equal.
    expect(withoutSignal.score!).toBeGreaterThan(withSignal.score!);
  });

  it("hysteresis: 40–54 keeps the prior state in both directions", () => {
    // bounce 2% → 66.7 · spam 0.1% → 50 · delivery 90% → 38.5 · reply 0 → 0
    // ⇒ 0.4·66.7 + 0.35·50 + 0.15·38.5 ≈ 50 — inside the band.
    const banded = sample({ sent: 1000, delivered: 900, bounced: 20, spam: 1 });
    const fresh = computeSenderHealth(banded);
    expect(fresh.score).toBeGreaterThanOrEqual(HEALTH_COLLAPSE_BELOW);
    expect(fresh.score).toBeLessThan(HEALTH_RECOVER_AT);
    expect(computeSenderHealth(banded, "unhealthy").state).toBe("unhealthy");
    expect(computeSenderHealth(banded, "healthy").state).toBe("healthy");
    // No prior (first compute) → the band is not a collapse.
    expect(fresh.state).toBe("healthy");
  });

  it("recovery: an unhealthy sender needs ≥ the recover line, not just ≥ the collapse line", () => {
    const recovered = computeSenderHealth(
      sample({ sent: 100, delivered: 97, bounced: 1, replied: 2 }),
      "unhealthy",
    );
    expect(recovered.score).toBeGreaterThanOrEqual(HEALTH_RECOVER_AT);
    expect(recovered.state).toBe("healthy");
  });

  it("constants are the documented plan values (owner-sign-off anchors)", () => {
    expect(HEALTH_WEIGHTS).toEqual({ bounce: 0.4, spam: 0.35, delivery: 0.15, reply: 0.1 });
    expect(BOUNCE_ZERO_AT).toBe(0.06); // 2× the DEC-019 3% breach
    expect(SPAM_ZERO_AT).toBe(0.002); // 2× the DEC-019 0.1% breach
    expect(HEALTH_COLLAPSE_BELOW).toBe(40);
    expect(HEALTH_RECOVER_AT).toBe(55);
  });
});
