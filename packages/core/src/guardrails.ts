/**
 * Guardrails schema (P1.5, handoff A8) — replaces the bare `Agent.guardrails
 * Json` contract. Enforced by the email adapter (send boundary) and, from
 * P1.6, the workflow. Wizard step 5 + the agent-view Settings tab read/write
 * this shape. `unsubscribeFooter` and `suppressionCheck` are LITERAL `true` —
 * never disableable.
 */
import { z } from "zod";
import { languageCodeSchema, languageSourceSchema } from "./language";
import { strategyBlockSchema } from "./strategy";
import { voiceRiderSchema } from "./voice";

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
  // P2.1 (DEC-061): per-channel caps — sms OPTIONAL and additive; legacy
  // rows parse unchanged. A8 literals below stay untouched.
  // P3.1 (DEC-078): voice cap, same additive pattern.
  dailyCap: z.object({
    email: z.number().int().min(1),
    sms: z.number().int().min(1).optional(),
    voice: z.number().int().min(1).optional(),
  }),
  consent: z.object({ attestedBy: z.string().min(1), attestedAt: z.string().min(1) }).nullable(),
  tracking: trackingSchema.default({ openTracking: true, linkTracking: true }),
  /**
   * C2.9 (DEC-059): custom-goal terminal label, owner-typed in wizard step 1.
   * Rides this Json because it must survive launch without a migration —
   * display-only, no effect on the send boundary; the A8 rails below are
   * untouched. Absent for the 8 fixed goals (GOAL_META supplies their labels).
   */
  goalLabel: z.string().max(60).optional(),
  /**
   * M1a (DEC-065): optional per-agent selling strategy — `strategyNotes`
   * (planner prompt guidance) + `neverSay` (prompt AND deterministic
   * post-generation ban). Rides this Json like `goalLabel` — no migration;
   * absent = defaults, legacy rows parse unchanged. Read at plan time only;
   * the A8 rails below are untouched and the send boundary ignores it.
   */
  strategy: strategyBlockSchema.optional(),
  /**
   * G1 (DEC-070): per-agent compose mode — absent = "scripted" (default at
   * creation; legacy rows parse unchanged; no migration, no wizard field).
   * "guided" makes the PLANNER emit briefs for sms steps; each step's mode is
   * baked into the graph node at plan time, so flipping this applies to
   * future generations/sends — steps already planned keep their mode. Read
   * at plan time only; the A8 rails below are untouched.
   */
  composeMode: z.enum(["scripted", "guided"]).optional(),
  /**
   * L1 (DEC-072): the agent's OUTPUT language — what it writes sequences,
   * reply drafts, and compliance lines in (the app UI stays English). Rides
   * this Json like `goalLabel`/`strategy`/`composeMode` — no migration;
   * absent = English, legacy rows parse unchanged. `languageSource` records
   * who set it: "detected" (the distiller's evidence-pack detection — may be
   * overwritten by a later detection) or "owner" (Settings edit — sticky,
   * never touched by the detector). Read at generation time by the planner /
   * composer / distiller and at send time ONLY to pick the pre-translated
   * compliance constants; the A8 rails below are untouched.
   */
  language: languageCodeSchema.optional(),
  languageSource: languageSourceSchema.optional(),
  /**
   * P3.1 (DEC-078): per-agent voice settings — spoken name (+ its confirmed
   * flag: an unconfirmed value is the ✦ suggestion, never spoken) and the TTS
   * persona. Rides this Json like `goalLabel`/`strategy`/`composeMode` — no
   * migration; absent = workspace default → default literal (the locked
   * resolution chain in voice.ts). D0 holds: never a wizard field. The A8
   * rails below are untouched.
   */
  voice: voiceRiderSchema.optional(),
  /**
   * B3d (DEC-122): per-campaign autonomy — how much Ada decides. Rides this
   * Json like every rider — no migration; absent = "limits" (the default:
   * she acts inside the guardrails; anything outside waits). "ask" parks
   * every scheduled outbound as an approval; "full" additionally covers
   * budget moves + branch starts when those actions exist. NO level ever
   * bypasses the send-boundary gates, quiet hours, consent/DNC, or the
   * DEC-116 reply hold — autonomy decides who taps, never what is allowed.
   * No zod .default(): a materialized value would rewrite every row on the
   * next guardrails round-trip (the voice-rider precedent).
   */
  autonomy: z.enum(["ask", "limits", "full"]).optional(),
  /**
   * B7 (DEC-133): per-campaign channel toggles — the B3d deferral come home.
   * Rides this Json like every rider — no migration; an ABSENT block or an
   * absent key means ON (legacy rows parse unchanged). `false` PAUSES that
   * channel: all three send boundaries (email/SMS/voice) refuse with
   * CHANNEL_PAUSED before their cap checks, so the step holds exactly like a
   * cap. A toggle only ever RESTRICTS — no value bypasses the A8 rails,
   * quiet hours, consent/DNC, or the reply hold.
   */
  channels: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      voice: z.boolean().optional(),
    })
    .optional(),
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

/** B3d: the autonomy fallback — absent rider = "Act inside limits". */
export const DEFAULT_AUTONOMY = "limits" as const;
export type AutonomyLevel = "ask" | "limits" | "full";

/** B7: a channel is ON unless its key is explicitly false. */
export function channelEnabled(
  guardrails: Pick<Guardrails, "channels">,
  channel: "email" | "sms" | "voice",
): boolean {
  return guardrails.channels?.[channel] !== false;
}

/**
 * B7 (DEC-133): workspace-level guardrail DEFAULTS — the values a NEW
 * campaign starts from (the settings hub's Guardrails page edits these).
 * Stored additively in `Workspace.settings.guardrailDefaults`; absent =
 * today's DEFAULT_GUARDRAILS baseline, so legacy workspaces are unchanged.
 * Campaigns keep their OWN stored guardrails after creation — editing a
 * default never rewrites a live campaign (live inheritance is Q-109).
 */
export const guardrailDefaultsSchema = z.object({
  dailyCap: z
    .object({
      email: z.number().int().min(1).max(10_000).optional(),
      sms: z.number().int().min(1).max(10_000).optional(),
      voice: z.number().int().min(1).max(10_000).optional(),
    })
    .optional(),
  sendingWindow: sendingWindowSchema.optional(),
});
export type GuardrailDefaults = z.infer<typeof guardrailDefaultsSchema>;

/** Parse the stored defaults; absent/invalid-empty = no overrides. */
export function parseGuardrailDefaults(value: unknown): GuardrailDefaults {
  if (!value || typeof value !== "object") return {};
  const res = guardrailDefaultsSchema.safeParse(value);
  return res.success ? res.data : {};
}

/** The guardrails a new campaign starts from: baseline + workspace defaults. */
export function applyGuardrailDefaults(defaults: GuardrailDefaults): Guardrails {
  return {
    ...DEFAULT_GUARDRAILS,
    dailyCap: { ...DEFAULT_GUARDRAILS.dailyCap, ...(defaults.dailyCap ?? {}) },
    ...(defaults.sendingWindow ? { sendingWindow: defaults.sendingWindow } : {}),
  };
}

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
