/**
 * P5 W2 (DEC-084): the sender-health BAND contract — owner-locked cutoffs
 * (2026-07-15), moved here from `packages/channels` so the engine (channels)
 * and the surfaces (web Settings ring, B1-W4 fleet) import ONE source and
 * agree by construction. The scoring math itself stays in channels; this is
 * the classification every consumer renders.
 */
import { z } from "zod";

/** LOCKED band floors: healthy ≥80 · watch 60–79 · at-risk 40–59 · paused <40. */
export const HEALTH_BANDS = { healthy: 80, watch: 60, atRisk: 40 } as const;
/** The SENDER_UNHEALTHY refusal threshold (sharp — recovery is ≥ this line). */
export const HEALTH_AUTO_PAUSE_BELOW = HEALTH_BANDS.atRisk;

export const healthBandSchema = z.enum(["healthy", "watch", "at_risk", "paused"]);
export type HealthBand = z.infer<typeof healthBandSchema>;

export const healthGateStateSchema = z.enum(["healthy", "unhealthy", "low_data"]);
export type HealthGateState = z.infer<typeof healthGateStateSchema>;

export function healthBandFor(score: number): HealthBand {
  if (score >= HEALTH_BANDS.healthy) return "healthy";
  if (score >= HEALTH_BANDS.watch) return "watch";
  if (score >= HEALTH_BANDS.atRisk) return "at_risk";
  return "paused";
}
