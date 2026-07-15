/**
 * P5 W2 (DEC-084): sender health/warmup display mapping — the OWNER-LOCKED
 * band cutoffs fold into the ring states here, importing the same
 * `@clientforce/core` contract the scoring engine uses (surface and engine
 * agree by construction). Labels keep the prototype vocabulary where it
 * exists (Excellent/Good on the green ring, "Warming" on the list pill); the
 * two bands the prototype never modeled (at-risk, auto-paused) are flagged
 * designed additions, colored from the token palette.
 */
import { HEALTH_BANDS, healthBandFor } from "@clientforce/core";
import { PAIR, type Pair, type Sender } from "./shared";

export interface RingDisplay {
  /** "97" or the honest em-dash below the sample floor. */
  score: string;
  color: string;
  label: string;
  sub: string;
}

/**
 * The drawer ring, per the locked bands: healthy ≥80 (prototype labels
 * Excellent ≥90 / Good 80–89) · watch 60–79 · at-risk 40–59 · auto-paused
 * <40; below the F1 sample floor there is NO score — "Warming up · low data",
 * never a fake number.
 */
export function ringDisplay(health: Sender["health"]): RingDisplay {
  if (!health || health.score === null || health.state === "low_data") {
    return { score: "—", color: "#9AA59E", label: "Warming up", sub: "low data — no score yet" };
  }
  const score = String(health.score);
  const sub = "Reputation score · /100";
  const band = health.band ?? healthBandFor(health.score);
  if (band === "healthy") {
    return { score, color: "#16A82A", label: health.score >= 90 ? "Excellent" : "Good", sub };
  }
  if (band === "watch") return { score, color: "#E8C45B", label: "Watch", sub };
  if (band === "at_risk") return { score, color: "#A87B16", label: "At risk", sub };
  return { score, color: "#C9543F", label: "Auto-paused", sub: "sending refuses below 40 — recovers automatically" };
}

/**
 * The list "Sending" pill — status first (owner intent beats derived state),
 * then the health gate, then the ramp: DISABLED ▸ PAUSED ▸ auto-paused ▸
 * Warming (canon list vocabulary) ▸ Good.
 */
export function sendingPill(s: Sender): { label: string } & Pair {
  if (s.status === "DISABLED") return { label: "Needs verification", ...PAIR.warn };
  if (s.status === "PAUSED") return { label: "Paused", ...PAIR.neutral };
  if (s.health && (s.health.band === "paused" || s.health.state === "unhealthy")) {
    return { label: "Auto-paused", ...PAIR.bad };
  }
  if (s.warmup?.active) return { label: "Warming", ...PAIR.warn };
  return { label: "Good", ...PAIR.good };
}

/** Warm-up card status pill: Active → Complete, with the interlock's Held. */
export function warmupPill(w: NonNullable<Sender["warmup"]>): { label: string } & Pair {
  if (w.completedAt) return { label: "Complete", ...PAIR.good };
  if (w.holding) return { label: "Held", ...PAIR.warn };
  return { label: "Active", ...PAIR.good };
}

/** The drawer activity timeline — human copy per event type (DEC-057: mapped types only, never a raw slug). */
export function describeSenderEvent(type: string, payload: Record<string, unknown>): { icon: string; fg: string; bg: string; text: string } | null {
  switch (type) {
    case "sender.health_collapsed.v1":
      return {
        icon: "⚠",
        fg: "#9A6B12",
        bg: "rgba(232,196,91,.2)",
        text: `Health collapsed to ${typeof payload.score === "number" ? payload.score : "?"}/100 — sending auto-paused`,
      };
    case "sender.health_recovered.v1":
      return {
        icon: "✓",
        fg: "#16A82A",
        bg: "rgba(53,232,52,.16)",
        text:
          typeof payload.score === "number"
            ? `Health recovered to ${payload.score}/100 — sending resumed`
            : "Quiet window reset the sample — sending resumed",
      };
    case "sender.warmup_completed.v1":
      return {
        icon: "✓",
        fg: "#16A82A",
        bg: "rgba(53,232,52,.16)",
        text: `Warm-up complete — day ${typeof payload.days === "number" ? payload.days : 45}, full daily limit unlocked`,
      };
    case "sender.status_changed.v1":
      return payload.to === "PAUSED"
        ? { icon: "⏸", fg: "#8A7F6B", bg: "#F2EEE4", text: "Sender paused" }
        : { icon: "▶", fg: "#16A82A", bg: "rgba(53,232,52,.16)", text: "Sender resumed" };
    default:
      return null;
  }
}

/** Re-exported so the surface tests pin the same cutoffs the engine enforces. */
export { HEALTH_BANDS };
