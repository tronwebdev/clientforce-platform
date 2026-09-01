#!/usr/bin/env node
/**
 * Typography contract gate (B7.6, owner amendment — "fidelity stops being a
 * review activity and becomes CI").
 *
 * THE CONTRACT, read off the prototype rather than asserted:
 * `design_handoff_console_v3/prototypes/Console Bold.dc.html` styles 86
 * elements with the display family. 84 of those are weight 900; only 2 use
 * 800. Conversely it carries 76 elements at weight 800 that deliberately
 * inherit IBM Plex Sans — row names, button labels — and only TWO at weight
 * 900 without the display family, both small monogram tiles (13px, 14px).
 *
 * So the invariant is NOT "weight 800+ means Schibsted". It is:
 *
 *      font-weight 900  ⟹  the display family (Schibsted Grotesk)
 *
 * That distinction matters: IBM Plex Sans is loaded at 400/500/600/700 only
 * (matching the prototype's own Google Fonts request), so a 900 on it has no
 * real face and the browser SYNTHESISES a fake bold. At 800 the prototype
 * does the same thing on purpose and the build should match it; at 900 the
 * prototype always reaches for a real Schibsted face and the build must too.
 *
 * A synthesised 900 is exactly the defect that shipped unnoticed three times
 * by eye — it is subtle per-element, never global, so it survives a glance at
 * a whole page.
 *
 * WHY STATIC. CI runs install → build → migrate → lint → test and never
 * starts a browser or a dev server, so a computed-style assertion cannot gate
 * it. This checks the authoring rule at source, which is where the mistake is
 * actually made, and is the same rule the prototype follows: family and
 * weight are set together on the element. The computed-style counterpart runs
 * in the capture tool, which does drive a browser.
 *
 * Run: pnpm lint:typography (also part of pnpm lint)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const WEB = join(ROOT, "apps", "web");
const CSS_FILES = [join(WEB, "app", "bold", "bold.css"), join(ROOT, "packages", "theme", "src", "console-bold.css")];
const failures = [];
const notes = [];
const owed = [];

/** Selectors whose rule sets the display family — derived, never hard-coded. */
function displayClasses() {
  const out = new Set(["cvb-display"]);
  for (const f of CSS_FILES) {
    let css;
    try { css = readFileSync(f, "utf8"); } catch { continue; }
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/font-family:\s*var\(--cvb-font-display\)/.test(m[2])) continue;
      for (const cls of m[1].matchAll(/\.([A-Za-z0-9_-]+)/g)) out.add(cls[1]);
    }
  }
  return out;
}
const DISPLAY = displayClasses();

/** Small monogram/avatar tiles: the prototype's own two exceptions. */
const MONOGRAM_MAX_PX = 15;

/**
 * Cross-session allowlist. B7.6 introduces this gate as shared infrastructure
 * while the Lead-finder wave owns `BoldLeadFinderView.tsx` on another branch
 * (B6.5 / DEC-154). Failing CI on files this session is instructed not to edit
 * would block that session's work on ours, so its violations are recorded here
 * rather than silently exempted: they are COUNTED, PRINTED on every run, and
 * the gate reports them as owed.
 *
 * This is the only allowlist. It shrinks to empty when that session lands its
 * fix and the entry is deleted — it must never grow to cover new work.
 */
const ALLOWLIST = new Map([
  ["apps/web/components/bold/BoldLeadFinderView.tsx", "owned by the Lead-finder wave (B6.5, DEC-154) — that session fixes and removes this entry"],
]);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (e !== "node_modules" && e !== ".next") walk(p, acc); }
    else if (/\.tsx?$/.test(p)) acc.push(p);
  }
  return acc;
}

const files = [
  ...walk(join(WEB, "components", "bold")),
  ...walk(join(WEB, "app", "bold")),
];

/**
 * Find each JSX element carrying an inline fontWeight of 900 and check the
 * same element also establishes the display family. Elements are delimited by
 * the enclosing `<tag ... >`; we scan the attribute text around each match.
 */
let checked = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (const m of src.matchAll(/fontWeight:\s*(900|"900"|'900')/g)) {
    checked += 1;
    // The element's attribute region: back to the opening '<', forward to '>'.
    const start = src.lastIndexOf("<", m.index);
    let end = src.indexOf(">", m.index);
    if (end < 0) end = src.length;
    const el = src.slice(start < 0 ? 0 : start, end);
    const line = src.slice(0, m.index).split("\n").length;

    const hasInlineFamily = /fontFamily:\s*["'`]?var\(--cvb-font-display\)/.test(el);
    const hasDisplayClass = [...DISPLAY].some((c) =>
      new RegExp(`(className|class)=[^>]*\\b${c.replace(/[-]/g, "\\-")}\\b`).test(el));
    if (hasInlineFamily || hasDisplayClass) continue;

    // Monogram exception: the prototype allows a synthesised 900 on a small tile.
    const sizeM = el.match(/fontSize:\s*([0-9.]+)/);
    const size = sizeM ? parseFloat(sizeM[1]) : null;
    if (size != null && size <= MONOGRAM_MAX_PX && /width:\s*\d+|borderRadius/.test(el)) {
      notes.push(`${relative(ROOT, file)}:${line} — ${size}px monogram tile, synthesised 900 allowed (prototype does the same)`);
      continue;
    }
    const rel = relative(ROOT, file);
    if (ALLOWLIST.has(rel)) { owed.push(`${rel}:${line} — ${ALLOWLIST.get(rel)}`); continue; }
    failures.push(
      `${rel}:${line} — fontWeight 900 without the display family` +
        (size ? ` (fontSize ${size})` : "") +
        `\n      ${lines[line - 1].trim().slice(0, 110)}`,
    );
  }
}

/** The families must actually be requested at the weights the code asks for. */
const layout = readFileSync(join(WEB, "app", "bold", "layout.tsx"), "utf8");
for (const w of ["700", "800", "900"]) {
  if (!new RegExp(`schibsted-grotesk/${w}\\.css`).test(layout))
    failures.push(`apps/web/app/bold/layout.tsx — Schibsted Grotesk ${w} is never imported, so every ${w} on the display family falls back`);
}
if (/ibm-plex-sans\/(800|900)\.css/.test(layout))
  failures.push("apps/web/app/bold/layout.tsx — IBM Plex Sans is imported at 800/900; the prototype requests 400;500;600;700 only");

if (failures.length) {
  console.error(`Typography contract — FAILED (${failures.length} violation(s) of ${checked} weight-900 sites)\n`);
  console.error("  Contract: font-weight 900 must resolve to Schibsted Grotesk.");
  console.error("  IBM Plex Sans has no 900 face, so the browser synthesises a fake bold.\n");
  console.error("  BEFORE reaching for the display family, CHECK THE PROTOTYPE'\''S WEIGHT for this");
  console.error("  element. If the prototype styles it 700 or 800 on the UI face, the 900 is");
  console.error("  itself the deviation and the fix is the WEIGHT, not the family — adding");
  console.error("  Schibsted there moves the build further from the prototype on two axes and");
  console.error("  then locks it in. (This gate did exactly that to the item stat strip and the");
  console.error("  sender-drawer stats on its first run; both are corrected in the same commit.)\n");
  console.error("  Otherwise: add `fontFamily: \"var(--cvb-font-display)\"` to the element, or one");
  console.error(`  of the display classes (${[...DISPLAY].join(", ")}).\n`);
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
if (owed.length) {
  console.warn(`Typography contract — ${owed.length} known violation(s) owed by another session:`);
  for (const o of owed) console.warn(`  ~ ${o}`);
}
console.log(
  `Typography contract: ${checked} weight-900 site(s) checked, all on the display family` +
    (notes.length ? `; ${notes.length} monogram tile(s) allowed` : "") +
    (owed.length ? `; ${owed.length} owed elsewhere` : "") + " — passed.",
);
