/**
 * F1 (DEC-068) — the step-card outcome badge renders all three signal states:
 * none → NOTHING (honest absence), low → muted "· low data", ok → full green.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StepOutcomes } from "@clientforce/core";
import { OutcomeBadge } from "../components/OutcomeBadge";

function step(partial: Partial<StepOutcomes>): StepOutcomes {
  return {
    stepNodeId: "step-1",
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

describe("OutcomeBadge", () => {
  it("none → renders nothing (honest absence, no em-dash chip)", () => {
    expect(renderToStaticMarkup(<OutcomeBadge step={step({ sent: 7 })} />)).toBe("");
    expect(renderToStaticMarkup(<OutcomeBadge step={undefined} />)).toBe("");
    expect(renderToStaticMarkup(<OutcomeBadge step={null} />)).toBe("");
  });

  it('low → muted chip with the rate and "low data"', () => {
    const html = renderToStaticMarkup(
      <OutcomeBadge step={step({ sent: 24, signal: "low", replies: 1, replyRatePct: 4.2 })} />,
    );
    expect(html).toContain("4.2% reply · low data");
    expect(html).toContain('data-signal="low"');
    expect(html).toContain("#5C6B62"); // muted ink, never the full-signal green
    expect(html).not.toContain("#16A82A");
  });

  it("ok → full green chip with the rate only", () => {
    const html = renderToStaticMarkup(
      <OutcomeBadge step={step({ sent: 62, signal: "ok", replies: 3, replyRatePct: 4.8 })} />,
    );
    expect(html).toContain("4.8% reply");
    expect(html).not.toContain("low data");
    expect(html).toContain('data-signal="ok"');
    expect(html).toContain("#16A82A");
  });

  it("carries the raw counts in the tooltip (title), confidence-labeled", () => {
    const html = renderToStaticMarkup(
      <OutcomeBadge
        step={step({ sent: 62, signal: "ok", replies: 3, optOuts: 1, replyRatePct: 4.8 })}
      />,
    );
    expect(html).toContain("62 sent · 3 replies · 1 opt-out — confidence: ok");
  });
});
