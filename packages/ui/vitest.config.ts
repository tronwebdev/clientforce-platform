import { defineConfig } from "vitest/config";

export default defineConfig({
  // Automatic JSX runtime, matching apps/web's transform.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
  },
});
