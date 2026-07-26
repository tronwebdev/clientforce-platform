/**
 * @clientforce/theme — console-v3 design tokens (typed mirror).
 *
 * Binding source: `CONSOLE_V3_CANON.md` at the repo root (LOCKED by the owner
 * 2026-07-12). `consoleV3Vars` mirrors src/console-v3.css one-to-one; the
 * package test pins the two in both directions AND pins the canon's hard
 * rules, so neither can drift from the doc silently.
 */

/** Exact mirror of the custom properties in console-v3.css. */
export const consoleV3Vars: Record<string, string> = {
  // §1 Color
  "--cv3-wash": "#e9efea",
  "--cv3-panel": "#fbfdfb",
  "--cv3-card": "#ffffff",
  "--cv3-ink": "#101613",
  "--cv3-muted": "#5a6660",
  "--cv3-faint": "#8b968f",
  "--cv3-line": "#e9eeea",
  "--cv3-line-input": "#dce5de",
  "--cv3-line-soft": "#e2eae4",
  "--cv3-forest": "#146b33",
  "--cv3-forest-deep": "#0f5227",
  "--cv3-mint": "#eaf5ee",
  "--cv3-mint-line": "#cfe8d8",
  "--cv3-warn": "#8a6d1a",
  "--cv3-warn-bg": "#f7efda",
  "--cv3-danger": "#b0483a",
  "--cv3-teal": "#0e7d93",
  "--cv3-bubble-agent": "#f2f6f3",
  "--cv3-gradient-signature": "linear-gradient(135deg, #36d7ed, #35e834 55%, #d0f56b)",
  "--cv3-gradient-hero-ink": "linear-gradient(180deg, #101613 25%, #14743a 120%)",
  "--cv3-vivid": "#35e834",
  "--cv3-vivid-ring": "rgba(53, 232, 52, 0.35)",

  // §2 Semantic labels — pipeline temperature ramp
  "--cv3-stage-new-fg": "#5a6660",
  "--cv3-stage-new-bg": "#f1f4f2",
  "--cv3-stage-new-line": "#e2eae4",
  "--cv3-stage-contacted-fg": "#356170",
  "--cv3-stage-contacted-bg": "#eaf3f5",
  "--cv3-stage-contacted-line": "#cfe4e9",
  "--cv3-stage-engaged-fg": "#0e7d93",
  "--cv3-stage-engaged-bg": "#e2f3f6",
  "--cv3-stage-engaged-line": "#bfe3eb",
  "--cv3-stage-interested-fg": "#8a6d1a",
  "--cv3-stage-interested-bg": "#f7efda",
  "--cv3-stage-interested-line": "#ead9a8",
  "--cv3-stage-booked-fg": "#146b33",
  "--cv3-stage-booked-bg": "#eaf5ee",
  "--cv3-stage-booked-line": "#cfe8d8",
  "--cv3-stage-won-fg": "#ffffff",
  "--cv3-stage-won-bg": "#146b33",
  "--cv3-stage-won-line": "#0f5227",
  "--cv3-stage-lost-fg": "#b0483a",
  "--cv3-stage-lost-bg": "#fbeeea",
  "--cv3-stage-lost-line": "#f0cfc8",

  // §2 Channel tints
  "--cv3-channel-email-fg": "#146b33",
  "--cv3-channel-email-bg": "#f1f8f3",
  "--cv3-channel-email-line": "#dcebe1",
  "--cv3-channel-sms-fg": "#0e7d93",
  "--cv3-channel-sms-bg": "#f0f8fa",
  "--cv3-channel-sms-line": "#d5eaef",
  "--cv3-channel-whatsapp-fg": "#2e7d4f",
  "--cv3-channel-whatsapp-bg": "#f1f8f3",
  "--cv3-channel-whatsapp-line": "#d8eadf",
  "--cv3-channel-voice-fg": "#8a6d1a",
  "--cv3-channel-voice-bg": "#fbf6e9",
  "--cv3-channel-voice-line": "#eee0bf",

  // §3 Type
  "--cv3-font-display": '"Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif',
  "--cv3-font-ui": '"Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif',
  "--cv3-font-mono": '"IBM Plex Mono", ui-monospace, monospace',
  "--cv3-display-tracking": "-0.02em",
  "--cv3-display-tracking-tight": "-0.035em",
  "--cv3-h1-size": "32px",
  "--cv3-h1-weight": "900",
  "--cv3-h2-size": "22px",
  "--cv3-h2-weight": "800",
  "--cv3-h3-size": "16px",
  "--cv3-h3-weight": "700",
  "--cv3-body-size": "14.5px",
  "--cv3-body-weight": "400",
  "--cv3-label-size": "13px",
  "--cv3-label-weight": "600",
  "--cv3-eyebrow-size": "11px",
  "--cv3-eyebrow-weight": "700",
  "--cv3-eyebrow-tracking": "0.08em",
  "--cv3-mono-size": "12px",
  "--cv3-mono-weight": "500",

  // §4 Radius · space · elevation
  "--cv3-radius-sm": "9px",
  "--cv3-radius-md": "12px",
  "--cv3-radius-lg": "16px",
  "--cv3-radius-frame": "22px",
  "--cv3-radius-pill": "999px",
  "--cv3-space-1": "4px",
  "--cv3-space-2": "8px",
  "--cv3-space-3": "12px",
  "--cv3-space-4": "16px",
  "--cv3-space-5": "22px",
  "--cv3-space-6": "30px",
  "--cv3-shadow-card": "0 1px 2px rgba(16, 22, 19, 0.04), 0 10px 30px rgba(16, 22, 19, 0.07)",
  "--cv3-shadow-float": "0 1px 2px rgba(16, 22, 19, 0.05), 0 18px 44px rgba(16, 22, 19, 0.16)",

  // §5 Motion
  "--cv3-breathe": "3.6s",
  "--cv3-ping": "2.2s",
  "--cv3-spin": "2.4s",
  "--cv3-slide": "1.7s",
  "--cv3-glow": "4.5s",
  "--cv3-ease": "cubic-bezier(0.4, 0, 0.2, 1)",
  "--cv3-motion-fast": "150ms",
  "--cv3-motion-base": "200ms",
};

/** Ergonomic accessors for the values consumers reference from TS. */
export const consoleV3 = {
  forest: consoleV3Vars["--cv3-forest"] as string,
  forestDeep: consoleV3Vars["--cv3-forest-deep"] as string,
  ink: consoleV3Vars["--cv3-ink"] as string,
  card: consoleV3Vars["--cv3-card"] as string,
  panel: consoleV3Vars["--cv3-panel"] as string,
  wash: consoleV3Vars["--cv3-wash"] as string,
  gradientSignature: consoleV3Vars["--cv3-gradient-signature"] as string,
  /** Gradient + motion ONLY — never pass this to a fill/text slot (§1). */
  vivid: consoleV3Vars["--cv3-vivid"] as string,
} as const;

/** The canon's agent mark (§6) — ✦ on the signature gradient. */
export const AGENT_MARK = "✦";

/** Canon default agent name (§6). */
export const DEFAULT_AGENT_NAME = "Ada";

/**
 * §6 — the five CONSOLE states. Console-surface concern; listed here so the
 * re-skin reads them from the same module.
 */
export const CONSOLE_STATES = ["ready", "thinking", "working", "needs-you", "held"] as const;
export type ConsoleState = (typeof CONSOLE_STATES)[number];

/**
 * §6 — the widget's FOUR chat verbs. Canon is explicit: do NOT force a fifth
 * state into the widget; these map into the console states instead.
 */
export const AGENT_STATES = ["idle", "listening", "thinking", "replying"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/**
 * The recorded widget→console mapping (Q-049). `needs-you` and `held` have no
 * widget analogue — they are console-surface states, deliberately unmapped.
 */
export const WIDGET_STATE_TO_CONSOLE: Record<AgentState, ConsoleState> = {
  idle: "ready",
  listening: "ready",
  thinking: "thinking",
  replying: "working",
};

/** Motion verb per widget state (§5 verbs, §6 mark treatments). */
export const AGENT_STATE_MOTION: Record<AgentState, "breathe" | "ping" | "spin" | "slide"> = {
  idle: "breathe",
  listening: "ping",
  thinking: "spin",
  replying: "slide",
};

/**
 * Contrast resolution for text on an arbitrary brand fill (luminance rule;
 * the dark side is the canon ink, the light side white).
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
