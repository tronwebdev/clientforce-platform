import type { CreateAgentInput } from "@clientforce/core";
import { DEFAULT_GUARDRAILS } from "@clientforce/core";
import type { Prisma } from "@clientforce/db";

/**
 * B2.6 (DEC-110): the ONE agent-create data shape. `POST /agents` and the
 * suggestion sweep both assemble a DRAFT row through this helper — the ruled
 * "engine writes drafts through the same creation API"; no parallel path.
 */
export function agentCreateData(
  workspaceId: string,
  input: CreateAgentInput,
): Prisma.AgentUncheckedCreateInput {
  return {
    workspaceId,
    name: input.name,
    goal: input.goal,
    // M1a (DEC-065): the wizard's step-1 picker persisted — with the
    // goal it derives the selling arc (supersedes DEC-038(6)).
    category: input.category ?? null,
    instructions: input.instructions ?? null,
    // B2.5 (DEC-109, Q-069): guided create writes the goal sentence.
    goalSummary: input.goalSummary ?? null,
    status: "DRAFT",
    guardrails: DEFAULT_GUARDRAILS as unknown as Prisma.InputJsonValue,
  };
}
