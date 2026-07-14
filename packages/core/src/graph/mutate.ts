/**
 * Deterministic CampaignGraph mutations (W3-4, DEC-076). The sequence editor
 * is a graph-MUTATION surface, never a second planner: every helper takes a
 * graph, returns a NEW graph with the structural invariants `validateGraph`
 * checks preserved by construction (single out-edge per sequential node,
 * entry/edge/goto integrity, guided-brief rules), and throws a typed
 * `GraphMutationError` on an impossible edit instead of producing an invalid
 * graph. Persistence still re-validates server-side — these helpers are the
 * shared client of that gate, not a bypass.
 *
 * Node-id policy (load-bearing): ids are STABLE across edits — content edits,
 * mode flips and reorders never rename a node (send idempotency is keyed on
 * `(enrollmentId, stepNodeId)`, rules reference `targetNodeId`, outcome stats
 * attribute by stepNodeId). New nodes take the first free `step-added-N` /
 * `delay-added-N` id so deletes can never cause a collision.
 */
import type {
  CampaignGraph,
  Channel,
  DelayUnit,
  GraphNode,
  StepBrief,
  StepContent,
  StepNode,
} from "./types";
import { branchChains, caseKeyOf, chainForCase, mainSequence } from "./walk";

export class GraphMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphMutationError";
  }
}

/** Where a mutation applies: the main sequence, or one branch case's chain. */
export type SequenceContainer =
  | { kind: "main" }
  | { kind: "case"; branchId: string; caseKey: string };

/** First unused `<prefix>-N` id (deletes can never re-collide a fresh id). */
export function freshNodeId(graph: CampaignGraph, prefix: string): string {
  const ids = new Set(graph.nodes.map((n) => n.id));
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function nodeById(graph: CampaignGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function outEdgeTarget(graph: CampaignGraph, id: string): string | undefined {
  return graph.edges.find((e) => e.from === id)?.to;
}

/** The container's ordered nodes (see walk.ts) — throws on unknown containers. */
export function containerNodes(graph: CampaignGraph, container: SequenceContainer): GraphNode[] {
  if (container.kind === "main") return mainSequence(graph);
  const chain = chainForCase(graph, container.branchId, container.caseKey);
  if (!chain) {
    throw new GraphMutationError(
      `Unknown branch case "${container.caseKey}" on branch "${container.branchId}"`,
    );
  }
  return chain;
}

/**
 * A chain shared by more than one branch case cannot be mutated through ONE
 * case's container — the sibling case's flow would change (or truncate)
 * without the owner touching it. Refuse loudly; branch-structure edits are
 * the planner's/rules' job, not the step editor's (review round, DEC-076).
 */
function assertChainNotShared(graph: CampaignGraph, container: SequenceContainer): void {
  if (container.kind !== "case") return;
  const set = branchChains(graph).find((b) => b.branch.id === container.branchId);
  if (!set || set.sharedNodeIds.length === 0) return;
  const chain = set.cases.find((c) => c.key === container.caseKey)?.chain ?? [];
  const shared = new Set(set.sharedNodeIds);
  if (chain.some((n) => shared.has(n.id))) {
    throw new GraphMutationError(
      "This reply path shares steps with another reply path — editing it here would change both. Regenerate the sequence to restructure it.",
    );
  }
}

/** The container a step lives in, or undefined (e.g. an orphan node). */
export function stepContainerOf(
  graph: CampaignGraph,
  stepId: string,
): SequenceContainer | undefined {
  if (mainSequence(graph).some((n) => n.id === stepId)) return { kind: "main" };
  for (const node of graph.nodes) {
    if (node.type !== "branch") continue;
    for (const c of node.cases) {
      const key = caseKeyOf(c);
      if (chainForCase(graph, node.id, key)?.some((n) => n.id === stepId)) {
        return { kind: "case", branchId: node.id, caseKey: key };
      }
    }
  }
  return undefined;
}

/**
 * Rewrite one container's internal flow to `newChain` (same node ids or a
 * superset/subset — callers add/remove/reorder the array first). Rewires:
 * container head reference (graph entry or the branch case's goto), each
 * chain node's single out-edge, and the tail edge onto the container's exit
 * node. Edges from OUTSIDE into surviving chain nodes keep pointing at their
 * (stable) ids untouched.
 */
function rebuildContainer(
  graph: CampaignGraph,
  container: SequenceContainer,
  oldChain: GraphNode[],
  newChain: GraphNode[],
): CampaignGraph {
  const oldIds = new Set(oldChain.map((n) => n.id));
  const removed = oldChain.filter((n) => !newChain.some((m) => m.id === n.id));

  // The node the container exits into (branch/end/rejoin target).
  const tail = oldChain[oldChain.length - 1];
  const exitId = tail
    ? outEdgeTarget(graph, tail.id)
    : container.kind === "case"
      ? undefined // empty case chain: goto already points at the exit
      : undefined;
  const headExit =
    container.kind === "case" && !tail
      ? graph.nodes
          .filter((n): n is Extract<GraphNode, { type: "branch" }> => n.type === "branch")
          .find((n) => n.id === container.branchId)
          ?.cases.find((c) => caseKeyOf(c) === container.caseKey)?.goto
      : undefined;
  const exit = exitId ?? headExit;
  if (!exit) throw new GraphMutationError("Container has no exit node — graph is malformed");

  const removedIds = new Set(removed.map((n) => n.id));
  const newIds = new Set(newChain.map((n) => n.id));
  // A removed node's references splice to its next SURVIVING old-chain
  // successor (or the exit) — a rejoin edge into a deleted step lands where
  // that step's flow continued.
  const successorOf = new Map<string, string>();
  for (let i = 0; i < oldChain.length; i += 1) {
    const node = oldChain[i]!;
    if (!removedIds.has(node.id)) continue;
    const survivor = oldChain.slice(i + 1).find((n) => newIds.has(n.id));
    successorOf.set(node.id, survivor?.id ?? exit);
  }

  const nodes = graph.nodes
    .filter((n) => !removedIds.has(n.id))
    .map((n) => newChain.find((m) => m.id === n.id) ?? n);
  // Nodes newly added by the mutation (not in the graph yet), in chain order.
  const existingIds = new Set(graph.nodes.map((n) => n.id));
  for (const m of newChain) if (!existingIds.has(m.id)) nodes.push(m);

  const headId = newChain[0]?.id ?? exit;
  // Rebuild the chain's internal out-edges; inbound edges from outside follow
  // removed nodes to their successors and otherwise stay on their stable ids.
  const edges = graph.edges
    .filter((e) => !oldIds.has(e.from))
    .map((e) => (removedIds.has(e.to) ? { ...e, to: successorOf.get(e.to)! } : e))
    .filter((e) => e.from !== e.to);
  for (let i = 0; i < newChain.length; i += 1) {
    edges.push({ from: newChain[i]!.id, to: newChain[i + 1]?.id ?? exit });
  }

  const next: CampaignGraph = { entry: graph.entry, nodes, edges };
  if (container.kind === "main") {
    next.entry = headId;
  } else {
    next.nodes = next.nodes.map((n) =>
      n.type === "branch" && n.id === container.branchId
        ? {
            ...n,
            cases: n.cases.map((c) => (caseKeyOf(c) === container.caseKey ? { ...c, goto: headId } : c)),
          }
        : n,
    );
  }
  // Any OTHER reference to a removed node (branch cases elsewhere) splices too.
  next.nodes = next.nodes.map((n) =>
    n.type === "branch"
      ? {
          ...n,
          cases: n.cases.map((c) =>
            removedIds.has(c.goto) ? { ...c, goto: successorOf.get(c.goto)! } : c,
          ),
        }
      : n,
  );
  return next;
}

export interface AddStepParams {
  container: SequenceContainer;
  channel: Channel;
  /** Scripted copy; ignored when a brief is given. */
  content?: StepContent;
  /** Present = the new step is guided (email/sms only). */
  brief?: StepBrief;
  /** Days to wait before the new step (canon default 2; skipped for a first step). */
  delayDays?: number;
}

/**
 * Append `wait N days + step` at the container's end (the Campaign View
 * add-step interaction: a first step in an empty container takes no delay).
 * Returns the mutated graph and the new step's id.
 */
export function addStep(
  graph: CampaignGraph,
  params: AddStepParams,
): { graph: CampaignGraph; stepId: string; delayId?: string } {
  const { container, channel } = params;
  if (params.brief && channel !== "email" && channel !== "sms") {
    throw new GraphMutationError(`Guided steps are email/sms-only — "${channel}" cannot carry a brief`);
  }
  assertChainNotShared(graph, container);
  const chain = containerNodes(graph, container);
  const stepId = freshNodeId(graph, "step-added");
  const n = chain.filter((c) => c.type === "step").length + 1;
  const defaultContent: StepContent =
    channel === "email"
      ? { subject: `Follow-up ${n}`, body: "Hi {{firstName}}, one more thought for {{company}}…" }
      : { body: "Hi {{firstName}} — quick follow-up about {{company}}." };
  const step: StepNode = params.brief
    ? { id: stepId, type: "step", channel, content: {}, mode: "guided", brief: params.brief }
    : { id: stepId, type: "step", channel, content: params.content ?? defaultContent };

  const newChain: GraphNode[] = [...chain];
  let delayId: string | undefined;
  if (chain.length > 0) {
    delayId = freshNodeId(graph, "delay-added");
    newChain.push({ id: delayId, type: "delay", amount: params.delayDays ?? 2, unit: "days" });
  }
  newChain.push(step);
  const next = rebuildContainer(graph, container, chain, newChain);
  return { graph: next, stepId, ...(delayId ? { delayId } : {}) };
}

/**
 * Remove a step, splicing its chain (its preceding gap-delay goes with it
 * unless it is the graph's LAST delay — generated graphs always carry one and
 * the edit gate preserves that). Refuses to remove the graph's only step, or
 * the only step of a chain a reply-branch case routes into (the playbook
 * contract: strategy cases route to a step).
 */
export function removeStep(graph: CampaignGraph, stepId: string): CampaignGraph {
  const node = nodeById(graph, stepId);
  if (!node || node.type !== "step") {
    throw new GraphMutationError(`Step "${stepId}" not found`);
  }
  const stepCount = graph.nodes.filter((n) => n.type === "step").length;
  if (stepCount <= 1) {
    throw new GraphMutationError("A sequence needs at least one step — edit it instead of deleting");
  }
  const container = stepContainerOf(graph, stepId);
  if (!container) throw new GraphMutationError(`Step "${stepId}" is not on an editable path`);
  assertChainNotShared(graph, container);
  const chain = containerNodes(graph, container);
  if (container.kind === "case" && chain.filter((c) => c.type === "step").length <= 1) {
    throw new GraphMutationError(
      "This reply strategy needs at least one step — edit it instead of deleting",
    );
  }
  if (container.kind === "main" && chain.filter((c) => c.type === "step").length <= 1) {
    throw new GraphMutationError("The main sequence needs at least one step");
  }

  const idx = chain.findIndex((c) => c.id === stepId);
  const newChain = chain.filter((c) => c.id !== stepId);
  // Absorb the step's gap-delay (the add-step pair inverse): the preceding
  // delay, or — for the chain-HEAD step ONLY — the following one (a chain
  // must not start with a leading wait; a mid-chain step's following delay
  // belongs to the NEXT step and stays). Never the graph's last delay.
  const gap =
    chain[idx - 1]?.type === "delay" ? chain[idx - 1] : idx === 0 ? chain[idx + 1] : undefined;
  if (gap?.type === "delay") {
    const delayCount = graph.nodes.filter((n) => n.type === "delay").length;
    const referenced =
      graph.entry === gap.id ||
      graph.nodes.some((n) => n.type === "branch" && n.cases.some((c) => c.goto === gap.id));
    if (delayCount > 1 && !referenced) {
      newChain.splice(newChain.indexOf(gap), 1);
      // rebuildContainer needs the removed delay out of the new chain only;
      // it stays in oldChain so its edges/nodes are cleaned up.
      return rebuildContainer(graph, container, chain, newChain);
    }
  }
  // The kept gap must never become a CASE chain's head — the case goto would
  // point at a delay (a leading wait, and the playbook contract wants steps).
  if (container.kind === "case" && newChain[0]?.type === "delay") {
    throw new GraphMutationError(
      "Removing this step would leave the reply path starting with a wait (its delay is the sequence's only one) — edit the step instead",
    );
  }
  return rebuildContainer(graph, container, chain, newChain);
}

/**
 * Swap a step with the previous/next STEP in its container (delays keep
 * their slots; ids never change). Throws at the container edges.
 */
export function moveStep(
  graph: CampaignGraph,
  stepId: string,
  direction: "up" | "down",
): CampaignGraph {
  const container = stepContainerOf(graph, stepId);
  if (!container) throw new GraphMutationError(`Step "${stepId}" is not on an editable path`);
  assertChainNotShared(graph, container);
  const chain = containerNodes(graph, container);
  const stepIdxs = chain
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.type === "step")
    .map(({ i }) => i);
  const pos = stepIdxs.findIndex((i) => chain[i]!.id === stepId);
  const targetPos = direction === "up" ? pos - 1 : pos + 1;
  if (targetPos < 0 || targetPos >= stepIdxs.length) {
    throw new GraphMutationError(
      direction === "up" ? "Already the first step" : "Already the last step",
    );
  }
  const a = stepIdxs[pos]!;
  const b = stepIdxs[targetPos]!;
  const newChain = [...chain];
  [newChain[a], newChain[b]] = [newChain[b]!, newChain[a]!];
  return rebuildContainer(graph, container, chain, newChain);
}

/** Edit a scripted step's copy (subject is email-only). Ids stay stable. */
export function updateStepContent(
  graph: CampaignGraph,
  stepId: string,
  patch: { subject?: string; body?: string },
): CampaignGraph {
  const node = nodeById(graph, stepId);
  if (!node || node.type !== "step") throw new GraphMutationError(`Step "${stepId}" not found`);
  if (node.mode === "guided") {
    throw new GraphMutationError(
      `Step "${stepId}" is guided — edit its brief (the composer writes the copy at send time)`,
    );
  }
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === stepId && n.type === "step" ? { ...n, content: { ...n.content, ...patch } } : n,
    ),
  };
}

/** Edit a guided step's brief. Ids stay stable. */
export function updateStepBrief(
  graph: CampaignGraph,
  stepId: string,
  brief: StepBrief,
): CampaignGraph {
  const node = nodeById(graph, stepId);
  if (!node || node.type !== "step") throw new GraphMutationError(`Step "${stepId}" not found`);
  if (node.mode !== "guided") {
    throw new GraphMutationError(`Step "${stepId}" is scripted — flip it to guided to give it a brief`);
  }
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === stepId && n.type === "step" ? { ...n, brief } : n)),
  };
}

/**
 * Flip one step's compose mode (W3-4's per-step override — the agent-level
 * composeMode rider stays the PLANNING default; mixed-mode graphs execute,
 * G2 proved it). guided needs a brief (seed it first); scripted needs body
 * copy — never a dead state. Ids stay stable.
 */
export function setStepMode(
  graph: CampaignGraph,
  stepId: string,
  params: { mode: "guided"; brief: StepBrief } | { mode: "scripted"; content: StepContent },
): CampaignGraph {
  const node = nodeById(graph, stepId);
  if (!node || node.type !== "step") throw new GraphMutationError(`Step "${stepId}" not found`);
  if (params.mode === "guided") {
    if (node.channel !== "email" && node.channel !== "sms") {
      throw new GraphMutationError(
        `Guided mode is email/sms-only this phase — "${node.channel}" steps stay scripted`,
      );
    }
    if (node.channel === "sms" && params.brief.subjectHint !== undefined) {
      throw new GraphMutationError("Subject hints are email-only — an SMS brief cannot carry one");
    }
    return {
      ...graph,
      nodes: graph.nodes.map((n) => {
        if (n.id !== stepId || n.type !== "step") return n;
        // Guided steps carry a brief, never copy (one source of truth); the
        // threaded rider survives — it belongs to the send, not the copy.
        const { subject: _s, body: _b, ...content } = n.content;
        return { ...n, mode: "guided" as const, brief: params.brief, content };
      }),
    };
  }
  if (!params.content.body?.trim()) {
    throw new GraphMutationError(
      "A scripted step needs body copy — compose a draft or write it before flipping",
    );
  }
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.id !== stepId || n.type !== "step") return n;
      // Back to the legacy scripted shape: mode/brief keys gone entirely.
      const { mode: _m, brief: _br, ...rest } = n;
      return { ...rest, content: { ...n.content, ...params.content } };
    }),
  };
}

/** Edit a delay's wait. Amount is a positive integer (UI clamps per its canon). */
export function updateDelay(
  graph: CampaignGraph,
  delayId: string,
  amount: number,
  unit?: DelayUnit,
): CampaignGraph {
  const node = nodeById(graph, delayId);
  if (!node || node.type !== "delay") throw new GraphMutationError(`Delay "${delayId}" not found`);
  if (!Number.isInteger(amount) || amount < 1) {
    throw new GraphMutationError("A delay must be a whole number of at least 1");
  }
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === delayId && n.type === "delay" ? { ...n, amount, ...(unit ? { unit } : {}) } : n,
    ),
  };
}

/**
 * Deterministic pre-validation repair for edited graphs — the manual-edit
 * analogue of the planner's bounded repair loop (which repairs MODEL output;
 * owner-typed content is never rewritten silently). Fixes only what has one
 * unambiguous correction and reports every repair; anything else is left for
 * validation to reject loudly.
 */
export function repairGraph(input: CampaignGraph): { graph: CampaignGraph; repairs: string[] } {
  const repairs: string[] = [];
  const ids = new Set(input.nodes.map((n) => n.id));

  // Drop edges referencing unknown nodes and exact-duplicate edges. A
  // sequential node with out-edges to DIFFERENT targets is an ambiguous fork
  // — no unambiguous correction exists, so it falls through to validation's
  // loud rejection instead of an order-dependent silent reroute (review
  // round, DEC-076).
  const seenEdges = new Set<string>();
  const edges = input.edges.filter((e) => {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      repairs.push(`dropped edge ${e.from} → ${e.to} (unknown node)`);
      return false;
    }
    const key = `${e.from}→${e.to}`;
    if (seenEdges.has(key)) {
      repairs.push(`dropped duplicate edge ${key}`);
      return false;
    }
    seenEdges.add(key);
    return true;
  });

  // Trim/drop empty strings the drawer chips can produce; real violations
  // (too few talking points afterwards) still reject downstream.
  const nodes = input.nodes.map((n) => {
    if (n.type !== "step" || !n.brief) return n;
    const clean = (xs: string[] | undefined) => {
      if (!xs) return undefined;
      const kept = xs.map((x) => x.trim()).filter(Boolean);
      if (kept.length !== xs.length) repairs.push(`dropped empty entries from step ${n.id}'s brief`);
      return kept.length > 0 ? kept : undefined;
    };
    const talkingPoints = clean(n.brief.talkingPoints) ?? [];
    const mustSay = clean(n.brief.mustSay);
    const neverSay = clean(n.brief.neverSay);
    const { mustSay: _m, neverSay: _v, ...rest } = n.brief;
    return {
      ...n,
      brief: {
        ...rest,
        talkingPoints,
        ...(mustSay ? { mustSay } : {}),
        ...(neverSay ? { neverSay } : {}),
      },
    };
  });

  return { graph: repairs.length > 0 ? { ...input, nodes, edges } : input, repairs };
}
