/**
 * SentenceChunker — the spike-proven sentence behavior stays byte-identical
 * in default mode; `eagerFirst` (P3.1, cert run 3) flushes only the TURN's
 * first chunk at a clause boundary (the TTFA lever), then reverts to full
 * sentences.
 */
import { describe, expect, it } from "vitest";
import { SentenceChunker } from "../src/sentence-chunker";

describe("SentenceChunker — default (spike-proven, unchanged)", () => {
  it("emits complete sentences as they close, holding partials", () => {
    const c = new SentenceChunker();
    expect(c.push("Hello there")).toEqual([]);
    expect(c.push(". How are ")).toEqual(["Hello there."]);
    expect(c.push("you? Good")).toEqual(["How are you?"]);
    expect(c.flush()).toBe("Good");
  });

  it("does NOT clause-flush short openings without eagerFirst", () => {
    const c = new SentenceChunker();
    expect(c.push("We help clinics like BrightSmile, and more")).toEqual([]);
  });
});

describe("SentenceChunker — eagerFirst (the TTFA lever)", () => {
  it("flushes the FIRST chunk at a clause boundary instead of waiting out the sentence", () => {
    const c = new SentenceChunker(true);
    expect(c.push("We help clinics like BrightSmile book more,")).toEqual([]);
    const out = c.push(" and our free growth audit shows where bookings leak");
    expect(out).toEqual(["We help clinics like BrightSmile book more,"]);
  });

  it("after the first chunk, reverts to full sentences", () => {
    const c = new SentenceChunker(true);
    c.push("We help clinics like BrightSmile book more, and it works");
    expect(c.push(" well for teams, honestly speaking")).toEqual([]); // no clause-flush anymore
    expect(c.push(". Done.")).toEqual(["and it works well for teams, honestly speaking."]);
  });

  it("a short complete first sentence still flushes normally", () => {
    const c = new SentenceChunker(true);
    expect(c.push("Happy to explain. More")).toEqual(["Happy to explain."]);
  });
});
