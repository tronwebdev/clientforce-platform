/**
 * @clientforce/telemetry — the product-telemetry catalog (B1 W3, DEC-081).
 *
 * Versioned like the domain event catalog (`noun.verb.vN`), but with a HARD
 * privacy rail: every payload schema admits ONLY id-shaped fields plus
 * enums/counts/durations — never message bodies, contact PII, or knowledge
 * content. The rail is enforced structurally (a key can't be declared) AND by a
 * schema-pinned test (`test/privacy.test.ts`) that fails the build if any schema
 * declares a PII/body key. Internal-only — never surfaced in tenant Analytics.
 */
import { z } from "zod";

/** An opaque id — the only "string" the rail allows (never a name/email/body). */
const id = z.string().min(1);
/** A low-cardinality label / enum value (channel, feature, section…), not free text. */
const label = z.string().min(1).max(64);

export const TELEMETRY_SCHEMAS = {
  // Activation-funnel signals (funnel milestones are DERIVED as first-per-workspace).
  "product.signup.v1": z.object({ actorId: id, agencyId: id.optional() }),
  "product.agent_created.v1": z.object({ workspaceId: id, agentId: id, actorId: id }),
  "product.agent_launched.v1": z.object({ workspaceId: id, agentId: id, actorId: id }),
  "product.send.v1": z.object({ workspaceId: id, channel: label, agentId: id.optional() }),
  "product.reply.v1": z.object({ workspaceId: id, channel: label }),
  "product.goal.v1": z.object({ workspaceId: id, goal: label }),
  // Feature usage + operator/agent actions.
  "wizard.step_completed.v1": z.object({ workspaceId: id, actorId: id, step: z.number().int().nonnegative() }),
  "wizard.step_abandoned.v1": z.object({ workspaceId: id, actorId: id, step: z.number().int().nonnegative() }),
  "feature.first_used.v1": z.object({ workspaceId: id, feature: label, actorId: id.optional() }),
  "agent.takeover.v1": z.object({ workspaceId: id, agentId: id, actorId: id }),
  "agent.regenerated.v1": z.object({ workspaceId: id, agentId: id, actorId: id }),
  "settings.edited.v1": z.object({ workspaceId: id, actorId: id, section: label }),
  // Metering (closes W2's AI-spend honest-absence).
  "ai.spend.v1": z.object({ workspaceId: id, task: label, credits: z.number().int().nonnegative() }),
} satisfies Record<string, z.ZodTypeAny>;

export type TelemetryType = keyof typeof TELEMETRY_SCHEMAS;
export type TelemetryPayloads = { [K in TelemetryType]: z.infer<(typeof TELEMETRY_SCHEMAS)[K]> };
export const TELEMETRY_TYPES = Object.keys(TELEMETRY_SCHEMAS) as TelemetryType[];

/**
 * The privacy-rail denylist. No telemetry payload schema may declare any of
 * these keys (checked case-insensitively by the pinned test). PII/body/content
 * simply cannot be represented, so it cannot leak.
 */
export const PII_DENYLIST = [
  "email",
  "phone",
  "name",
  "firstname",
  "lastname",
  "fullname",
  "body",
  "subject",
  "content",
  "text",
  "message",
  "address",
  "company",
  "title",
  "note",
  "notes",
  "transcript",
  "summary",
  "snippet",
  "preview",
] as const;

/** Validate a payload against its schema (throws on mismatch). */
export function validateTelemetry<T extends TelemetryType>(
  type: T,
  payload: unknown,
): TelemetryPayloads[T] {
  return TELEMETRY_SCHEMAS[type].parse(payload) as TelemetryPayloads[T];
}
