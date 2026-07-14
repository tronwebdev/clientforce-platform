/**
 * Graph walking helpers (M1b DEC-068 · W3-4 DEC-076). The walk itself now
 * lives in @clientforce/core (`graph/walk.ts`) — ONE implementation shared by
 * the validators, the planner gate and both editor hosts; this module keeps
 * the web-local API every surface already imports. `strategyStepsOf` keeps
 * its historical single-step contract (each non-default reply case whose
 * DIRECT target is a step); chain-aware surfaces use `strategyChains` /
 * `branchChains` from core directly.
 */
import { mainPath, mainSequence, mainSteps, replyBranchOf, strategyChains } from "@clientforce/core";
import type { CampaignGraph, StepNode } from "@clientforce/core";

export { mainPath, mainSequence, mainSteps, replyBranchOf, strategyChains };

/** Reply-strategy steps: each non-default branch case whose target is a step. */
export function strategyStepsOf(graph: CampaignGraph): Array<{ intent: string; step: StepNode }> {
  const branch = replyBranchOf(graph);
  if (!branch) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: Array<{ intent: string; step: StepNode }> = [];
  for (const c of branch.cases) {
    if (c.when === "default") continue;
    const target = byId.get(c.goto);
    if (target?.type === "step") out.push({ intent: c.when.intent, step: target });
  }
  return out;
}
