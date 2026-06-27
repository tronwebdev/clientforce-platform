/**
 * @clientforce/config — shared runtime configuration.
 *
 * T0 stub: only exposes the package name + a constant so the workspace is real
 * and importable. Environment parsing, logging, auth, and telemetry config land
 * in later tickets (see ARCHITECTURE.md §5 `config/`).
 */
export const CONFIG_PACKAGE = "@clientforce/config";

/** Marker that downstream packages/apps can import to confirm wiring. */
export const isConfigured = (): boolean => true;
