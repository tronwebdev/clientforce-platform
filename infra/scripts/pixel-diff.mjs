#!/usr/bin/env node
/**
 * Perceptual pixel-diff gate (B7.6, owner amendment).
 *
 * "Every build/proto pair gets diffed against a threshold; above it, the build
 * fails." Every `docs/fidelity/<unit>/proto-<name>.png` is diffed against its
 * `build-<name>.png` sibling and scored as the fraction of perceptually
 * different pixels.
 *
 * WHY A RATCHET AND NOT A FLAT CEILING. The gate is introduced across 60 unit
 * dirs of already-shipped frames, and B7.7 — the retroactive sweep that drives
 * these scores down — is a LATER unit that uses this gate as its audit tool. A
 * flat ceiling on day one would fail every historical surface at once and
 * block all work until the sweep finished, which inverts the owner's ordering
 * ("after the gates exist"). So:
 *
 *   - Every pair's current score is recorded in PIXEL_BASELINE.json.
 *   - A pair that gets WORSE than its baseline (beyond REGRESSION_TOLERANCE)
 *     fails the build. Fidelity can only improve.
 *   - A pair with NO baseline — new work — must come in under CEILING.
 *
 * The ratchet is the part that bites on new work; the baseline is the debt
 * B7.7 pays down. Baselines may only be lowered: `--update` refuses to raise
 * one, so a regression cannot be laundered by re-recording it.
 *
 * Run: pnpm lint:pixel · pnpm lint:pixel --update · pnpm lint:pixel --table
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const ROOT = process.cwd();
const FID = join(ROOT, "docs", "fidelity");
const BASELINE = join(FID, "PIXEL_BASELINE.json");

/** Per-pixel colour distance below which two pixels count as the same. */
const PIXEL_THRESHOLD = 0.1;
/** A brand-new pair may not exceed this fraction of differing pixels. */
const CEILING = 0.12;
/** Scores wobble by a hair across renders; only a real regression should fail. */
const REGRESSION_TOLERANCE = 0.005;

const UPDATE = process.argv.includes("--update");
const TABLE = process.argv.includes("--table");

if (!existsSync(FID)) { console.log("docs/fidelity: nothing to diff."); process.exit(0); }

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { pairs: {} };
const scores = {};
const failures = [];
const rows = [];

for (const unit of readdirSync(FID).filter((d) => statSync(join(FID, d)).isDirectory())) {
  const dir = join(FID, unit);
  for (const f of readdirSync(dir).filter((x) => x.startsWith("proto-") && x.endsWith(".png"))) {
    const build = join(dir, f.replace(/^proto-/, "build-"));
    if (!existsSync(build)) continue;
    const key = `${unit}/${f.replace(/^proto-/, "").replace(/\.png$/, "")}`;

    const a = PNG.sync.read(readFileSync(join(dir, f)));
    const b = PNG.sync.read(readFileSync(build));
    if (a.width !== b.width || a.height !== b.height) {
      failures.push(`${key}: frame sizes differ (proto ${a.width}x${a.height}, build ${b.width}x${b.height}) — a pair must be shot at one viewport`);
      continue;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: PIXEL_THRESHOLD });
    const score = changed / (a.width * a.height);
    scores[key] = Number(score.toFixed(5));
    rows.push({ key, unit, score, changed });

    const prev = baseline.pairs?.[key];
    if (prev == null) {
      if (score > CEILING)
        failures.push(`${key}: ${(score * 100).toFixed(1)}% of pixels differ — a new pair may not exceed ${(CEILING * 100).toFixed(0)}%`);
    } else if (score > prev + REGRESSION_TOLERANCE) {
      failures.push(`${key}: REGRESSED — ${(prev * 100).toFixed(1)}% -> ${(score * 100).toFixed(1)}% of pixels differ`);
    }
  }
}

if (TABLE) {
  rows.sort((x, y) => y.score - x.score);
  console.log("| Surface | Unit | Differing pixels |");
  console.log("|---|---|--:|");
  for (const r of rows) console.log(`| \`${r.key.split("/")[1]}\` | ${r.unit} | ${(r.score * 100).toFixed(1)}% |`);
  process.exit(0);
}

if (UPDATE) {
  const next = { ...(baseline.pairs ?? {}) };
  let lowered = 0, added = 0, refused = 0;
  for (const [k, v] of Object.entries(scores)) {
    if (next[k] == null) { next[k] = v; added += 1; }
    else if (v < next[k]) { next[k] = v; lowered += 1; }
    else if (v > next[k] + REGRESSION_TOLERANCE) { refused += 1; }
  }
  writeFileSync(BASELINE, JSON.stringify({
    note: "Fraction of perceptually differing pixels per build/proto pair. Ratcheted by infra/scripts/pixel-diff.mjs: entries may only fall. B7.7 drives these down.",
    pixelThreshold: PIXEL_THRESHOLD, ceiling: CEILING,
    pairs: Object.fromEntries(Object.entries(next).sort(([x], [y]) => x.localeCompare(y))),
  }, null, 2) + "\n");
  console.log(`${relative(ROOT, BASELINE)}: ${added} added, ${lowered} lowered${refused ? `, ${refused} REFUSED (regressions are not recordable)` : ""}.`);
  if (refused) process.exit(1);
  process.exit(0);
}

if (failures.length) {
  console.error(`Pixel-diff gate FAILED (${failures.length}):\n`);
  for (const f of failures) console.error(`  • ${f}`);
  console.error("\nA pair may only get closer to the prototype. Re-capture clean-tree after fixing,");
  console.error("then `pnpm lint:pixel --update` to ratchet the baseline down.");
  process.exit(1);
}
console.log(`docs/fidelity: ${Object.keys(scores).length} build/proto pair(s) diffed — no regressions.`);
