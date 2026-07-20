/**
 * @clientforce/validation — LH1 (DEC-087): ONE email-validation spine behind
 * a swappable vendor adapter (ZeroBounce, owner-locked 2026-07-15). Async,
 * never blocking a flow; free filters before every paid call; spend rails
 * that hold honestly instead of billing silently. Every ingress feeds the
 * one enrollment gate — sources never fork the pipeline.
 */
export * from "./constants";
export * from "./types";
export * from "./filters";
export * from "./zerobounce";
export * from "./service";
export * from "./queue";
