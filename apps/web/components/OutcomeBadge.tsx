/**
 * F1 (DEC-068) — per-step outcome badge, shared by wizard step-2 and the
 * Steps tab. Statistical honesty lives in the ENDPOINT (rates are null below
 * the min-n floor); this component only maps signal → chip:
 *   none → nothing (honest absence) · low → muted "· low data" · ok → full.
 * No prototype anchor — the prototype's step cards carry no stat chips
 * (§0 convention addition, flagged in the F1 fidelity log); anatomy + tints
 * reuse the existing step-card chip vocabulary.
 */
import type { StepOutcomes } from "@clientforce/core";

export function OutcomeBadge({ step }: { step: StepOutcomes | null | undefined }) {
  if (!step || step.signal === "none" || step.replyRatePct === null) return null;
  const low = step.signal === "low";
  const detail =
    `${step.sent} sent · ${step.replies} repl${step.replies === 1 ? "y" : "ies"} · ` +
    `${step.optOuts} opt-out${step.optOuts === 1 ? "" : "s"} — confidence: ${step.signal}`;
  return (
    <span
      title={detail}
      style={{
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 7,
        padding: "3px 9px",
        whiteSpace: "nowrap",
        color: low ? "#5C6B62" : "#16A82A",
        background: low ? "#F2EEE4" : "rgba(53,232,52,.12)",
      }}
      data-testid="step-outcome-badge"
      data-signal={step.signal}
    >
      {step.replyRatePct}% reply{low ? " · low data" : ""}
    </span>
  );
}
