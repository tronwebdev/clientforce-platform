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
    // TODO(T4+): signal the enrollment's Temporal workflow to branch.
    void event;
  },
};

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
