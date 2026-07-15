/**
 * The telemetry event-bus consumer (B1 W3, DEC-081) — the 4th `ConsumerHook`,
 * instrumenting product signals ADDITIVELY from the existing domain event
 * catalog (no new emit calls at the send path). Injected-deps pattern (DEC-035):
 * the `record` sink+store writer is passed in, so this package stays free of DB
 * and vendor dependencies. Mapping/record failures never break the bus.
 */
import type { BusEvent, ConsumerHook } from "@clientforce/events";
import { validateTelemetry, type TelemetryType } from "./catalog";
import type { TelemetryRecord } from "./sink";

/** Map a domain event to a telemetry signal (null = not telemetry-relevant). */
export function mapDomainEvent(
  event: BusEvent,
): { name: TelemetryType; props: Record<string, unknown> } | null {
  const channel = event.type.split(".")[0]; // "email" | "sms" | "whatsapp" | …
  if (event.type.endsWith(".sent.v1")) {
    return { name: "product.send.v1", props: { workspaceId: event.workspaceId, channel } };
  }
  if (event.type.endsWith(".replied.v1")) {
    return { name: "product.reply.v1", props: { workspaceId: event.workspaceId, channel } };
  }
  // signup · agent_created · agent_launched · goal · feature/settings actions
  // arrive via thin explicit emit points (they aren't domain bus events).
  return null;
}

export interface TelemetryConsumerDeps {
  record: (r: TelemetryRecord) => Promise<void>;
}

export function createTelemetryConsumer(deps: TelemetryConsumerDeps): ConsumerHook {
  return {
    name: "telemetry",
    async handle(event: BusEvent): Promise<void> {
      const mapped = mapDomainEvent(event);
      if (!mapped) return;
      try {
        // Re-validate against the PII-free schema before it leaves the boundary.
        const props = validateTelemetry(mapped.name, mapped.props) as Record<string, unknown>;
        await deps.record({
          name: mapped.name,
          actorType: "system",
          workspaceId: event.workspaceId,
          props,
          occurredAt: event.occurredAt,
        });
      } catch {
        // A telemetry mapping/validation error must never dead-letter the event.
      }
    },
  };
}
