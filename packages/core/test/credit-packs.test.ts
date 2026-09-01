import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKS,
  DEFAULT_PACK_CREDITS,
  daysOfSending,
  isBestRate,
  packFor,
  packSubLine,
  ratePer1000,
} from "../src/credit-packs";

/**
 * The prototype is the price list (Console Bold.dc.html:5090, :5140). These
 * pin the numbers AND the derivations, so the modal and whatever eventually
 * charges the card cannot drift apart.
 */
describe("credit packs", () => {
  it("carries the prototype's three packs at the prototype's prices", () => {
    expect(CREDIT_PACKS.map((p) => [p.credits, p.priceUsd])).toEqual([
      [2_000, 40],
      [5_000, 90],
      [10_000, 180],
    ]);
  });

  it("pre-selects the middle pack, as the prototype does", () => {
    expect(DEFAULT_PACK_CREDITS).toBe(5_000);
    expect(packFor(DEFAULT_PACK_CREDITS).priceUsd).toBe(90);
  });

  it("derives the per-1,000 rate the way the prototype rounds it", () => {
    expect(CREDIT_PACKS.map(ratePer1000)).toEqual([20, 18, 18]);
  });

  it("derives `best rate` from the ratio rather than asserting it", () => {
    // 10,000 carries the flag in the prototype; 5,000 ties it on rate, and a
    // tie is genuinely the best rate — the chip is a claim about the number.
    expect(isBestRate(packFor(10_000))).toBe(true);
    expect(isBestRate(packFor(2_000))).toBe(false);
  });

  it("divides by the workspace's own ceiling, not a design constant", () => {
    // 5,000 credits at a 200/day ceiling is 25 days. The prototype's hard-coded
    // 210 would say 24 — close, and still a number with no basis in this
    // workspace. The point is the SOURCE, not the delta.
    expect(daysOfSending(packFor(5_000), 200)).toBe(25);
    expect(daysOfSending(packFor(10_000), 120)).toBe(83);
  });

  it("drops the days clause rather than inventing a denominator", () => {
    expect(daysOfSending(packFor(5_000), null)).toBeNull();
    expect(daysOfSending(packFor(5_000), 0)).toBeNull();
    expect(packSubLine(packFor(5_000), null)).toBe("$18 per 1,000");
    expect(packSubLine(packFor(5_000), 200)).toBe("$18 per 1,000 · about 25 days of sending");
  });

  it("never reports less than a day for a pack that carries credits", () => {
    expect(daysOfSending(packFor(2_000), 100_000)).toBe(1);
  });
});
