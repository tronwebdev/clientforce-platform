/**
 * Assets imported with the `?raw` query resolve to their source text:
 * vite/vitest handle `?raw` natively; build.mjs mirrors it with an esbuild
 * plugin (text loader). The widget inlines its styles and the brand mark so
 * the bundle fetches nothing at runtime.
 */
declare module "*?raw" {
  const contents: string;
  export default contents;
}
