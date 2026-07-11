/**
 * R1 (DEC-073): the typed campaign-rules vocabulary — constrained unions,
 * never free-form. These pins are the shared-core contract: Phase 6's
 * standalone Automations parse the SAME schemas.
 */
import { describe, expect, it } from "vitest";
import {
  campaignRuleActionSchema,
  campaignRuleConditionSchema,
  campaignRuleTriggerSchema,
  isTerminalAction,
  MAX_RULE_CAUSATION_DEPTH,
  TERMINAL_ACTION_KINDS,
  type CampaignRuleAction,
} from "../src/campaign-rules";

describe("campaign rule trigger union", () => {
  it("accepts every documented trigger kind", () => {
    const triggers = [
      { kind: "reply_classified", intents: ["interested", "not_interested"] },
      { kind: "meeting_booked" },
      { kind: "opted_out" },
      { kind: "email_opened" },
      { kind: "link_clicked" },
      { kind: "lead_captured" },
      { kind: "sequence_quiet", days: 30 },
    ];
    for (const t of triggers) {
      expect(campaignRuleTriggerSchema.safeParse(t).success, JSON.stringify(t)).toBe(true);
    }
  });

  it("rejects unknown kinds, empty intent sets, and out-of-range quiet days", () => {
    expect(campaignRuleTriggerSchema.safeParse({ kind: "email_bounced" }).success).toBe(false);
    expect(
      campaignRuleTriggerSchema.safeParse({ kind: "reply_classified", intents: [] }).success,
    ).toBe(false);
    expect(
      campaignRuleTriggerSchema.safeParse({ kind: "sequence_quiet", days: 0 }).success,
    ).toBe(false);
    expect(
      campaignRuleTriggerSchema.safeParse({ kind: "sequence_quiet", days: 366 }).success,
    ).toBe(false);
  });
});

describe("campaign rule condition union", () => {
  it("accepts keyword_contains and rejects free-form kinds", () => {
    expect(
      campaignRuleConditionSchema.safeParse({ kind: "keyword_contains", keywords: ["pricing"] })
        .success,
    ).toBe(true);
    expect(
      campaignRuleConditionSchema.safeParse({ kind: "regex", pattern: ".*" }).success,
    ).toBe(false);
    expect(
      campaignRuleConditionSchema.safeParse({ kind: "keyword_contains", keywords: [] }).success,
    ).toBe(false);
  });
});

describe("campaign rule action union", () => {
  it("accepts every documented action kind", () => {
    const actions = [
      { kind: "move_to_node", targetNodeId: "branch-1" },
      { kind: "end_enrollment" },
      { kind: "pause_enrollment" },
      { kind: "suppress_contact" },
      { kind: "set_stage", stage: "interested" },
      { kind: "set_stage", stage: "booked", label: "Meeting booked" },
      { kind: "notify_team" },
      { kind: "notify_team", note: "Hot lead — call them" },
      { kind: "add_tag", tag: "re-engage" },
      { kind: "run_automation", automationId: "auto-1" },
    ];
    for (const a of actions) {
      expect(campaignRuleActionSchema.safeParse(a).success, JSON.stringify(a)).toBe(true);
    }
  });

  it("rejects unknown kinds and missing references", () => {
    expect(campaignRuleActionSchema.safeParse({ kind: "send_email" }).success).toBe(false);
    expect(campaignRuleActionSchema.safeParse({ kind: "move_to_node" }).success).toBe(false);
    expect(campaignRuleActionSchema.safeParse({ kind: "run_automation" }).success).toBe(false);
  });

  it("classifies exactly end / move / pause / suppress as terminal (unit semantics §1)", () => {
    expect([...TERMINAL_ACTION_KINDS].sort()).toEqual([
      "end_enrollment",
      "move_to_node",
      "pause_enrollment",
      "suppress_contact",
    ]);
    const terminal: CampaignRuleAction = { kind: "end_enrollment" };
    const nonTerminal: CampaignRuleAction = { kind: "notify_team" };
    expect(isTerminalAction(terminal)).toBe(true);
    expect(isTerminalAction(nonTerminal)).toBe(false);
  });

  it("pins the causation depth guard at 2 (the G2 bounded→typed-refusal pattern)", () => {
    expect(MAX_RULE_CAUSATION_DEPTH).toBe(2);
  });
});
