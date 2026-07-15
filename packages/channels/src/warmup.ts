/**
 * P5 W1 (DEC-083, curve LOCKED by owner 2026-07-15): the warmup scheduler —
 * a daily-cap ramp per sender, as config TABLES (not hard-coded logic), so
 * the schedule stays tunable without a code change.
 *
 * Warmup is TRIGGERED, never retroactive (DEC-019): it rides
 * `SenderConnection.warmupState.startedAt`, which the create endpoint stamps
 * on NEW senders. A sender without `warmupState.startedAt` (every sender that
 * predates this unit) has NO ramp — its send behavior is byte-identical to
 * pre-W1, regression-pinned. DEC-019's re-warm triggers (idle domain, volume
 * jump, health breach) are future writers of the same `startedAt` field.
 *
 * Curve v2 (owner-locked): an ABSOLUTE schedule — day 1 at 50/day, ~doubling
 * every ~3 days through week 2 (50 → 100 → 250 → 500 → 1,000), then linear to
 * full (10,000) by day 45 (passing the 2,000 / 5,000 milestones en route).
 * The effective boundary cap is min(warmup cap, configured daily limit): both
 * checks run in `assertUnderCaps`, so whichever is lower refuses first
 * (`DAILY_CAP_REACHED`, existing reason — no enum fork for caps).
 *
 * HEALTH INTERLOCK (owner-locked): a complaint/bounce spike mid-warmup HOLDS
 * the current cap — the ramp day stops advancing while a signal sits at/over
 * its DANGER bound, and resumes when it clears. Warmup respects health, not
 * just the calendar. Held time accumulates in `warmupState.heldMs` (+ the
 * open `holdStartedAt`), so the effective day stays deterministic from the
 * persisted row alone.
 */
import { Prisma, withTenant, type PrismaClient, type SenderConnection } from "@clientforce/db";
import type { EventType } from "@clientforce/events";
import { HEALTH_SIGNALS, parseHealthState } from "./health";

/** Curve length in days — also the prototype canon ("Day N of 45"). */
export const WARMUP_DAYS = 45;
/**
 * LOCKED (owner 2026-07-15) — the doubling phase: `[fromDay, cap]` steps,
 * each cap holding until the next step's day.
 */
export const WARMUP_STEP_CAPS: ReadonlyArray<readonly [number, number]> = [
  [1, 50],
  [4, 100],
  [7, 250],
  [10, 500],
  [13, 1_000],
];
/** LOCKED — the linear tail runs from the last step to this by day 45. */
export const WARMUP_FULL_CAP = 10_000;
/** Identifies the curve constants a sender ramped under. */
export const WARMUP_CURVE_VERSION = "v2";

/** Shape of `SenderConnection.warmupState` this unit reads/writes. */
export interface WarmupState {
  /** ISO timestamp the ramp started (creation, or a future re-warm). */
  startedAt?: string;
  /** Curve the ramp runs under (constants above). */
  curve?: string;
  /** ISO timestamp the ramp finished — stamped once by the worker sweep. */
  completedAt?: string;
  /** Health interlock: total ms the ramp has been held so far. */
  heldMs?: number;
  /** Health interlock: ISO start of the currently-open hold, if any. */
  holdStartedAt?: string;
}

export function parseWarmupState(raw: unknown): WarmupState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = raw as Record<string, unknown>;
  return {
    ...(typeof state.startedAt === "string" ? { startedAt: state.startedAt } : {}),
    ...(typeof state.curve === "string" ? { curve: state.curve } : {}),
    ...(typeof state.completedAt === "string" ? { completedAt: state.completedAt } : {}),
    ...(typeof state.heldMs === "number" && state.heldMs >= 0 ? { heldMs: state.heldMs } : {}),
    ...(typeof state.holdStartedAt === "string" ? { holdStartedAt: state.holdStartedAt } : {}),
  };
}

const DAY_MS = 86_400_000;

/** Ramp-effective elapsed ms: wall-clock minus accumulated + open holds. */
function effectiveElapsedMs(state: WarmupState, startedAt: Date, now: Date): number {
  const openHold = state.holdStartedAt ? now.getTime() - new Date(state.holdStartedAt).getTime() : 0;
  const held = (state.heldMs ?? 0) + Math.max(0, openHold);
  return Math.max(0, now.getTime() - startedAt.getTime() - held);
}

/** 1-based warmup day for a started ramp (day 1 = the first 24h). */
export function warmupDay(startedAt: Date, now: Date): number {
  const elapsed = now.getTime() - startedAt.getTime();
  if (elapsed < 0) return 1;
  return Math.floor(elapsed / DAY_MS) + 1;
}

/**
 * Curve v2 cap for a 1-based day: step table through the doubling phase, then
 * linear from the last step's cap to `WARMUP_FULL_CAP` at day `WARMUP_DAYS`.
 * Monotonic non-decreasing; null past the curve (the configured limit rules
 * alone). Callers clamp to the sender's daily limit (min-semantics).
 */
export function warmupCurveCap(day: number, target: number): number | null {
  if (day > WARMUP_DAYS) return null; // ramp complete — configured limit rules alone
  const boundedDay = Math.max(1, day);
  const lastStep = WARMUP_STEP_CAPS[WARMUP_STEP_CAPS.length - 1]!;
  let cap: number;
  if (boundedDay >= lastStep[0]) {
    cap = Math.round(
      lastStep[1] + ((WARMUP_FULL_CAP - lastStep[1]) * (boundedDay - lastStep[0])) / (WARMUP_DAYS - lastStep[0]),
    );
  } else {
    cap = WARMUP_STEP_CAPS[0]![1];
    for (const [fromDay, stepCap] of WARMUP_STEP_CAPS) {
      if (boundedDay >= fromDay) cap = stepCap;
    }
  }
  return Math.min(target, cap);
}

export interface ActiveWarmup {
  day: number;
  days: number;
  cap: number;
  target: number;
  /** True while the health interlock is holding the ramp at this cap. */
  holding: boolean;
}

/** Hold-aware 1-based ramp day for a parsed state (day 1 = the first 24h). */
export function warmupEffectiveDay(state: WarmupState, startedAt: Date, now: Date): number {
  return Math.floor(effectiveElapsedMs(state, startedAt, now) / DAY_MS) + 1;
}

/**
 * The boundary's question: is this sender ramping right now, and at what cap?
 * `null` = no active ramp (never started, complete, or aged out) — the
 * configured daily limit is the only sender cap. The day is HOLD-AWARE: a
 * ramp held by the health interlock stays on its current day/cap.
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
  const day = warmupEffectiveDay(state, started, now);
  const cap = warmupCurveCap(day, sender.dailyLimit);
  if (cap === null) return null;
  return { day, days: WARMUP_DAYS, cap, target: sender.dailyLimit, holding: Boolean(state.holdStartedAt) };
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
  /** Health interlock: the ramp is currently held at this day/cap. */
  holding: boolean;
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
  const effectiveDay = warmupEffectiveDay(state, started, now);
  const day = Math.min(effectiveDay, WARMUP_DAYS);
  const active = !state.completedAt && warmupCurveCap(effectiveDay, sender.dailyLimit) !== null;
  return {
    active,
    day,
    days: WARMUP_DAYS,
    currentCap: active ? (warmupCurveCap(day, sender.dailyLimit) ?? sender.dailyLimit) : sender.dailyLimit,
    target: sender.dailyLimit,
    pct: Math.round((day / WARMUP_DAYS) * 100),
    holding: active && Boolean(state.holdStartedAt),
    startedAt: state.startedAt,
    ...(state.completedAt ? { completedAt: state.completedAt } : {}),
  };
}

/**
 * The health interlock (owner-locked): called right after a health recompute
 * (worker sweep + webhook fast path). A SPIKE = a measured complaint or
 * hard-bounce rate at/over its DANGER bound. Spike on an active ramp → open a
 * hold (the ramp day freezes); spike cleared (or no longer measurable — the
 * window drained below the floor) → close it, accumulating the held time.
 * Deterministic from the persisted rows alone; idempotent per state.
 */
export async function applyWarmupHealthInterlock(
  deps: { prisma: PrismaClient; now?: () => Date },
  params: { workspaceId: string; senderId: string },
): Promise<{ holding: boolean; changed: boolean }> {
  const now = deps.now?.() ?? new Date();
  const sender = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.senderConnection.findFirst({ where: { id: params.senderId, workspaceId: params.workspaceId } }),
  );
  if (!sender) return { holding: false, changed: false };
  const state = parseWarmupState(sender.warmupState);
  if (!state?.startedAt || state.completedAt) return { holding: false, changed: false };
  const started = new Date(state.startedAt);
  if (Number.isNaN(started.getTime())) return { holding: false, changed: false };
  if (warmupCurveCap(warmupEffectiveDay(state, started, now), sender.dailyLimit) === null) {
    return { holding: false, changed: false }; // ramp already past the curve
  }

  const health = parseHealthState(sender.healthState);
  const rates = health?.rates ?? null;
  const spike =
    rates !== null &&
    (rates.spam >= HEALTH_SIGNALS.spam.danger || rates.bounce >= HEALTH_SIGNALS.bounce.danger);

  let next: WarmupState | null = null;
  if (spike && !state.holdStartedAt) {
    next = { ...state, holdStartedAt: now.toISOString() };
  } else if (!spike && state.holdStartedAt) {
    const heldMs =
      (state.heldMs ?? 0) + Math.max(0, now.getTime() - new Date(state.holdStartedAt).getTime());
    next = { ...state, heldMs };
    delete next.holdStartedAt;
  }
  if (!next) return { holding: Boolean(state.holdStartedAt), changed: false };

  await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.senderConnection.update({
      where: { id: params.senderId },
      data: { warmupState: next as unknown as Prisma.InputJsonValue },
    }),
  );
  return { holding: Boolean(next.holdStartedAt), changed: true };
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
  // Hold-aware: a held ramp completes later by exactly its held time.
  if (warmupEffectiveDay(state, started, now) <= WARMUP_DAYS) return { completed: false, emitted: false };

  const completedAt = new Date(started.getTime() + (state.heldMs ?? 0) + WARMUP_DAYS * DAY_MS);
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
