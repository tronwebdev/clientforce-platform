/**
 * @clientforce/automations — the shared When→If→Then execution core
 * (R1, DEC-074; ARCHITECTURE.md §151 per-agent rules + §5 monorepo layout).
 * Campaign rules consume it now; the Phase-6 standalone Automations engine
 * (§152) consumes the SAME core — never two evaluators, never two trigger
 * vocabularies. Typed unions live in `@clientforce/core`.
 */
export * from "./types";
export * from "./match";
export * from "./executors";
export * from "./evaluate";
export * from "./consumer";
export * from "./sweep";
export * from "./meeting-sweep";

export const AUTOMATIONS_PACKAGE = "@clientforce/automations";
