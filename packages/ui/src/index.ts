/**
 * @clientforce/ui — design system (CONSISTENCY_AUDIT.md).
 *
 * T0 stub. The full token scale, theme, and base components (Button, Card, Pill,
 * Toast, …) land in T5. For now this exports only the brand color so the token is
 * defined in exactly one place and `stylelint` can fail any off-token color.
 */

/** The Clientforce brand green. The single source of truth for the token. */
export const BRAND_COLOR = "#35E834" as const;

/** Design tokens (T0: brand only; full scale arrives in T5). */
export const tokens = {
  color: {
    brand: BRAND_COLOR,
  },
} as const;

export const UI_PACKAGE = "@clientforce/ui";
