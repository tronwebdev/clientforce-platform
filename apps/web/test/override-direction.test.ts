import { describe, expect, it } from "vitest";

/**
 * B7.6 — a campaign override has a DIRECTION, and the chip has to say which.
 *
 * B7.5 labelled every departure "Tighter" regardless. The pixel gate surfaced
 * it: filling the workspace guardrail-defaults seed gap gave the demo a 120/day
 * ceiling while every seeded campaign carries 200, so the overrides tab started
 * calling four LOOSER campaigns "Tighter" — a reassurance shown at exactly the
 * moment the opposite is true.
 *
 * This pins the rule the surface now applies. It mirrors the derivation in
 * BoldGuardItem rather than importing it, because the component is a client
 * component with a data dependency; the shape is small enough that a drift
 * here is caught by the e2e assertion on the same tab.
 */
function direction(pairs: Array<[number, number]>): string {
  const looser = pairs.some(([cap, base]) => cap > base);
  const tighter = pairs.some(([cap, base]) => cap < base);
  return looser && tighter ? "Mixed" : looser ? "Looser" : tighter ? "Tighter" : "Different";
}

describe("campaign override direction", () => {
  it("calls a higher ceiling Looser, not Tighter", () => {
    // The exact case the seed produced: campaign 200/day, workspace 120/day.
    expect(direction([[200, 120]])).toBe("Looser");
  });

  it("calls a lower ceiling Tighter", () => {
    expect(direction([[40, 60]])).toBe("Tighter");
  });

  it("calls a campaign that is looser on one channel and tighter on another Mixed", () => {
    expect(direction([[200, 120], [40, 60]])).toBe("Mixed");
  });

  it("calls a departure with no numeric difference Different", () => {
    // A campaign that only sends in a different WINDOW is neither tighter nor
    // looser — there is no ceiling to compare.
    expect(direction([])).toBe("Different");
  });
});
