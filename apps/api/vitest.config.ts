import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// NestJS relies on emitted decorator metadata for DI; esbuild (vitest's default)
// doesn't emit it, so transform the e2e suite with SWC instead.
export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  plugins: [
    swc.vite({
      tsconfigFile: false,
      module: { type: "es6" },
      jsc: {
        keepClassNames: true,
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
