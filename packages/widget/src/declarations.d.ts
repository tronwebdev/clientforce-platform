/**
 * CSS imported with the `?raw` query resolves to its source text:
 * vite/vitest handle `?raw` natively; build.mjs mirrors it with an esbuild
 * plugin (text loader). The widget inlines all styles into its shadow root.
 */
declare module "*.css?raw" {
  const css: string;
  export default css;
}
