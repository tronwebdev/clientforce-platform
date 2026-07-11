import { registerPrompt, renderPrompt } from "@clientforce/ai";
import { DEFAULT_LANGUAGE, languagePromptLabel, type LanguageCode } from "@clientforce/core";

/**
 * Distiller prompt (P1.3, DEC-024). Versioned in the P1.1 registry. The
 * hard rule the whole feature hangs on: fills come ONLY from the evidence
 * pack, every fill cites chunk ids, and anything unsupported is OMITTED —
 * the gap checker turns omissions into gap rows. Never model priors.
 *
 * v2 (L1, DEC-071): the v1 literal + one rawSummary-language rule — the
 * distilled brief is user-facing (the wizard's About-your-business card), so
 * a non-English agent reads it in its language. Rendered ONLY for non-English
 * agents; English agents keep rendering v1 byte-identical (regression-pinned).
 * Derived from the v1 literal at registration so the two can never drift.
 */
export const DISTILL_PROMPT_NAME = "context.distill";
export const DISTILL_PROMPT_VERSION = 1;
// L1 (DEC-071): non-English agents render v2 — v1 plus the summary-language rule.
export const DISTILL_PROMPT_VERSION_LANGUAGE = 2;

export const DISTILL_SYSTEM =
  "You distill a company's business context from evidence chunks extracted from their website and documents. " +
  "You NEVER use outside knowledge or assumptions: a field may only be filled when the provided evidence supports it, " +
  "and every filled field must cite the ids of the chunks that support it. If the evidence does not clearly support " +
  "a field, OMIT that field entirely — an omitted field becomes an explicit question to the business owner, which is " +
  "far better than a plausible guess. Values must be faithful to the evidence (paraphrase is fine; invention is not).";

const V1_TEMPLATE = `Distill the business context fields listed below from the evidence chunks.

GOAL: {{goal}}

FIELDS (key — what to extract):
{{fields}}

EVIDENCE CHUNKS (id then content):
{{evidence}}

Rules:
- Fill a field ONLY if the evidence supports it; cite every supporting chunk id in "citations".
- Omit unsupported fields entirely. Do not fill from general knowledge.
- Keep each value concise (1-3 sentences) and grounded in the evidence.
- "rawSummary": a short distilled brief of the business drawn only from the evidence.
{{proposedAsksRule}}`;

// The v2 anchor: the language rule extends the rawSummary rule in place, so
// everything else stays the v1 literal (asserted at registration).
const V1_SUMMARY_RULE =
  '- "rawSummary": a short distilled brief of the business drawn only from the evidence.';

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerPrompt({ name: DISTILL_PROMPT_NAME, version: DISTILL_PROMPT_VERSION, template: V1_TEMPLATE });
  if (!V1_TEMPLATE.includes(V1_SUMMARY_RULE)) {
    throw new Error(
      "distill prompt v2 derivation: v1 rawSummary rule not found — realign the language variant",
    );
  }
  registerPrompt({
    name: DISTILL_PROMPT_NAME,
    version: DISTILL_PROMPT_VERSION_LANGUAGE,
    template: V1_TEMPLATE.replace(
      V1_SUMMARY_RULE,
      V1_SUMMARY_RULE.slice(0, -1) +
        ", written in {{summaryLanguage}} — the business owner reads it in their language. Field values stay faithful to the evidence.",
    ),
  });
}

export function renderDistillPrompt(
  vars: {
    goal: string;
    fields: string;
    evidence: string;
    proposedAsksRule: string;
  },
  /** L1 (DEC-071): the agent's effective language; "en" renders v1 byte-identical. */
  language: LanguageCode = DEFAULT_LANGUAGE,
): string {
  ensureRegistered();
  if (language === "en") {
    return renderPrompt(DISTILL_PROMPT_NAME, DISTILL_PROMPT_VERSION, vars);
  }
  return renderPrompt(DISTILL_PROMPT_NAME, DISTILL_PROMPT_VERSION_LANGUAGE, {
    ...vars,
    summaryLanguage: languagePromptLabel(language),
  });
}
