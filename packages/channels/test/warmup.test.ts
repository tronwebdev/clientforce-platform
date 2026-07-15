/**
 * P5 W1 (DEC-083): the ramp-curve walk — the geometric 45-day curve pinned
 * day by day, plus the triggered-not-retroactive rule (no `startedAt`, no
 * ramp) and the completion lifecycle.
 */
import { describe, expect, it } from "vitest";
import {
  initialWarmupState,
  parseWarmupState,
  WARMUP_DAYS,
  WARMUP_MIN_CAP,
  WARMUP_START_PCT,
  warmupCapFor,
  warmupCurveCap,
  warmupDay,
  warmupProgressFor,
} from "../src/warmup";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-07-15T12:00:00Z");
const senderOnDay = (day: number, dailyLimit = 500) => ({
  dailyLimit,
  warmupState: { startedAt: new Date(NOW.getTime() - (day - 1) * DAY_MS).toISOString(), curve: "v1" },
});

describe("warmup curve", () => {
  it("constants are the documented plan values", () => {
    expect(WARMUP_DAYS).toBe(45); // canon: the drawer's "Day N of 45"
    expect(WARMUP_START_PCT).toBe(0.02);
    expect(WARMUP_MIN_CAP).toBe(10);
  });

  it("walks the curve: 2% of target on day 1 → 100% on day 45, monotonic non-decreasing", () => {
    const target = 500;
    expect(warmupCurveCap(1, target)).toBe(10); // ceil(500·0.02)
    expect(warmupCurveCap(45, target)).toBe(500);
    let prev = 0;
    for (let day = 1; day <= WARMUP_DAYS; day++) {
      const cap = warmupCurveCap(day, target)!;
      expect(cap).toBeGreaterThanOrEqual(prev);
      expect(cap).toBeLessThanOrEqual(target);
      prev = cap;
    }
  });

  it("sample days for the plan table (target 500): 1→10 · 7→18 · 14→32 · 21→60 · 30→132 · 45→500", () => {
    const target = 500;
    const walk = [1, 7, 14, 21, 30, 45].map((d) => warmupCurveCap(d, target));
    expect(walk).toEqual([10, 18, 32, 60, 132, 500]);
  });

  it("floors at WARMUP_MIN_CAP but never exceeds a tiny target", () => {
    expect(warmupCurveCap(1, 200)).toBe(10); // max(10, ceil(4))
    expect(warmupCurveCap(1, 50)).toBe(10); // SMS default cap
    expect(warmupCurveCap(1, 5)).toBe(5); // min(target, …) wins
  });

  it("past the curve the ramp is over (null — configured limit rules alone)", () => {
    expect(warmupCurveCap(46, 500)).toBeNull();
  });
});

describe("warmupCapFor — the boundary's question", () => {
  it("no warmupState.startedAt → NO ramp (pre-W1 senders stay byte-identical)", () => {
    expect(warmupCapFor({ dailyLimit: 500, warmupState: null }, NOW)).toBeNull();
    expect(warmupCapFor({ dailyLimit: 500, warmupState: {} }, NOW)).toBeNull();
  });

  it("day-N fixture: a sender started N-1 days ago is on day N at that day's cap", () => {
    expect(warmupCapFor(senderOnDay(1), NOW)).toMatchObject({ day: 1, cap: 10, target: 500 });
    expect(warmupCapFor(senderOnDay(7), NOW)).toMatchObject({ day: 7, cap: 18 });
    expect(warmupCapFor(senderOnDay(30), NOW)).toMatchObject({ day: 30, cap: 132 });
  });

  it("effective cap = min(warmup cap, configured daily limit) — a lowered limit binds mid-ramp", () => {
    const sender = senderOnDay(30, 100); // curve says 23% of 100 = 23
    expect(warmupCapFor(sender, NOW)?.cap).toBeLessThanOrEqual(100);
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
  it("initialWarmupState stamps startedAt + curve version", () => {
    const state = initialWarmupState(NOW);
    expect(state).toEqual({ startedAt: NOW.toISOString(), curve: "v1" });
    expect(parseWarmupState(state)?.startedAt).toBe(NOW.toISOString());
  });

  it("warmupDay: day 1 for the first 24h, rolling over per day", () => {
    const started = new Date(NOW.getTime() - 3 * DAY_MS + 1);
    expect(warmupDay(started, NOW)).toBe(3);
    expect(warmupDay(NOW, NOW)).toBe(1);
  });

  it("warmupProgressFor projects the canon bar (day/days pct) and honest inactive states", () => {
    const active = warmupProgressFor(senderOnDay(18), NOW);
    expect(active).toMatchObject({ active: true, day: 18, days: 45, pct: 40, target: 500 });
    expect(warmupProgressFor({ dailyLimit: 500, warmupState: null }, NOW)).toBeNull();
    const done = warmupProgressFor(senderOnDay(60), NOW);
    expect(done).toMatchObject({ active: false, day: 45, currentCap: 500 });
  });
});
