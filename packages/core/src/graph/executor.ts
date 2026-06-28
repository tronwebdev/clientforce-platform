/**
 * Pure CampaignGraph executor — walks the graph and emits ordered "intended
 * actions" (what *would* happen). No real sends, no timers, no I/O. Branches
 * resolve against mocked events keyed by branch-node id.
 */
import type {
  BranchCase,
  BranchNode,
  CampaignGraph,
  GraphNode,
  IntendedAction,
  NodeId,
} from "./types";
import { validateGraph } from "./validate";

export class GraphExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphExecutionError";
  }
}

/** A mocked event delivered to a branch node (e.g. a classified reply). */
export interface MockedEvent {
  intent?: string;
}

export interface ExecuteOptions {
  /** Mocked events by branch-node id; supplies the intent a branch resolves on. */
  events?: Record<NodeId, MockedEvent>;
  /** Cycle guard. Default 1000. */
  maxSteps?: number;
}

function resolveBranch(node: BranchNode, event: MockedEvent | undefined): { matched: string; chosen: BranchCase } {
  const intent = event?.intent;
  if (intent !== undefined) {
    const hit = node.cases.find((c) => c.when !== "default" && c.when.intent === intent);
    if (hit) return { matched: `intent:${intent}`, chosen: hit };
  }
  const fallback = node.cases.find((c) => c.when === "default");
  if (fallback) return { matched: "default", chosen: fallback };
  throw new GraphExecutionError(
    `branch "${node.id}" has no case for intent "${intent ?? "<none>"}" and no default`,
  );
}

/**
 * Execute a (validated) graph to a list of intended actions. Accepts unknown
 * input and validates it first, so callers get a single entry point.
 */
export function execute(input: unknown, options: ExecuteOptions = {}): IntendedAction[] {
  const graph: CampaignGraph = validateGraph(input);
  const nodesById = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  // First outgoing edge per node (sequential nodes are validated to have exactly one).
  const next = new Map<string, string>();
  for (const edge of graph.edges) {
    if (!next.has(edge.from)) next.set(edge.from, edge.to);
  }

  const events = options.events ?? {};
  const maxSteps = options.maxSteps ?? 1000;
  const actions: IntendedAction[] = [];

  let current: string | undefined = graph.entry;
  let steps = 0;

  while (current !== undefined) {
    if (++steps > maxSteps) {
      throw new GraphExecutionError(`Exceeded maxSteps (${maxSteps}); possible cycle at "${current}"`);
    }
    const node = nodesById.get(current);
    /* c8 ignore next */
    if (!node) throw new GraphExecutionError(`Reached unknown node "${current}"`);

    switch (node.type) {
      case "step": {
        actions.push({ kind: "send", nodeId: node.id, channel: node.channel, content: node.content });
        if (node.pipelineOnSend) {
          actions.push({ kind: "pipeline_move", nodeId: node.id, stage: node.pipelineOnSend });
        }
        current = next.get(node.id);
        break;
      }
      case "delay": {
        actions.push({ kind: "wait", nodeId: node.id, amount: node.amount, unit: node.unit });
        current = next.get(node.id);
        break;
      }
      case "action": {
        actions.push({
          kind: "action",
          nodeId: node.id,
          action: node.action,
          ...(node.params ? { params: node.params } : {}),
        });
        current = next.get(node.id);
        break;
      }
      case "subcampaign": {
        actions.push({ kind: "enter_subcampaign", nodeId: node.id, ref: node.ref });
        current = next.get(node.id); // may be undefined → terminal
        break;
      }
      case "branch": {
        const { matched, chosen } = resolveBranch(node, events[node.id]);
        actions.push({ kind: "branch", nodeId: node.id, on: node.on, matched, goto: chosen.goto });
        if (chosen.pipeline) {
          actions.push({ kind: "pipeline_move", nodeId: node.id, stage: chosen.pipeline });
        }
        current = chosen.goto;
        break;
      }
      case "end": {
        actions.push({ kind: "end", nodeId: node.id });
        current = undefined;
        break;
      }
    }
  }

  return actions;
}
