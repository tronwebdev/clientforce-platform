/**
 * Design-token enforcement (CONSISTENCY_AUDIT.md).
 *
 * Raw color literals (hex / named) are disallowed everywhere so that UI code is
 * forced to consume design tokens (CSS custom properties) instead of off-token
 * colors. The single place a literal color is allowed is the design-system token
 * source (`packages/ui/src/tokens.css`), where the brand token `#35E834` and the
 * rest of the palette are defined.
 */
module.exports = {
  rules: {
    "color-no-hex": true,
    "color-named": "never",
  },
  ignoreFiles: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/.turbo/**"],
  overrides: [
    {
      // Design-token SOURCES — the only files allowed raw color literals:
      // the legacy skin's tokens and the console-v3 module (widget unit).
      files: ["packages/ui/src/tokens.css", "packages/theme/src/console-v3.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
      },
    },
  ],
};
