import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // P1.1 acceptance: no package other than packages/ai may touch the model
    // SDKs — everything goes through the @clientforce/ai gateway.
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["packages/ai/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message:
                "Import the gateway from @clientforce/ai instead — direct SDK use is restricted to packages/ai (PHASE1_ISSUES P1.1).",
            },
            {
              name: "openai",
              message:
                "Use @clientforce/ai embed()/gateway instead — provider SDKs are restricted to packages/ai (PHASE1_ISSUES P1.1).",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
