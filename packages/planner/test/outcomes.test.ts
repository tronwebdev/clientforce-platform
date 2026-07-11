/**
 * F1 (DEC-068) — the OBSERVED OUTCOMES block: appears ONLY when a step clears
 * the low-signal floor, lists ONLY the qualifying steps, and cites the rollup
 * payload's own numbers (it never recomputes). Pure, no infra.
 */
import { describe, expect, it } from "vitest";
import { SIGNAL_MIN_SENDS, type CampaignOutcomes, type StepOutcomes } from "@clientforce/core";
import { buildOutcomesPromptBlock } from "../src/outcomes";

function step(partial: Partial<StepOutcomes> & { stepNodeId: string }): StepOutcomes {
  return {
    channel: "email",
    sent: 0,
    delivered: 0,
    replies: 0,
    positiveReplies: 0,
    optOuts: 0,
    replyRatePct: null,
    positiveRatePct: null,
    optOutRatePct: null,
    signal: "none",
    ...partial,
  };
}

function outcomes(steps: StepOutcomes[]): CampaignOutcomes {
  return {
    agentId: "agent-1",
    campaignId: "camp-1",
    graphVersion: 3,
    thresholds: { low: SIGNAL_MIN_SENDS.low, ok: SIGNAL_MIN_SENDS.ok },
    steps,
    totals: {
      sent: steps.reduce((n, s) => n + s.sent, 0),
      delivered: null,
      replies: 0,
      positiveReplies: 0,
      optOuts: 0,
      replyRatePct: null,
      positiveRatePct: null,
      optOutRatePct: null,
      signal: "none",
      goalCompletions: 0,
    },
  };
}

describe("buildOutcomesPromptBlock", () => {
  it("returns an empty string when every step is below the floor", () => {
    const block = buildOutcomesPromptBlock(
      outcomes([step({ stepNodeId: "step-1", sent: 19 }), step({ stepNodeId: "step-2", sent: 0 })]),
    );
    expect(block).toBe("");
  });

  it("lists ONLY low+ steps, confidence-labeled, citing the payload's own numbers", () => {
    const ok = step({
      stepNodeId: "step-1",
      sent: 62,
      signal: "ok",
      replies: 3,
      positiveReplies: 1,
      replyRatePct: 4.8,
      positiveRatePct: 1.6,
      optOutRatePct: 0,
    });
    const low = step({
      stepNodeId: "step-2",
      sent: 24,
      signal: "low",
      replyRatePct: 0,
      positiveRatePct: 0,
      optOutRatePct: 4.2,
    });
    const none = step({ stepNodeId: "step-3", sent: 7 });
    const block = buildOutcomesPromptBlock(outcomes([ok, low, none]));

    expect(block).toContain("OBSERVED OUTCOMES");
    expect(block).toContain(
      "- step-1 (email): 62 sent · reply rate 4.8% · positive-intent 1.6% · opt-out 0% — confidence: ok (≥50 sends)",
    );
    expect(block).toContain(
      "- step-2 (email): 24 sent · reply rate 0% · positive-intent 0% · opt-out 4.2% — confidence: low (20–49 sends — directional only)",
    );
    expect(block).not.toContain("step-3"); // below the floor — omitted, and said so:
    expect(block).toContain("Steps below 20 sends are omitted");
    expect(block).toContain("Never invent metrics.");
  });
});
