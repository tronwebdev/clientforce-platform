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
