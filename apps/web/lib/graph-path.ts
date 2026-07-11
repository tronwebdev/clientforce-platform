/**
 * Graph walking helpers (M1b, DEC-068). A v4 playbook graph carries reply-
 * STRATEGY steps hanging off the reply branch — they are not main-sequence
 * steps, and any surface that counts or lists "the sequence" must walk the
 * MAIN PATH (entry → edges, branch → default case) instead of filtering all
 * step nodes, or the strategy steps masquerade as extra sequence steps.
 */
import type { BranchNode, CampaignGraph, GraphNode, StepNode } from "@clientforce/core";

/** Nodes along entry → default path, in flow order (cycle-guarded). */
export function mainPath(graph: CampaignGraph): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const next = new Map<string, string>();
  for (const e of graph.edges) if (!next.has(e.from)) next.set(e.from, e.to);
  const out: GraphNode[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = graph.entry;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    out.push(node);
    cur =
      node.type === "branch"
        ? node.cases.find((c) => c.when === "default")?.goto
        : next.get(cur);
  }
  return out;
}

/** The steps a non-replying lead experiences, in order. */
export function mainSteps(graph: CampaignGraph): StepNode[] {
  return mainPath(graph).filter((n): n is StepNode => n.type === "step");
}

/** The (single) reply branch, if the graph has one. */
export function replyBranchOf(graph: CampaignGraph): BranchNode | undefined {
  return graph.nodes.find((n): n is BranchNode => n.type === "branch" && n.on === "reply");
}

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
