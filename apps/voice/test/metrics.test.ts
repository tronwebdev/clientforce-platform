/**
 * MetricsCollector (DEC-092 owner finding 3) — the first-60s vs steady-state
 * per-sentence split every call now self-reports (the raw array proved
 * container-locked when the workflow principal couldn't exec).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricsCollector } from "../src/metrics";

afterEach(() => {
  vi.useRealTimers();
});

describe("ttsSentenceWindowStats — the start-window split", () => {
  it("splits per-sentence first-audio at the 60s boundary", () => {
    vi.useFakeTimers();
    const m = new MetricsCollector();
    m.markCallStart();
    m.addTtsSentence(70, 2000); // t≈0 — start window
    vi.advanceTimersByTime(5_000);
    m.addTtsSentence(90, 2100); // t=5s — start window
    vi.advanceTimersByTime(60_000);
    m.addTtsSentence(75, 1900); // t=65s — steady state
    const w = m.ttsSentenceWindowStats();
    expect(w.first60s).toEqual({ n: 2, firstAudioP50: 70, firstAudioMax: 90 });
    expect(w.steady).toEqual({ n: 1, firstAudioP50: 75, firstAudioMax: 75 });
  });

  it("report() carries the split + the finding-2 clear accounting + bridgedAtMs", () => {
    const m = new MetricsCollector();
    m.markCallStart();
    m.bufferedMsAtInterrupt.push(340);
    m.bridgedAtMs = 9000;
    const r = m.report();
    expect(r.ttsSentenceWindows.first60s.n).toBe(0);
    expect(r.bufferedMsAtInterrupt).toEqual([340]);
    expect(r.bridgedAtMs).toBe(9000);
  });
});
