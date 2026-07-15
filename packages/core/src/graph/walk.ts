/**
 * Canonical CampaignGraph walks (W3-4, DEC-076). ONE implementation of the
 * "main path" convention every surface shares (entry → first edge per node,
 * branch → its default case, cycle-guarded) plus the branch-chain walk that
 * makes multi-step chains inside a branch first-class: a case's chain is the
 * run of nodes from its `goto` up to (exclusive) the first end node, branch
 * node, main-path node (a rejoin), or already-seen node (cycle guard).
 *
 * `apps/web/lib/graph-path.ts` delegates here; the workflow isolate keeps its
 * own pinned copy in `@clientforce/workflows` shared.ts (replay-load-bearing —
 * in-flight runs replay old code paths; never retarget that import).
 */
import type {
  BranchCase,
  BranchNode,
  CampaignGraph,
  GraphNode,
  StepNode,
  SubcampaignNode,
} from "./types";

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

/** The primary reply branch (first `on:"reply"` in node order), if present. */
export function replyBranchOf(graph: CampaignGraph): BranchNode | undefined {
  return graph.nodes.find((n): n is BranchNode => n.type === "branch" && n.on === "reply");
}

/**
 * The EDITABLE main sequence: the main path truncated at (exclusive) the
 * first branch or end node — the steps/delays the sequence editor owns.
 */
export function mainSequence(graph: CampaignGraph): GraphNode[] {
  const out: GraphNode[] = [];
  for (const node of mainPath(graph)) {
    if (node.type === "branch" || node.type === "end") break;
    out.push(node);
  }
  return out;
}

/** A branch case's key: its intent, or the literal "default". */
export function caseKeyOf(c: BranchCase): string {
  return c.when === "default" ? "default" : c.when.intent;
}

export interface BranchCaseChain {
  /** "default" or the case's intent. */
  key: string;
  case: BranchCase;
  /**
   * The case's own nodes, in flow order — multi-step chains included. Empty
   * when the case jumps straight to the main path / an end node (the default
   * case's continuation IS the main path, so its chain is always empty).
   */
  chain: GraphNode[];
}

export interface BranchChains {
  branch: BranchNode;
  cases: BranchCaseChain[];
  /** Node ids appearing in more than one case's chain (shared tails). */
  sharedNodeIds: string[];
}

/** One shared walk index per graph — chain walks all read the same maps. */
interface WalkIndex {
  byId: Map<string, GraphNode>;
  next: Map<string, string>;
  mainIds: Set<string>;
}

function walkIndexOf(graph: CampaignGraph): WalkIndex {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const next = new Map<string, string>();
  for (const e of graph.edges) if (!next.has(e.from)) next.set(e.from, e.to);
  return { byId, next, mainIds: new Set(mainPath(graph).map((n) => n.id)) };
}

/**
 * The ONE container chain walk: the run of nodes from `start` up to
 * (exclusive) end nodes, branch nodes, subcampaign nodes (container heads
 * belong to their container, never to another chain — #90/DEC-077),
 * main-path nodes (rejoins), and cycles — those belong to the flow the
 * chain exits INTO, not to the chain. `skip` excludes the walk's own head.
 */
function walkChain(index: WalkIndex, start: string | undefined, skip?: string): GraphNode[] {
  const chain: GraphNode[] = [];
  const seen = new Set<string>(skip ? [skip] : []);
  let cur = start;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (index.mainIds.has(cur)) break;
    const n = index.byId.get(cur);
    if (!n || n.type === "end" || n.type === "branch" || n.type === "subcampaign") break;
    chain.push(n);
    cur = index.next.get(cur);
  }
  return chain;
}

/**
 * Every branch's per-case chains (see {@link walkChain} for the stop rules —
 * one shared walk, so a case chain never swallows a sub-campaign head).
 */
export function branchChains(graph: CampaignGraph): BranchChains[] {
  const index = walkIndexOf(graph);
  const out: BranchChains[] = [];
  for (const node of graph.nodes) {
    if (node.type !== "branch") continue;
    const cases: BranchCaseChain[] = [];
    const counts = new Map<string, number>();
    for (const c of node.cases) {
      const chain = walkChain(index, c.goto);
      for (const n of chain) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
      cases.push({ key: caseKeyOf(c), case: c, chain });
    }
    out.push({
      branch: node,
      cases,
      sharedNodeIds: [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id),
    });
  }
  return out;
}

/** One case's chain (see {@link branchChains}); undefined when the branch/case is unknown. */
export function chainForCase(
  graph: CampaignGraph,
  branchId: string,
  caseKey: string,
): GraphNode[] | undefined {
  const set = branchChains(graph).find((b) => b.branch.id === branchId);
  return set?.cases.find((c) => c.key === caseKey)?.chain;
}

export interface SubcampaignChain {
  node: SubcampaignNode;
  /**
   * The container's own nodes, in flow order — the run from the container
   * node's out-edge up to (exclusive) its end node. Same stop rules as the
   * branch-case walk (end/branch/main-path/cycle), plus sibling subcampaign
   * nodes: a container never swallows another container's head.
   */
  chain: GraphNode[];
}

/**
 * Every sub-campaign container's chain (#90, DEC-077). A sub-campaign is a
 * `SubcampaignNode`-headed chain DISJOINT from the main path — enrollments
 * enter via an R1 rule's `move_to_node` targeting the container node, never
 * via the in-graph walk (the workflow records `enter_subcampaign` and walks
 * the chain).
 */
export function subcampaignChains(graph: CampaignGraph): SubcampaignChain[] {
  const index = walkIndexOf(graph);
  const out: SubcampaignChain[] = [];
  for (const node of graph.nodes) {
    if (node.type !== "subcampaign") continue;
    out.push({ node, chain: walkChain(index, index.next.get(node.id), node.id) });
  }
  return out;
}

/**
 * The node a sub-campaign container exits into — its chain tail's out-edge
 * target (the container node's own out-edge for an empty chain). A
 * well-formed container exits into its OWN end node; anything else (a main
 * rejoin, a branch, a cycle back into the chain, nothing) is the malformed
 * shape the edit gate refuses.
 */
export function subcampaignExitOf(
  graph: CampaignGraph,
  subcampaignId: string,
): GraphNode | undefined {
  const chain = subcampaignChainOf(graph, subcampaignId) ?? [];
  const tailId = chain.length > 0 ? chain[chain.length - 1]!.id : subcampaignId;
  const exitId = graph.edges.find((e) => e.from === tailId)?.to;
  return exitId ? graph.nodes.find((n) => n.id === exitId) : undefined;
}

/** One sub-campaign's chain (see {@link subcampaignChains}); undefined when unknown. */
export function subcampaignChainOf(
  graph: CampaignGraph,
  subcampaignId: string,
): GraphNode[] | undefined {
  return subcampaignChains(graph).find((s) => s.node.id === subcampaignId)?.chain;
}

/**
 * Node ids reachable from MORE than one container chain — branch cases
 * (across ALL branches) and sub-campaign chains counted together. The
 * cross-container superset of `branchChains().sharedNodeIds`: mutating a
 * chain two containers reach would change both, so it refuses (#88 review
 * round invariant, extended across container kinds by #90/DEC-077).
 */
export function sharedContainerNodeIds(graph: CampaignGraph): Set<string> {
  const counts = new Map<string, number>();
  for (const set of branchChains(graph)) {
    for (const c of set.cases) {
      for (const n of c.chain) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
    }
  }
  for (const s of subcampaignChains(graph)) {
    for (const n of s.chain) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
}

/**
 * Reply-strategy chains, keyed by intent — the branch-chain view of the reply
 * branch's non-default cases. Supersedes the single-step `strategyStepsOf`
 * convention: a chain's FIRST step is what that helper used to surface.
 */
export function strategyChains(
  graph: CampaignGraph,
): Array<{ intent: string; chain: GraphNode[]; steps: StepNode[] }> {
  const branch = replyBranchOf(graph);
  if (!branch) return [];
  const set = branchChains(graph).find((b) => b.branch.id === branch.id);
  if (!set) return [];
  return set.cases
    .filter((c) => c.key !== "default")
    .map((c) => ({
      intent: c.key,
      chain: c.chain,
      steps: c.chain.filter((n): n is StepNode => n.type === "step"),
    }));
}
