/**
 * B7.5 — the credits honesty gate has to stay true on its own.
 *
 * `METERED_CREDIT_ACTIONS` is what the credits surface uses to decide which
 * spend kinds it may draw a bar for; everything else it names as not-metered.
 * That list is only honest while it matches the code: the day a send starts
 * debiting the ledger, a surface still calling sends "not metered yet" is
 * lying in the other direction.
 *
 * B9.5 (DEC-157) MOVED THIS GUARD, and deliberately — it would otherwise have
 * gone blind. The original scanned for a literal `reason: "..."` beside a
 * `creditLedger.create`. After the extraction there is exactly ONE
 * `creditLedger.create` in the whole product, inside `charge()`, and its
 * reason is a variable. The old first test would then have found no reasons at
 * all and passed vacuously, while the second would have failed every declared
 * action. So the guard now watches the new seam — the `action:` a caller hands
 * to `charge()` — and gains a third assertion the old shape could not make:
 * that the single ledger writer really is single.
 *
 * Scanning is deliberately static and dumb. A test that imported the modules
 * and inspected them at runtime would only see the paths it happened to
 * execute; reading the source sees every call site, including ones nothing
 * exercises yet.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEDGER_ADJUSTMENT_REASONS, METERED_CREDIT_ACTIONS } from "@clientforce/core";

const REPO = join(__dirname, "..", "..", "..");
/**
 * Every place a charge can be made from. `packages/db` holds `charge()`
 * itself; the rest are its callers. Widened past `apps/api/src` at B9.5
 * because the send boundaries live in `packages/channels` — a guard that
 * cannot see them is a guard that misses the next meter.
 */
const ROOTS = [
  join(REPO, "apps", "api", "src"),
  join(REPO, "apps", "worker", "src"),
  join(REPO, "packages", "channels", "src"),
  join(REPO, "packages", "workflows", "src"),
  join(REPO, "packages", "db", "src"),
  join(REPO, "packages", "leads", "src"),
];

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const sources = (): Array<{ file: string; source: string }> =>
  ROOTS.flatMap(walk).map((file) => ({ file, source: readFileSync(file, "utf8") }));

/** The `action:` literals handed to `charge()` anywhere in the product. */
function chargedActions(): Set<string> {
  const actions = new Set<string>();
  for (const { source } of sources()) {
    if (!source.includes("charge(")) continue;
    for (const m of source.matchAll(/\bcharge\(\s*tx\s*,\s*\{[\s\S]{0,600}?\}\s*\)/g)) {
      for (const a of m[0].matchAll(/action:\s*(?:"([a-z_]+)"|([A-Z_]+))/g)) {
        // A constant like REVEAL_PRICE_ACTION is resolved from its own
        // declaration rather than guessed at.
        if (a[1]) actions.add(a[1]);
        else if (a[2]) {
          for (const { source: s2 } of sources()) {
            const decl = s2.match(new RegExp(`${a[2]}\\s*=\\s*"([a-z_]+)"`));
            if (decl?.[1]) actions.add(decl[1]);
          }
        }
      }
    }
  }
  return actions;
}

describe("credit metering — the declared set matches the code", () => {
  it("there is exactly ONE ledger writer besides the backoffice adjustment", () => {
    // SURFACE_SPEC_METERING §7.1 as a test rather than a grep in a PR body.
    // A second `creditLedger.create` is a parallel meter, which the standing
    // constraint forbids: billing enforcement consumes W2's reconciliation and
    // cannot reconcile against two sets of books.
    const writers: string[] = [];
    for (const { file, source } of sources()) {
      for (const _ of source.matchAll(/creditLedger\.create(?:Many)?\(/g)) {
        writers.push(file.replace(`${REPO}/`, ""));
      }
    }
    const allowed = (f: string) =>
      f.endsWith("packages/db/src/charge.ts") ||
      f.endsWith("apps/api/src/backoffice/backoffice.service.ts");
    const rogue = writers.filter((f) => !allowed(f));
    expect(
      rogue,
      `A ledger write outside charge(): ${rogue.join(", ")}. Every debit goes through the one charge path — a second writer is a parallel meter.`,
    ).toEqual([]);
    // And the one path really is present, so this test cannot pass by the
    // helper having been deleted.
    expect(writers.some((f) => f.endsWith("packages/db/src/charge.ts"))).toBe(true);
  });

  it("every action charged in code is a declared metered action", () => {
    const declared = new Set([...METERED_CREDIT_ACTIONS, ...LEDGER_ADJUSTMENT_REASONS]);
    const undeclared = [...chargedActions()].filter((a) => !declared.has(a));
    expect(
      undeclared,
      `Charged with no entry in METERED_CREDIT_ACTIONS — the credits surface would call them "not metered yet" while they charge: ${undeclared.join(", ")}`,
    ).toEqual([]);
  });

  it("nothing is declared metered that no code ever charges", () => {
    const charged = chargedActions();
    for (const action of METERED_CREDIT_ACTIONS) {
      expect(
        charged.has(action),
        `${action} is declared metered but nothing calls charge() with it — the surface would draw a bar for a kind that never charges`,
      ).toBe(true);
    }
  });
});
