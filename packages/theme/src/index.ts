/**
 * @clientforce/theme — console-v3 design tokens (typed mirror).
 *
 * `consoleV3Vars` mirrors src/console-v3.css one-to-one (custom-property name →
 * value); the package test pins the two in both directions so they cannot
 * drift. Consumers style with var(--cv3-*) and use this module for typed
 * access (build-time constants, contrast resolution, motion-state names).
 *
 * PROVISIONAL pending the owner's console-v3 mock (Q-047) — values are
 * canon-derived only (DESIGN_TOKENS.md + the Agent Widget prototype).
 */

/** Exact mirror of the custom properties in console-v3.css. */
export const consoleV3Vars: Record<string, string> = {
  "--cv3-ink": "#0e1512",
  "--cv3-ink-strong": "#0a0f0c",
  "--cv3-ink-body": "#27322c",
  "--cv3-muted": "#9aa59e",
  "--cv3-muted-2": "#5c6b62",
  "--cv3-muted-3": "#8a7f6b",
  "--cv3-surface": "#ffffff",
  "--cv3-surface-soft": "#f7f9f8",
  "--cv3-surface-mist": "#f2f5f3",
  "--cv3-canvas": "#fbf7f0",
  "--cv3-hairline": "#e4eae6",
  "--cv3-hairline-soft": "#ecefec",
  "--cv3-hairline-warm": "#ebe3d6",
  "--cv3-line-soft": "#f2eee4",
  "--cv3-accent": "#16a82a",
  "--cv3-accent-deep": "#0f7a28",
  "--cv3-accent-vivid": "#35e834",
  "--cv3-accent-ghost": "rgba(53, 232, 52, 0.1)",
  "--cv3-accent-tint": "rgba(53, 232, 52, 0.12)",
  "--cv3-accent-border": "rgba(53, 232, 52, 0.28)",
  "--cv3-accent-soft-bg": "#d7f5dd",
  "--cv3-accent-fade": "rgba(53, 232, 52, 0)",
  "--cv3-online": "#7cf59b",
  "--cv3-orb-overlay": "rgba(255, 255, 255, 0.22)",
  "--cv3-gradient-signature": "linear-gradient(135deg, #36d7ed 0%, #35e834 55%, #d0f56b 100%)",
  "--cv3-gradient-identity": "linear-gradient(135deg, #36d7ed, #35e834)",
  "--cv3-danger": "#c9543f",
  "--cv3-badge": "#ff5a5a",
  "--cv3-cyan": "#36d7ed",
  "--cv3-lime": "#d0f56b",
  "--cv3-dark": "#0c140f",
  "--cv3-dark-surface": "#141b17",
  "--cv3-dark-hairline": "rgba(255, 255, 255, 0.1)",
  "--cv3-dark-bubble": "rgba(255, 255, 255, 0.07)",
  "--cv3-dark-ink": "rgba(255, 255, 255, 0.9)",
  "--cv3-dark-chip": "rgba(255, 255, 255, 0.06)",
  "--cv3-dark-chip-border": "rgba(255, 255, 255, 0.14)",
  "--cv3-dark-field": "rgba(255, 255, 255, 0.06)",
  "--cv3-dark-field-border": "rgba(255, 255, 255, 0.12)",
  "--cv3-dark-placeholder": "rgba(255, 255, 255, 0.4)",
  "--cv3-font-display": '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif',
  "--cv3-font-body": '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
  "--cv3-font-mono": '"Courier New", ui-monospace, monospace',
  "--cv3-radius-sm": "8px",
  "--cv3-radius-md": "11px",
  "--cv3-radius-lg": "14px",
  "--cv3-radius-xl": "16px",
  "--cv3-radius-2xl": "20px",
  "--cv3-radius-3xl": "28px",
  "--cv3-radius-pill": "100px",
  "--cv3-shadow-card": "0 4px 16px rgba(14, 21, 18, 0.04)",
  "--cv3-shadow-btn-glow": "0 6px 16px rgba(53, 232, 52, 0.26)",
  "--cv3-shadow-panel": "0 18px 50px rgba(14, 21, 18, 0.22)",
  "--cv3-shadow-launcher": "0 10px 26px rgba(14, 21, 18, 0.28)",
  "--cv3-shadow-label": "0 6px 18px rgba(14, 21, 18, 0.16)",
  "--cv3-shadow-knob": "0 1px 3px rgba(0, 0, 0, 0.2)",
  "--cv3-scrim": "rgba(12, 20, 15, 0.45)",
  "--cv3-motion-fast": "150ms",
  "--cv3-motion-base": "200ms",
  "--cv3-ease": "cubic-bezier(0.4, 0, 0.2, 1)",
  "--cv3-breath-period": "2s",
  "--cv3-float-period": "3.5s",
};

/** Ergonomic accessors for the values consumers reference from TS. */
export const consoleV3 = {
  accent: consoleV3Vars["--cv3-accent"] as string,
  accentDeep: consoleV3Vars["--cv3-accent-deep"] as string,
  accentVivid: consoleV3Vars["--cv3-accent-vivid"] as string,
  ink: consoleV3Vars["--cv3-ink"] as string,
  inkStrong: consoleV3Vars["--cv3-ink-strong"] as string,
  surface: consoleV3Vars["--cv3-surface"] as string,
  gradientSignature: consoleV3Vars["--cv3-gradient-signature"] as string,
  gradientIdentity: consoleV3Vars["--cv3-gradient-identity"] as string,
} as const;

/**
 * Agent-identity motion states (console-v3 language). The widget's identity
 * orb renders one of these at all times; choreography is CSS-driven off
 * data-agent-state and honors prefers-reduced-motion.
 */
export const AGENT_STATES = ["idle", "listening", "thinking", "replying"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/**
 * Contrast resolution for text on an arbitrary brand fill — verbatim port of
 * the Agent Widget prototype's ink() (luminance > 0.62 → near-black, else
 * white). Keeps configurable brand colors AA-legible without inventing a rule.
 */
export function textOnColor(hex: string): string {
  const h = String(hex || "").replace("#", "");
  if (h.length < 6) return consoleV3.inkStrong;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return consoleV3.inkStrong;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? consoleV3.inkStrong : "#FFFFFF";
}

/** Subtitle/secondary tone on a brand fill, from the prototype's onBrandSub. */
export function subtleTextOnColor(hex: string): string {
  return textOnColor(hex) === "#FFFFFF" ? "rgba(255,255,255,.75)" : "rgba(10,15,12,.6)";
}
