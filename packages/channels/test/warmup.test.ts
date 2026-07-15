/**
 * P5 W1 (DEC-083): the ramp-curve walk — the OWNER-LOCKED curve v2
 * (2026-07-15): absolute caps, 50/day doubling ~every 3 days through week 2,
 * linear to 10,000 by day 45; config TABLES, not logic. Plus the
 * triggered-not-retroactive rule (no `startedAt`, no ramp), min(cap, limit)
 * semantics, the health-interlock HOLD (a held ramp's day freezes), and the
 * completion lifecycle.
 */
import { describe, expect, it } from "vitest";
import {
  initialWarmupState,
  parseWarmupState,
  WARMUP_DAYS,
  WARMUP_FULL_CAP,
  WARMUP_STEP_CAPS,
  warmupCapFor,
  warmupCurveCap,
  warmupDay,
  warmupEffectiveDay,
  warmupProgressFor,
} from "../src/warmup";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-07-15T12:00:00Z");
const senderOnDay = (day: number, dailyLimit = 10_000, extra: Record<string, unknown> = {}) => ({
  dailyLimit,
  warmupState: {
    startedAt: new Date(NOW.getTime() - (day - 1) * DAY_MS).toISOString(),
    curve: "v2",
    ...extra,
  },
});

describe("warmup curve v2 (owner-locked config tables)", () => {
  it("constants are the LOCKED values", () => {
    expect(WARMUP_DAYS).toBe(45); // also the canon "Day N of 45"
    expect(WARMUP_STEP_CAPS).toEqual([
      [1, 50],
      [4, 100],
      [7, 250],
      [10, 500],
      [13, 1000],
    ]);
    expect(WARMUP_FULL_CAP).toBe(10_000);
  });

  it("doubling phase holds each step ~3 days: 50 → 100 → 250 → 500 → 1,000", () => {
    const walk = (d: number) => warmupCurveCap(d, 10_000);
    expect([walk(1), walk(2), walk(3)]).toEqual([50, 50, 50]);
    expect([walk(4), walk(6)]).toEqual([100, 100]);
    expect([walk(7), walk(9)]).toEqual([250, 250]);
    expect([walk(10), walk(12)]).toEqual([500, 500]);
    expect(walk(13)).toBe(1000);
  });

  it("linear tail from 1,000 (day 13) to 10,000 (day 45), passing the 2,000/5,000 milestones", () => {
    const walk = (d: number) => warmupCurveCap(d, 100_000)!;
    expect(walk(14)).toBe(1281);
    expect(walk(17)).toBe(2125); // ≥ 2,000 milestone crossed
    expect(walk(28)).toBe(5219); // ≥ 5,000 milestone crossed
    expect(walk(45)).toBe(10_000);
    let prev = 0;
    for (let day = 1; day <= WARMUP_DAYS; day++) {
      const cap = warmupCurveCap(day, 100_000)!;
      expect(cap).toBeGreaterThanOrEqual(prev);
      prev = cap;
    }
  });

  it("past the curve the ramp is over (null — configured limit rules alone)", () => {
    expect(warmupCurveCap(46, 10_000)).toBeNull();
  });

  it("effective cap = min(curve, configured daily limit)", () => {
    expect(warmupCurveCap(1, 200)).toBe(50);
    expect(warmupCurveCap(7, 200)).toBe(200); // curve 250 clamped to the limit
    expect(warmupCurveCap(1, 50)).toBe(50); // an SMS-default limit binds from day 1
    expect(warmupCurveCap(1, 30)).toBe(30);
  });
});

describe("warmupCapFor — the boundary's question", () => {
  it("no warmupState.startedAt → NO ramp (pre-W1 senders stay byte-identical)", () => {
    expect(warmupCapFor({ dailyLimit: 500, warmupState: null }, NOW)).toBeNull();
    expect(warmupCapFor({ dailyLimit: 500, warmupState: {} }, NOW)).toBeNull();
  });

  it("day-N fixture: a sender started N-1 days ago is on day N at that day's cap", () => {
    expect(warmupCapFor(senderOnDay(1), NOW)).toMatchObject({ day: 1, cap: 50, holding: false });
    expect(warmupCapFor(senderOnDay(5), NOW)).toMatchObject({ day: 5, cap: 100 });
    expect(warmupCapFor(senderOnDay(11), NOW)).toMatchObject({ day: 11, cap: 500 });
    expect(warmupCapFor(senderOnDay(21), NOW)).toMatchObject({ day: 21, cap: 3250 });
  });

  it("HOLD (owner-locked interlock): accumulated held time freezes the effective day", () => {
    // Started 10 calendar days ago, but 3 days were held → effective day 7.
    const held = senderOnDay(10, 10_000, { heldMs: 3 * DAY_MS });
    expect(warmupCapFor(held, NOW)).toMatchObject({ day: 7, cap: 250, holding: false });
    // An OPEN hold (2 days and counting) freezes it the same way, flagged.
    const holding = senderOnDay(10, 10_000, {
      holdStartedAt: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
    });
    expect(warmupCapFor(holding, NOW)).toMatchObject({ day: 8, cap: 250, holding: true });
  });

  it("a completed ramp caps nothing", () => {
    expect(warmupCapFor(senderOnDay(46), NOW)).toBeNull();
    const stamped = {
      dailyLimit: 500,
      warmupState: { ...senderOnDay(20).warmupState, completedAt: NOW.toISOString() },
    };
    expect(warmupCapFor(stamped, NOW)).toBeNull();
  });
});

describe("warmup lifecycle helpers", () => {
  it("initialWarmupState stamps startedAt + curve v2", () => {
    const state = initialWarmupState(NOW);
    expect(state).toEqual({ startedAt: NOW.toISOString(), curve: "v2" });
    expect(parseWarmupState(state)?.startedAt).toBe(NOW.toISOString());
  });

  it("parseWarmupState round-trips the hold fields", () => {
    const parsed = parseWarmupState({
      startedAt: NOW.toISOString(),
      heldMs: 1234,
      holdStartedAt: NOW.toISOString(),
    });
    expect(parsed).toMatchObject({ heldMs: 1234, holdStartedAt: NOW.toISOString() });
  });

  it("warmupDay: day 1 for the first 24h; warmupEffectiveDay subtracts holds", () => {
    const started = new Date(NOW.getTime() - 3 * DAY_MS + 1);
    expect(warmupDay(started, NOW)).toBe(3);
    expect(warmupEffectiveDay({ startedAt: started.toISOString() }, started, NOW)).toBe(3);
    expect(
      warmupEffectiveDay({ startedAt: started.toISOString(), heldMs: 2 * DAY_MS }, started, NOW),
    ).toBe(1);
  });

  it("warmupProgressFor projects the canon bar (day/days pct) + holding, and honest inactive states", () => {
    const active = warmupProgressFor(senderOnDay(18, 500), NOW);
    expect(active).toMatchObject({ active: true, day: 18, days: 45, pct: 40, target: 500, holding: false });
    expect(warmupProgressFor({ dailyLimit: 500, warmupState: null }, NOW)).toBeNull();
    const done = warmupProgressFor(senderOnDay(60, 500), NOW);
    expect(done).toMatchObject({ active: false, day: 45, currentCap: 500 });
    const holding = warmupProgressFor(
      senderOnDay(10, 500, { holdStartedAt: new Date(NOW.getTime() - DAY_MS).toISOString() }),
      NOW,
    );
    expect(holding).toMatchObject({ active: true, holding: true, day: 9 });
  });
});
