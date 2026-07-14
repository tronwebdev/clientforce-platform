/**
 * Shared guided-composer plumbing (G1 DEC-070 · G2 DEC-071) — the typed
 * refusal, the input shapes, and the render/context helpers both channel
 * composers (`compose-sms`, `compose-email`) build on. Extracted verbatim
 * from the G1 module so the sms composer's behavior stays byte-identical;
 * `compose-sms` re-exports everything here, so its public API is unchanged.
 */
import {
  DEFAULT_LANGUAGE,
  parseGuardrails,
  selectStrategy,
  type LanguageCode,
} from "@clientforce/core";

// ── Typed refusal ────────────────────────────────────────────────────────────
export type ComposeRefusalReason =
  | "COMPOSER_UNCONFIGURED"
  | "NEVER_SAY_VIOLATION"
  | "MUST_SAY_MISSING"
  | "TOO_LONG"
  | "TOKEN_SYNTAX"
  | "UNGROUNDED_URL"
  // G2 (DEC-071): email-only reasons — the composed subject broke a playbook
  // subject rule, or the composed text carried unsubscribe/footer language
  // (the footer is the boundary's job, forever).
  | "SUBJECT_RULE"
  | "COMPOSED_FOOTER"
  // P3.1 (DEC-078): voice-only — a spoken turn carried unspeakable material
  // (a URL read aloud, markdown/formatting, emoji). Spoken register is a
  // deterministic check, not a style preference.
  | "SPOKEN_REGISTER";

/** Composition failed its deterministic checks after the bounded retry. */
export class ComposeRefusedError extends Error {
  constructor(
    readonly reason: ComposeRefusalReason,
    readonly detail: string,
  ) {
    super(`Compose refused (${reason}): ${detail}`);
    this.name = "ComposeRefusedError";
  }
}

export interface ComposeViolation {
  reason: Exclude<ComposeRefusalReason, "COMPOSER_UNCONFIGURED">;
  detail: string;
}

// ── Inputs ───────────────────────────────────────────────────────────────────
export interface ComposeLead {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  /** C2.7 custom field values (string values only are rendered). */
  custom?: Record<string, unknown> | null;
}

export interface ComposeHistoryLine {
  channel: string;
  direction: "OUTBOUND" | "INBOUND";
  text: string;
}

// ── Deterministic-check primitives (pure) ────────────────────────────────────
export const TOKEN_SYNTAX_RE = /\{\{[^}]*\}\}/;
export const URL_RE = /(?:https?:\/\/|www\.)[^\s"'<>()\]]+/gi;

export const stripTrailingPunct = (u: string): string => u.replace(/[.,;:!?]+$/, "");

// ── Prompt-side renderers ────────────────────────────────────────────────────
export function renderLead(lead: ComposeLead): string {
  const custom = Object.entries(lead.custom ?? {})
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "")
    .map(([k, v]) => `- ${k}: ${v}`);
  const lines = [
    `- First name: ${lead.firstName?.trim() || "(unknown)"}`,
    `- Last name: ${lead.lastName?.trim() || "(unknown)"}`,
    `- Company: ${lead.company?.trim() || "(unknown)"}`,
    ...(lead.title?.trim() ? [`- Title: ${lead.title.trim()}`] : []),
    ...custom,
  ];
  return lines.join("\n");
}

export function renderHistory(history: ComposeHistoryLine[]): string {
  if (history.length === 0) {
    return "(first touch — no prior messages; identify the business naturally)";
  }
  return history
    .map((h) => `- [${h.channel} · ${h.direction === "OUTBOUND" ? "we sent" : "they replied"}] ${h.text}`)
    .join("\n");
}

/**
 * Build the per-agent cacheable block: business context + derived tone +
 * owner strategy notes. Stable across every lead of one agent by
 * construction — the provider cache prefix depends on it.
 */
export function buildCachedContext(args: {
  contextText: string;
  toneHints: string;
  strategyNotes?: string;
}): string {
  return [
    "BUSINESS CONTEXT (the ONLY permitted source of facts — cite-worthy values distilled from the company's own materials):",
    args.contextText,
    "",
    `TONE: ${args.toneHints}`,
    ...(args.strategyNotes?.trim() ? [`OWNER STRATEGY NOTES: ${args.strategyNotes.trim()}`] : []),
  ].join("\n");
}

/** How much recent conversation the composer sees (the classifier's number). */
export const HISTORY_TAKE = 10;

/**
 * Sample preview (G1/G2 UI): the FIXED sample lead the api composes against —
 * no contact row, no consent implications, empty history. Free at launch;
 * metering is Q-020.
 */
export const SAMPLE_LEAD: ComposeLead = {
  firstName: "Jane",
  lastName: "Doe",
  company: "Acme Dental",
  title: "Practice manager",
};

/** Agent-stable composer inputs from goal/category/guardrails — lenient like
 *  the planner's rider read: an unparsable row composes with defaults
 *  (English, no notes, no bans). L1 (DEC-072): both channel composers read
 *  the language rider from here — the pair can never fork on it. */
export function strategyOf(
  goal: string | null | undefined,
  category: string | null | undefined,
  guardrails: unknown,
): { toneHints: string; strategyNotes?: string; neverSay: string[]; language: LanguageCode } {
  const { toneHints } = selectStrategy(goal, category);
  try {
    const parsed = parseGuardrails(guardrails);
    return {
      toneHints,
      strategyNotes: parsed.strategy?.strategyNotes,
      neverSay: parsed.strategy?.neverSay ?? [],
      language: parsed.language ?? DEFAULT_LANGUAGE,
    };
  } catch {
    return { toneHints, neverSay: [], language: DEFAULT_LANGUAGE };
  }
}
