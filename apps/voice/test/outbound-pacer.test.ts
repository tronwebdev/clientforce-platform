/**
 * OutboundPacer (DEC-092 owner finding 2) — the just-in-time send queue that
 * keeps the un-cancellable audio window ≤ leadCapMs. Deterministic: injected
 * clock, no real timers needed for the core model (the interval only drains
 * what the clock allows — tests advance the clock and pump via enqueue).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboundPacer } from "../src/outbound-pacer";

const collect = () => {
  const frames: Buffer[] = [];
  return { frames, send: (f: Buffer) => frames.push(f) };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("OutboundPacer", () => {
  it("sends short audio synchronously on enqueue (behavior unchanged for clips)", () => {
    const { frames, send } = collect();
    const t = 1000;
    const pacer = new OutboundPacer({ send, now: () => t, leadCapMs: 400 });
    // 300ms of audio (2400 bytes) — inside the lead cap, all out immediately.
    pacer.enqueueAudio(Buffer.alloc(2400, 1));
    expect(Buffer.concat(frames).length).toBe(2400);
    expect(frames.every((f) => f.length <= 160)).toBe(true);
    expect(pacer.outstandingMs()).toBe(300); // all in flight, none queued
    pacer.close();
  });

  it("caps in-flight audio at leadCapMs and drains as the clock advances", () => {
    vi.useFakeTimers();
    const { frames, send } = collect();
    let t = 1000;
    const pacer = new OutboundPacer({ send, now: () => t, leadCapMs: 400, frameMs: 20 });
    // 1000ms of audio — only ~the lead window leaves synchronously.
    pacer.enqueueAudio(Buffer.alloc(8000, 1));
    const sentNow = Buffer.concat(frames).length;
    expect(sentNow).toBeLessThanOrEqual(420 * 8); // cap + one frame of slack
    expect(pacer.outstandingMs()).toBe(1000); // queued + in flight
    // Advance the world: the interval drains the rest, never exceeding cap.
    t += 300;
    vi.advanceTimersByTime(300);
    expect(pacer.inFlightMs()).toBeLessThanOrEqual(420);
    t += 2000;
    vi.advanceTimersByTime(2000);
    expect(Buffer.concat(frames).length).toBe(8000); // everything eventually sent
    pacer.close();
  });

  it("enqueueSilence emits μ-law silence frames of the requested duration", () => {
    const { frames, send } = collect();
    const t = 1000;
    const pacer = new OutboundPacer({ send, now: () => t, leadCapMs: 500 });
    pacer.enqueueSilence(400);
    const all = Buffer.concat(frames);
    expect(all.length).toBe(400 * 8);
    expect(all.every((b) => b === 0xff)).toBe(true);
    pacer.close();
  });

  it("clearNow drops the queue instantly and reports dropped + in-flight ms", () => {
    const { frames, send } = collect();
    let t = 1000;
    const pacer = new OutboundPacer({ send, now: () => t, leadCapMs: 400 });
    pacer.enqueueAudio(Buffer.alloc(8000, 1)); // 1000ms total, ~400ms in flight
    const before = Buffer.concat(frames).length;
    const cleared = pacer.clearNow();
    expect(cleared.inFlightMs).toBeGreaterThan(300);
    expect(cleared.inFlightMs).toBeLessThanOrEqual(420);
    expect(cleared.droppedMs + cleared.inFlightMs).toBe(1000);
    expect(pacer.outstandingMs()).toBe(0);
    // Nothing more leaves after the clear.
    t += 5000;
    expect(Buffer.concat(frames).length).toBe(before);
    pacer.close();
  });

  it("onWireSend fires per wire frame, not per enqueue", () => {
    const { send } = collect();
    let wire = 0;
    const t = 1000;
    const pacer = new OutboundPacer({
      send,
      onWireSend: () => wire++,
      now: () => t,
      leadCapMs: 400,
    });
    pacer.enqueueAudio(Buffer.alloc(1600, 1)); // 200ms = 10 frames
    expect(wire).toBe(10);
    pacer.close();
  });

  it("a partial tail frame is sent with correct duration accounting", () => {
    const { frames, send } = collect();
    const t = 1000;
    const pacer = new OutboundPacer({ send, now: () => t, leadCapMs: 400 });
    pacer.enqueueAudio(Buffer.alloc(200, 1)); // 25ms → one 160B + one 40B frame
    expect(frames.length).toBe(2);
    expect(frames[1]!.length).toBe(40);
    expect(pacer.outstandingMs()).toBe(25);
    pacer.close();
  });
});
