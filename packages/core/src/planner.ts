/**
 * Planner REST DTOs (P1.4, A2). The wizard's step-2 "drafting sequence" posts
 * a plan job and polls the latest graph.
 */
import { z } from "zod";

export const planRequestSchema = z.object({
  agentId: z.string().min(1),
});
export type PlanRequestDto = z.infer<typeof planRequestSchema>;

export const plannerGraphQuerySchema = z.object({
  agentId: z.string().min(1),
});
export type PlannerGraphQuery = z.infer<typeof plannerGraphQuerySchema>;
