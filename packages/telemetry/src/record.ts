/**
 * The recorder (B1 W3, DEC-081): dual-writes a telemetry record to a local store
 * (powering the backoffice dashboards + the sample floor) AND forwards it to the
 * configured sink. Both are best-effort — telemetry never breaks the caller.
 */
import { validateTelemetry, type TelemetryType } from "./catalog";
import type { TelemetryRecord, TelemetrySink } from "./sink";

export interface TelemetryStore {
  save(record: TelemetryRecord): Promise<void>;
}

/** A recorder that validates the payload (PII-free) then persists + forwards. */
export function createRecorder(
  sink: TelemetrySink,
  store?: TelemetryStore,
): (record: TelemetryRecord) => Promise<void> {
  return async (record) => {
    // Enforce the schema at the write boundary too (defense in depth).
    validateTelemetry(record.name as TelemetryType, record.props);
    if (store) {
      try {
        await store.save(record);
      } catch {
        // local store outage must not break the caller
      }
    }
    await sink.capture(record);
  };
}
