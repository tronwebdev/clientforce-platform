/**
 * Agents REST DTOs (C2.2, A2) — shared by api + web.
 */
import { z } from "zod";

export const agentStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: agentStatusSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, {
    message: "Provide name and/or status",
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
