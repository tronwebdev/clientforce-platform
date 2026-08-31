/**
 * B7.5 — DTOs for the settings WRITE layer (SURFACE_SPEC_SETTINGS §11).
 *
 * B7 shipped these surfaces read-only. Everything here is the shape of a write
 * that surface could not previously make: teaching Ada a fact, naming a field,
 * adding a knowledge source from settings, asking for a number, inviting a
 * colleague, and changing what someone on the team may do.
 *
 * Additive by construction — no existing schema is re-exported or narrowed.
 */
import { z } from "zod";

/* ------------------------------------------------------------ core facts */

/**
 * A fact taught in settings is question → answer, not a registry key. It rides
 * the workspace `BusinessContext` layer under a derived key with the question
 * carried as the value's `label`, which is what `renderContextText` quotes —
 * so "she knows it now" is true rather than a toast.
 */
export const workspaceFactSchema = z.object({
  /** "Do you take my insurance?" — becomes the field's label. */
  question: z.string().trim().min(2).max(160),
  /** What she should answer, in the owner's own words. */
  answer: z.string().trim().min(1).max(5_000),
  /**
   * Set when this fact ANSWERS a reported gap: the registry key is written
   * directly instead of a derived one, so the gap closes rather than sitting
   * beside a near-duplicate.
   */
  gapKey: z.string().trim().min(1).max(120).optional(),
});
export type WorkspaceFactDto = z.infer<typeof workspaceFactSchema>;

/** Editing a taught fact: the key is known, both halves are replaceable. */
export const updateWorkspaceFactSchema = z.object({
  key: z.string().trim().min(1).max(120),
  question: z.string().trim().min(2).max(160).optional(),
  answer: z.string().trim().min(1).max(5_000).optional(),
});
export type UpdateWorkspaceFactDto = z.infer<typeof updateWorkspaceFactSchema>;

/**
 * Derive the stored key for a taught fact. Deterministic so the same question
 * edits the same row instead of growing a second one; prefixed so a taught
 * fact is never mistaken for a registry field.
 */
export function workspaceFactKey(question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `ask_${slug.length > 0 ? slug : "fact"}`;
}

/** True for keys this surface minted — the registry owns everything else. */
export function isWorkspaceFactKey(key: string): boolean {
  return key.startsWith("ask_") || key.startsWith("field_");
}

/**
 * A named field on "Who you are": the owner writes the name, she quotes the
 * value exactly and never guesses around it.
 */
export const workspaceFieldSchema = z.object({
  name: z.string().trim().min(2).max(160),
  value: z.string().trim().min(1).max(5_000),
});
export type WorkspaceFieldDto = z.infer<typeof workspaceFieldSchema>;

export function workspaceFieldKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `field_${slug.length > 0 ? slug : "field"}`;
}

/* ------------------------------------------------------- role vocabulary */

/**
 * ONE source for how a workspace role is spoken to a person.
 *
 * The stored enum is OWNER / ADMIN / **AGENT** / VIEWER and it does not move —
 * renaming a shipped enum is not additive. What moves is the WORD.
 *
 * "Agent" cannot be a human's role here. Ada is the workspace's one agent and
 * the Team page says so two rows above the invite button (`Agent · acts inside
 * your guardrails`), and an `Agent` row is a campaign's internal container
 * everywhere else in this codebase. So a person's third role is **Member**,
 * which is also what the surface spec has said all along.
 *
 * Every surface that shows a role to a person reads from here. Before this
 * there were two label maps and four places rendering the raw enum, which is
 * how "brightsmile · AGENT" and "You are signed in as AGENT" reached a screen.
 */
export const WORKSPACE_ROLE_WORD: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  AGENT: "Member",
  VIEWER: "Viewer",
};

/**
 * What each role may actually do — the surface spec's own §7 sentences,
 * verbatim, so unifying the two old label maps could not quietly reword them.
 */
export const WORKSPACE_ROLE_SCOPE: Record<string, string> = {
  OWNER: "Everything, including senders, guardrails, credits and who is on the team",
  ADMIN: "Everything except billing and deleting the workspace",
  AGENT: "Works the inbox, runs campaigns, cannot change guardrails",
  VIEWER: "Reads everything, sends nothing",
};

/** An unknown role reads as itself rather than vanishing or throwing. */
export function workspaceRoleWord(role: string): string {
  return WORKSPACE_ROLE_WORD[role] ?? role;
}

export function workspaceRoleScope(role: string): string {
  return WORKSPACE_ROLE_SCOPE[role] ?? "";
}

/* --------------------------------------------------------------- invites */

/**
 * The role an invite carries. The shipped `Role` enum is the vocabulary —
 * OWNER is deliberately not invitable: ownership transfers, it is not handed
 * out by email.
 */
export const invitableRoleSchema = z.enum(["ADMIN", "AGENT", "VIEWER"]);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;

export const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: invitableRoleSchema,
});
export type CreateInviteDto = z.infer<typeof createInviteSchema>;

/** Seven days, stated in the completion toast and enforced server-side. */
export const INVITE_TTL_DAYS = 7;

export const memberRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "AGENT", "VIEWER"]),
});
export type MemberRoleDto = z.infer<typeof memberRoleSchema>;

/* --------------------------------------------------------------- numbers */

/** What a requested number should carry. */
export const numberCarriesSchema = z.enum(["sms", "sms_voice"]);
export type NumberCarries = z.infer<typeof numberCarriesSchema>;

export const createNumberRequestSchema = z.object({
  /** Three digits — local numbers get answered more often. */
  areaCode: z.string().trim().regex(/^\d{3}$/, "An area code is three digits"),
  carries: numberCarriesSchema,
});
export type CreateNumberRequestDto = z.infer<typeof createNumberRequestSchema>;

/* -------------------------------------------------------------- warm-up */

/**
 * The warm-up pace chosen when an email sender is added. The ramp itself is
 * the shipped curve; the choice records which pace the owner asked for.
 */
export const warmupPaceSchema = z.enum(["careful", "standard", "fast"]);
export type WarmupPace = z.infer<typeof warmupPaceSchema>;

export const WARMUP_PACES: ReadonlyArray<{
  key: WarmupPace;
  title: string;
  detail: string;
  recommended: boolean;
}> = [
  { key: "careful", title: "Careful", detail: "40 a day, about three weeks", recommended: false },
  { key: "standard", title: "Standard", detail: "120 a day, about ten days", recommended: true },
  { key: "fast", title: "Fast", detail: "300 a day, higher bounce risk", recommended: false },
];

/* --------------------------------------------------- credits honesty gate */

/**
 * The credit-price actions that ACTUALLY debit the ledger today.
 *
 * "Where they go" may only draw a bar for a kind that is measured. Every other
 * priced action — email sends, SMS, call minutes, audience syncs — has a price
 * but no debit path, so the surface names them as not-yet-metered instead of
 * drawing a zero bar that looks like a measurement of nothing happening.
 *
 * This list is pinned by a test that reads every `creditLedger.create` reason
 * in the API source, so it cannot quietly drift out of step with the code.
 */
export const METERED_CREDIT_ACTIONS: readonly string[] = ["lead_reveal"];

/**
 * Ledger reasons that are not a priced ACTION at all — a human moving the
 * balance. They belong in the ledger list, never in "where they go".
 */
export const LEDGER_ADJUSTMENT_REASONS: readonly string[] = [
  "backoffice_adjustment",
  "adjustment",
  "topup",
];

/**
 * Days of ledger history a burn rate needs before it means anything. Below
 * this the burn tile, the runway sentence and "runs out" are absent — a
 * projection from three days of data is a fabrication, not an estimate.
 */
export const BURN_MIN_HISTORY_DAYS = 14;
