/**
 * @clientforce/context — BusinessContext distiller + gap checker (P1.3).
 *
 * DEC-024: evidence-cited fills only (citation or gap, never model priors);
 * goal-conditional required fields per the owner-approved registry in
 * `@clientforce/core`. DEC-025: two layers — workspace (Brand kit, agentId
 * null) + agent overlay; planner reads merged (agent wins); the gap checker
 * spans both.
 */
export {
  distill,
  parseAsks,
  parseFields,
  type DistillDeps,
  type DistillTarget,
  type ProposedAsk,
} from "./distill";
export { checkGaps, coveredKeys, mergeLayers, type GapInput } from "./gaps";
// G1 (DEC-070): the ONE context-text renderer shared by planner + composer.
export { loadMergedContextText, renderContextText } from "./context-text";
export { CONTEXT_QUEUE_NAME, createDistillQueue, createDistillWorker } from "./queue";
export {
  DISTILL_PROMPT_NAME,
  DISTILL_PROMPT_VERSION,
  DISTILL_PROMPT_VERSION_LANGUAGE,
  DISTILL_SYSTEM,
} from "./prompts";
// L1 (DEC-071): evidence-pack language detection + the guardrails write rules.
export {
  agentLanguageRider,
  applyDetectedLanguage,
  detectionCorpus,
  type LanguageApplyOutcome,
} from "./agent-language";
