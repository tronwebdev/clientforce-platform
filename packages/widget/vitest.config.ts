import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * `x.css?raw` → the file's source text as the default export. Vitest's CSS
 * pipeline otherwise intercepts .css ids and returns empty content; resolving
 * to a non-.css marker id keeps it out of that path. build.mjs mirrors this
 * for the bundle with an esbuild text-loader plugin.
 */
/* The marker must change the apparent extension: vitest's CSS interception
 * matches `.css` with or without a query and would return an empty module. */
const RAW_SUFFIX = ".cfw-raw.js";
const rawCss: Plugin = {
  name: "cfw-raw-css",
  enforce: "pre",
  async resolveId(source, importer) {
    if (!source.endsWith(".css?raw")) return null;
    const resolved = await this.resolve(source.slice(0, -"?raw".length), importer, {
      skipSelf: true,
    });
    return resolved ? resolved.id + RAW_SUFFIX : null;
  },
  load(id) {
    if (!id.endsWith(RAW_SUFFIX)) return null;
    const file = id.slice(0, -RAW_SUFFIX.length);
    return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
  },
};

export default defineConfig({
  plugins: [rawCss],
  test: {
    environment: "jsdom",
    include: ["test/**/*.{test,spec}.ts"],
  },
});
