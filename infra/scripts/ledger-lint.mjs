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
 *   4. Every id CITED anywhere in the ledger has a row of its own.
 *
 * Check 4 exists because uniqueness alone did not stop the second collision.
 * WID2 claimed Q-057/Q-058 in the prose of a status row and never wrote the
 * rows; INT W5 then took both ids for its own questions, entirely reasonably,
 * because from the table there was nothing there. An id claimed in prose is
 * invisible to a reader scanning the table AND to checks 2–3, which only ever
 * look at rows — so "claimed" has to mean "written down" or it means nothing.
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
//
// ANNOTATION-tolerant for the same reason: an id cell may carry a note, as
// Q-028's does ("| Q-028 (renumbered from Q-025 in the #93 merge …) |"). The
// id is what identifies the row; requiring it to be the cell's only content
// made that row invisible to the duplicate check too.
const ids = { "DEC id": /^\|\s*(DEC-\d+)\b/, "Q id": /^\|\s*(Q-\d+)\b/ };
const rowIds = new Set();
for (const [label, pattern] of Object.entries(ids)) {
  const entries = [];
  lines.forEach((line, i) => {
    const m = pattern.exec(line);
    if (m) {
      entries.push({ key: m[1], line: i + 1 });
      rowIds.add(m[1]);
    }
  });
  reportDuplicates(label, entries);
}

/**
 * Ids cited in prose that were never given a row. Each of these is a real gap
 * inherited from an earlier unit, listed so the check can fail on NEW ones from
 * today rather than on history somebody else has to write. Shrinks as they get
 * filed; it must never grow — that is the whole point.
 */
const KNOWN_UNFILED = new Set([
  // "Q-items (Clerk gives these free; deliberately skipped)" — named in the
  // AUTH status row as a list, never filed individually.
  "Q-012",
  "Q-013",
  "Q-014",
  "Q-015",
  // Named in the SMS status row's "Q-items:" list, same pattern.
  "Q-016",
  "Q-017",
  "Q-018",
  "Q-019",
]);

const duplicateFailures = failures.length;
const unfiled = new Map();
for (const [i, line] of lines.entries()) {
  for (const m of line.matchAll(/\b((?:DEC|Q)-\d+)\b/g)) {
    const id = m[1];
    if (rowIds.has(id) || KNOWN_UNFILED.has(id)) continue;
    if (!unfiled.has(id)) unfiled.set(id, i + 1);
  }
}
for (const [id, line] of unfiled) {
  failures.push(
    `cited but never filed: "${id}" is referenced (line ${line}) with no row of its own — ` +
      `claim it in the table or stop citing it`,
  );
}

if (failures.length) {
  console.error(`${FILE} — ledger identity check FAILED:\n`);
  for (const f of failures) console.error(`  • ${f}`);
  if (duplicateFailures) {
    console.error(
      "\nA duplicate is almost always a merge artifact: two tracks branched from" +
        "\ndifferent mains and the append-only file kept both copies. Fix by renumbering" +
        "\nthe row that merged SECOND (never a merged DEC id) or removing the stale" +
        "\nduplicate, then note it in the unit's DEC entry.",
    );
  }
  if (unfiled.size) {
    console.error(
      "\nAn unfiled citation is the OTHER half of the same failure: an id claimed in" +
        "\nprose is invisible to the table, so the next unit takes it in good faith." +
        "\nWrite the row at the moment you claim the id.",
    );
  }
  process.exit(1);
}

console.log(
  `${FILE}: ${statusRows.length} status rows, ids unique — ledger identity check passed.`,
);
