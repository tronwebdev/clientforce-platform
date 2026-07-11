/**
 * Agent output-language detection (L1, DEC-072). The agent-layer distill
 * already holds the merged evidence pack — website chunks, uploaded-document
 * chunks, typed answers — so detection is source-agnostic by construction: a
 * doc-only agent detects from its documents, a typed-only agent from its
 * answers. Detection itself is the DETERMINISTIC core detector (no model in
 * the loop) and confidence-gated: mixed or ambiguous evidence means English.
 *
 * Write rules (the whole contract):
 * - `languageSource: "owner"` is NEVER touched — a Settings edit is sticky.
 * - A confident detection writes `{ language, languageSource: "detected" }`
 *   (the detector may overwrite its own earlier call — sources arrive one at
 *   a time in the wizard, so detection must converge as the pack changes).
 * - A NOT-confident detection CLEARS a previously detector-written value
 *   (back to absent = English default) — "German site, then an English doc"
 *   ends English, exactly like uploading both at once.
 * - An unparsable guardrails row is left alone (the strict parse at the send
 *   boundary owns that failure) — detection never breaks a distill.
 */
import {
  detectLanguage,
  parseGuardrails,
  type LanguageCode,
  type LanguageDetection,
  type LanguageSource,
} from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import type { RetrievedChunk } from "@clientforce/knowledge";
import type { ContextFields } from "@clientforce/core";

/** The lenient rider read (planner precedent) — null = unparsable row. */
export function agentLanguageRider(
  guardrails: unknown,
): { language?: LanguageCode; languageSource?: LanguageSource } | null {
  try {
    const parsed = parseGuardrails(guardrails);
    return { language: parsed.language, languageSource: parsed.languageSource };
  } catch {
    return null;
  }
}

/**
 * The detection corpus: every evidence chunk in this distill's pack plus the
 * layer's typed answers ("website crawl, uploaded documents, and typed
 * answers all count" — DEC-072).
 */
export function detectionCorpus(evidence: RetrievedChunk[], fields: ContextFields): string {
  const typedValues = Object.values(fields)
    .filter((v) => v.source === "typed")
    .map((v) => v.value);
  return [...evidence.map((c) => c.content), ...typedValues].join("\n\n");
}

export type LanguageApplyOutcome =
  | "set" // confident detection written (new or changed)
  | "cleared" // ambiguous/mixed pack removed a previous detector write
  | "kept-owner" // owner-set language — detector never touches it
  | "unchanged" // decision matches what the row already says
  | "skipped-invalid"; // unparsable guardrails — left alone

/**
 * Persist the detection decision onto the agent's guardrails Json (compose
 * over the parsed row — the DEC-065(7) discipline; a legacy empty row
 * materializes the conservative defaults alongside the language, which is
 * behavior-identical to the parse-time fallback it replaces).
 */
export async function applyDetectedLanguage(
  prisma: PrismaClient,
  target: { workspaceId: string; agentId: string },
  detection: LanguageDetection,
): Promise<LanguageApplyOutcome> {
  const { workspaceId, agentId } = target;
  const agent = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.agent.findUnique({ where: { id: agentId }, select: { guardrails: true } }),
  );
  if (!agent) return "skipped-invalid";

  let parsed;
  try {
    parsed = parseGuardrails(agent.guardrails);
  } catch {
    return "skipped-invalid";
  }
  if (parsed.languageSource === "owner") return "kept-owner";

  const detected = detection.confident ? detection.code : null;
  if (detected) {
    if (parsed.language === detected && parsed.languageSource === "detected") return "unchanged";
    await withTenant(prisma, { workspaceId }, (tx) =>
      tx.agent.update({
        where: { id: agentId },
        data: {
          guardrails: { ...parsed, language: detected, languageSource: "detected" } as object,
        },
      }),
    );
    return "set";
  }

  // Not confident: absent stays absent; a detector-written value converges
  // back to the English default.
  if (parsed.language === undefined && parsed.languageSource === undefined) return "unchanged";
  const { language: _language, languageSource: _languageSource, ...rest } = parsed;
  await withTenant(prisma, { workspaceId }, (tx) =>
    tx.agent.update({ where: { id: agentId }, data: { guardrails: rest as object } }),
  );
  return "cleared";
}

/** Re-exported for the distiller's summary-language decision. */
export { detectLanguage };
