/**
 * Action display map (R1-UI, DEC-088) — lib/triggers.ts's twin for R1's
 * `campaignRuleActionSchema` kinds: a DISPLAY LAYER ONLY over the ONE action
 * union in `@clientforce/core` (never a parallel union — the DEC-034 one-enum
 * rule). The Automations picker enumerates `ACCOUNT_ACTION_OPTIONS`, which is
 * derived from core's `ACCOUNT_ACTION_KINDS` — a new engine action kind fails
 * compilation here AND lights up in the picker with one label entry (the
 * ⭑ automation-vocabulary ride-along mechanism).
 *
 * Canon glyph/labels from `Automations.dc.html`'s ACT catalog where a twin
 * exists (pauseseq ⏸ · suppress ⊘ · setstatus ⇄ · tag ⌗ · notifyteam 🔔 ·
 * endflow ⊘); `run_automation` has no canon twin — designed label, ⟳ (the
 * Automations glyph), flagged in the fidelity log.
 */
import {
  ACCOUNT_ACTION_KINDS,
  type CampaignRuleAction,
  type CampaignRuleActionKind,
} from "@clientforce/core";

export const ACTION_LABELS: Record<CampaignRuleActionKind, string> = {
  move_to_node: "Move to sequence node",
  end_enrollment: "End campaign for contact",
  pause_enrollment: "Pause contact",
  suppress_contact: "Suppress / unsubscribe",
  set_stage: "Set pipeline stage",
  notify_team: "Notify team",
  add_tag: "Add tag",
  run_automation: "Run another automation",
};

export const ACTION_ICONS: Record<CampaignRuleActionKind, string> = {
  move_to_node: "↪",
  end_enrollment: "⊘",
  pause_enrollment: "⏸",
  suppress_contact: "⊘",
  set_stage: "⇄",
  notify_team: "🔔",
  add_tag: "⌗",
  run_automation: "⟳",
};

export function actionLabel(kind: CampaignRuleActionKind): string {
  return ACTION_LABELS[kind];
}

/**
 * The card/drawer chip text for a concrete action (canon actionLabel style:
 * "Add tag: hot-lead", "Set status: Qualified"). `automationNames` resolves
 * run_automation targets LIVE (B6) — an unknown id renders the honest
 * "missing automation" state, never a silent blank.
 */
export function actionChip(
  action: CampaignRuleAction,
  automationNames?: Record<string, string>,
): string {
  switch (action.kind) {
    case "add_tag":
      return `Add tag: ${action.tag}`;
    case "set_stage":
      return `Set stage: ${action.label ?? action.stage}`;
    case "notify_team":
      return "Notify team";
    case "run_automation": {
      const name = automationNames?.[action.automationId];
      return name ? `Run “${name}”` : "Run automation (missing)";
    }
    case "move_to_node":
      return "Move to sequence node";
    case "end_enrollment":
      return "End campaign";
    case "pause_enrollment":
      return "Pause contact";
    case "suppress_contact":
      return "Suppress contact";
  }
}

export interface ActionOption {
  kind: CampaignRuleActionKind;
  label: string;
  icon: string;
  /** Canon picker group (`Automations.dc.html` ACT_GROUPS). */
  group: string;
  desc: string;
}

const ACTION_GROUPS: Record<(typeof ACCOUNT_ACTION_KINDS)[number], { group: string; desc: string }> = {
  end_enrollment: { group: "Sequences & campaigns", desc: "The campaign ends for this contact" },
  pause_enrollment: { group: "Sequences & campaigns", desc: "Pause the contact's sequence" },
  suppress_contact: { group: "Update the lead", desc: "Opt the contact out everywhere" },
  set_stage: { group: "Update the lead", desc: "Move the pipeline stage" },
  add_tag: { group: "Update the lead", desc: "Apply a tag to the contact" },
  notify_team: { group: "Notify the team", desc: "A run row + Logs entry for the team" },
  run_automation: { group: "Flow & integrations", desc: "Chain another automation" },
};

/**
 * The ACCOUNT-scope picker entries — core's `ACCOUNT_ACTION_KINDS` verbatim
 * (the union minus `move_to_node`, whose target is a campaign-graph node:
 * Campaign View owns move rules, #90 — link, don't duplicate).
 */
export const ACCOUNT_ACTION_OPTIONS: readonly ActionOption[] = ACCOUNT_ACTION_KINDS.map(
  (kind) => ({
    kind,
    label: ACTION_LABELS[kind],
    icon: ACTION_ICONS[kind],
    ...ACTION_GROUPS[kind],
  }),
);
