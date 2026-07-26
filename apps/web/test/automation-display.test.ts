/**
 * R1-UI W1 (DEC-091): the action DISPLAY map + Automations list/drawer
 * helpers. The load-bearing pins: the display layer covers EXACTLY the core
 * unions (drift-guarded against the schemas themselves — never a parallel
 * enum), the account picker enumerates core's ACCOUNT_ACTION_KINDS verbatim
 * (move_to_node is the ONE campaign-scoped exclusion), and the list/drawer
 * states derive honestly (invalid rows = Error, desc is deterministic).
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ACTION_KINDS,
  campaignRuleActionSchema,
  campaignRuleTriggerSchema,
  type CampaignRuleActionKind,
  type CampaignRuleTriggerKind,
} from "@clientforce/core";
import {
  ACCOUNT_ACTION_OPTIONS,
  ACTION_ICONS,
  ACTION_LABELS,
  actionChip,
  actionLabel,
} from "../lib/actions";
import { TRIGGER_DESCRIPTIONS, TRIGGER_ICONS } from "../lib/triggers";
import {
  conditionText,
  deriveDesc,
  relTime,
  statusOf,
} from "../app/(shell)/automations/AutomationsView";
import type { AutomationListRow } from "../lib/types";

const ACTION_KINDS = campaignRuleActionSchema.options.map(
  (o) => o.shape.kind.value,
) as CampaignRuleActionKind[];
const TRIGGER_KINDS = campaignRuleTriggerSchema.options.map(
  (o) => o.shape.kind.value,
) as CampaignRuleTriggerKind[];

describe("action display map (lib/actions)", () => {
  it("labels + icons cover exactly the core union — the display layer can never fork it", () => {
    expect(new Set(Object.keys(ACTION_LABELS))).toEqual(new Set(ACTION_KINDS));
    expect(new Set(Object.keys(ACTION_ICONS))).toEqual(new Set(ACTION_KINDS));
    for (const kind of ACTION_KINDS) expect(actionLabel(kind)).toBeTruthy();
  });

  it("the ACCOUNT picker enumerates core's ACCOUNT_ACTION_KINDS verbatim — the union minus move_to_node ONLY", () => {
    expect(ACCOUNT_ACTION_OPTIONS.map((o) => o.kind)).toEqual([...ACCOUNT_ACTION_KINDS]);
    const excluded = ACTION_KINDS.filter(
      (k) => !(ACCOUNT_ACTION_KINDS as readonly string[]).includes(k),
    );
    expect(excluded).toEqual(["move_to_node"]);
    // Every entry carries a canon group + desc for the W2 grouped picker.
    for (const o of ACCOUNT_ACTION_OPTIONS) {
      expect(o.group).toBeTruthy();
      expect(o.desc).toBeTruthy();
      expect(o.icon).toBe(ACTION_ICONS[o.kind]);
      expect(o.label).toBe(ACTION_LABELS[o.kind]);
    }
  });

  it("chips render the canon strings; run_automation resolves LIVE with an honest missing state", () => {
    expect(actionChip({ kind: "add_tag", tag: "hot-lead" })).toBe("Add tag: hot-lead");
    expect(actionChip({ kind: "set_stage", stage: "booked" })).toBe("Set stage: booked");
    expect(actionChip({ kind: "set_stage", stage: "booked", label: "Meeting booked" })).toBe(
      "Set stage: Meeting booked",
    );
    expect(actionChip({ kind: "end_enrollment" })).toBe("End campaign");
    expect(actionChip({ kind: "pause_enrollment" })).toBe("Pause contact");
    expect(actionChip({ kind: "suppress_contact" })).toBe("Suppress contact");
    expect(actionChip({ kind: "notify_team" })).toBe("Notify team");
    // INT W2 (DEC-094): parameterless — the label IS the chip.
    expect(actionChip({ kind: "send_booking_link" })).toBe("Send booking link");
    expect(
      actionChip({ kind: "run_automation", automationId: "a1" }, { a1: "Stop on unsubscribe" }),
    ).toBe("Run “Stop on unsubscribe”");
    expect(actionChip({ kind: "run_automation", automationId: "gone" }, {})).toBe(
      "Run automation (missing)",
    );
  });

  it("send_webhook chip: hostname when valid, default-URL when blank, and NEVER crashes mid-type (W3)", () => {
    expect(actionChip({ kind: "send_payment_link" })).toBe("Send payment link");
    expect(actionChip({ kind: "send_webhook" })).toBe("Send webhook (default URL)");
    expect(actionChip({ kind: "send_webhook", url: "https://ops.example.com/hook" })).toBe("Send webhook: ops.example.com");
    // Review-round pin (ui #1, CRITICAL): the builder calls actionChip on the
    // LIVE draft every keystroke, so a partial/invalid URL must degrade to the
    // raw text, never throw `new URL()` and unmount the builder.
    expect(() => actionChip({ kind: "send_webhook", url: "h" })).not.toThrow();
    expect(actionChip({ kind: "send_webhook", url: "https:/" })).toBe("Send webhook: https:/");
  });

  it("INT W4: the CRM push chips carry the target stage", () => {
    expect(actionChip({ kind: "create_crm_deal" })).toBe("Create CRM deal");
    expect(actionChip({ kind: "create_crm_deal", stage: "qualifiedtobuy" })).toBe("Create CRM deal → qualifiedtobuy");
    expect(actionChip({ kind: "update_deal_stage", stage: "closedwon" })).toBe("Update deal stage → closedwon");
  });
});

describe("trigger display additions (lib/triggers, DEC-091)", () => {
  it("icons + descriptions cover exactly the trigger union", () => {
    expect(new Set(Object.keys(TRIGGER_ICONS))).toEqual(new Set(TRIGGER_KINDS));
    expect(new Set(Object.keys(TRIGGER_DESCRIPTIONS))).toEqual(new Set(TRIGGER_KINDS));
  });
});

const row = (over: Partial<AutomationListRow> = {}): AutomationListRow => ({
  id: "a1",
  name: "Flag hot replies",
  enabled: true,
  trigger: { kind: "reply_classified", intents: ["interested"] },
  conditions: [],
  actions: [{ kind: "add_tag", tag: "hot" }],
  invalid: false,
  runs: 3,
  lastRunAt: null,
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
  ...over,
});

describe("list/drawer state helpers (AutomationsView)", () => {
  it("statusOf: Active/Paused per canon; invalid rows = the honest Error state (designed addition)", () => {
    expect(statusOf(row())).toBe("Active");
    expect(statusOf(row({ enabled: false }))).toBe("Paused");
    expect(statusOf(row({ invalid: true, trigger: null, actions: [] }))).toBe("Error");
    // Error wins over the toggle state — an unreadable rule never claims Active.
    expect(statusOf(row({ invalid: true, enabled: true }))).toBe("Error");
  });

  it("deriveDesc: the canon deterministic derivation (no desc column exists)", () => {
    expect(deriveDesc(row())).toBe("1 action when reply classified as…");
    expect(
      deriveDesc(
        row({
          trigger: { kind: "sequence_quiet", days: 14 },
          actions: [{ kind: "add_tag", tag: "x" }, { kind: "notify_team" }],
        }),
      ),
    ).toBe("2 actions when no reply for n days");
    expect(deriveDesc(row({ invalid: true, trigger: null }))).toContain("couldn't be read");
  });

  it("conditionText renders the ONE engine condition kind verbatim", () => {
    expect(conditionText({ kind: "keyword_contains", keywords: ["pricing"] })).toBe(
      "Reply contains “pricing”",
    );
    expect(conditionText({ kind: "keyword_contains", keywords: ["pricing", "quote"] })).toBe(
      "Reply contains “pricing” or “quote”",
    );
  });

  it("relTime: coarse honest buckets, '—' for never", () => {
    expect(relTime(null)).toBe("—");
    expect(relTime(new Date(Date.now() - 10_000).toISOString())).toBe("just now");
    expect(relTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(relTime(new Date(Date.now() - 26 * 3_600_000).toISOString())).toBe("yesterday");
    expect(relTime(new Date(Date.now() - 4 * 86_400_000).toISOString())).toBe("4 days ago");
  });
});
