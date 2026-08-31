/**
 * Shared browser-suite fixtures.
 *
 * Not a spec: Playwright's default `testMatch` only collects `*.spec.ts` /
 * `*.test.ts`, so this file is imported, never run.
 *
 * It exists because the sign-in identity used to be eighteen copies of one
 * string literal. Changing it meant changing it eighteen times, and any spec
 * written in a parallel branch carried the old value and went red on merge.
 * One constant, one edit.
 */

/**
 * The seeded workspace principal — the practice owner of Bright Smile Dental.
 *
 * It is a business address on purpose (B7.5 approval round, DEC-149 amended): the demo
 * workspace IS Bright Smile, and a `.test` agency identity has no business
 * appearing in a client's own team roster.
 */
export const OWNER_EMAIL = "practice@brightsmile.test";

/** The name that principal renders under, for specs that assert on it. */
export const OWNER_NAME = "Dr. Ines Duarte";
