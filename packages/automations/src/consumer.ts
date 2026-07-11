/**
 * The REAL consumer #2 (R1, DEC-073) — replaces the T2 no-op
 * `automationsConsumer` in the worker's bus wiring, keeping the three-hook
 * fan-out contract (temporal-signal · automations · dispatcher).
 *
 * Precedence seam: bus fan-out is parallel (`Promise.all`), so the rails →
 * rules → graph-continuation order is achieved by MEMOIZING one evaluation
 * per event id — the consumer starts it, and `shouldContinueGraph` (injected
 * as the temporal-signal consumer's gate) awaits the SAME evaluation and
 * answers false when a terminal rule action fired. Whichever hook runs first
 * triggers the evaluation; it runs exactly once per delivery. After the
 * promise settles the memo entry is dropped — a later re-ask (redelivery, or
 * a gate arriving after cleanup) re-evaluates idempotently off the persisted
 * run rows and reaches the same answer.
 *
 * Failure policy: the consumer never throws (a rules bug must not fail the
 * shared bus job and starve the temporal-signal consumer — pre-R1 behavior
 * is the floor); errors log loudly and the gate fails OPEN upstream.
 */
import type { BusEvent, ConsumerHook } from "@clientforce/events";
import { evaluateEventForRules } from "./evaluate";
import type { EvaluationSummary, RuleEngineDeps } from "./types";

export interface PerAgentRules {
  /** Mount in place of the no-op `automationsConsumer` (consumer #2). */
  consumer: ConsumerHook;
  /** The temporal-signal consumer's gate: false = a terminal rule action handled this event. */
  shouldContinueGraph: (event: BusEvent) => Promise<boolean>;
}

export function createPerAgentRules(deps: RuleEngineDeps): PerAgentRules {
  const log = deps.log ?? console.warn;
  const inflight = new Map<string, Promise<EvaluationSummary>>();

  const evaluate = (event: BusEvent): Promise<EvaluationSummary> => {
    const existing = inflight.get(event.id);
    if (existing) return existing;
    const run = evaluateEventForRules(deps, event);
    inflight.set(event.id, run);
    void run.finally(() => inflight.delete(event.id)).catch(() => undefined);
    return run;
  };

  return {
    consumer: {
      name: "automations",
      async handle(event: BusEvent): Promise<void> {
        try {
          await evaluate(event);
        } catch (err) {
          log(
            `[automations] rule evaluation failed for event ${event.id} (${event.type}): ` +
              `${err instanceof Error ? err.message : String(err)} — event persisted regardless`,
          );
        }
      },
    },
    shouldContinueGraph: async (event: BusEvent): Promise<boolean> => {
      const summary = await evaluate(event);
      return !summary.terminalFired;
    },
  };
}
