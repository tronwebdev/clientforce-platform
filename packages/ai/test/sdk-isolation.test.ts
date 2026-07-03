import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P1.1 acceptance #3 (belt to the eslint rule's suspenders): no source file
 * outside packages/ai imports a model SDK directly.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_ROOTS = ["apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "test-results"]);
const RESTRICTED = [
  /from\s+["']@anthropic-ai\/sdk["']/,
  /require\(["']@anthropic-ai\/sdk["']\)/,
  /from\s+["']openai["']/,
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) yield full;
  }
}

describe("SDK isolation", () => {
  it("no package outside packages/ai imports the Anthropic/OpenAI SDKs", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(REPO_ROOT, root))) {
        const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
        if (rel.startsWith("packages/ai/")) continue;
        const content = readFileSync(file, "utf8");
        if (RESTRICTED.some((re) => re.test(content))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
