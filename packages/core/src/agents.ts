/**
 * Agents REST DTOs (C2.2, A2) — shared by api + web.
 */
import { z } from "zod";
import { goalKeySchema } from "./context";
import { agentValueSchema } from "./goal-value";
import { businessCategorySchema } from "./strategy";

export const agentStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  goal: goalKeySchema,
  /**
   * M1a (DEC-065): the wizard's existing step-1 picker, finally persisted
   * (supersedes DEC-038(6) visual-only). Drives arc selection with the goal.
   */
  category: businessCategorySchema.optional(),
  instructions: z.string().max(2000).optional(),
  /** B2.5 (DEC-109, closes Q-069): the guided-create goal summary — the
   *  owner's one-line sentence for the hero/list lead (spec answer). */
  goalSummary: z.string().trim().max(160).optional(),
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
        /** W3-7: the audience-preview rows render name · email · company. */
        lastName: z.string().optional(),
        company: z.string().optional(),
        /** C2.8 (49-3): how the contact was added — drives enrollment provenance. */
        src: z.enum(["manual", "csv"]).optional(),
      }),
    )
    .max(500)
    .optional(),
  capture: z
    .object({
      widget: z.boolean(),
      form: z.boolean(),
      /**
       * W3-9/W3-10 additions — ALL optional so pre-W3 drafts parse
       * unchanged. Visual-only config (checkpoints §3: toggle state
       * persists, no capture backend): master toggle, the third inbound
       * asset, and the auto-prospecting config. `ap` absent = no explicit
       * user choice — the goal-fit default applies at render.
       */
      enabled: z.boolean().optional(),
      embed: z.boolean().optional(),
      ap: z.boolean().optional(),
      apKeywords: z.array(z.string().max(60)).max(20).optional(),
      apParams: z.record(z.string(), z.string().max(60)).optional(),
      apSignals: z.record(z.string(), z.boolean()).optional(),
    })
    .optional(),
  /**
   * W3-1: step-3 CSV import lands in a list; the draft keeps only the
   * REFERENCE — name/count re-resolve from the server on resume, exactly
   * like `pickedListId` (B6 rule: lists resolve live, never copied).
   */
  csvListId: z.string().optional(),
  dailyCap: z.number().int().min(1).max(10000).optional(),
  /** P2.1 (DEC-061): the sms daily cap (guardrails dailyCap.sms). */
  smsDailyCap: z.number().int().min(1).max(10000).optional(),
  windowStart: z.string().max(5).optional(),
  windowEnd: z.string().max(5).optional(),
  /** B10: IANA zone for the sending window (also lands in guardrails). */
  timezone: z.string().max(64).optional(),
  /** C2.8: step-3 "Choose a list" — name/count re-resolve from the server on resume. */
  pickedListId: z.string().optional(),
  /** C2.9: custom-goal terminal label typed in step 1 (also lands in guardrails). */
  goalLabel: z.string().max(60).optional(),
  sendDays: z.array(z.boolean()).length(7).optional(),
  quietHours: z.boolean().optional(),
  ramp: z.boolean().optional(),
});
export type DraftState = z.infer<typeof draftStateSchema>;

export const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: agentStatusSchema.optional(),
    /** M1a (DEC-065): DRAFT-only api-side — the arc derives at creation. */
    category: businessCategorySchema.optional(),
    /** Validated against the A8 Guardrails schema api-side (parseGuardrails). */
    guardrails: z.unknown().optional(),
    /** B6: wizard draft-resume state; null clears it (launch). */
    draftState: z.union([draftStateSchema, z.null()]).optional(),
    /** B1 (DEC-104): campaign value estimate — Addendum-2 §D fields, edited
     *  in the Bold overview strip (never a wizard field, D0). Null clears. */
    ...agentValueSchema.shape,
    /** B2.5 (DEC-109): the Q-069 goal summary — editable after create; null clears. */
    goalSummary: z.string().trim().max(160).nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.status !== undefined ||
      v.category !== undefined ||
      v.guardrails !== undefined ||
      v.draftState !== undefined ||
      v.valueEstCents !== undefined ||
      v.valueGoalUnits !== undefined ||
      v.valueSalesGoalCents !== undefined,
    { message: "Provide at least one updatable field" },
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
  /** B1 (DEC-104, the BACKEND_TOUCH_MAP "goal-met pill" EXTEND): true once any
   *  enrollment reached the goal-terminal stage. There is no target model on
   *  the list beyond valueGoalUnits — this is "met at least once", honestly. */
  goalMet: boolean;
  /** B1: resolved goal-terminal pill wording (C2.9 GOAL_META). */
  goalPill: string;
  /** B1: campaign value estimate (Addendum-2 §D), null until the owner sets it. */
  valueEstCents: number | null;
  valueGoalUnits: number | null;
  valueSalesGoalCents: number | null;
  /** B2.5 (DEC-109, Q-069): the guided-create goal sentence; null on legacy rows. */
  goalSummary: string | null;
}
