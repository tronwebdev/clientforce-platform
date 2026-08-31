/**
 * B7.5 — the credits honesty gate has to stay true on its own.
 *
 * `METERED_CREDIT_ACTIONS` is what the credits surface uses to decide which
 * spend kinds it may draw a bar for; everything else it names as not-metered.
 * That list is only honest while it matches the code: the day a send starts
 * debiting the ledger, a surface still calling sends "not metered yet" is
 * lying in the other direction.
 *
 * So this reads every `creditLedger.create` in the API source and asserts the
 * reasons it writes are exactly the declared set (plus the human adjustment
 * reasons, which are a person moving the balance, not a priced action). A new
 * debit path fails this test until the list is updated with it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEDGER_ADJUSTMENT_REASONS, METERED_CREDIT_ACTIONS } from "@clientforce/core";

const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("credit metering — the declared set matches the code", () => {
  it("every ledger debit reason is either a declared metered action or a declared adjustment", () => {
    const reasons = new Set<string>();
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("creditLedger.create")) continue;
      // `reason: "lead_reveal"` — a literal beside a ledger write.
      for (const m of source.matchAll(/creditLedger\.create\([\s\S]{0,400}?\)/g)) {
        for (const r of m[0].matchAll(/reason:\s*"([a-z_]+)"/g)) {
          reasons.add(r[1] as string);
        }
      }
    }
    // A debit whose reason is a runtime variable (the backoffice adjustment)
    // cannot be read statically; the declared adjustment list covers those.
    const declared = new Set([...METERED_CREDIT_ACTIONS, ...LEDGER_ADJUSTMENT_REASONS]);
    const undeclared = [...reasons].filter((r) => !declared.has(r));
    expect(
      undeclared,
      `New credit debit reason(s) with no entry in METERED_CREDIT_ACTIONS — the credits surface would call them "not metered yet" while they charge: ${undeclared.join(", ")}`,
    ).toEqual([]);
  });

  it("nothing is declared metered that the ledger never writes", () => {
    const written = new Set<string>();
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/creditLedger\.create\([\s\S]{0,400}?\)/g)) {
        for (const r of m[0].matchAll(/reason:\s*"([a-z_]+)"/g)) written.add(r[1] as string);
      }
    }
    for (const action of METERED_CREDIT_ACTIONS) {
      expect(
        written.has(action),
        `${action} is declared metered but nothing writes it to the ledger — the surface would draw a bar for a kind that never charges`,
      ).toBe(true);
    }
  });
});
