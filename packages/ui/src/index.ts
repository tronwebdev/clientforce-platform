/**
 * @clientforce/ui — design system (DESIGN_TOKENS.md).
 *
 * Tokens live in `tokens.css` (CSS custom properties) and `theme.ts` (the typed
 * mirror). Components consume the tokens via classes in `styles.css`. Consumers
 * import both stylesheets once:
 *   import "@clientforce/ui/tokens.css";
 *   import "@clientforce/ui/styles.css";
 */
export * from "./theme";
export * from "./components";

/** The Clientforce brand green (`green` token). */
export const BRAND_COLOR = "#35e834" as const;

export const UI_PACKAGE = "@clientforce/ui";
