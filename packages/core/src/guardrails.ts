/**
 * Guardrails schema (P1.5, handoff A8) — replaces the bare `Agent.guardrails
 * Json` contract. Enforced by the email adapter (send boundary) and, from
 * P1.6, the workflow. Wizard step 5 + the agent-view Settings tab read/write
 * this shape. `unsubscribeFooter` and `suppressionCheck` are LITERAL `true` —
 * never disableable.
 */
import { z } from "zod";

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

export const sendingWindowSchema = z.object({
  /** ISO weekday numbers, 1 (Mon) – 7 (Sun). */
  days: z.array(z.number().int().min(1).max(7)).min(1),
  start: timeHHMM,
  end: timeHHMM,
  /** IANA timezone, e.g. "America/Chicago". */
  timezone: z.string().min(1),
});
export type SendingWindow = z.infer<typeof sendingWindowSchema>;

/**
 * Owner-approved A8 extension (DEC-042): open/link tracking are real,
 * per-agent persisted toggles — unlike the literal-true consent rails below,
 * these two ARE user-controllable. Legacy rows without the block parse to
 * both-on (the send path's historical behavior).
 */
export const trackingSchema = z.object({
  openTracking: z.boolean(),
  linkTracking: z.boolean(),
});
export type Tracking = z.infer<typeof trackingSchema>;

export const guardrailsSchema = z.object({
  sendingWindow: sendingWindowSchema,
  dailyCap: z.object({ email: z.number().int().min(1) }),
  consent: z.object({ attestedBy: z.string().min(1), attestedAt: z.string().min(1) }).nullable(),
  tracking: trackingSchema.default({ openTracking: true, linkTracking: true }),
  unsubscribeFooter: z.literal(true),
  suppressionCheck: z.literal(true),
});
export type Guardrails = z.infer<typeof guardrailsSchema>;

/** Conservative defaults for agents that predate wizard step 5. */
export const DEFAULT_GUARDRAILS: Guardrails = {
  sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
  dailyCap: { email: 200 },
  consent: null,
  tracking: { openTracking: true, linkTracking: true },
  unsubscribeFooter: true,
  suppressionCheck: true,
};

/**
 * Parse an agent's stored guardrails; an empty/legacy value falls back to the
 * conservative defaults, but a PRESENT-yet-invalid value throws — a typo in a
 * sending window must never silently widen it.
 */
export function parseGuardrails(value: unknown): Guardrails {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) {
    return DEFAULT_GUARDRAILS;
  }
  return guardrailsSchema.parse(value);
}
