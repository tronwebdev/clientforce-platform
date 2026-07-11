/**
 * The three event-bus consumers (ARCHITECTURE.md §3c).
 *
 * Every persisted event fans out to exactly these three hooks:
 *   1. Temporal signal — wake the lead's workflow and branch it.
 *   2. Automations — evaluate When→If→Then rules.
 *   3. Dispatcher — outbound webhooks/Zapier + the analytics warehouse.
 *
 * T2 ships them as no-op stubs; the real handlers land with their subsystems
 * (T4+ for Temporal, the Automations/Integrations tickets for the others).
 */
import type { BusEvent } from "./types";

export interface ConsumerHook {
  readonly name: string;
  handle(event: BusEvent): Promise<void>;
}

export const temporalSignalConsumer: ConsumerHook = {
  name: "temporal-signal",
  async handle(event: BusEvent): Promise<void> {
    // Inert default — apps/worker wires the real signaler via
    // `createTemporalSignalConsumer` (P1.7). Kept as the DEFAULT_CONSUMERS
    // entry so environments without Temporal stay no-op.
    void event;
  },
};

/**
 * The REAL consumer #1 (P1.7): a `*.replied.v1` event with an enrollment wakes
 * that enrollment's CampaignWorkflow — the P1.6 branch `condition()` resolves
 * and routes on the classified intent. The signal function is injected (the
 * events package stays dependency-free of the Temporal client); callers pass
 * `signalEnrollmentReply` bound to a connected client. Signal failures are
 * logged, not thrown — a missing/finished workflow must not dead-letter the
 * event (the Event row is already persisted for the timeline either way).
 *
 * R1 (DEC-074) — `gate`: the injected precedence seam. Bus fan-out is
 * parallel (`Promise.all`), so the campaign-rules evaluator can't order
 * itself before this consumer; instead the gate AWAITS that evaluation and
 * resolves false when a TERMINAL rule action already handled the reply —
 * the graph strategy continuation for that event is then SKIPPED (a contact
 * who tripped "not interested → end campaign" must not still receive the
 * strategy reply). A gate FAILURE fails OPEN (signal proceeds, loudly
 * logged): a rules bug must degrade to pre-R1 behavior, never take down
 * reply handling.
 */
export function createTemporalSignalConsumer(
  signal: (enrollmentId: string, intent: string) => Promise<void>,
  log: (msg: string) => void = console.warn,
  gate?: (event: BusEvent) => Promise<boolean>,
): ConsumerHook {
  return {
    name: "temporal-signal",
    async handle(event: BusEvent): Promise<void> {
      if (!event.type.endsWith(".replied.v1") || !event.enrollmentId) return;
      const intent = (event.payload as { intent?: string }).intent;
      if (!intent) return;
      if (gate) {
        let proceed = true;
        try {
          proceed = await gate(event);
        } catch (err) {
          log(
            `[events] temporal-signal: rules gate failed for event ${event.id} ` +
              `(${err instanceof Error ? err.message : String(err)}) — failing OPEN, signal proceeds`,
          );
        }
        if (!proceed) {
          log(
            `[events] temporal-signal: gated for enrollment ${event.enrollmentId} — ` +
              `a terminal campaign-rule action handled event ${event.id}; graph continuation skipped`,
          );
          return;
        }
      }
      try {
        await signal(event.enrollmentId, intent);
      } catch (err) {
        log(
          `[events] temporal-signal: could not signal enrollment ${event.enrollmentId} ` +
            `(${err instanceof Error ? err.message : String(err)}) — event ${event.id} persisted regardless`,
        );
      }
    },
  };
}

export const automationsConsumer: ConsumerHook = {
  name: "automations",
  async handle(event: BusEvent): Promise<void> {
    // TODO(automations): evaluate When→If→Then rules for this event.
    void event;
  },
};

export const dispatcherConsumer: ConsumerHook = {
  name: "dispatcher",
  async handle(event: BusEvent): Promise<void> {
    // TODO(integrations/analytics): deliver to webhooks/Zapier + roll up metrics.
    void event;
  },
};

/** Default fan-out order for the bus. */
export const DEFAULT_CONSUMERS: ConsumerHook[] = [
  temporalSignalConsumer,
  automationsConsumer,
  dispatcherConsumer,
];
