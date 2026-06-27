/**
 * @clientforce/core — shared domain types.
 *
 * T0 stub. The real domain model (CampaignGraph, Lead, Pipeline, Event,
 * StepContext) lands in T4 and beyond (DATA_MODEL.md §3.1). For now this exports
 * a couple of foundational primitives plus a trivially-testable helper so the
 * package is real, importable, and covered by `pnpm test`.
 */

/** Branded id type used across the domain (cuid in practice — see T1). */
export type Id = string & { readonly __brand: "Id" };

/** The tenancy hierarchy levels (ARCHITECTURE.md §3b). */
export type TenancyLevel = "agency" | "workspace" | "user";

/** Package marker for wiring checks. */
export const CORE_PACKAGE = "@clientforce/core";

/**
 * Narrow an arbitrary string to a branded {@link Id}. Real validation arrives
 * with the data model; this keeps the type honest without runtime cost.
 */
export const asId = (value: string): Id => value as Id;
