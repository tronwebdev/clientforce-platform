/**
 * @clientforce/telemetry — product telemetry (B1 W3, DEC-081).
 *
 * Versioned, PII-free product-event catalog + a swappable `TelemetrySink`
 * adapter (default `NoopSink`; self-hosted PostHog when configured) + the
 * event-bus consumer that instruments additively from the domain catalog. The
 * privacy rail (ids + event names only) is enforced by the catalog schemas and
 * the pinned test in `test/privacy.test.ts`. Internal-only.
 */
export * from "./catalog";
export * from "./sink";
export * from "./consumer";
export * from "./record";

export const TELEMETRY_PACKAGE = "@clientforce/telemetry";
