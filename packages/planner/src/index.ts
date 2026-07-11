/**
 * @clientforce/planner — goal + BusinessContext → CampaignGraph (P1.4).
 *
 * Email-only this phase (A1). Copy is grounded in the evidence-cited
 * BusinessContext (DEC-015 — never model priors); output passes the T4
 * validator + slice requirements (≥1 delay, branch on reply, merge tokens)
 * or is never persisted. Versions land on the agent's primary campaign (A5).
 */
export {
  planCampaign,
  PlannerError,
  REQUIRED_BRANCH_INTENTS,
  validateAll,
  type PlanDeps,
  type PlanResult,
  type PlanTarget,
} from "./plan";
export { createPlanQueue, createPlanWorker, PLANNER_QUEUE_NAME } from "./queue";
export { PLANNER_PROMPT_NAME, PLANNER_PROMPT_VERSION, PLANNER_SYSTEM } from "./prompts";
// F1 (DEC-068): shared by the rollup endpoint + outcome-aware regen.
export { buildOutcomesPromptBlock, loadCampaignOutcomes } from "./outcomes";
