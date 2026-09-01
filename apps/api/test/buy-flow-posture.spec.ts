/**
 * B7.6 — the buy flow must never dead-end, and it must never fabricate money.
 *
 * The owner's ruling (REDO §1.1): a purchase either goes through or the entry
 * point is honestly disabled and says why. Both halves of that are structural,
 * so both are pinned here rather than left to a reviewer's eye:
 *
 *  1. KEYLESS IS A STATED STATE, NOT A CRASH. With no `STRIPE_SECRET_KEY` the
 *     billing read must return `configured: false` WITH a reason in plain
 *     words — not throw, not 500, and not quietly return a truthy posture that
 *     lets the modal open onto a checkout that cannot charge anyone.
 *
 *  2. ONE PRICE LIST. The prices the modal quotes and the prices any charge
 *     path multiplies come from the same `CREDIT_PACKS` constant. A second
 *     hard-coded list anywhere in the API is exactly how a screen ends up
 *     promising $90 while the card is charged something else, so this fails
 *     the build if pack prices are ever written down a second time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, packSubLine, ratePer1000 } from "@clientforce/core";

const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("buy flow posture", () => {
  it("treats a missing Stripe key as a stated state, not an error", () => {
    const src = readFileSync(join(SRC, "pricing", "billing.controller.ts"), "utf8");
    // configured is derived from the key's presence, never assumed true.
    expect(src).toMatch(/process\.env\.STRIPE_SECRET_KEY/);
    expect(src).toMatch(/configured\s*=/);
    // The keyless branch carries a reason the surface can print verbatim.
    expect(src).toMatch(/reason:/);
    // And it must not throw on the keyless path — that would turn an expected
    // state into a 500 and take the whole credits page down with it.
    expect(src).not.toMatch(/throw new \w*Exception\(/);
  });

  it("never fabricates a card to fill the PAYING WITH row", () => {
    const src = readFileSync(join(SRC, "pricing", "billing.controller.ts"), "utf8");
    // No masked PAN literals anywhere: the prototype's `•••• 4242` is demo
    // dressing, and a card that does not exist must render as absent so the
    // surface can withhold its "change card" affordance.
    expect(src).not.toMatch(/4242|•{4}/);
    expect(src).toMatch(/card: null/);
  });

  it("keeps ONE price list — no second hard-coded pack price in the API", () => {
    const prices = CREDIT_PACKS.map((p) => p.priceUsd);
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8");
      if (src.includes("CREDIT_PACKS")) continue; // reads the shared list — fine
      for (const price of prices) {
        // A bare pack price next to a credit-ish word is the drift we are
        // guarding against, not any occurrence of the number 40.
        if (new RegExp(`\\b${price}\\b[^\\n]{0,40}(credit|pack|usd|price)`, "i").test(src)) {
          offenders.push(`${file}: ${price}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("derives the days-of-sending clause, and drops it without a ceiling", () => {
    const pack = CREDIT_PACKS[1]!;
    // The workspace's OWN ceiling is the denominator, so the clause is
    // arithmetic on configured data rather than a projection.
    expect(packSubLine(pack, 120)).toBe(`$${ratePer1000(pack)} per 1,000 · about 42 days of sending`);
    // With no ceiling the clause disappears rather than inventing one.
    expect(packSubLine(pack, null)).toBe(`$${ratePer1000(pack)} per 1,000`);
  });
});
