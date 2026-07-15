/**
 * @clientforce/core — Platform backoffice REST DTOs (B1 W1, DEC-079).
 *
 * The internal operator surface is deliberately cross-tenant; these are the
 * zod-typed request/response contracts shared by `apps/api` and `apps/web`. They
 * carry NO tenant scoping — the backoffice authenticates as platform staff, not
 * as a workspace member.
 */
import { z } from "zod";

/** Platform-staff login (dev-rail HS256; production gates via SSO later). */
export const backofficeLoginSchema = z.object({
  email: z.string().email(),
});
export type BackofficeLoginDto = z.infer<typeof backofficeLoginSchema>;

/** The reason attached to every reversible tenant status change (audited). */
export const backofficeReasonSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type BackofficeReasonDto = z.infer<typeof backofficeReasonSchema>;

/**
 * A manual credit adjustment → exactly one append-only `CreditLedger` row.
 * `delta` is signed (grant or claw-back) and must be non-zero; `reason` is
 * mandatory and lands verbatim on both the ledger row and the audit row.
 */
export const creditAdjustmentSchema = z.object({
  delta: z
    .number()
    .int("delta must be a whole number of credits")
    .refine((n) => n !== 0, "delta must be non-zero"),
  reason: z.string().trim().min(3).max(500),
});
export type CreditAdjustmentDto = z.infer<typeof creditAdjustmentSchema>;

/** Tenant status vocabulary (mirrors DB `TenantStatus`). */
export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type TenantStatusName = (typeof TENANT_STATUSES)[number];

/** Tenant list filters (query params, all optional). */
export const tenantListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
});
export type TenantListQueryDto = z.infer<typeof tenantListQuerySchema>;

/** Audit-log filters. */
export const auditQuerySchema = z.object({
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(64).optional(),
});
export type AuditQueryDto = z.infer<typeof auditQuerySchema>;

export const PLATFORM_STAFF_ROLES = ["OPERATOR", "ADMIN"] as const;
export type PlatformStaffRoleName = (typeof PLATFORM_STAFF_ROLES)[number];

// ── Response shapes (informational; the API returns these) ───────────────────

export interface BackofficeStaff {
  id: string;
  email: string;
  name: string | null;
  role: PlatformStaffRoleName;
}

export interface BackofficeWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatusName;
  creditBalance: number;
  createdAt: string;
  lastActivityAt: string | null;
}

export interface BackofficeAgencyRow {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  status: TenantStatusName;
  createdAt: string;
  lastActivityAt: string | null;
  workspaces: BackofficeWorkspaceRow[];
}

export interface BackofficeAuditRow {
  id: string;
  operatorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
}

// ── B1 W2 (DEC-080): usage · reconciliation · credit-price editor ─────────────

/** A row from the effective-dated `CreditPrice` table (agencyId null = default). */
export interface CreditPriceRow {
  agencyId: string | null;
  action: string;
  credits: number;
  effectiveFrom: string | Date;
}

/**
 * Resolve the effective credit price for `(agencyId, action)` at time `at`:
 * the newest row whose `effectiveFrom <= at`, with a per-agency override beating
 * the platform default (`agencyId = null`). Returns `null` if none applies. Pure
 * — the credit-price editor and any cost estimate read the same rule.
 */
export function resolveCreditPrice(
  rows: CreditPriceRow[],
  opts: { agencyId?: string | null; action: string; at?: Date },
): number | null {
  const atMs = (opts.at ?? new Date()).getTime();
  const agencyId = opts.agencyId ?? null;
  const applicable = rows.filter(
    (r) =>
      r.action === opts.action &&
      new Date(r.effectiveFrom).getTime() <= atMs &&
      (r.agencyId === null || r.agencyId === agencyId),
  );
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => {
    // Agency-specific override wins over the platform default…
    const override = Number(b.agencyId !== null) - Number(a.agencyId !== null);
    if (override !== 0) return override;
    // …then the newest effective date.
    return new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime();
  });
  return applicable[0]!.credits;
}

/** Append an effective-dated credit price (platform default when agencyId null). */
export const creditPriceUpsertSchema = z.object({
  agencyId: z.string().min(1).nullable().optional(),
  action: z.string().trim().min(1).max(60),
  credits: z.number().int().min(0),
  effectiveFrom: z.string().datetime().optional(),
});
export type CreditPriceUpsertDto = z.infer<typeof creditPriceUpsertSchema>;

export const usageQuerySchema = z.object({
  scope: z.enum(["agency", "workspace"]),
  id: z.string().min(1),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type UsageQueryDto = z.infer<typeof usageQuerySchema>;

export const reconciliationQuerySchema = z.object({
  provider: z.string().trim().min(1).max(40).optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM")
    .optional(),
});
export type ReconciliationQueryDto = z.infer<typeof reconciliationQuerySchema>;

export interface UsageRollup {
  scope: "agency" | "workspace";
  id: string;
  from: string;
  to: string;
  sendsByChannel: Record<string, number>;
  voiceMinutes: number;
  /** LH1 (DEC-087): PAID email verifications (platform COGS — free to the
   *  tenant, owner-ruled 2026-07-15; visibility + fair-use, never a charge). */
  emailValidations: number;
  creditBurn: number; // absolute sum of negative ledger deltas
  creditGranted: number; // sum of positive ledger deltas
  aiSpendCredits: null; // honest absence — AI spend is not metered yet
  lowData: boolean; // below the sample floor → don't over-read the numbers
}

// ── B1 W4 (DEC-082): fleet health · kill switch · impersonation · flags ──────

/**
 * The channels the kill switch ENFORCES — deliberately NOT the full send
 * vocabulary. A kill switch is only offered for a channel whose send boundary
 * actually calls `assertChannelLive` (email + SMS today); offering `voice`/
 * `whatsapp` here would ship a silent no-op, since those paths don't gate yet
 * (Q-025, owner ruling 2026-07-15). Each channel RE-ENTERS this list via the
 * ride-along on the PR that wires its boundary rail (voice → P3.2 rail port;
 * WhatsApp → its finish PR) — the CHECKLIST_B1_BACKOFFICE_COVERAGE rule.
 */
export const KILL_SWITCH_CHANNELS = ["email", "sms"] as const;

/** Set/clear a per-agency/per-channel kill switch (audited, reversible). */
export const killSwitchSetSchema = z.object({
  agencyId: z.string().min(1),
  channel: z.enum(KILL_SWITCH_CHANNELS),
  active: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
export type KillSwitchSetDto = z.infer<typeof killSwitchSetSchema>;

export interface KillSwitchRow {
  id: string;
  agencyId: string;
  channel: string;
  active: boolean;
  reason: string;
  updatedAt: string;
}

/** Set a per-tenant feature flag (audited). */
export const featureFlagSetSchema = z.object({
  key: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
});
export type FeatureFlagSetDto = z.infer<typeof featureFlagSetSchema>;

export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  updatedAt: string;
}

/** Start a read-only impersonation session (audited, banner-marked). */
export const impersonateSchema = z.object({
  workspaceId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});
export type ImpersonateDto = z.infer<typeof impersonateSchema>;

/**
 * P5-W1's sender health-score contract (FR-ADMIN-04). The backoffice CONSUMES
 * P5-W1's SHARED `computeSenderHealth` (packages/channels) per sender — it never
 * recomputes the score a second time (DEC-083's rail: "the score math must never
 * fork"). `score`/`status` are P5-W1's outputs verbatim.
 */
export interface SenderHealthScore {
  senderId: string;
  workspaceId: string;
  score: number | null; // 0..100, or null below P5-W1's sample floor (never a fake score)
  status: string; // P5-W1's band: "healthy" | "watch" | "at_risk" | "paused", or "low_data"
}

export interface FleetHealthView {
  // `wired` = P5-W1's computation ran (true since P5-W1 is on main + consumed in-process).
  health: { wired: boolean; scores: SenderHealthScore[] };
  outliers: { agencyId: string; workspaceId: string; metric: string; count: number }[]; // backoffice thresholds
  lowData: boolean;
}

/**
 * A started read-only impersonation session (FR-ADMIN-05). The START is audited
 * (`impersonate.start`); the returned session is banner-marked (`readOnly: true`)
 * and carries NO token or write path to tenant content — the operator only reads.
 */
export interface ImpersonationSession {
  workspaceId: string;
  workspace: { id: string; name: string; slug: string; status: TenantStatusName };
  agency: { id: string; name: string };
  readOnly: true;
  startedAt: string;
  auditId: string;
}

/** One read-only message row in the impersonation viewer (body truncated to a preview). */
export interface ImpersonationMessage {
  id: string;
  channel: string;
  direction: "OUTBOUND" | "INBOUND";
  subject: string | null;
  preview: string;
  sentAt: string;
  contactId: string;
}

/**
 * Model + prompt version-pin visibility (FR-ADMIN-06), READ-ONLY. These pins are
 * platform-global today (model routing is env-overridable per deploy; prompt
 * versions are code constants) — `scope: "platform"` says so honestly rather
 * than implying a per-tenant pin that doesn't exist yet.
 */
export interface VersionPins {
  scope: "platform";
  models: { task: string; model: string }[];
  embeddingModel: string;
  prompts: { name: string; version: number }[];
}

// ── B1 W3 (DEC-081): product telemetry + adoption dashboards ─────────────────

export const adoptionQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AdoptionQueryDto = z.infer<typeof adoptionQuerySchema>;

export interface FunnelStep {
  step: string;
  count: number;
  conversionPct: number | null; // vs the previous step; null for the first / when prior is 0
}

export interface AdoptionSummary {
  from: string;
  to: string;
  funnel: FunnelStep[]; // signup → agent → launch → first send → first reply → goal
  dau: number; // active workspaces in the last 24h
  wau: number; // active workspaces in the last 7d
  featureAdoption: { feature: string; workspaces: number }[];
  lowData: boolean; // below the sample floor → don't over-read the numbers
}

export interface ReconciliationRow {
  provider: string;
  metric: string;
  month: string; // YYYY-MM
  meteredQuantity: number | null; // null = we don't meter this metric yet
  invoiceQuantity: number | null;
  invoiceAmount: number | null; // integer minor units
  variance: number | null; // metered - invoice
  variancePct: number | null;
  matchesInvoice: boolean | null;
}
