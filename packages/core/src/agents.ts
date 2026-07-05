/**
 * Agents REST DTOs (C2.2, A2) — shared by api + web.
 */
import { z } from "zod";
import { goalKeySchema } from "./context";

export const agentStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  goal: goalKeySchema,
  instructions: z.string().max(2000).optional(),
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: agentStatusSchema.optional(),
    /** Validated against the A8 Guardrails schema api-side (parseGuardrails). */
    guardrails: z.unknown().optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined || v.guardrails !== undefined, {
    message: "Provide name, status and/or guardrails",
  });
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

/** One Agents-List row (checkpoints §2) — live metrics, RLS-scoped. */
export interface AgentListItem {
  id: string;
  name: string;
  goal: string;
  status: AgentStatus;
  channels: string[];
  contacts: number;
  replies: number;
  qualified: number;
  steps: number;
  sendsToday: number;
  bookings: number;
  /** Derived (DEC-037): "Good" | "Warn" — Warn when unplannable or no active sender. */
  health: "Good" | "Warn";
  createdAt: string;
}
