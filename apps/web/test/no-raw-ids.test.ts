/**
 * B7.6 acceptance §5 — "No raw cuid is rendered to a user anywhere in the unit."
 *
 * Five sites shipped in B7.5 and two more were found only by reading the
 * source, because no captured frame exercised them. They fall into two kinds,
 * and both are machine identifiers reaching a non-technical reader:
 *
 *   - a database id (`workspaceId`, `senderId`) printed as a mono record line
 *   - a machine KEY used as a display name when a lookup misses
 *     (`field.key` → `company_address`; a ledger reason → `whatsapp_msg`)
 *
 * A reviewer cannot keep catching these — the second kind only appears for
 * data the demo does not have — so the rule is enforced here instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BOLD = join(__dirname, "..", "components", "bold");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const settingsFiles = walk(BOLD).filter(
  (f) => f.includes(`${"settings"}/`) || /BoldCreditsView\.tsx$/.test(f),
);

describe("no raw machine ids reach a reader", () => {
  it("renders no database id in the Settings tree", () => {
    const offenders: string[] = [];
    for (const file of settingsFiles) {
      const src = readFileSync(file, "utf8");
      // A bare `{someId}` in JSX CHILD position — the shape that printed a
      // cuid under every item page and at the foot of the sender drawer.
      // The name must be exactly `id` or `somethingId`, so `said` and friends
      // do not match.
      for (const m of src.matchAll(/\{\s*(?:[A-Za-z_$][\w$]*\.)?(id|[a-z][\w$]*Id)\s*\}/g)) {
        // `prop={x.id}` is React plumbing and `${x.id}` is a template literal;
        // neither renders the value as text. Only a `{...}` opening a JSX child
        // counts, so skip a match preceded by `=` or `$`.
        const before = src.slice(Math.max(0, m.index - 1), m.index);
        if (before === "=" || before === "$") continue;
        offenders.push(`${file.split("/bold/")[1]}: {${m[1]}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never falls back to a raw key as a display name", () => {
    const offenders: string[] = [];
    for (const file of settingsFiles) {
      const src = readFileSync(file, "utf8");
      // `meta?.label ?? action` / `?? r.reason` / `?? field.key` — a lookup
      // miss must degrade to readable words, never to the key itself.
      for (const m of src.matchAll(
        /\?\?\s*(?:<span[^>]*>\s*)?\{?\s*((?:[A-Za-z_$][\w$]*\.)?(?:key|reason|action|slug))\s*(?:\}|<\/span>|\})/g,
      )) {
        offenders.push(`${file.split("/bold/")[1]}: ?? ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps a guard on RecordLine so a machine id cannot come back", () => {
    const kit = readFileSync(join(BOLD, "bold-settings-kit.tsx"), "utf8");
    // The component refuses a cuid rather than trusting every caller forever.
    expect(kit).toMatch(/MACHINE_ID\s*=\s*\/\^c\[a-z0-9\]\{20,\}\$\/i/);
    expect(kit).toMatch(/if \(!id \|\| MACHINE_ID\.test\(id\)\) return null;/);
  });
});
