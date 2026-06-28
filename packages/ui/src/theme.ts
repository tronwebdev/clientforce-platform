/**
 * Theme object — the TypeScript mirror of tokens.css (DESIGN_TOKENS.md §1–§5).
 * Canonical names + values; keep in sync with tokens.css. Components should
 * prefer the CSS custom properties; this object is for logic that needs values
 * (charts, canvas, inline computed styles, tests).
 */
export const colors = {
  ink: "#0e1512",
  hairline: "#ebe3d6",
  muted: "#9aa59e",
  "muted-2": "#5c6b62",
  "green-ink": "#16a82a",
  green: "#35e834",
  cyan: "#36d7ed",
  "line-soft": "#f2eee4",
  "muted-3": "#8a7f6b",
  "near-black": "#0a0f0c",
  lime: "#d0f56b",
  bg: "#fbf7f0",
  "border-cool": "#e4eae6",
  dark: "#0c140f",
  "green-soft-bg": "#d7f5dd",
  "teal-ink": "#1192a6",
  danger: "#c9543f",
  "green-700": "#0f7a28",
  surface: "#ffffff",
} as const;

export const gradient = {
  brand: "linear-gradient(135deg,#36d7ed 0%,#35e834 55%,#d0f56b 100%)",
} as const;

export const radius = {
  sm: 8,
  md: 11,
  lg: 14,
  xl: 16,
  "2xl": 20,
  pill: 100,
} as const;

export const shadow = {
  card: "0 4px 16px rgba(14,21,18,.04)",
  "btn-glow": "0 6px 16px rgba(53,232,52,.26)",
  dropdown: "0 16px 44px rgba(0,0,0,.18)",
  drawer: "-24px 0 70px rgba(0,0,0,.28)",
  modal: "0 40px 90px rgba(0,0,0,.45)",
  "toggle-knob": "0 1px 3px rgba(0,0,0,.2)",
} as const;

/** 4px spacing ramp (§5). */
export const space = [4, 8, 12, 16, 20, 24, 32, 40, 48] as const;

/** Type ramp in px (§2). */
export const text = [11, 12, 13, 14, 16, 18, 20, 24, 28] as const;

export const font = {
  display: '"Bricolage Grotesque", sans-serif',
  body: '"Hanken Grotesk", sans-serif',
  mono: '"Courier New", ui-monospace, monospace',
} as const;

export const theme = { colors, gradient, radius, shadow, space, text, font } as const;

export type ColorToken = keyof typeof colors;
export type RadiusToken = keyof typeof radius;
export type ShadowToken = keyof typeof shadow;

/** Reference a color token as its CSS custom property, e.g. cssVar("green-ink"). */
export function cssVar(token: ColorToken): string {
  return `var(--cf-color-${token})`;
}
