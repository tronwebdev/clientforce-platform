/**
 * P5 W1 (DEC-083, formula LOCKED by owner 2026-07-15): the sender health
 * engine — a DETERMINISTIC 0–100 score from event-ledger aggregates (rolling
 * 7-day per-sender rates). No AI, and no invented numbers below the sample
 * floor (the F1 statistical-honesty pattern: `SIGNAL_MIN_SENDS` reused — a
 * low-volume sender is "warming / low data", never a fake score).
 *
 * PENALTY MODEL (owner-locked constants in `HEALTH_SIGNALS` — config, not
 * logic): start at 100, subtract each signal's weighted penalty; the penalty
 * scales LINEARLY between the signal's healthy→danger bounds (0 at/below
 * healthy, the full weight at/above danger):
 *   spam-complaint rate — healthy <0.1% · danger >0.3% · weight 40
 *   hard-bounce rate    — healthy <2%   · danger >5%   · weight 30
 *   delivery rate       — healthy >95%  · danger <90%  · weight 20
 *                         (no penalty when NO delivery signal exists in the
 *                         window — missing webhooks must never read as failure)
 *   reply/engagement    — weight 10, BONUS ONLY (adds back up to 10, clamped
 *                         at 100; its absence never drives a pause)
 *
 * Bands (owner-locked cutoffs — the W2 ring states):
 *   healthy ≥ 80 · warming/watch 60–79 · at-risk 40–59 · auto-pause < 40
 * `< 40` is the SENDER_UNHEALTHY refusal threshold — a SHARP line (the
 * four-band model replaces the earlier hysteresis: 40–59 is a sendable
 * at-risk band, not a sticky-paused zone). Below the sample floor → low_data,
 * NEVER gated: a collapsed sender that stops sending drains to low_data after
 * the window passes and may send again (reversibility; DEC-083).
 *
 * SMS senders score on their channel's ledger twins (failed ≈ bounce,
 * opted_out ≈ complaint). Transitions emit catalog events; per-send refusals
 * stay uncataloged (the TENANT_SUSPENDED precedent).
 */
import { Prisma, withTenant, type PrismaClient, type SenderConnection } from "@clientforce/db";
import {
  HEALTH_AUTO_PAUSE_BELOW,
  HEALTH_BANDS,
  healthBandFor,
  outcomeSignal,
  type HealthBand,
  type HealthGateState,
  type OutcomeSignal,
} from "@clientforce/core";
import type { EventType } from "@clientforce/events";

// P5 W2 (DEC-084): the band contract lives in core (one source for the
// engine, the Settings ring, and the B1-W4 fleet view) — re-exported here so
// every W1 import path keeps working.
export { HEALTH_AUTO_PAUSE_BELOW, HEALTH_BANDS, healthBandFor };
export type { HealthBand, HealthGateState };

/** Rolling aggregation window. */
export const HEALTH_WINDOW_DAYS = 7;

/** LOCKED (owner 2026-07-15): per-signal bounds + weights — config constants. */
export const HEALTH_SIGNALS = {
  /** Complaint rate: 0 penalty ≤0.1%, full 40 ≥0.3%. */
  spam: { healthy: 0.001, danger: 0.003, weight: 40 },
  /** Hard-bounce rate: 0 penalty ≤2%, full 30 ≥5%. */
  bounce: { healthy: 0.02, danger: 0.05, weight: 30 },
  /** Delivery rate (higher is better): 0 penalty ≥95%, full 20 ≤90%. */
  delivery: { healthy: 0.95, danger: 0.9, weight: 20 },
  /** Engagement bonus: up to +10 at ≥2% reply rate — never a penalty. */
  reply: { weight: 10, fullAt: 0.02 },
} as const;

export interface LedgerSample {
  sent: number;
  delivered: number;
  bounced: number;
  spam: number;
  replied: number;
}

export interface HealthComputation {
  /** 0–100, or null below the sample floor (never a fake score). */
  score: number | null;
  state: HealthGateState;
  /** Owner-locked display band; null below the sample floor. */
  band: HealthBand | null;
  /** F1 min-n gate over `sent`: none <20 · low 20–49 · ok ≥50. */
  floor: OutcomeSignal;
  /** Rates over `sent`; null below the floor (no fake precision either). */
  rates: { bounce: number; spam: number; delivery: number | null; reply: number } | null;
}

/** Persisted shape of `SenderConnection.healthState`. */
export interface HealthSnapshot extends HealthComputation {
  v: 1;
  windowDays: number;
  computedAt: string;
  sample: LedgerSample;
  /** Set when the sender entered `unhealthy`; cleared on recovery/drain. */
  collapsedAt?: string;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Pure score math — fixture-tested, the single computation both tenant land and the backoffice consume. */
export function computeSenderHealth(sample: LedgerSample): HealthComputation {
  const floor = outcomeSignal(sample.sent);
  if (floor === "none") {
    // Below the sample floor there is no honest score — and no gate: low_data
    // must never refuse, or a fresh sender could never earn a sample.
    return { score: null, state: "low_data", band: null, floor, rates: null };
  }

  const bounceRate = sample.bounced / sample.sent;
  const spamRate = sample.spam / sample.sent;
  const replyRate = sample.replied / sample.sent;
  const deliverySignal = sample.delivered + sample.bounced > 0;
  const deliveryRate = deliverySignal ? sample.delivered / sample.sent : null;

  const { spam, bounce, delivery, reply } = HEALTH_SIGNALS;
  const spamPenalty = spam.weight * clamp01((spamRate - spam.healthy) / (spam.danger - spam.healthy));
  const bouncePenalty =
    bounce.weight * clamp01((bounceRate - bounce.healthy) / (bounce.danger - bounce.healthy));
  const deliveryPenalty =
    deliveryRate === null
      ? 0 // no delivery signal in the window — never penalize missing instrumentation
      : delivery.weight * clamp01((delivery.healthy - deliveryRate) / (delivery.healthy - delivery.danger));
  const replyBonus = reply.weight * clamp01(replyRate / reply.fullAt);

  const score = Math.round(
    Math.min(100, Math.max(0, 100 - spamPenalty - bouncePenalty - deliveryPenalty + replyBonus)),
  );
  const band = healthBandFor(score);

  return {
    score,
    state: band === "paused" ? "unhealthy" : "healthy",
    band,
    floor,
    rates: { bounce: bounceRate, spam: spamRate, delivery: deliveryRate, reply: replyRate },
  };
}

/** Defensive parse of the persisted snapshot (unknown Json in, typed out). */
export function parseHealthState(raw: unknown): HealthSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = raw as Record<string, unknown>;
  if (state.v !== 1) return null;
  if (state.state !== "healthy" && state.state !== "unhealthy" && state.state !== "low_data") return null;
  return state as unknown as HealthSnapshot;
}

/** Ledger event types feeding each channel's sample. */
const LEDGER_TYPES: Record<
  "email" | "sms",
  { bounced: EventType; spam: EventType; delivered: EventType; replied: EventType }
> = {
  email: {
    bounced: "email.bounced.v1",
    spam: "email.spam.v1",
    delivered: "email.delivered.v1",
    replied: "email.replied.v1",
  },
  // SMS twins: carrier failure ≈ bounce, STOP/opt-out ≈ complaint.
  sms: {
    bounced: "sms.failed.v1",
    spam: "sms.opted_out.v1",
    delivered: "sms.delivered.v1",
    replied: "sms.replied.v1",
  },
};

export function senderLedgerChannel(sender: Pick<SenderConnection, "type">): "email" | "sms" {
  return sender.type === "TWILIO_SMS" ? "sms" : "email";
}

/** Windowed per-sender aggregates off the denormalized `senderId` columns. */
export async function loadSenderLedgerSample(
  prisma: PrismaClient,
  params: { workspaceId: string; senderId: string; channel: "email" | "sms"; now: Date },
): Promise<LedgerSample> {
  const since = new Date(params.now.getTime() - HEALTH_WINDOW_DAYS * 86_400_000);
  const types = LEDGER_TYPES[params.channel];
  const [sent, grouped] = await withTenant(prisma, { workspaceId: params.workspaceId }, (tx) =>
    Promise.all([
      tx.message.count({
        where: {
          workspaceId: params.workspaceId,
          senderId: params.senderId,
          channel: params.channel,
          direction: "OUTBOUND",
          sentAt: { gte: since },
        },
      }),
      tx.event.groupBy({
        by: ["type"],
        where: {
          workspaceId: params.workspaceId,
          senderId: params.senderId,
          type: { in: Object.values(types) },
          occurredAt: { gte: since },
        },
        _count: { _all: true },
      }),
    ]),
  );
  const count = (type: EventType): number =>
    grouped.find((g) => g.type === type)?._count._all ?? 0;
  return {
    sent,
    delivered: count(types.delivered),
    bounced: count(types.bounced),
    spam: count(types.spam),
    replied: count(types.replied),
  };
}

export interface HealthRecomputeDeps {
  prisma: PrismaClient;
  /** Bus publisher (`EventBus.publish`-compatible); transitions emit through it. */
  publish: (input: {
    workspaceId: string;
    type: EventType;
    senderId: string;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
  now?: () => Date;
}

export interface HealthRecomputeResult {
  snapshot: HealthSnapshot;
  transition: "collapsed" | "recovered" | null;
}

/**
 * Recompute one sender's health from the ledger, persist the snapshot, and
 * emit the transition events (collapse / recovery) exactly once — the persist
 * is guarded on the prior state so a webhook-fast-path/sweep race can't
 * double-emit. Called by the worker sweep (cadence) and the SendGrid webhook
 * path (immediate collapse on bounce/spam).
 */
export async function recomputeSenderHealth(
  deps: HealthRecomputeDeps,
  params: { workspaceId: string; senderId: string },
): Promise<HealthRecomputeResult | null> {
  const now = deps.now?.() ?? new Date();
  const sender = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.senderConnection.findFirst({ where: { id: params.senderId, workspaceId: params.workspaceId } }),
  );
  if (!sender) return null;

  const prior = parseHealthState(sender.healthState);
  const channel = senderLedgerChannel(sender);
  const sample = await loadSenderLedgerSample(deps.prisma, {
    workspaceId: params.workspaceId,
    senderId: params.senderId,
    channel,
    now,
  });
  const computed = computeSenderHealth(sample);

  const snapshot: HealthSnapshot = {
    v: 1,
    ...computed,
    windowDays: HEALTH_WINDOW_DAYS,
    computedAt: now.toISOString(),
    sample,
    ...(computed.state === "unhealthy" ? { collapsedAt: prior?.collapsedAt ?? now.toISOString() } : {}),
  };

  const transitioned =
    prior?.state !== computed.state
      ? computed.state === "unhealthy"
        ? ("collapsed" as const)
        : prior?.state === "unhealthy"
          ? ("recovered" as const)
          : null
      : null;

  // Guarded persist: on a transition, only the writer that still sees the
  // prior state lands it (and owns the emission); racers see count 0.
  const updated = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.senderConnection.updateMany({
      where: {
        id: params.senderId,
        workspaceId: params.workspaceId,
        ...(transitioned && prior
          ? { healthState: { path: ["state"], equals: prior.state } }
          : {}),
      },
      data: { healthState: snapshot as unknown as Prisma.InputJsonValue },
    }),
  );
  if (updated.count === 0) return { snapshot, transition: null };

  if (transitioned === "collapsed" && snapshot.score !== null) {
    await deps.publish({
      workspaceId: params.workspaceId,
      type: "sender.health_collapsed.v1",
      senderId: params.senderId,
      payload: {
        senderId: params.senderId,
        score: snapshot.score,
        windowDays: HEALTH_WINDOW_DAYS,
        ...(snapshot.rates
          ? { bounceRate: snapshot.rates.bounce, spamRate: snapshot.rates.spam }
          : {}),
      },
    });
  } else if (transitioned === "recovered") {
    // Recovery covers both real recovery (score ≥ 55) and the window draining
    // to low_data — either way the gate is open again; the payload says which.
    await deps.publish({
      workspaceId: params.workspaceId,
      type: "sender.health_recovered.v1",
      senderId: params.senderId,
      payload: {
        senderId: params.senderId,
        windowDays: HEALTH_WINDOW_DAYS,
        ...(snapshot.score !== null ? { score: snapshot.score } : {}),
        lowData: snapshot.state === "low_data",
      },
    });
  }

  return { snapshot, transition: transitioned };
}
