/**
 * @clientforce/tenancy — the Agency → Workspace → User hierarchy, RBAC, RLS, branding.
 *
 * T0 stub. The real hierarchy, role model, RLS context helpers, and per-request
 * tenant resolution land in T3 (ARCHITECTURE.md §3b).
 */
export const TENANCY_PACKAGE = "@clientforce/tenancy";

/** Roles in the platform (RBAC); enforced in T3. */
export type Role = "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
