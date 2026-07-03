import { registerPrompt, renderPrompt } from "@clientforce/ai";

/**
 * Distiller prompt (P1.3, DEC-024). Versioned in the P1.1 registry. The
 * hard rule the whole feature hangs on: fills come ONLY from the evidence
 * pack, every fill cites chunk ids, and anything unsupported is OMITTED —
 * the gap checker turns omissions into gap rows. Never model priors.
 */
export const DISTILL_PROMPT_NAME = "context.distill";
export const DISTILL_PROMPT_VERSION = 1;

export const DISTILL_SYSTEM =
  "You distill a company's business context from evidence chunks extracted from their website and documents. " +
  "You NEVER use outside knowledge or assumptions: a field may only be filled when the provided evidence supports it, " +
  "and every filled field must cite the ids of the chunks that support it. If the evidence does not clearly support " +
  "a field, OMIT that field entirely — an omitted field becomes an explicit question to the business owner, which is " +
  "far better than a plausible guess. Values must be faithful to the evidence (paraphrase is fine; invention is not).";

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerPrompt({
    name: DISTILL_PROMPT_NAME,
    version: DISTILL_PROMPT_VERSION,
    template: `Distill the business context fields listed below from the evidence chunks.

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
{{proposedAsksRule}}`,
  });
}

export function renderDistillPrompt(vars: {
  goal: string;
  fields: string;
  evidence: string;
  proposedAsksRule: string;
}): string {
  ensureRegistered();
  return renderPrompt(DISTILL_PROMPT_NAME, DISTILL_PROMPT_VERSION, vars);
}
