import { defineConfig } from "vitest/config";

export default defineConfig({
  // Use the automatic JSX runtime (react/jsx-runtime) so components don't need
  // an explicit React import — matching Next's transform.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
  },
});
