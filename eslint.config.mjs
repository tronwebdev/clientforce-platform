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
  {
    // B3a review (owner ruling, DEC-112(7)): build-process vocabulary —
    // wave ids, DEC-### and Q-### ledger ids — never reaches rendered Bold
    // copy. String literals, JSX text and template strings under the Bold
    // surface are checked; code comments are unaffected.
    files: ["apps/web/components/bold/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[value=/\\b(DEC-\\d|Q-\\d\\d|wave)\\b/i]",
          message:
            "Process vocabulary (wave / DEC / Q ids) must not render in Bold copy — owner ruling, B3a review.",
        },
        {
          selector: "Literal[value=/\\b(DEC-\\d|Q-\\d\\d|wave)\\b/i]",
          message:
            "Process vocabulary (wave / DEC / Q ids) must not render in Bold copy — owner ruling, B3a review.",
        },
        {
          selector: "TemplateElement[value.raw=/\\b(DEC-\\d|Q-\\d\\d|wave)\\b/i]",
          message:
            "Process vocabulary (wave / DEC / Q ids) must not render in Bold copy — owner ruling, B3a review.",
        },
      ],
    },
  },
  {
    // B6.5 (SURFACE_SPEC §12.9, DEC-153): the NOUN CHECK. On the Lead finder,
    // every noun for the people being described comes from the shape/vertical
    // registries through `GET /leads/config` — `config.noun`, `config.title`,
    // the group labels. A hard-coded B2B (or B2C) noun in this shared surface
    // is a review defect: it shows businesses to a workspace that sells to
    // consumers, and patients to one that does not have any.
    files: ["apps/web/components/bold/BoldLeadFinderView.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXText[value=/\\b(dentists?|practices?|patients?|households?|companies|business(es)?|clinics?|salons?)\\b/i]",
          message:
            "Nouns for the people on this surface must come from the shape/vertical registry (config.noun / config.title), never a literal.",
        },
        {
          selector:
            "Literal[value=/\\b(dentists?|practices?|patients?|households?|companies|business(es)?|clinics?|salons?)\\b/i]",
          message:
            "Nouns for the people on this surface must come from the shape/vertical registry (config.noun / config.title), never a literal.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b(dentists?|practices?|patients?|households?|companies|business(es)?|clinics?|salons?)\\b/i]",
          message:
            "Nouns for the people on this surface must come from the shape/vertical registry (config.noun / config.title), never a literal.",
        },
      ],
    },
  },
  prettier,
);
