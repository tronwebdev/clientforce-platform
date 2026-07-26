/**
 * Embed bundle build — one self-contained IIFE, no runtime dependencies.
 * `?raw` imports mirror vite's native raw handling (CSS inlined as text and
 * injected into the shadow root at mount).
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const rawPlugin = {
  name: "raw-text",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, async (args) => {
      const spec = args.path.slice(0, -"?raw".length);
      const resolved = await b.resolve(spec, {
        resolveDir: args.resolveDir,
        kind: "import-statement",
      });
      if (resolved.errors.length > 0) return { errors: resolved.errors };
      return { path: resolved.path, namespace: "raw-text" };
    });
    b.onLoad({ filter: /.*/, namespace: "raw-text" }, (args) => ({
      contents: readFileSync(args.path, "utf8"),
      loader: "text",
    }));
  },
};

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/clientforce-widget.js",
  format: "iife",
  target: ["es2019"],
  minify: true,
  sourcemap: true,
  plugins: [rawPlugin],
  banner: {
    js: "/* Clientforce Agent Widget — embeds with shadow-DOM isolation; see packages/widget/README.md */",
  },
  logLevel: "info",
});
