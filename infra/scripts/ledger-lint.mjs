#!/usr/bin/env node
/**
 * PROGRESS.md ledger guard.
 *
 * The append-only convention (handoff §E) fails SILENTLY on merge: two tracks
 * that branch from different mains and both touch the ledger merge cleanly by
 * keeping BOTH copies. That is how a duplicated WID status row and a live
 * Q-046 id collision reached `main` — neither conflicted, so nothing objected.
 * Renumber-on-collision only works if a collision is visible, so this makes it
 * a failing build instead of something a reader has to notice.
 *
 * Checks:
 *   1. Status-board rows are unique by their first cell (the unit key).
 *   2. DEC ids are unique.
 *   3. Q ids are unique.
 *
 * Deliberately NOT checked: ordering (the log drifts newest-first vs inserted
 * rows and that is harmless), or content — this guard is about identity only.
 *
 * Run: pnpm lint:ledger
 */
import { readFileSync } from "node:fs";

const FILE = "PROGRESS.md";
const text = readFileSync(FILE, "utf8");
const lines = text.split("\n");

/** Rows above the Decision log heading are the status board. */
const decisionLogAt = lines.findIndex((l) => l.startsWith("## Decision log"));
if (decisionLogAt === -1) {
  console.error(`${FILE}: no "## Decision log" heading — has the layout changed?`);
  process.exit(1);
}

const failures = [];

function reportDuplicates(label, entries) {
  const seen = new Map();
  for (const { key, line } of entries) {
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(line);
  }
  for (const [key, hits] of seen) {
    if (hits.length > 1) {
      failures.push(`${label}: "${key}" appears ${hits.length}× (lines ${hits.join(", ")})`);
    }
  }
}

const isSeparator = (cells) => cells.every((c) => /^-{3,}$/.test(c.trim()) || c.trim() === "");
const isHeader = (first) => /^(Area|Unit|ID|Screen|Question)\b/i.test(first);

const statusRows = [];
for (let i = 0; i < decisionLogAt; i++) {
  const line = lines[i];
  if (!line.startsWith("| ")) continue;
  const cells = line.split("|").slice(1, -1);
  if (cells.length < 2 || isSeparator(cells)) continue;
  const key = cells[0].trim();
  if (!key || isHeader(key)) continue;
  statusRows.push({ key, line: i + 1 });
}
reportDuplicates("status-board row", statusRows);

// Whitespace-TOLERANT on purpose. Prettier pads markdown table cells to align
// columns, so a swept row renders as "| DEC-101  |" with two spaces. The
// original single-space pattern skipped those rows entirely — the guard went
// blind exactly when a formatting sweep touched the ledger, which is how a
// DEC-101 collision between the widget track and INT W5 reached main unflagged.
const ids = { "DEC id": /^\|\s*(DEC-\d+)\s*\|/, "Q id": /^\|\s*(Q-\d+)\s*\|/ };
for (const [label, pattern] of Object.entries(ids)) {
  const entries = [];
  lines.forEach((line, i) => {
    const m = pattern.exec(line);
    if (m) entries.push({ key: m[1], line: i + 1 });
  });
  reportDuplicates(label, entries);
}

if (failures.length) {
  console.error(`${FILE} — ledger identity check FAILED:\n`);
  for (const f of failures) console.error(`  • ${f}`);
  console.error(
    "\nThis is almost always a merge artifact: two tracks branched from different" +
      "\nmains and the append-only file kept both copies. Fix by renumbering the" +
      "\nrow that merged SECOND (never a merged DEC id) or removing the stale" +
      "\nduplicate, then note it in the unit's DEC entry.",
  );
  process.exit(1);
}

console.log(
  `${FILE}: ${statusRows.length} status rows, ids unique — ledger identity check passed.`,
);
