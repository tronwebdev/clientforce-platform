/**
 * LH1 (DEC-087) — owner-locked validation config tables (the WARMUP_STEP_CAPS
 * precedent: constants in the owning package, env-overridable where ops needs
 * a dial, never scattered inline).
 *
 * Cost stance (owner-ruled 2026-07-15): CSV validation is FREE to tenants —
 * platform COGS, managed by visibility (B1-W2 usage/reconciliation) + the
 * fair-use rails below, never a tenant charge. Sends stay the billable act.
 */

const envInt = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
};

/** Verdict cache TTL — re-imports/re-enrolls inside it never re-bill. */
export const VALIDATION_VERDICT_TTL_DAYS = 90;

/**
 * Per-workspace daily validation allowance (a THROTTLE, never a charge) —
 * beyond it jobs queue to the next UTC day with the honest "validation
 * queued" state. Generous: ~25k/day covers any sane single-day import while
 * bounding a runaway tenant. Proposal ratified at the plan comment.
 */
export const VALIDATION_DAILY_ALLOWANCE = envInt("VALIDATION_DAILY_ALLOWANCE", 25_000);

/**
 * Modeled provider cost per PAID verification, in USD micros. ZeroBounce
 * lists ~$0.007–0.01 by volume tier; the meter models $0.008 and B1-W2
 * reconciliation vs the real ZeroBounce invoice catches drift — that is
 * exactly what reconciliation is for.
 */
export const VALIDATION_COST_PER_CHECK_MICROS = envInt("VALIDATION_COST_PER_CHECK_MICROS", 8_000);

/**
 * Platform-wide daily validation spend ceiling (USD) — the vendor-spine
 * spend rail. Breach pauses NEW validation jobs (contacts stay `unverified`
 * + held at the gate, honest "validation queued" state, typed Logs row,
 * cost alert fires) — never silent, never blocks sends of already-valid
 * contacts. $400/day ≈ 50k verifications at the modeled cost — two maxed
 * workspace allowances. Proposal ratified at the plan comment.
 */
export const VALIDATION_SPEND_CEILING_USD = envInt("VALIDATION_SPEND_CEILING_USD", 400);

/** Ceiling expressed in checks, derived from the modeled per-check cost. */
export const validationCeilingChecks = (): number =>
  Math.floor((VALIDATION_SPEND_CEILING_USD * 1_000_000) / VALIDATION_COST_PER_CHECK_MICROS);

/** Items resolved per queue turn — one self-requeueing job per batch means
 *  concurrent batches interleave chunk-by-chunk (queue fairness). */
export const VALIDATION_CHUNK_SIZE = envInt("VALIDATION_CHUNK_SIZE", 500);

/** Max RUNNING batches per workspace — one tenant's pile-up of imports
 *  cannot occupy every worker slot (its excess batches stay `queued`). */
export const VALIDATION_WORKSPACE_CONCURRENCY = envInt("VALIDATION_WORKSPACE_CONCURRENCY", 2);

/** Addresses per ZeroBounce batch-API request (the adapter chunks itself). */
export const ZEROBOUNCE_BATCH_MAX = 100;

/** Chunk-claim lease — a crashed worker's batch is retryable after this. */
export const VALIDATION_CLAIM_LEASE_MS = 5 * 60_000;

/** MX lookup timebox — past it the check is UNKNOWN and fails OPEN to the
 *  provider (a slow resolver must never mint an `invalid`). */
export const VALIDATION_MX_TIMEOUT_MS = envInt("VALIDATION_MX_TIMEOUT_MS", 3_000);
