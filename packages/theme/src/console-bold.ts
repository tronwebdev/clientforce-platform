/**
 * Console Bold design tokens (typed mirror) — the ADDITIVE Bold layer.
 *
 * Binding sources: `design_handoff_console_v3/DESIGN_TOKENS_V3.md` (§Bold,
 * 2026-08-16) + the built values in `prototypes/Console Bold.dc.html`.
 * `consoleBoldVars` mirrors src/console-bold.css one-to-one; the package test
 * pins the two in both directions and pins §Bold's hard rules, so neither can
 * drift from the doc silently. console-v3 (`--cv3-*`) is untouched beside it.
 */

/** Exact mirror of the custom properties in console-bold.css. */
export const consoleBoldVars: Record<string, string> = {
  // Surfaces
  "--cvb-wash": "#eff1f0",
  "--cvb-panel": "#fcfcfc",
  "--cvb-card": "#ffffff",
  "--cvb-hover": "#f6f7f7",
  "--cvb-well": "#f2f3f3",

  // Hairlines
  "--cvb-line": "#ecedec",
  "--cvb-line-2": "#f0f1f0",
  "--cvb-line-3": "#eaebea",
  "--cvb-line-strong": "#e2e4e3",
  "--cvb-line-inner": "#f1f2f1",
  "--cvb-line-ctl": "#e4e6e5",
  "--cvb-line-hover": "#dee1df",
  "--cvb-line-soft": "#edeeed",
  "--cvb-scrollbar": "#dcdfdd",

  // Ink & text
  "--cvb-ink": "#101613",
  "--cvb-ink-soft": "#3e4b44",
  "--cvb-muted": "#5a6660",
  "--cvb-line-dash": "#dcdfdd",
  "--cvb-row-hover": "#fbfcfb",
  "--cvb-hub-card-hover": "#f8faf9",
  "--cvb-hub-card-hover-line": "#dde4df",
  "--cvb-faint": "#8b968f",
  "--cvb-faint-2": "#a8b2ac",
  "--cvb-ghost": "#c3cbc6",

  // Color roles
  "--cvb-forest": "#146b33",
  "--cvb-mint": "#eaf5ee",
  "--cvb-mint-line": "#cfe8d8",
  "--cvb-mint-wash": "#f4faf6",
  "--cvb-cyan": "#0e7d93",
  "--cvb-cyan-tint": "#e2f3f6",
  "--cvb-cyan-line": "#bfe3eb",
  "--cvb-plum": "#5b4a8a",
  "--cvb-plum-tint": "#f0edf9",
  "--cvb-plum-line": "#dcd5ef",
  "--cvb-amber": "#8a6d1a",
  "--cvb-amber-bg": "#f7efda",
  "--cvb-amber-line": "#ead9a8",
  "--cvb-amber-soft-bg": "#fdfbf5",
  "--cvb-amber-soft-line": "#efe6d0",
  "--cvb-amber-soft-ink": "#a08749",
  "--cvb-danger": "#b0483a",
  "--cvb-danger-bg": "#fbeeea",
  "--cvb-slate": "#356170",
  "--cvb-slate-tint": "#eaf3f5",
  "--cvb-slate-line": "#cfe4e9",

  // Indicators
  "--cvb-live": "#35e834",
  "--cvb-warn-dot": "#e0a83a",
  "--cvb-dot-amber": "#d9a82b",
  "--cvb-icon-idle": "#7c8781",

  // Gradients
  "--cvb-gradient-signature": "linear-gradient(135deg, #36d7ed, #35e834 55%, #d0f56b)",
  "--cvb-gradient-ink": "linear-gradient(180deg, #101613 30%, #14743a 130%)",
  "--cvb-gradient-mark": "linear-gradient(135deg, #146b33, #35e834)",
  "--cvb-gradient-mark-2": "linear-gradient(135deg, #0e7d93, #36d7ed)",
  "--cvb-gradient-mark-3": "linear-gradient(135deg, #5b4a8a, #9b87d4)",
  "--cvb-gradient-rcp": "linear-gradient(150deg, #0c2a1b, #0a1524)",
  "--cvb-gradient-stage": "linear-gradient(180deg, #ffffff 0%, #fcfdfc 50%, #f7faf8 100%)",
  "--cvb-line-stage": "#e4e7e5",
  "--cvb-gradient-focus-wash":
    "radial-gradient(120% 90% at 78% -10%, #f3f6f4 0%, #edf0ee 45%, #e7ebe9 100%)",
  "--cvb-gradient-capsule":
    "linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 55%), linear-gradient(135deg, rgba(54, 215, 237, 0.16), rgba(53, 232, 52, 0.13) 55%, rgba(208, 245, 107, 0.18))",
  "--cvb-capsule-line": "rgba(53, 232, 52, 0.32)",
  "--cvb-capsule-line-hover": "rgba(53, 232, 52, 0.6)",
  "--cvb-capsule-glow": "rgba(53, 232, 52, 0.16)",
  "--cvb-capsule-glow-hover": "rgba(53, 232, 52, 0.4)",

  // Elevation
  "--cvb-shadow-card": "0 1px 2px rgba(16, 22, 19, 0.05), 0 14px 38px -14px rgba(16, 22, 19, 0.18)",
  "--cvb-shadow-subtle": "0 1px 2px rgba(16, 22, 19, 0.035)",
  "--cvb-shadow-lift": "0 1px 2px rgba(16, 22, 19, 0.12), 0 8px 20px -8px rgba(20, 107, 51, 0.55)",
  "--cvb-glow-ring": "rgba(20, 107, 51, 0.045)",
  "--cvb-glow-live": "0 0 0 7px rgba(20, 107, 51, 0.045)",

  // Inputs — recessed wells
  "--cvb-well-fill": "#f4f6f5",
  "--cvb-well-line": "#e2e6e4",
  "--cvb-well-divider": "#e7eae8",
  "--cvb-shadow-well": "inset 0 1px 2px rgba(16, 22, 19, 0.05)",

  // Type
  "--cvb-font-display": '"Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif',
  "--cvb-font-ui": '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  "--cvb-font-mono": '"IBM Plex Mono", ui-monospace, monospace',
  "--cvb-title-hero": "46px",
  "--cvb-title-stage": "34px",
  "--cvb-title-canvas": "27px",
  "--cvb-title-card": "26px",
  "--cvb-eyebrow-size": "9.5px",
  "--cvb-eyebrow-tracking": "0.18em",
  "--cvb-statlabel-size": "10px",
  "--cvb-statlabel-tracking": "0.13em",

  // Shell metrics
  "--cvb-shell-pad": "26px",
  "--cvb-shell-gap": "18px",
  "--cvb-rail-w": "228px",
  "--cvb-rail-slim-w": "46px",
  "--cvb-dock-w": "52px",
  "--cvb-dock-tile": "38px",
  "--cvb-dock-gap": "4px",
  "--cvb-r-tile": "13px",

  // Radius
  "--cvb-r-pill": "999px",
  "--cvb-r-chip": "13px",
  "--cvb-r-well": "14px",
  "--cvb-r-card": "17px",
  "--cvb-r-card-lg": "20px",
  "--cvb-r-stage": "22px",
  "--cvb-r-canvas": "24px",

  // Motion
  "--cvb-ease": "cubic-bezier(0.32, 0.72, 0, 1)",
  "--cvb-t-rail-fade": "0.22s",
  "--cvb-t-rail-slide": "0.3s",
  "--cvb-t-canvas-recede": "0.34s",
  "--cvb-t-canvas-approach": "0.4s",
  "--cvb-t-dock": "0.38s",
  "--cvb-t-tail": "0.3s",

  // B7.5 settings/write-layer style contract (SURFACE_SPEC_SETTINGS §2)
  "--cvb-shadow-two-layer":
    "0 1px 2px rgba(16, 22, 19, 0.04), 0 18px 34px -22px rgba(16, 22, 19, 0.1)",
  "--cvb-gradient-panel": "linear-gradient(180deg, #ffffff, #f7faf8)",
  "--cvb-panel-quiet": "#fcfcfc",
  "--cvb-well-fill-2": "#f4f6f5",
  "--cvb-well-line-2": "#dfe3e1",
  "--cvb-scrim": "rgba(16, 22, 19, 0.26)",
  "--cvb-r-drawer": "21px",
};

/** Ergonomic accessors for the values consumers reach for most. */
export const consoleBold = {
  wash: consoleBoldVars["--cvb-wash"],
  panel: consoleBoldVars["--cvb-panel"],
  card: consoleBoldVars["--cvb-card"],
  ink: consoleBoldVars["--cvb-ink"],
  forest: consoleBoldVars["--cvb-forest"],
  mint: consoleBoldVars["--cvb-mint"],
  mintLine: consoleBoldVars["--cvb-mint-line"],
  live: consoleBoldVars["--cvb-live"],
  warnDot: consoleBoldVars["--cvb-warn-dot"],
  gradientSignature: consoleBoldVars["--cvb-gradient-signature"],
  ease: consoleBoldVars["--cvb-ease"],
} as const;

/** Dock order — fixed by ADDENDUM_4_BOLD §3 (Receptionist alone at top). */
export const BOLD_DOCK_ORDER = [
  "receptionist",
  "inbox",
  "contacts",
  "lead-finder",
  "automations",
  "forms",
  "site-agent",
  "proposals",
  "analytics",
  "integrations",
  "settings",
] as const;
export type BoldDockKey = (typeof BOLD_DOCK_ORDER)[number];
