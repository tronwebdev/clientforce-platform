/**
 * Tenant-side feature-flag read contract (B0, Console Bold port).
 *
 * `FeatureFlag` rows are backoffice-WRITTEN (B1 W4, DEC-082) and app-READABLE
 * by design — the W4 migration kept SELECT for `clientforce_app` precisely so
 * "the app reads FeatureFlag to gate features". This adds the first tenant
 * read: `GET /flags` returns the enabled keys for the active workspace.
 * Additive only — the backoffice write path and DTOs are untouched.
 */

/** The Console Bold parallel-route flag (ADDENDUM_4_BOLD §9; default off). */
export const CONSOLE_BOLD_FLAG = "consoleBold";

/** B4 (DEC-124): the receptionist add-on's availability gate — backoffice
 *  flipped like every FeatureFlag. Gates the receptionist panel; the rail
 *  and dock keep the add-on's pitch either way. */
export const RECEPTIONIST_FLAG = "receptionist";

/** Shape returned by the API's GET /flags. */
export interface WorkspaceFlagsResponse {
  /** Enabled flag keys for the active workspace (disabled/absent keys omitted). */
  flags: string[];
}
