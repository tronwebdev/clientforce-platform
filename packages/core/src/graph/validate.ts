/**
 * CampaignGraph validation — zod for shape, plus a semantic pass for referential
 * integrity and well-formed flow. Throws `GraphValidationError` with a precise
 * message so invalid planner output is rejected loudly.
 */
import { z } from "zod";
import type { CampaignGraph } from "./types";

export class GraphValidationError extends Error {
  readonly issues?: unknown;
  constructor(message: string, issues?: unknown) {
    super(message);
    this.name = "GraphValidationError";
    this.issues = issues;
  }
}

const id = z.string().min(1);

const stepContentSchema = z.object({
  subject: z.string().optional(),
  body: z.string().optional(),
  template: z.string().optional(),
  buttons: z.array(z.string()).optional(),
  voice: z
    .object({
      persona: z.string().optional(),
      objective: z.string().optional(),
      script: z.string().optional(),
    })
    .optional(),
});

const stepNode = z.object({
  id,
  type: z.literal("step"),
  channel: z.enum(["email", "sms", "whatsapp", "voice", "linkedin"]),
  content: stepContentSchema,
  pipelineOnSend: z.string().optional(),
});

const delayNode = z.object({
  id,
  type: z.literal("delay"),
  amount: z.number().positive(),
  unit: z.enum(["minutes", "hours", "days"]),
});

const branchCase = z.object({
  when: z.union([z.object({ intent: z.string().min(1) }), z.literal("default")]),
  goto: id,
  pipeline: z.string().optional(),
});

const branchNode = z.object({
  id,
  type: z.literal("branch"),
  on: z.enum(["reply", "open", "click", "call_outcome", "no_response"]),
  cases: z.array(branchCase).min(1),
});

const subcampaignNode = z.object({ id, type: z.literal("subcampaign"), ref: z.string().min(1) });
const actionNode = z.object({
  id,
  type: z.literal("action"),
  action: z.string().min(1),
  params: z.record(z.unknown()).optional(),
});
const endNode = z.object({ id, type: z.literal("end") });

const nodeSchema = z.discriminatedUnion("type", [
  stepNode,
  delayNode,
  branchNode,
  subcampaignNode,
  actionNode,
  endNode,
]);

const graphSchema = z.object({
  entry: id,
  nodes: z.array(nodeSchema).min(1),
  edges: z.array(z.object({ from: id, to: id })),
});

/**
 * Validate arbitrary input into a typed {@link CampaignGraph}. Throws
 * {@link GraphValidationError} on a bad shape (unknown node type / channel),
 * unknown references (entry, edges, branch `goto`), duplicate ids, or malformed
 * flow (a sequential node without exactly one outgoing edge).
 */
export function validateGraph(input: unknown): CampaignGraph {
  const parsed = graphSchema.safeParse(input);
  if (!parsed.success) {
    throw new GraphValidationError(
      `Invalid campaign graph: ${parsed.error.message}`,
      parsed.error.issues,
    );
  }
  const graph = parsed.data as CampaignGraph;

  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) throw new GraphValidationError(`Duplicate node id "${node.id}"`);
    ids.add(node.id);
  }

  if (!ids.has(graph.entry)) {
    throw new GraphValidationError(`entry "${graph.entry}" is not a known node`);
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) {
      throw new GraphValidationError(`edge from "${edge.from}" references an unknown node`);
    }
    if (!ids.has(edge.to)) {
      throw new GraphValidationError(
        `edge to "${edge.to}" (from "${edge.from}") references an unknown node`,
      );
    }
  }

  const outDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
  }

  for (const node of graph.nodes) {
    if (node.type === "branch") {
      for (const c of node.cases) {
        if (!ids.has(c.goto)) {
          throw new GraphValidationError(`branch "${node.id}" case goto "${c.goto}" is unknown`);
        }
      }
      continue; // branches route via cases, not edges
    }
    const deg = outDegree.get(node.id) ?? 0;
    if (node.type === "end") {
      if (deg !== 0)
        throw new GraphValidationError(`end node "${node.id}" must have no outgoing edge`);
    } else if (node.type === "subcampaign") {
      if (deg > 1)
        throw new GraphValidationError(`subcampaign "${node.id}" has more than one outgoing edge`);
    } else if (deg !== 1) {
      // step / delay / action
      throw new GraphValidationError(
        `node "${node.id}" (${node.type}) must have exactly one outgoing edge, found ${deg}`,
      );
    }
  }

  return graph;
}
