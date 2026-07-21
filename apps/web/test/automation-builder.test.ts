/**
 * R1-UI W2 (DEC-091): the builder's picker registries + recipes + helpers.
 * The load-bearing pins:
 *   — the pickers enumerate the CORE vocabulary verbatim (every engine kind
 *     maps into a canon group; a new kind fails compilation AND these tests)
 *   — the honest-absent ledgers stay honest: every absent entry carries a
 *     canon group + an owner-readable reason, and no absent label collides
 *     with an expressible entry (one label can never mean two things)
 *   — every recipe is FULLY expressible: it parses through the REAL
 *     `automationWriteSchema` and uses only account-scope actions (a recipe
 *     that can't save is a lie); recipe triggers are pairwise distinct so
 *     seeding them all can never trip the dup-422
 *   — the builder's default payloads are schema-valid for every kind either
 *     picker offers (the Save button can't be dead-on-arrival)
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ACTION_KINDS,
  automationWriteSchema,
  campaignRuleTriggerSchema,
  isAccountAction,
  sameTrigger,
  type CampaignRuleTriggerKind,
} from "@clientforce/core";
import {
  ABSENT_TRIGGERS,
  TRIGGER_GROUP,
  TRIGGER_OPTIONS,
  TRIGGER_PICKER_GROUPS,
} from "../lib/triggers";
import {
  ABSENT_ACTIONS,
  ACCOUNT_ACTION_OPTIONS,
  ACTION_PICKER_GROUPS,
  CAMPAIGN_SCOPED_REASON,
} from "../lib/actions";
import {
  AUTOMATION_RECIPES,
  defaultActionFor,
  defaultTriggerFor,
  keywordsToConditions,
} from "../app/(shell)/automations/AutomationBuilder";

const TRIGGER_KINDS = campaignRuleTriggerSchema.options.map(
  (o) => o.shape.kind.value,
) as CampaignRuleTriggerKind[];

describe("W2 picker registries (the vocabulary + the honest-absent ledger)", () => {
  it("every engine trigger kind maps into a canon picker group — exhaustively", () => {
    expect(new Set(Object.keys(TRIGGER_GROUP))).toEqual(new Set(TRIGGER_KINDS));
    for (const kind of TRIGGER_KINDS) {
      expect(TRIGGER_PICKER_GROUPS).toContain(TRIGGER_GROUP[kind]);
    }
  });

  it("absent trigger entries carry a canon group + reason and never shadow an expressible label", () => {
    const expressible = new Set(TRIGGER_OPTIONS.map((o) => o.label));
    for (const a of ABSENT_TRIGGERS) {
      expect(TRIGGER_PICKER_GROUPS).toContain(a.group);
      expect(a.reason.length).toBeGreaterThan(0);
      expect(expressible.has(a.label)).toBe(false);
    }
    // The canon's intent-flavoured reply entries FOLD into reply_classified —
    // they must never reappear as separate absent vocabulary.
    for (const folded of ["Positive reply", "Objection raised", "Question asked", "Out-of-office reply"]) {
      expect(ABSENT_TRIGGERS.some((a) => a.label === folded)).toBe(false);
    }
  });

  it("every account action option maps into a canon picker group; absent actions never shadow expressible labels", () => {
    for (const o of ACCOUNT_ACTION_OPTIONS) {
      expect(ACTION_PICKER_GROUPS).toContain(o.group);
    }
    const expressible = new Set(ACCOUNT_ACTION_OPTIONS.map((o) => o.label));
    for (const a of ABSENT_ACTIONS) {
      expect(ACTION_PICKER_GROUPS).toContain(a.group);
      expect(a.reason.length).toBeGreaterThan(0);
      expect(expressible.has(a.label)).toBe(false);
    }
  });

  it("the campaign-scoped canon moves (sequence/branch/step) carry the Campaign View reason — the move_to_node refusal's picker face", () => {
    for (const label of ["Move to sequence", "Move to branch", "Skip to step"]) {
      const entry = ABSENT_ACTIONS.find((a) => a.label === label);
      expect(entry?.reason).toBe(CAMPAIGN_SCOPED_REASON);
    }
    // And no absent entry duplicates the folded canon twins of engine kinds.
    for (const folded of ["Mark qualified", "Set status", "End workflow", "Remove from sequences"]) {
      expect(ABSENT_ACTIONS.some((a) => a.label === folded)).toBe(false);
    }
  });
});

describe("W2 recipes — pre-filled builder states, all fully expressible", () => {
  it("every recipe parses through the REAL automationWriteSchema with account-scope actions only", () => {
    for (const r of AUTOMATION_RECIPES) {
      const parsed = automationWriteSchema.safeParse({ name: r.name, enabled: true, ...r.write });
      expect(parsed.success, `recipe "${r.name}" must be expressible`).toBe(true);
      for (const action of r.write.actions) {
        expect(isAccountAction(action), `recipe "${r.name}" action ${action.kind}`).toBe(true);
      }
    }
  });

  it("recipe triggers are pairwise distinct — seeding every recipe can never trip the dup-422", () => {
    for (let i = 0; i < AUTOMATION_RECIPES.length; i++) {
      for (let j = i + 1; j < AUTOMATION_RECIPES.length; j++) {
        expect(
          sameTrigger(AUTOMATION_RECIPES[i]!.write.trigger, AUTOMATION_RECIPES[j]!.write.trigger),
          `${AUTOMATION_RECIPES[i]!.name} vs ${AUTOMATION_RECIPES[j]!.name}`,
        ).toBe(false);
      }
    }
  });
});

describe("W2 builder defaults + keyword helper", () => {
  it("defaultTriggerFor yields a schema-valid trigger for every picker kind", () => {
    for (const o of TRIGGER_OPTIONS) {
      expect(campaignRuleTriggerSchema.safeParse(defaultTriggerFor(o.kind)).success).toBe(true);
    }
  });

  it("defaultActionFor yields a schema-valid ACCOUNT action for every picker kind", () => {
    for (const kind of ACCOUNT_ACTION_KINDS) {
      const action = defaultActionFor(kind, "auto-1");
      expect(isAccountAction(action)).toBe(true);
      const write = automationWriteSchema.safeParse({
        name: "x",
        trigger: { kind: "meeting_booked" },
        actions: [action],
      });
      expect(write.success, `default for ${kind}`).toBe(true);
    }
  });

  it("keywordsToConditions — comma entry ⇄ the ONE engine condition (trim, drop empties, cap 10, null/blank → no filter)", () => {
    expect(keywordsToConditions(null)).toEqual([]);
    expect(keywordsToConditions("  ")).toEqual([]);
    expect(keywordsToConditions("pricing, quote ,, ")).toEqual([
      { kind: "keyword_contains", keywords: ["pricing", "quote"] },
    ]);
    const eleven = Array.from({ length: 11 }, (_, i) => `k${i}`).join(",");
    expect(keywordsToConditions(eleven)[0]!.keywords).toHaveLength(10);
  });
});
