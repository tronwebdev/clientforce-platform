/**
 * P5 W1 (DEC-083): the warmup scheduler — an age-based daily-cap ramp per
 * sender, as config constants (owner sign-off on the PR plan comment).
 *
 * Warmup is TRIGGERED, never retroactive (DEC-019): it rides
 * `SenderConnection.warmupState.startedAt`, which the create endpoint stamps
 * on NEW senders. A sender without `warmupState.startedAt` (every sender that
 * predates this unit) has NO ramp — its send behavior is byte-identical to
 * pre-W1, regression-pinned. DEC-019's re-warm triggers (idle domain, volume
 * jump, health breach) are future writers of the same `startedAt` field.
 *
 * The curve: a geometric ramp from `WARMUP_START_PCT` of the sender's
 * configured daily limit on day 1 to 100% of it on day `WARMUP_DAYS` — the
 * canon length (Settings prototype: "Day 18 of 45"). The effective boundary
 * cap is min(warmup cap, configured daily limit): both checks run in
 * `assertUnderCaps`, so whichever is lower refuses first (`DAILY_CAP_REACHED`,
 * existing reason — no enum fork for caps).
 */
import { Prisma, withTenant, type PrismaClient, type SenderConnection } from "@clientforce/db";
import type { EventType } from "@clientforce/events";

/** Curve length in days — the prototype canon ("Day N of 45"). */
export const WARMUP_DAYS = 45;
/** Day-1 cap as a fraction of the sender's configured daily limit. */
export const WARMUP_START_PCT = 0.02;
/** Absolute floor so tiny limits still get a usable day-1 allowance. */
export const WARMUP_MIN_CAP = 10;
/** Identifies the curve constants a sender ramped under. */
export const WARMUP_CURVE_VERSION = "v1";

/** Shape of `SenderConnection.warmupState` this unit reads/writes. */
export interface WarmupState {
  /** ISO timestamp the ramp started (creation, or a future re-warm). */
  startedAt?: string;
  /** Curve the ramp runs under (constants above). */
  curve?: string;
  /** ISO timestamp the ramp finished — stamped once by the worker sweep. */
  completedAt?: string;
}

export function parseWarmupState(raw: unknown): WarmupState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = raw as Record<string, unknown>;
  return {
    ...(typeof state.startedAt === "string" ? { startedAt: state.startedAt } : {}),
    ...(typeof state.curve === "string" ? { curve: state.curve } : {}),
    ...(typeof state.completedAt === "string" ? { completedAt: state.completedAt } : {}),
  };
}

/** 1-based warmup day for a started ramp (day 1 = the first 24h). */
export function warmupDay(startedAt: Date, now: Date): number {
  const elapsed = now.getTime() - startedAt.getTime();
  if (elapsed < 0) return 1;
  return Math.floor(elapsed / 86_400_000) + 1;
}

/**
 * The curve itself: cap for a 1-based day against a target daily limit.
 * Geometric from `WARMUP_START_PCT` → 100% over `WARMUP_DAYS`; monotonic
 * non-decreasing; never above target, never below `WARMUP_MIN_CAP` (but
 * always clamped to target so tiny limits stay honored).
 */
export function warmupCurveCap(day: number, target: number): number | null {
  if (day > WARMUP_DAYS) return null; // ramp complete — configured limit rules alone
  const boundedDay = Math.max(1, day);
  const pct = WARMUP_START_PCT * Math.pow(1 / WARMUP_START_PCT, (boundedDay - 1) / (WARMUP_DAYS - 1));
  return Math.min(target, Math.max(WARMUP_MIN_CAP, Math.ceil(target * pct)));
}

export interface ActiveWarmup {
  day: number;
  days: number;
  cap: number;
  target: number;
}

/**
 * The boundary's question: is this sender ramping right now, and at what cap?
 * `null` = no active ramp (never started, complete, or aged out) — the
 * configured daily limit is the only sender cap.
 */
export function warmupCapFor(
  sender: Pick<SenderConnection, "warmupState" | "dailyLimit">,
  now: Date,
): ActiveWarmup | null {
  const state = parseWarmupState(sender.warmupState);
  if (!state?.startedAt) return null;
  if (state.completedAt) return null;
  const started = new Date(state.startedAt);
  if (Number.isNaN(started.getTime())) return null;
  const day = warmupDay(started, now);
  const cap = warmupCurveCap(day, sender.dailyLimit);
  if (cap === null) return null;
  return { day, days: WARMUP_DAYS, cap, target: sender.dailyLimit };
}

/** UI/API projection — active ramp, completed ramp, or no ramp at all. */
export interface WarmupProgress {
  active: boolean;
  day: number;
  days: number;
  /** Today's curve cap while active; the configured limit once done. */
  currentCap: number;
  target: number;
  /** Schedule progress (day/days), what the canon bar renders. */
  pct: number;
  startedAt: string;
  completedAt?: string;
}

export function warmupProgressFor(
  sender: Pick<SenderConnection, "warmupState" | "dailyLimit">,
  now: Date,
): WarmupProgress | null {
  const state = parseWarmupState(sender.warmupState);
  if (!state?.startedAt) return null;
  const started = new Date(state.startedAt);
  if (Number.isNaN(started.getTime())) return null;
  const day = Math.min(warmupDay(started, now), WARMUP_DAYS);
  const active = !state.completedAt && warmupCurveCap(warmupDay(started, now), sender.dailyLimit) !== null;
  return {
    active,
    day,
    days: WARMUP_DAYS,
    currentCap: active ? (warmupCurveCap(day, sender.dailyLimit) ?? sender.dailyLimit) : sender.dailyLimit,
    target: sender.dailyLimit,
    pct: Math.round((day / WARMUP_DAYS) * 100),
    startedAt: state.startedAt,
    ...(state.completedAt ? { completedAt: state.completedAt } : {}),
  };
}

/** `warmupState` value the create endpoint stamps on a NEW sender. */
export function initialWarmupState(now: Date): WarmupState {
  return { startedAt: now.toISOString(), curve: WARMUP_CURVE_VERSION };
}

/** Emit `warmup_completed` only for completions this fresh — older ones
 * (worker downtime, senders aging past the curve unobserved) stamp silently
 * instead of back-dating timeline noise. */
export const WARMUP_COMPLETION_EMIT_WINDOW_MS = 48 * 3_600_000;

export interface WarmupCompletionDeps {
  prisma: PrismaClient;
  publish: (input: {
    workspaceId: string;
    type: EventType;
    senderId: string;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
  now?: () => Date;
}

/**
 * Worker-sweep helper: a ramp that has aged past `WARMUP_DAYS` gets its
 * `completedAt` stamped exactly once (derived, not wall-clock — deterministic)
 * and, when the completion is fresh, one `sender.warmup_completed.v1`.
 */
export async function ensureWarmupCompletion(
  deps: WarmupCompletionDeps,
  params: { workspaceId: string; senderId: string },
): Promise<{ completed: boolean; emitted: boolean }> {
  const now = deps.now?.() ?? new Date();
  const sender = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.senderConnection.findFirst({ where: { id: params.senderId, workspaceId: params.workspaceId } }),
  );
  if (!sender) return { completed: false, emitted: false };
  const state = parseWarmupState(sender.warmupState);
  if (!state?.startedAt || state.completedAt) return { completed: false, emitted: false };
  const started = new Date(state.startedAt);
  if (Number.isNaN(started.getTime())) return { completed: false, emitted: false };
  if (warmupDay(started, now) <= WARMUP_DAYS) return { completed: false, emitted: false };

  const completedAt = new Date(started.getTime() + WARMUP_DAYS * 86_400_000);
  const next: WarmupState = { ...state, completedAt: completedAt.toISOString() };
  await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.senderConnection.update({
      where: { id: params.senderId },
      data: { warmupState: next as unknown as Prisma.InputJsonValue },
    }),
  );

  const fresh = now.getTime() - completedAt.getTime() <= WARMUP_COMPLETION_EMIT_WINDOW_MS;
  if (fresh) {
    await deps.publish({
      workspaceId: params.workspaceId,
      type: "sender.warmup_completed.v1",
      senderId: params.senderId,
      payload: { senderId: params.senderId, days: WARMUP_DAYS, target: sender.dailyLimit },
    });
  }
  return { completed: true, emitted: fresh };
}
