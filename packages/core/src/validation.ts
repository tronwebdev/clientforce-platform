/**
 * List hygiene — email validation DTOs (LH1, DEC-087).
 *
 * One verdict enum of record, shared by the Contact columns, the verdict
 * cache, the batch report and every UI chip. The enrollment gate consumes
 * these; the suppression ledger stays authoritative regardless of verdict
 * (a hard bounce anywhere = suppressed everywhere; validation never
 * un-suppresses).
 */
import { z } from "zod";

/** The owner-locked verdict enum: `unverified` is the default landing state. */
export const EMAIL_VERDICTS = ["valid", "risky", "invalid", "unverified"] as const;
export const emailVerdictSchema = z.enum(EMAIL_VERDICTS);
export type EmailVerdict = z.infer<typeof emailVerdictSchema>;

/** Batch lifecycle — holds are HONEST states, never silent. */
export const VALIDATION_BATCH_STATUSES = ["queued", "running", "held", "completed"] as const;
export type ValidationBatchStatus = (typeof VALIDATION_BATCH_STATUSES)[number];

/** Why a batch is held (the "validation queued" states). */
export const VALIDATION_HOLD_REASONS = [
  "workspace_allowance",
  "platform_spend_ceiling",
  "provider_unavailable",
] as const;
export type ValidationHoldReason = (typeof VALIDATION_HOLD_REASONS)[number];

/** Per-row report outcome; `pending` rows are still validating. */
export const VALIDATION_ITEM_OUTCOMES = [
  "pending",
  "valid",
  "risky",
  "invalid",
  "skipped_suppressed",
] as const;
export type ValidationItemOutcome = (typeof VALIDATION_ITEM_OUTCOMES)[number];

/** Enrollment-hold reasons (the gate's queue). */
export const ENROLLMENT_HOLD_REASONS = ["unverified", "risky_held", "cap_overflow"] as const;
export type EnrollmentHoldReason = (typeof ENROLLMENT_HOLD_REASONS)[number];

/**
 * Typed enrollment-gate refusal codes. `CONTACT_INVALID` is the only refusal —
 * everything else the gate can decide is a HOLD (unverified/risky/cap), which
 * drains, not a refusal. Mirrors the send boundary's `SendBlockReason` shape.
 */
export const ENROLL_BLOCK_REASONS = ["CONTACT_INVALID"] as const;
export type EnrollBlockReason = (typeof ENROLL_BLOCK_REASONS)[number];

/**
 * The progressive batch report (GET /contacts/validation-batches/:id) — the
 * import report's data: "1,240 valid · 87 risky (held) · 43 invalid
 * (excluded) · 12 already suppressed", plus pending for the honest
 * "Validating N contacts…" line.
 */
export interface ValidationBatchReport {
  id: string;
  status: ValidationBatchStatus;
  heldReason: ValidationHoldReason | null;
  source: string;
  listId: string | null;
  counts: {
    total: number;
    pending: number;
    valid: number;
    risky: number;
    invalid: number;
    skippedSuppressed: number;
  };
  createdAt: string;
  completedAt: string | null;
}

/** Row-level report detail (paged; also the exclusion-CSV row shape). */
export interface ValidationBatchRow {
  contactId: string;
  email: string;
  outcome: ValidationItemOutcome;
  via: string | null;
  detail: string | null;
}

/**
 * Workspace-level validation policy — a rider on `Workspace.settings`
 * (the guardrails-rider precedent: absent = defaults, legacy rows
 * byte-identical). `riskyPolicy` is owner-flippable later (default HOLD —
 * risky addresses wait rather than burn sender reputation).
 */
export const workspaceValidationSettingsSchema = z
  .object({
    riskyPolicy: z.enum(["hold", "enroll"]).default("hold"),
  })
  .default({ riskyPolicy: "hold" });
export type WorkspaceValidationSettings = z.infer<typeof workspaceValidationSettingsSchema>;

/** Parse the rider off a raw `Workspace.settings` Json — never throws. */
export function parseWorkspaceValidationSettings(settings: unknown): WorkspaceValidationSettings {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const raw = (settings as Record<string, unknown>).validation;
    const parsed = workspaceValidationSettingsSchema.safeParse(raw ?? undefined);
    if (parsed.success) return parsed.data;
  }
  return { riskyPolicy: "hold" };
}

/**
 * POST /enrollments result when the gate HOLDS instead of enrolling — a 200,
 * never an error: the flow completed; sending starts as the contact clears.
 */
export interface EnrollmentHeldResult {
  held: true;
  holdId: string;
  reason: EnrollmentHoldReason;
}

/** The per-campaign validation/hold progress chip (agent dashboard). */
export interface ValidationProgress {
  heldUnverified: number;
  heldRisky: number;
  heldCapOverflow: number;
  refusedInvalid: number;
}

/**
 * Per-day-per-campaign enrollment cap, platform default (LH1, DEC-087 —
 * proposal ratified at the plan comment). Bounds the QUEUE feeding a
 * warming sender: effective send volume stays min(warmup curve, dailyLimit)
 * — this cap only meters how fast contacts may ENTER the sequence, so an
 * autoprospector or a huge import can never flood day one. Verified
 * enrollments count toward it; holds don't. `Campaign.enrollmentDailyCap`
 * overrides per campaign; `enrollmentCapEnabled=false` disables (owner).
 */
export const ENROLLMENT_DAILY_CAP_DEFAULT = 200;
