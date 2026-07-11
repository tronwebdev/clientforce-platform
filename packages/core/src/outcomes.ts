/**
 * Outcome feedback v1 (F1, DEC-068) — pure per-step aggregation over the send
 * ledger (`Message`, the A6 store — `email.sent.v1` is catalog-only, nothing
 * emits it) joined with engagement `Event` rows, with statistical honesty
 * baked into the RESULT, not the UI: below `SIGNAL_MIN_SENDS.low` sends a
 * step's rates are `null` and its signal is `"none"` — no caller can render
 * a rate the data can't support.
 *
 * Everything here is prisma-free and unit-tested; the row loader that feeds
 * it lives in `@clientforce/planner` (`loadCampaignOutcomes`) and is shared
 * by the rollup endpoint AND the outcome-aware regen prompt, so both cite
 * literally the same numbers.
 */
import { z } from "zod";

// ── Signal thresholds (statistical honesty gates — constants, tested) ───────
export const SIGNAL_MIN_SENDS = { low: 20, ok: 50 } as const;

export const OUTCOME_SIGNALS = ["none", "low", "ok"] as const;
export const outcomeSignalSchema = z.enum(OUTCOME_SIGNALS);
export type OutcomeSignal = z.infer<typeof outcomeSignalSchema>;

/** `< 20 → "none"` · `20–49 → "low"` · `≥ 50 → "ok"`. */
export function outcomeSignal(sent: number): OutcomeSignal {
  if (sent >= SIGNAL_MIN_SENDS.ok) return "ok";
  if (sent >= SIGNAL_MIN_SENDS.low) return "low";
  return "none";
}

// ── Attribution rules (F1 charter — constants, edge-tested) ─────────────────
export const ATTRIBUTION_RULES = {
  /** A reply attributes to the LAST-SENT step: the thread pointer the existing
   *  threading resolved (`inReplyToId`), falling back to the latest outbound
   *  in the same enrollment (else to the same contact) sent before the reply. */
  reply: "last-sent-step",
  /** Goal completion attributes to the SEQUENCE only — never a single step. */
  goal: "sequence",
} as const;

// ── Counting vocabulary (documented defaults — flagged on the F1 plan) ──────
/** Intents that count as a positive reply (today's emitted positive set;
 *  `booked` is retired from emission by M1b but historical rows stay honest). */
export const POSITIVE_INTENTS = ["interested", "booked"] as const;
/** An unsubscribe reply is an opt-out demand, not engagement (DEC-034:
 *  side-effect label) — it counts in `optOuts`, never in `replies`. */
export const REPLY_EXCLUDED_INTENTS = ["unsubscribe"] as const;
/** Channels with delivery telemetry wired today. Steps on other channels
 *  report `delivered: null` (untracked), never a fake 0. */
export const DELIVERY_TRACKED_CHANNELS = ["email"] as const;

/** Event types the rollup consumes (version-pinned names — A9). `sms.replied.v1`
 *  is included for forward-compat although P1.7 currently rides every reply on
 *  `email.replied.v1`; `sms.opted_out.v1` is deliberately absent — it is always
 *  accompanied by a `lead.unsubscribed.v1` and counting both would double. */
export const OUTCOME_EVENT_TYPES = {
  delivered: ["email.delivered.v1", "sms.delivered.v1", "whatsapp.delivered.v1"],
  replied: ["email.replied.v1", "sms.replied.v1", "whatsapp.replied.v1"],
  optOut: ["lead.unsubscribed.v1"],
  goal: ["lead.stage_changed.v1"],
} as const;

// ── Input rows (plain objects — the loader selects exactly these fields) ────
export interface OutcomeStepRef {
  stepNodeId: string;
  channel: string;
}

export interface OutcomeOutboundRow {
  id: string;
  stepNodeId: string | null;
  contactId: string;
  enrollmentId: string | null;
  sentAt: Date;
}

export interface OutcomeInboundRow {
  id: string;
  inReplyToId: string | null;
  intent: string | null;
  contactId: string;
  enrollmentId: string | null;
  sentAt: Date;
}

export interface OutcomeEventRow {
  id: string;
  type: string;
  payload: unknown;
  contactId: string | null;
  enrollmentId: string | null;
  occurredAt: Date;
}

export interface ComputeOutcomesInput {
  /** The CURRENT graph's step nodes, in graph order — every one gets a row
   *  (zero-filled); sends on stepNodeIds no longer in the graph fold into
   *  totals only (a removed step can't render a card). */
  steps: OutcomeStepRef[];
  outbound: OutcomeOutboundRow[];
  inbound: OutcomeInboundRow[];
  events: OutcomeEventRow[];
}

// ── Result DTO (zod — shared by the endpoint, the web, and the regen block) ─
export const stepOutcomesSchema = z.object({
  stepNodeId: z.string(),
  channel: z.string(),
  sent: z.number().int(),
  /** null = delivery not tracked for this channel yet. */
  delivered: z.number().int().nullable(),
  /** Distinct leads whose reply attributed to this step (a thread's
   *  back-and-forth is one replier, not five replies). */
  replies: z.number().int(),
  positiveReplies: z.number().int(),
  /** Distinct leads whose opt-out attributed to this step. */
  optOuts: z.number().int(),
  /** 1-decimal percents over `sent`; null below the min-n floor. */
  replyRatePct: z.number().nullable(),
  positiveRatePct: z.number().nullable(),
  optOutRatePct: z.number().nullable(),
  signal: outcomeSignalSchema,
});
export type StepOutcomes = z.infer<typeof stepOutcomesSchema>;

export const outcomeTotalsSchema = stepOutcomesSchema
  .omit({ stepNodeId: true, channel: true })
  .extend({
    /** Distinct enrollments that reached the goal — SEQUENCE attribution,
     *  never present on a step row (ATTRIBUTION_RULES.goal). */
    goalCompletions: z.number().int(),
  });
export type OutcomeTotals = z.infer<typeof outcomeTotalsSchema>;

export const campaignOutcomesSchema = z.object({
  agentId: z.string(),
  campaignId: z.string().nullable(),
  graphVersion: z.number().int().nullable(),
  thresholds: z.object({ low: z.number().int(), ok: z.number().int() }),
  steps: z.array(stepOutcomesSchema),
  totals: outcomeTotalsSchema,
});
export type CampaignOutcomes = z.infer<typeof campaignOutcomesSchema>;

/** Percent with one decimal, or null on a zero denominator. */
function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function payloadOf(event: OutcomeEventRow): Record<string, unknown> {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

/**
 * The whole F1 aggregation as one pure function. Attribution:
 * - delivered → `payload.messageId` → outbound's stepNodeId;
 * - replies   → `payload.messageId` = INBOUND message → its `inReplyToId`
 *   (the existing threading resolution) → outbound's stepNodeId; thread
 *   pointer missing → latest outbound in the same enrollment (else to the
 *   same contact) sent at-or-before the reply — i.e. the LAST-SENT step;
 * - opt-outs  → latest outbound in the event's enrollment (else contact)
 *   sent at-or-before the event;
 * - goal      → totals only, deduped per enrollment (else contact).
 * Anything unattributable counts toward totals, never a step.
 */
export function computeOutcomes(input: ComputeOutcomesInput): {
  steps: StepOutcomes[];
  totals: OutcomeTotals;
} {
  const outboundById = new Map(input.outbound.map((m) => [m.id, m]));
  const inboundById = new Map(input.inbound.map((m) => [m.id, m]));

  // Outbound rows sorted once, newest-last, for the last-sent fallback scans.
  const byEnrollment = new Map<string, OutcomeOutboundRow[]>();
  const byContact = new Map<string, OutcomeOutboundRow[]>();
  const sorted = [...input.outbound].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  for (const m of sorted) {
    if (m.enrollmentId) {
      (byEnrollment.get(m.enrollmentId) ?? byEnrollment.set(m.enrollmentId, []).get(m.enrollmentId)!).push(m);
    }
    (byContact.get(m.contactId) ?? byContact.set(m.contactId, []).get(m.contactId)!).push(m);
  }

  /** Latest outbound sent at-or-before `at` for the enrollment (else contact). */
  function lastSentBefore(
    enrollmentId: string | null,
    contactId: string | null,
    at: Date,
  ): OutcomeOutboundRow | null {
    const pool =
      (enrollmentId ? byEnrollment.get(enrollmentId) : undefined) ??
      (contactId ? byContact.get(contactId) : undefined) ??
      [];
    for (let i = pool.length - 1; i >= 0; i--) {
      const row = pool[i]!;
      if (row.sentAt.getTime() <= at.getTime()) return row;
    }
    return null;
  }

  interface Bucket {
    sent: number;
    delivered: number;
    repliers: Set<string>;
    positiveRepliers: Set<string>;
    optOuts: Set<string>;
  }
  const bucket = (): Bucket => ({
    sent: 0,
    delivered: 0,
    repliers: new Set(),
    positiveRepliers: new Set(),
    optOuts: new Set(),
  });
  const perStep = new Map<string, Bucket>(input.steps.map((s) => [s.stepNodeId, bucket()]));
  const unattributed = bucket(); // totals-only bucket (removed steps, broken joins)

  const bucketFor = (stepNodeId: string | null | undefined): Bucket =>
    (stepNodeId && perStep.get(stepNodeId)) || unattributed;

  for (const m of input.outbound) bucketFor(m.stepNodeId).sent += 1;

  // Events, deduped by id (the loader's campaign OR enrollment fetch can overlap).
  const seen = new Set<string>();
  const events = input.events.filter((e) => !seen.has(e.id) && (seen.add(e.id), true));

  const deliveredTypes = new Set<string>(OUTCOME_EVENT_TYPES.delivered);
  const repliedTypes = new Set<string>(OUTCOME_EVENT_TYPES.replied);
  const optOutTypes = new Set<string>(OUTCOME_EVENT_TYPES.optOut);
  const goalTypes = new Set<string>(OUTCOME_EVENT_TYPES.goal);
  const positive = new Set<string>(POSITIVE_INTENTS);
  const replyExcluded = new Set<string>(REPLY_EXCLUDED_INTENTS);

  const goalCompleters = new Set<string>();

  for (const event of events) {
    const payload = payloadOf(event);

    if (deliveredTypes.has(event.type)) {
      const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
      const outbound = messageId ? outboundById.get(messageId) : undefined;
      bucketFor(outbound?.stepNodeId).delivered += 1;
      continue;
    }

    if (repliedTypes.has(event.type)) {
      const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
      const reply = messageId ? inboundById.get(messageId) : undefined;
      if (!reply) continue; // reply event without a ledger row — nothing to count honestly
      const intent = reply.intent ?? (typeof payload.intent === "string" ? payload.intent : null);
      if (intent && replyExcluded.has(intent)) continue; // opt-out demand — counted below
      const threaded = reply.inReplyToId ? outboundById.get(reply.inReplyToId) : undefined;
      const outbound =
        threaded?.stepNodeId != null
          ? threaded
          : lastSentBefore(reply.enrollmentId, reply.contactId, reply.sentAt);
      const target = bucketFor(outbound?.stepNodeId);
      target.repliers.add(reply.contactId);
      if (intent && positive.has(intent)) target.positiveRepliers.add(reply.contactId);
      continue;
    }

    if (optOutTypes.has(event.type)) {
      if (!event.contactId) continue;
      const outbound = lastSentBefore(event.enrollmentId, event.contactId, event.occurredAt);
      bucketFor(outbound?.stepNodeId).optOuts.add(event.contactId);
      continue;
    }

    if (goalTypes.has(event.type)) {
      const isGoal = typeof payload.goalKey === "string" || payload.toStage === "booked";
      if (!isGoal) continue;
      const key = event.enrollmentId ?? event.contactId;
      if (key) goalCompleters.add(key);
    }
  }

  const trackedChannels = new Set<string>(DELIVERY_TRACKED_CHANNELS);

  function finalize(b: Bucket, delivered: number | null): Omit<StepOutcomes, "stepNodeId" | "channel"> {
    const signal = outcomeSignal(b.sent);
    const gated = signal !== "none";
    return {
      sent: b.sent,
      delivered,
      replies: b.repliers.size,
      positiveReplies: b.positiveRepliers.size,
      optOuts: b.optOuts.size,
      replyRatePct: gated ? pct(b.repliers.size, b.sent) : null,
      positiveRatePct: gated ? pct(b.positiveRepliers.size, b.sent) : null,
      optOutRatePct: gated ? pct(b.optOuts.size, b.sent) : null,
      signal,
    };
  }

  const steps: StepOutcomes[] = input.steps.map((s) => {
    const b = perStep.get(s.stepNodeId)!;
    const delivered = trackedChannels.has(s.channel) ? b.delivered : null;
    return { stepNodeId: s.stepNodeId, channel: s.channel, ...finalize(b, delivered) };
  });

  // Totals: per-step buckets + everything unattributable. A contact who
  // replied to two different steps is two step-level repliers but ONE lead
  // in the totals (distinct-lead semantics hold at both levels).
  const total = bucket();
  const buckets = [...perStep.values(), unattributed];
  for (const b of buckets) {
    total.sent += b.sent;
    total.delivered += b.delivered;
    for (const c of b.repliers) total.repliers.add(c);
    for (const c of b.positiveRepliers) total.positiveRepliers.add(c);
    for (const c of b.optOuts) total.optOuts.add(c);
  }
  const anyTracked = input.steps.some((s) => trackedChannels.has(s.channel));
  const totals: OutcomeTotals = {
    ...finalize(total, anyTracked || total.delivered > 0 ? total.delivered : null),
    goalCompletions: goalCompleters.size,
  };

  return { steps, totals };
}
