/**
 * The telemetry adapter (B1 W3, DEC-081). The provider stays swappable: the sink
 * is the ONLY place a provider is named. Default is `NoopSink` so CI/tests run
 * with the vendor mocked; production sets POSTHOG_HOST + POSTHOG_KEY for the
 * self-hosted PostHog sink (owner-confirmed).
 */
import type { TelemetryType } from "./catalog";

export type ActorType = "operator" | "user" | "system";

/** A ready-to-emit telemetry record — payload already validated PII-free. */
export interface TelemetryRecord {
  name: TelemetryType;
  actorType: ActorType;
  actorId?: string | null;
  workspaceId?: string | null;
  agencyId?: string | null;
  entityId?: string | null;
  props: Record<string, unknown>;
  /** ISO-8601. */
  occurredAt: string;
}

export interface TelemetrySink {
  capture(event: TelemetryRecord): Promise<void> | void;
}

/** The CI/test default — captures nothing (vendor mocked). */
export const NoopSink: TelemetrySink = { capture() {} };

/** Dev: logs event names + ids only (never bodies/PII). */
export const LogSink: TelemetrySink = {
  capture(e) {
    console.log(`[telemetry] ${e.name} ws=${e.workspaceId ?? "-"} actor=${e.actorId ?? "-"}`);
  },
};

type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean }>;

/**
 * Self-hosted PostHog sink — SDK-free: a plain POST to `${host}/capture/`. The
 * `distinct_id` is an id (workspace/actor), never PII. Telemetry must never
 * break the caller, so transport failures are swallowed.
 */
export class PostHogSink implements TelemetrySink {
  constructor(
    private readonly host: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async capture(e: TelemetryRecord): Promise<void> {
    const distinctId = e.workspaceId ?? e.actorId ?? "system";
    const body = JSON.stringify({
      api_key: this.apiKey,
      event: e.name,
      distinct_id: distinctId,
      timestamp: e.occurredAt,
      properties: {
        ...e.props,
        actorType: e.actorType,
        ...(e.agencyId ? { agencyId: e.agencyId } : {}),
        ...(e.entityId ? { entityId: e.entityId } : {}),
      },
    });
    try {
      await this.fetchImpl(`${this.host.replace(/\/$/, "")}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch {
      // swallow — a telemetry outage must never affect the product path
    }
  }
}

/** Resolve the configured sink from env. Noop unless PostHog is configured. */
export function resolveSink(env: NodeJS.ProcessEnv = process.env): TelemetrySink {
  if (env.POSTHOG_HOST && env.POSTHOG_KEY) {
    return new PostHogSink(env.POSTHOG_HOST, env.POSTHOG_KEY);
  }
  if (env.TELEMETRY_LOG === "1") return LogSink;
  return NoopSink;
}
