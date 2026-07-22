/**
 * @clientforce/theme — console-v3 design tokens (typed mirror).
 *
 * `consoleV3Vars` mirrors src/console-v3.css one-to-one (custom-property name →
 * value); the package test pins the two in both directions so they cannot
 * drift. Consumers style with var(--cv3-*) and use this module for typed
 * access (build-time constants, contrast resolution, motion-state names).
 *
 * Binding source: the Console v3 Build Spec + owner mock (values relayed at
 * the 2026-07-22 unit review — Q-049 lands the spec/mock files in-repo and
 * the fidelity pass against them). Supersedes the legacy prototype literals.
 */

/** Exact mirror of the custom properties in console-v3.css. */
export const consoleV3Vars: Record<string, string> = {
  "--cv3-accent": "#146b33",
  "--cv3-accent-hover": "#0f5227",
  "--cv3-wash": "#e9efea",
  "--cv3-panel": "#fbfdfb",
  "--cv3-card": "#ffffff",
  "--cv3-ink": "#101613",
  "--cv3-muted": "#5a6660",
  "--cv3-faint": "#8b968f",
  "--cv3-hairline": "#e9eeea",
  "--cv3-hairline-input": "#dce5de",
  "--cv3-divider": "#e2eae4",
  "--cv3-mint": "#eaf5ee",
  "--cv3-mint-border": "#cfe8d8",
  "--cv3-warn-ink": "#8a6d1a",
  "--cv3-warn-bg": "#f7efda",
  "--cv3-danger": "#b0483a",
  "--cv3-gradient-signature": "linear-gradient(135deg, #36d7ed, #35e834 55%, #d0f56b)",
  "--cv3-vivid": "#35e834",
  "--cv3-vivid-fade": "rgba(53, 232, 52, 0)",
  "--cv3-font-display": '"Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif',
  "--cv3-font-ui": '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  "--cv3-font-mono": '"IBM Plex Mono", ui-monospace, monospace',
  "--cv3-radius-sm": "9px",
  "--cv3-radius-md": "12px",
  "--cv3-radius-lg": "16px",
  "--cv3-radius-xl": "22px",
  "--cv3-radius-pill": "999px",
  "--cv3-shadow-panel": "0 18px 50px rgba(14, 21, 18, 0.22)",
  "--cv3-shadow-launcher": "0 10px 26px rgba(14, 21, 18, 0.28)",
  "--cv3-motion-fast": "150ms",
  "--cv3-motion-base": "200ms",
  "--cv3-ease": "cubic-bezier(0.4, 0, 0.2, 1)",
  "--cv3-breathe-period": "2s",
  "--cv3-float-period": "3.5s",
  "--cv3-ping-ring": "rgba(53, 232, 52, 0.35)",
  "--cv3-online": "#7cf59b",
  "--cv3-badge": "#ff5a5a",
  "--cv3-orb-overlay": "rgba(255, 255, 255, 0.22)",
  "--cv3-dark-surface": "#141b17",
  "--cv3-dark-hairline": "rgba(255, 255, 255, 0.1)",
  "--cv3-dark-bubble": "rgba(255, 255, 255, 0.07)",
  "--cv3-dark-ink": "rgba(255, 255, 255, 0.9)",
  "--cv3-dark-chip": "rgba(255, 255, 255, 0.06)",
  "--cv3-dark-chip-border": "rgba(255, 255, 255, 0.14)",
  "--cv3-dark-field": "rgba(255, 255, 255, 0.06)",
  "--cv3-dark-field-border": "rgba(255, 255, 255, 0.12)",
  "--cv3-dark-placeholder": "rgba(255, 255, 255, 0.4)",
};

/** Ergonomic accessors for the values consumers reference from TS. */
export const consoleV3 = {
  accent: consoleV3Vars["--cv3-accent"] as string,
  accentHover: consoleV3Vars["--cv3-accent-hover"] as string,
  ink: consoleV3Vars["--cv3-ink"] as string,
  card: consoleV3Vars["--cv3-card"] as string,
  wash: consoleV3Vars["--cv3-wash"] as string,
  gradientSignature: consoleV3Vars["--cv3-gradient-signature"] as string,
  /** Gradient + motion ONLY — never pass this to a fill/text slot. */
  vivid: consoleV3Vars["--cv3-vivid"] as string,
} as const;

/**
 * Agent-identity motion states. Canon motion verbs (Agent Identity & States):
 * idle→breathe · listening→ping · thinking→spin · replying→slide (the reply
 * slides in). The canon names FIVE agent states; the widget ships these four —
 * the fifth reconciles when the states canon doc lands in-repo (Q-049).
 */
export const AGENT_STATES = ["idle", "listening", "thinking", "replying"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/**
 * Contrast resolution for text on an arbitrary brand fill (the widget
 * prototype's ink() luminance rule, dark side re-anchored on canon ink).
 */
export function textOnColor(hex: string): string {
  const h = String(hex || "").replace("#", "");
  if (h.length < 6) return consoleV3.ink;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return consoleV3.ink;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? consoleV3.ink : "#FFFFFF";
}

/** Subtitle/secondary tone on a brand fill. */
export function subtleTextOnColor(hex: string): string {
  return textOnColor(hex) === "#FFFFFF" ? "rgba(255,255,255,.75)" : "rgba(16,22,19,.6)";
}
