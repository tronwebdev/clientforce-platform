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

// CampaignGraph types, validator, and executor (DATA_MODEL.md §3.1).
export * from "./graph";

// Knowledge REST DTOs (P1.2, A2 — zod schemas shared by api + web).
export * from "./knowledge";

// BusinessContext field registry + DTOs (P1.3, DEC-024/025).
export * from "./context";

// Planner REST DTOs (P1.4).
export * from "./planner";

// Guardrails schema (P1.5, A8) + sender DTOs.
export * from "./guardrails";
export * from "./senders";

// Enrollment DTOs (P1.6).
export * from "./enrollments";

// Agents DTOs (C2.2).
export * from "./agents";

// Contact custom fields (C2.7) — defs, values, {{custom.*}} token grammar.
export * from "./contact-fields";
export * from "./contact-lists";

/**
 * Narrow an arbitrary string to a branded {@link Id}. Real validation arrives
 * with the data model; this keeps the type honest without runtime cost.
 */
export const asId = (value: string): Id => value as Id;
