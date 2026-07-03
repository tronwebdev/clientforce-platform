/**
 * Pins the owner-approved DEC-024 field registry (2026-07-03) including all
 * four owner edits — regressions here mean the table drifted from the
 * approval and must go back to the owner.
 */
import { describe, expect, it } from "vitest";
import {
  CONTEXT_FIELD_KEYS,
  CONTEXT_FIELD_META,
  CORE_REQUIRED,
  GOAL_FIELD_TABLE,
  GOAL_KEYS,
  MAX_CUSTOM_GOAL_ASKS,
  recommendedFieldsFor,
  requiredFieldsFor,
  WORKSPACE_EMAIL_REQUIRED,
} from "../src/context";

describe("DEC-024 field registry (owner-approved)", () => {
  it("core = offer/usp/tone for every goal", () => {
    expect(CORE_REQUIRED).toEqual(["offer", "usp", "tone"]);
    for (const goal of GOAL_KEYS) {
      const req = requiredFieldsFor(goal);
      expect(req).toEqual(expect.arrayContaining(["offer", "usp", "tone"]));
    }
  });

  it("owner edit 1: availability Required ONLY on reactivate_leads", () => {
    for (const goal of GOAL_KEYS) {
      const required = requiredFieldsFor(goal).includes("availability");
      expect(required).toBe(goal === "reactivate_leads");
    }
    // …and Recommended on book_appointments (booking_link carries it).
    expect(recommendedFieldsFor("book_appointments")).toContain("availability");
    expect(requiredFieldsFor("book_appointments")).toContain("booking_link");
  });

  it("owner edit 2: sender_identity is NOT a context field", () => {
    expect(CONTEXT_FIELD_KEYS).not.toContain("sender_identity");
    expect(Object.keys(CONTEXT_FIELD_META)).not.toContain("sender_identity");
  });

  it("owner edit 3: company_address is workspace-level Required for email goals", () => {
    expect(WORKSPACE_EMAIL_REQUIRED).toEqual(["company_address"]);
    for (const goal of GOAL_KEYS) {
      expect(requiredFieldsFor(goal, { email: true })).toContain("company_address");
      expect(requiredFieldsFor(goal, { email: false })).not.toContain("company_address");
    }
  });

  it("owner edit 4: lead_magnet never gates generate_leads; qualification_criteria recommended; icp required", () => {
    expect(requiredFieldsFor("generate_leads")).not.toContain("lead_magnet");
    expect(recommendedFieldsFor("generate_leads")).toEqual(
      expect.arrayContaining(["lead_magnet", "qualification_criteria"]),
    );
    expect(requiredFieldsFor("generate_leads")).toContain("icp");
  });

  it("icp is intentionally NOT core (reactivate/reviews target existing contacts)", () => {
    expect(CORE_REQUIRED).not.toContain("icp");
    expect(requiredFieldsFor("reactivate_leads")).not.toContain("icp");
    expect(requiredFieldsFor("collect_reviews")).not.toContain("icp");
  });

  it("custom goal = core only, with the ≤2 suggested-asks bound", () => {
    expect(GOAL_FIELD_TABLE.custom.required).toEqual([]);
    expect(requiredFieldsFor("custom", { email: false })).toEqual([...CORE_REQUIRED]);
    expect(MAX_CUSTOM_GOAL_ASKS).toBe(2);
  });

  it("every registry key has label + retrieval hint metadata", () => {
    for (const key of CONTEXT_FIELD_KEYS) {
      expect(CONTEXT_FIELD_META[key].label.length).toBeGreaterThan(0);
      expect(CONTEXT_FIELD_META[key].hint.length).toBeGreaterThan(0);
    }
    // …and the goal table only references registry keys.
    for (const goal of GOAL_KEYS) {
      for (const k of [...GOAL_FIELD_TABLE[goal].required, ...GOAL_FIELD_TABLE[goal].recommended]) {
        expect(CONTEXT_FIELD_KEYS).toContain(k);
      }
    }
  });
});
