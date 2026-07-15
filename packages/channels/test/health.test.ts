/**
 * P5 W1 (DEC-083): the score fixture matrix — the OWNER-LOCKED penalty model
 * (2026-07-15) pinned case by case: per-signal healthy→danger bounds and
 * weights, linear penalty scaling, reply as bonus-only, the four band
 * cutoffs (healthy ≥80 · watch 60–79 · at-risk 40–59 · auto-pause <40, a
 * SHARP threshold), and the F1 sample floors.
 */
import { describe, expect, it } from "vitest";
import {
  computeSenderHealth,
  HEALTH_AUTO_PAUSE_BELOW,
  HEALTH_BANDS,
  HEALTH_SIGNALS,
  healthBandFor,
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

describe("computeSenderHealth — the locked penalty model", () => {
  it("constants are the OWNER-LOCKED values (2026-07-15) — config, not logic", () => {
    expect(HEALTH_SIGNALS.spam).toEqual({ healthy: 0.001, danger: 0.003, weight: 40 });
    expect(HEALTH_SIGNALS.bounce).toEqual({ healthy: 0.02, danger: 0.05, weight: 30 });
    expect(HEALTH_SIGNALS.delivery).toEqual({ healthy: 0.95, danger: 0.9, weight: 20 });
    expect(HEALTH_SIGNALS.reply).toEqual({ weight: 10, fullAt: 0.02 });
    expect(HEALTH_BANDS).toEqual({ healthy: 80, watch: 60, atRisk: 40 });
    expect(HEALTH_AUTO_PAUSE_BELOW).toBe(40);
  });

  it("below the sample floor (<20 sent): NO score, low_data, no band, no rates — never a fake number", () => {
    for (const sent of [0, 1, 19]) {
      const r = computeSenderHealth(sample({ sent, bounced: sent }));
      expect(r).toMatchObject({ score: null, state: "low_data", band: null, floor: "none", rates: null });
    }
  });

  it("floor bands mirror F1's min-n gates: 20–49 low, ≥50 ok", () => {
    expect(computeSenderHealth(sample({ sent: 20 })).floor).toBe("low");
    expect(computeSenderHealth(sample({ sent: 49 })).floor).toBe("low");
    expect(computeSenderHealth(sample({ sent: 50 })).floor).toBe("ok");
  });

  it("clean sender scores 100 (owner pin: clean ≥80) — zero replies subtract NOTHING", () => {
    const r = computeSenderHealth(sample({ sent: 100 }));
    expect(r.score).toBe(100);
    expect(r.band).toBe("healthy");
    expect(r.state).toBe("healthy");
  });

  it("missing delivery instrumentation is never a penalty (no delivery signal → 0, not 20)", () => {
    // delivered+bounced = 0 → no delivery signal in the window.
    const r = computeSenderHealth(sample({ sent: 100, delivered: 0, bounced: 0 }));
    expect(r.score).toBe(100);
    expect(r.rates?.delivery).toBeNull();
  });

  it("reply bonus clamps at 100 and only ever ADDS (never drives a pause)", () => {
    expect(computeSenderHealth(sample({ sent: 100, delivered: 98, replied: 2 })).score).toBe(100);
    // Paused-by-signals at 39; a 2% reply rate adds +10 → 49 (at-risk, sendable).
    const lifted = computeSenderHealth(
      sample({ sent: 2000, delivered: 1900, spam: 6, bounced: 82, replied: 40 }),
    );
    expect(lifted.score).toBe(49);
    expect(lifted.band).toBe("at_risk");
    expect(lifted.state).toBe("healthy");
  });

  it("penalties scale LINEARLY between healthy→danger: DEC-019-era 3% bounce now costs exactly 10", () => {
    // bounce 3%: 30 × (0.03−0.02)/(0.05−0.02) = 10 → 90, healthy band.
    const r = computeSenderHealth(sample({ sent: 200, delivered: 190, bounced: 6 }));
    expect(r.score).toBe(90);
    expect(r.band).toBe("healthy");
  });

  it("owner pin: a complaint-spike sender lands <40 (auto-pause)", () => {
    // spam 0.4% (full 40) + bounce 4.5% (25) + delivery 91% (16) → 19.
    const r = computeSenderHealth(sample({ sent: 2000, delivered: 1820, bounced: 90, spam: 8 }));
    expect(r.score).toBe(19);
    expect(r.band).toBe("paused");
    expect(r.state).toBe("unhealthy");
  });

  it("owner pin — every band boundary, exact (delivery held at 95% = 0 penalty)", () => {
    const boundary = (bounced: number, spam: number) =>
      computeSenderHealth(sample({ sent: 2000, delivered: 1900, bounced, spam }));
    // 80 = healthy floor: bounce 4% → penalty 20.
    expect(boundary(80, 0)).toMatchObject({ score: 80, band: "healthy", state: "healthy" });
    // 79 = top of watch: bounce 4.1% → penalty 21.
    expect(boundary(82, 0)).toMatchObject({ score: 79, band: "watch", state: "healthy" });
    // 60 = watch floor: spam exactly at danger (0.3%) → full 40.
    expect(boundary(0, 6)).toMatchObject({ score: 60, band: "watch", state: "healthy" });
    // 59 = top of at-risk: spam 40 + bounce 2.1% → 1.
    expect(boundary(42, 6)).toMatchObject({ score: 59, band: "at_risk", state: "healthy" });
    // 40 = at-risk floor — the gate stays OPEN at exactly 40 (sharp threshold).
    expect(boundary(80, 6)).toMatchObject({ score: 40, band: "at_risk", state: "healthy" });
    // 39 = auto-pause: one more bounce point of penalty.
    expect(boundary(82, 6)).toMatchObject({ score: 39, band: "paused", state: "unhealthy" });
  });

  it("all signals at/past danger collapses to the floor (min 0 + bonus only)", () => {
    // spam 1% + bounce 8% + delivery 85% → 100−90 = 10.
    const r = computeSenderHealth(sample({ sent: 1000, delivered: 850, bounced: 80, spam: 10 }));
    expect(r.score).toBe(10);
    expect(r.state).toBe("unhealthy");
  });

  it("healthBandFor maps the locked cutoffs", () => {
    expect(healthBandFor(100)).toBe("healthy");
    expect(healthBandFor(80)).toBe("healthy");
    expect(healthBandFor(79)).toBe("watch");
    expect(healthBandFor(60)).toBe("watch");
    expect(healthBandFor(59)).toBe("at_risk");
    expect(healthBandFor(40)).toBe("at_risk");
    expect(healthBandFor(39)).toBe("paused");
    expect(healthBandFor(0)).toBe("paused");
  });
});
