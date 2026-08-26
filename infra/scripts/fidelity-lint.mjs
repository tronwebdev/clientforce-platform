#!/usr/bin/env node
/**
 * Fidelity-evidence freshness gate (B1 review ruling).
 *
 * A §8 screenshot at a mutable path is only evidence while its bytes are the
 * bytes the capture run wrote: the B1 review was misled by a stale image at
 * an unchanged path, and the round before that a crash page was committed as
 * a frame. Both failure modes become BUILD FAILURES here:
 *
 *   1. Every docs/fidelity/<unit>/ directory must carry a MANIFEST.json
 *      (written only by the single-run capture tool, which refuses to promote
 *      a partial or crashed set).
 *   2. The manifest's frame list and the directory's *.png set must match
 *      EXACTLY — a frame missing from the manifest, or a manifest entry with
 *      no file, fails.
 *   3. Every frame's sha256 must match its manifest entry — a stale,
 *      substituted, or hand-edited frame fails.
 *
 * Reviewers verify what they are looking at by hashing the file against the
 * manifest — never by trusting an image cache or a diff pane.
 *
 * Run: pnpm lint:fidelity
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FID = join(ROOT, "docs", "fidelity");
const failures = [];

if (!existsSync(FID)) {
  console.log("docs/fidelity: nothing to check.");
  process.exit(0);
}

const units = readdirSync(FID).filter((d) => statSync(join(FID, d)).isDirectory());
let frameCount = 0;

for (const unit of units) {
  const dir = join(FID, unit);
  const manifestPath = join(dir, "MANIFEST.json");
  if (!existsSync(manifestPath)) {
    failures.push(`${unit}: MANIFEST.json missing — frames without a manifest are not evidence`);
    continue;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    failures.push(`${unit}: MANIFEST.json unparsable (${String(e).slice(0, 80)})`);
    continue;
  }
  const declared = new Set(Object.keys(manifest.frames ?? {}));
  const present = new Set(readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png")));

  for (const f of present) {
    if (!declared.has(f)) failures.push(`${unit}/${f}: present on disk but absent from MANIFEST.json`);
  }
  for (const f of declared) {
    if (!present.has(f)) {
      failures.push(`${unit}/${f}: declared in MANIFEST.json but missing on disk`);
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(join(dir, f))).digest("hex");
    const expected = manifest.frames[f]?.sha256;
    if (actual !== expected) {
      failures.push(
        `${unit}/${f}: sha256 mismatch — the committed bytes are not the capture run's bytes ` +
          `(expected ${String(expected).slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
      );
    } else {
      frameCount += 1;
    }
  }
}

if (failures.length) {
  console.error("docs/fidelity — freshness gate FAILED:\n");
  for (const f of failures) console.error(`  • ${f}`);
  console.error(
    "\nRe-run the unit's single-run capture tool (e2e/capture-bold-fidelity.mjs) against a" +
      "\nfresh build — it refuses to promote partial or crashed sets and rewrites the manifest.",
  );
  process.exit(1);
}

console.log(
  `docs/fidelity: ${units.length} unit dir(s), ${frameCount} frames bound to their manifests — freshness gate passed.`,
);
