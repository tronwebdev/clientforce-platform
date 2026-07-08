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

/**
 * B6: the wizard's resumable working set. Everything durable (name, goal,
 * instructions, sources, gaps, context, graph, guardrails) lives on its own
 * rows; this JSON carries only what would otherwise die with the browser tab.
 * `null` clears it (set at launch — a launched agent is not resumable).
 */
export const draftStateSchema = z.object({
  step: z.number().int().min(0).max(5),
  buildMethod: z.enum(["ai", "template", "scratch"]).optional(),
  added: z
    .array(
      z.object({
        id: z.string(),
        email: z.string(),
        firstName: z.string().optional(),
        /** C2.8 (49-3): how the contact was added — drives enrollment provenance. */
        src: z.enum(["manual", "csv"]).optional(),
      }),
    )
    .max(500)
    .optional(),
  capture: z.object({ widget: z.boolean(), form: z.boolean() }).optional(),
  dailyCap: z.number().int().min(1).max(10000).optional(),
  windowStart: z.string().max(5).optional(),
  windowEnd: z.string().max(5).optional(),
  /** B10: IANA zone for the sending window (also lands in guardrails). */
  timezone: z.string().max(64).optional(),
  /** C2.8: step-3 "Choose a list" — name/count re-resolve from the server on resume. */
  pickedListId: z.string().optional(),
  sendDays: z.array(z.boolean()).length(7).optional(),
  quietHours: z.boolean().optional(),
  ramp: z.boolean().optional(),
});
export type DraftState = z.infer<typeof draftStateSchema>;

export const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: agentStatusSchema.optional(),
    /** Validated against the A8 Guardrails schema api-side (parseGuardrails). */
    guardrails: z.unknown().optional(),
    /** B6: wizard draft-resume state; null clears it (launch). */
    draftState: z.union([draftStateSchema, z.null()]).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.status !== undefined ||
      v.guardrails !== undefined ||
      v.draftState !== undefined,
    { message: "Provide name, status, guardrails and/or draftState" },
  );
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
