/**
 * Action display map (R1-UI, DEC-091) — lib/triggers.ts's twin for R1's
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
  // INT W2 (DEC-094): NOT a send — queues the booking link into the next
  // boundary-gated composed message (the Q-039 rails-honest form).
  send_booking_link: "Send booking link",
  // INT W3 (DEC-095): the booking twin (Q-039 stands) + the outbound webhook.
  send_payment_link: "Send invoice / payment link",
  send_webhook: "Send webhook",
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
  send_booking_link: "📅",
  send_payment_link: "🧾",
  send_webhook: "⚯",
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
    // INT W2: parameterless — the label IS the chip (honest wording: the
    // link is queued for the next composed message, never sent by the rule).
    case "send_booking_link":
      return "Send booking link";
    // INT W3: the payment twin — same queued-not-sent honesty.
    case "send_payment_link":
      return "Send payment link";
    case "send_webhook": {
      if (!action.url) return "Send webhook (default URL)";
      // The builder calls this on the LIVE draft on every keystroke, so
      // action.url is often an in-progress string `new URL()` would throw on —
      // fall back to the raw text, never crash the builder mid-type (W3 fix).
      try {
        return `Send webhook: ${new URL(action.url).hostname}`;
      } catch {
        return `Send webhook: ${action.url}`;
      }
    }
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
  // INT W1 (DEC-093, Q-042): posts to the connected Slack channel; without a
  // Slack connection the run row + Logs entry remain the transport of record.
  notify_team: { group: "Notify the team", desc: "Slack post when connected · always a run row + Logs entry" },
  // INT W2 (DEC-094): flags the enrollment so the NEXT boundary-gated
  // composed message carries the booking link as mustSay — never a send path.
  send_booking_link: { group: "Meetings", desc: "Queues your booking link into the next composed message" },
  // INT W3 (DEC-095): the payment twin (never a send path) + the signed POST.
  send_payment_link: { group: "Revenue & CRM", desc: "Queues your payment link into the next composed message" },
  send_webhook: { group: "Flow & integrations", desc: "Signed POST to your endpoint · run row records delivery" },
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

// ── W2 builder picker (R1-UI, DEC-091) ──────────────────────────────────────
// lib/triggers.ts's twin registry: the canon ACT entries the account picker
// can't express, rendered as HONEST-ABSENT disabled cards. Two flavours:
// future capability ("Arrives with …" — the Q-030+ ledger) and BY-DESIGN
// exclusions (send actions ride campaign sequences behind the ONE send
// boundary; move/branch/skip are campaign-scoped — the `move_to_node`
// refusal's picker face). Folded, never absent: Mark qualified / Set status
// = `set_stage`; End workflow / Remove from sequences = `end_enrollment`.

/** Canon group order (`Automations.dc.html` ACT_GROUPS, verbatim). */
export const ACTION_PICKER_GROUPS: readonly string[] = [
  "Send a message",
  "Sequences & campaigns",
  "Update the lead",
  "Assign & tasks",
  "Meetings",
  "Revenue & CRM",
  "Notify the team",
  "Flow & integrations",
];

/** The campaign-scoped picker reason (the ACCOUNT_ACTION_REFUSAL's face). */
export const CAMPAIGN_SCOPED_REASON =
  "Campaign-scoped — create this rule from the agent's Campaign View";

const SEND_BOUNDARY_REASON =
  "Arrives with per-channel send rules — sending rides campaign sequences today";

export const ABSENT_ACTIONS: ReadonlyArray<import("./triggers").AbsentPickerEntry> = [
  { group: "Send a message", icon: "✉", label: "Send email", desc: "Compose and send an email", reason: SEND_BOUNDARY_REASON },
  { group: "Send a message", icon: "💬", label: "Send SMS", desc: "Text the contact", reason: SEND_BOUNDARY_REASON },
  { group: "Send a message", icon: "🗨", label: "Send WhatsApp", desc: "Message on WhatsApp", reason: SEND_BOUNDARY_REASON },
  { group: "Send a message", icon: "☎", label: "Place AI call", desc: "Start a voice call", reason: SEND_BOUNDARY_REASON },
  { group: "Send a message", icon: "✦", label: "Send AI reply", desc: "Let the agent answer", reason: SEND_BOUNDARY_REASON },
  { group: "Send a message", icon: "in", label: "Send LinkedIn invite", desc: "Request a connection", reason: SEND_BOUNDARY_REASON },
  { group: "Send a message", icon: "in", label: "Send LinkedIn message", desc: "Message on LinkedIn", reason: SEND_BOUNDARY_REASON },
  { group: "Sequences & campaigns", icon: "↪", label: "Enroll in campaign", desc: "Add to a campaign", reason: "Arrives with auto-enrollment" },
  { group: "Sequences & campaigns", icon: "↪", label: "Move to sequence", desc: "Restart in another sequence", reason: CAMPAIGN_SCOPED_REASON },
  { group: "Sequences & campaigns", icon: "⑃", label: "Move to branch", desc: "Jump to a branch", reason: CAMPAIGN_SCOPED_REASON },
  { group: "Sequences & campaigns", icon: "⏭", label: "Skip to step", desc: "Jump ahead in the sequence", reason: CAMPAIGN_SCOPED_REASON },
  { group: "Update the lead", icon: "⌫", label: "Remove tag", desc: "Take a tag off the contact", reason: "Arrives with tag management" },
  { group: "Update the lead", icon: "☰", label: "Add to list", desc: "Put the contact on a list", reason: "Arrives with list actions" },
  { group: "Update the lead", icon: "☰", label: "Remove from list", desc: "Take the contact off a list", reason: "Arrives with list actions" },
  { group: "Update the lead", icon: "◆", label: "Adjust lead score", desc: "Raise or lower the score", reason: "Arrives with lead scoring" },
  { group: "Update the lead", icon: "▦", label: "Update field", desc: "Set a contact field", reason: "Arrives with field actions" },
  { group: "Update the lead", icon: "⚯", label: "Enrich lead data", desc: "Append fresh data", reason: "Arrives with enrichment" },
  { group: "Assign & tasks", icon: "☺", label: "Assign teammate", desc: "Route to a person", reason: "Arrives with teammates & tasks" },
  { group: "Assign & tasks", icon: "◎", label: "Assign to agent", desc: "Route to an agent", reason: "Arrives with teammates & tasks" },
  { group: "Assign & tasks", icon: "✓", label: "Create task", desc: "Add a follow-up task", reason: "Arrives with teammates & tasks" },
  // INT W2 (DEC-094): "Send booking link" LEFT this ledger — it plugged
  // behind the expressible `send_booking_link` action (the rails-honest
  // brief-injection form; an absent card would shadow live capability). The
  // two below stay honestly absent with the Q-033 re-filed reasons: reminder
  // IS a send (the Q-039 boundary stance) and create-event needs
  // Clientforce-created bookings + the gcal events scope.
  { group: "Meetings", icon: "⏰", label: "Send meeting reminder", desc: "Nudge before the meeting", reason: "Arrives with per-channel send rules — today pair a “Before a meeting” trigger with your sequence" },
  { group: "Meetings", icon: "🗓", label: "Create calendar event", desc: "Book it on the calendar", reason: "Arrives when Clientforce creates bookings — Calendly puts booked meetings on your calendar today" },
  { group: "Revenue & CRM", icon: "❒", label: "Create CRM deal", desc: "Open a pipeline deal", reason: "Arrives with proposals & payments" },
  { group: "Revenue & CRM", icon: "❒", label: "Update deal stage", desc: "Move the deal along", reason: "Arrives with proposals & payments" },
  { group: "Revenue & CRM", icon: "❒", label: "Send proposal", desc: "Send a proposal to sign", reason: "Arrives with proposals & payments" },
  // INT W3 (DEC-095): "Send invoice / payment link" LEFT this ledger — it
  // plugged behind the live send_payment_link action (Q-037's payment half).
  { group: "Revenue & CRM", icon: "🧾", label: "Send receipt", desc: "Confirm a payment", reason: "Arrives with proposals & payments" },
  // INT W1 (DEC-093): "Notify Slack" left this ledger — it plugged behind the
  // EXPRESSIBLE notify_team action (Q-042's recorded design: same action, real
  // transport once Slack is connected), so a separate absent card would shadow
  // a live capability. Email internal alert stays honestly absent (Q-046).
  { group: "Notify the team", icon: "✉", label: "Email internal alert", desc: "Email the team", reason: "Arrives with email alerts" },
  { group: "Flow & integrations", icon: "⏱", label: "Wait", desc: "Pause between actions", reason: "Multi-step chains arrive with automations v2" },
  { group: "Flow & integrations", icon: "⏰", label: "Wait until time", desc: "Hold until a set time", reason: "Multi-step chains arrive with automations v2" },
  // INT W3: "Send webhook" LEFT this ledger — live behind send_webhook
  // (Q-044's send half; the incoming trigger + Zapier/Sheets re-file → Q-048).
  { group: "Flow & integrations", icon: "⚡", label: "Trigger Zapier / Make", desc: "Hand off to a zap", reason: "Arrives with the Zapier integration" },
  { group: "Flow & integrations", icon: "▦", label: "Add row to Google Sheet", desc: "Append a spreadsheet row", reason: "Arrives with the Google Sheets integration" },
];
