/**
 * Pure, deterministic pieces shared by the workflow (V8 isolate) and the host
 * side (activities, client, API). NOTHING here may touch I/O, Date.now, or
 * randomness — the workflow imports this module and must replay identically.
 */
import type { BranchCase, BranchNode, CampaignGraph, DelayUnit, NodeId } from "@clientforce/core";

/** Single task queue for the platform (matches apps/worker). */
export const TASK_QUEUE = "clientforce";

/** Signal name the P1.7 classifier (and the dev endpoint) sends replies on. */
export const REPLY_SIGNAL = "reply";

/** Workflow id per enrollment — start-by-id makes double-enroll a no-op. */
export const workflowIdFor = (enrollmentId: string): string => `enroll-${enrollmentId}`;

export interface CampaignWorkflowInput {
  workspaceId: string;
  enrollmentId: string;
  campaignId: string;
  agentId: string;
  contactId: string;
  senderId: string;
  graph: CampaignGraph;
  /**
   * G1 (DEC-070): the persisted CampaignGraph row's version at enrollment
   * time — guided sends record it as `Message.meta.briefVersion` (which brief
   * produced this copy). Optional: in-flight pre-G1 runs replay unchanged.
   */
  graphVersion?: number | null;
  /**
   * Multiplier on every timer (delays + branch default timeout). 1 = real
   * time. Tests/live-proof pass e.g. 1/86400 so "1 day" becomes 1 second —
   * graph data never changes for testing (TEST_DELAY_SCALE env at start time).
   */
  delayScale?: number;
  /**
   * How long a `branch on="reply"` waits before taking its default case
   * (the no-response path). Hours, scaled by delayScale. Default 72.
   */
  branchDefaultTimeoutHours?: number;
  /**
   * R1 (DEC-074): start the walk at this node instead of `graph.entry` —
   * the "move to sequence/branch" rule action restarts an enrollment's run
   * here (cancel old run → new run at the target). Optional: in-flight
   * pre-R1 runs replay unchanged. Already-sent steps stay safe either way —
   * sends are idempotent per (enrollmentId, stepNodeId).
   */
  startNodeId?: NodeId;
}

export type CampaignWorkflowResult =
  | { status: "completed"; endNode: NodeId }
  | { status: "blocked"; node: NodeId; reason: string }
  | { status: "stopped"; node: NodeId; detail: string };

/** What the send activity reports back to the workflow. */
export type SendOutcome =
  | { kind: "sent"; messageId: string; providerMessageId: string | null }
  | { kind: "duplicate"; messageId: string; providerMessageId: string | null };

const UNIT_MS: Record<DelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/** Delay → milliseconds, scaled. Never below 1ms so timers always fire. */
export function delayToMs(amount: number, unit: DelayUnit, scale = 1): number {
  return Math.max(1, Math.round(amount * UNIT_MS[unit] * scale));
}

/** First outgoing edge per node (sequential nodes have exactly one — T4). */
export function nextAfter(graph: CampaignGraph, nodeId: NodeId): NodeId | undefined {
  return graph.edges.find((e) => e.from === nodeId)?.to;
}

/**
 * G2 (DEC-071): a step's 1-based position among MAIN-SEQUENCE steps (the web
 * `mainPath` walk: entry → edges, branch → default case, cycle-guarded).
 * Feeds the guided composer's arc-role awareness — the M1a role ladder is
 * positional (first = OPENER, last = BREAKUP). Reply-strategy steps are not
 * on the main path and return undefined (they compose role-free — but stay
 * scripted this phase anyway, DEC-070(7)).
 */
export function mainStepPosition(
  graph: CampaignGraph,
  stepId: NodeId,
): { index: number; count: number } | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const next = new Map<string, string>();
  for (const e of graph.edges) if (!next.has(e.from)) next.set(e.from, e.to);
  const seen = new Set<string>();
  const stepsInOrder: string[] = [];
  let cur: string | undefined = graph.entry;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const node = byId.get(cur);
    if (!node) break;
    if (node.type === "step") stepsInOrder.push(node.id);
    cur =
      node.type === "branch"
        ? node.cases.find((c) => c.when === "default")?.goto
        : next.get(cur);
  }
  const at = stepsInOrder.indexOf(stepId);
  return at === -1 ? undefined : { index: at + 1, count: stepsInOrder.length };
}

/**
 * Resolve a reply branch: matching intent case first, else the default case.
 * Mirrors the T4 executor's semantics (`resolveBranch`) so the durable run
 * routes exactly like the dry-run.
 */
export function resolveReplyBranch(
  node: BranchNode,
  intent: string | undefined,
): { matched: string; chosen: BranchCase } | undefined {
  if (intent !== undefined) {
    const hit = node.cases.find((c) => c.when !== "default" && c.when.intent === intent);
    if (hit) return { matched: `intent:${intent}`, chosen: hit };
  }
  const fallback = node.cases.find((c) => c.when === "default");
  return fallback ? { matched: "default", chosen: fallback } : undefined;
}
