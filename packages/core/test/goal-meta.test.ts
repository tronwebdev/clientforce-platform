/**
 * Pins the owner-approved C2.9 label table (docs/PLAN_GOAL_STATE.md, DEC-059)
 * — regressions here mean the table drifted from the approval and must go
 * back to the owner — plus the aggregation rule and the custom-label override.
 */
import { describe, expect, it } from "vitest";
import {
  GOAL_KEYS,
  GOAL_META,
  goalTerminalLabel,
  goalTerminalPill,
  workspaceGoalPill,
} from "../src";

describe("GOAL_META (C2.9 label table, verbatim)", () => {
  it("covers every goal with both labels, non-empty", () => {
    for (const key of GOAL_KEYS) {
      const meta = GOAL_META[key];
      expect(meta, key).toBeDefined();
      expect(meta.terminalLabel.length, `${key}.terminalLabel`).toBeGreaterThan(0);
      expect(meta.terminalPill.length, `${key}.terminalPill`).toBeGreaterThan(0);
    }
    expect(Object.keys(GOAL_META).sort()).toEqual([...GOAL_KEYS].sort());
  });

  it("matches the plan's 9-row table verbatim", () => {
    expect(GOAL_META).toEqual({
      book_appointments: { terminalLabel: "Meeting booked", terminalPill: "Booked" },
      generate_leads: { terminalLabel: "Lead qualified", terminalPill: "Qualified" },
      reactivate_leads: { terminalLabel: "Reactivated", terminalPill: "Reactivated" },
      drive_signups: { terminalLabel: "Signed up", terminalPill: "Signed up" },
      collect_reviews: { terminalLabel: "Review left", terminalPill: "Reviewed" },
      promote_offer: { terminalLabel: "Purchase made", terminalPill: "Purchased" },
      fill_event: { terminalLabel: "Registered", terminalPill: "Registered" },
      upsell_clients: { terminalLabel: "Upsell accepted", terminalPill: "Upgraded" },
      custom: { terminalLabel: "Goal met", terminalPill: "Goal met" },
    });
  });
});

describe("goalTerminalLabel / goalTerminalPill", () => {
  it("resolves fixed goals from the table", () => {
    expect(goalTerminalLabel("promote_offer")).toBe("Purchase made");
    expect(goalTerminalPill("promote_offer")).toBe("Purchased");
  });

  it("custom: typed label overrides the long label; the pill NEVER changes", () => {
    expect(goalTerminalLabel("custom")).toBe("Goal met");
    expect(goalTerminalLabel("custom", "Contract signed")).toBe("Contract signed");
    expect(goalTerminalLabel("custom", "   ")).toBe("Goal met");
    expect(goalTerminalPill("custom")).toBe("Goal met");
  });

  it("a typed label never leaks onto fixed goals; unknown keys fall back", () => {
    expect(goalTerminalLabel("promote_offer", "Contract signed")).toBe("Purchase made");
    expect(goalTerminalLabel("not_a_goal")).toBe("Goal met");
    expect(goalTerminalLabel(null)).toBe("Goal met");
    expect(goalTerminalPill(undefined)).toBe("Goal met");
  });
});

describe("workspaceGoalPill (aggregation rule)", () => {
  it("single shared goal → that goal's pill verbatim", () => {
    expect(workspaceGoalPill(["promote_offer"])).toBe("Purchased");
    expect(workspaceGoalPill(["book_appointments", "book_appointments"])).toBe("Booked");
  });

  it("mixed goals → generic 'Goal met'", () => {
    expect(workspaceGoalPill(["promote_offer", "book_appointments"])).toBe("Goal met");
  });

  it("no active agents → generic; single custom → its (generic) pill", () => {
    expect(workspaceGoalPill([])).toBe("Goal met");
    expect(workspaceGoalPill(["custom"])).toBe("Goal met");
  });
});
