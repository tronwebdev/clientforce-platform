/**
 * Trigger display map (W2, PR #94) — the ONE owner-facing vocabulary over
 * R1's `campaignRuleTriggerSchema` kinds, mirroring lib/intents.ts's role for
 * intents: a DISPLAY LAYER ONLY. The trigger union itself lives in
 * `@clientforce/core` (campaign-rules.ts) and is consumed verbatim — never a
 * parallel union, never a second schema (the DEC-034 one-enum rule applied
 * to triggers). `reply_classified` intent labels come VERBATIM from
 * `INTENT_TINT` via `intentTint` — one intent vocabulary, no fork.
 *
 * The prototype's "Reply received" and "Reply contains keyword" entries are
 * NOT R1-expressible as creator triggers (a bare "reply received" has no R1
 * kind; keyword matching is R1's CONDITION refinement, never a trigger) —
 * both are OMITTED here and recorded as DEC open questions. Do not build.
 */
import type { CampaignRuleTrigger, CampaignRuleTriggerKind } from "@clientforce/core";
import { intentTint } from "./intents";

/** Owner labels per kind — Record is exhaustiveness-checked: a new R1 kind
 *  fails compilation here instead of rendering raw. */
const TRIGGER_LABELS: Record<CampaignRuleTriggerKind, string> = {
  reply_classified: "Reply classified as…",
  sequence_quiet: "No reply for N days",
  email_opened: "Email opened",
  link_clicked: "Link clicked",
  meeting_booked: "Meeting booked",
  opted_out: "Unsubscribed / opted out",
  lead_captured: "Form / lead captured",
};

export function triggerLabel(kind: CampaignRuleTriggerKind): string {
  return TRIGGER_LABELS[kind];
}

/** R1-UI (DEC-091, additive): canon card/drawer glyphs per kind
 *  (`Automations.dc.html` TRIG catalog where a twin exists). */
export const TRIGGER_ICONS: Record<CampaignRuleTriggerKind, string> = {
  reply_classified: "↩",
  sequence_quiet: "⏳",
  email_opened: "◔",
  link_clicked: "🔗",
  meeting_booked: "📅",
  opted_out: "⊘",
  lead_captured: "⊞",
};

/** R1-UI (DEC-091, additive): canon picker descriptions per kind. */
export const TRIGGER_DESCRIPTIONS: Record<CampaignRuleTriggerKind, string> = {
  reply_classified: "A reply is classified with an intent",
  sequence_quiet: "No response after N days",
  email_opened: "A lead opens an email",
  link_clicked: "A lead clicks a link",
  meeting_booked: "A meeting is scheduled",
  opted_out: "A lead opts out",
  lead_captured: "A form, widget or LinkedIn lead arrives",
};

/** The card-chip text for a concrete trigger (canon: "💬 Reply: Interested",
 *  "⏱ No reply · 30 days"; parameterless kinds render their label). */
export function triggerChip(trigger: CampaignRuleTrigger): string {
  switch (trigger.kind) {
    case "reply_classified":
      return `💬 Reply: ${trigger.intents.map((i) => intentTint(i).label).join(" · ")}`;
    case "sequence_quiet":
      return `⏱ No reply · ${trigger.days} day${trigger.days === 1 ? "" : "s"}`;
    default:
      return TRIGGER_LABELS[trigger.kind];
  }
}

export interface TriggerOption {
  kind: CampaignRuleTriggerKind;
  label: string;
  chip: (trigger: CampaignRuleTrigger) => string;
}

/** Creator dropdown entries, in canon order. */
export const TRIGGER_OPTIONS: readonly TriggerOption[] = (
  [
    "reply_classified",
    "sequence_quiet",
    "email_opened",
    "link_clicked",
    "meeting_booked",
    "opted_out",
    "lead_captured",
  ] as const satisfies readonly CampaignRuleTriggerKind[]
).map((kind) => ({ kind, label: TRIGGER_LABELS[kind], chip: triggerChip }));

// ── W2 builder picker (R1-UI, DEC-091) ──────────────────────────────────────
// The grouped trigger picker renders TWO registries: the ENGINE kinds
// (derived from the core union — the vocabulary verbatim, a new kind fails
// compilation in TRIGGER_GROUP and lights up automatically) and the canon
// `Automations.dc.html` TRIG entries the engine can't express yet, rendered
// as HONEST-ABSENT disabled cards whose reasons name the future capability.
// Canon entries that FOLD into an engine kind are never listed absent:
// Positive reply / Objection / Question / OOO ride `reply_classified`'s
// intent multi-pick; Form / widget / LinkedIn-profile captures are the ONE
// `lead_captured` kind (three producers). The absent set is the Q-030+
// picker↔vocabulary ledger the ⭑ ride-along closes feature-by-feature.

/** Canon picker group per engine kind (groups from the canon TRIG catalog). */
export const TRIGGER_GROUP: Record<CampaignRuleTriggerKind, string> = {
  reply_classified: "Replies & conversations",
  sequence_quiet: "Replies & conversations",
  email_opened: "Email engagement",
  link_clicked: "Email engagement",
  meeting_booked: "Meetings",
  opted_out: "Lead lifecycle",
  lead_captured: "Forms & widget",
};

/** Canon group order (`Automations.dc.html` TRIG_GROUPS, verbatim). */
export const TRIGGER_PICKER_GROUPS: readonly string[] = [
  "Replies & conversations",
  "Email engagement",
  "Voice & calls",
  "Meetings",
  "Lead lifecycle",
  "Lead Finder & prospecting",
  "Forms & widget",
  "LinkedIn",
  "Proposals & revenue",
  "Schedule & system",
];

/** One honest-absent picker card: a canon entry with no engine twin. */
export interface AbsentPickerEntry {
  group: string;
  icon: string;
  label: string;
  desc: string;
  /** Owner-readable reason naming the future capability (honest absence). */
  reason: string;
}

export const ABSENT_TRIGGERS: readonly AbsentPickerEntry[] = [
  { group: "Replies & conversations", icon: "↩", label: "Reply received", desc: "A lead replies on any channel", reason: "Arrives with raw-reply rules — today use “Reply classified as…”" },
  { group: "Replies & conversations", icon: "💬", label: "Inbound message", desc: "New inbound SMS or WhatsApp", reason: "Arrives with inbox rules" },
  { group: "Email engagement", icon: "⚠", label: "Email bounced", desc: "A message hard-bounces", reason: "Arrives with deliverability triggers" },
  { group: "Email engagement", icon: "🚫", label: "Spam complaint", desc: "Marked as spam", reason: "Arrives with deliverability triggers" },
  { group: "Voice & calls", icon: "☎", label: "AI call completed", desc: "A voice call finishes", reason: "Arrives with voice campaigns" },
  { group: "Voice & calls", icon: "✦", label: "Call: interested", desc: "Call outcome is interested", reason: "Arrives with voice campaigns" },
  { group: "Voice & calls", icon: "🎙", label: "Voicemail left", desc: "AI leaves a voicemail", reason: "Arrives with voice campaigns" },
  { group: "Voice & calls", icon: "✖", label: "Call not answered", desc: "No pick-up on a call", reason: "Arrives with voice campaigns" },
  { group: "Voice & calls", icon: "↺", label: "Callback requested", desc: "A lead asks for a callback", reason: "Arrives with voice campaigns" },
  { group: "Meetings", icon: "⟳", label: "Meeting rescheduled", desc: "A meeting moves", reason: "Arrives with calendar sync" },
  { group: "Meetings", icon: "✕", label: "Meeting canceled / no-show", desc: "A meeting falls through", reason: "Arrives with calendar sync" },
  { group: "Meetings", icon: "⏰", label: "Before a meeting", desc: "A set time before a meeting", reason: "Arrives with calendar sync" },
  { group: "Lead lifecycle", icon: "＋", label: "Contact created", desc: "A new contact is added", reason: "Arrives with lifecycle triggers" },
  { group: "Lead lifecycle", icon: "✦", label: "Lead qualified", desc: "A lead is marked qualified", reason: "Arrives with lifecycle triggers" },
  { group: "Lead lifecycle", icon: "⇄", label: "Status changed", desc: "A contact's status changes", reason: "Arrives with lifecycle triggers" },
  { group: "Lead lifecycle", icon: "◆", label: "Lead score crosses", desc: "Score passes a threshold", reason: "Arrives with lead scoring" },
  { group: "Lead lifecycle", icon: "⌗", label: "Tag added", desc: "A tag is applied", reason: "Arrives with lifecycle triggers" },
  { group: "Lead lifecycle", icon: "⌫", label: "Tag removed", desc: "A tag is removed", reason: "Arrives with lifecycle triggers" },
  { group: "Lead lifecycle", icon: "☰", label: "Added to a list", desc: "A contact joins a list", reason: "Arrives with lifecycle triggers" },
  { group: "Lead lifecycle", icon: "✓", label: "Sequence completed", desc: "A lead finishes a sequence", reason: "Arrives with lifecycle triggers" },
  { group: "Lead Finder & prospecting", icon: "⚲", label: "New lead found", desc: "Lead Finder surfaces a match", reason: "Arrives with Lead Finder" },
  { group: "Lead Finder & prospecting", icon: "✦", label: "Auto-prospected lead", desc: "The agent auto-enrolls a lead", reason: "Arrives with Lead Finder" },
  { group: "Lead Finder & prospecting", icon: "◎", label: "High-fit ICP match", desc: "A strong-fit lead appears", reason: "Arrives with Lead Finder" },
  { group: "Lead Finder & prospecting", icon: "⚯", label: "Lead enriched", desc: "New data is appended", reason: "Arrives with enrichment" },
  { group: "Lead Finder & prospecting", icon: "⬆", label: "Import completed", desc: "A CSV import finishes", reason: "Arrives with import triggers" },
  { group: "Forms & widget", icon: "💬", label: "Widget chat started", desc: "A visitor opens chat", reason: "Arrives with widget chat rules" },
  { group: "LinkedIn", icon: "in", label: "Connection accepted", desc: "A LinkedIn invite is accepted", reason: "Arrives with the LinkedIn channel" },
  { group: "LinkedIn", icon: "in", label: "LinkedIn reply", desc: "A reply on LinkedIn", reason: "Arrives with the LinkedIn channel" },
  { group: "Proposals & revenue", icon: "❒", label: "Proposal sent", desc: "A proposal goes out", reason: "Arrives with proposals & payments" },
  { group: "Proposals & revenue", icon: "◔", label: "Proposal viewed", desc: "A prospect opens it", reason: "Arrives with proposals & payments" },
  { group: "Proposals & revenue", icon: "✓", label: "Proposal accepted", desc: "A proposal is signed", reason: "Arrives with proposals & payments" },
  { group: "Proposals & revenue", icon: "＄", label: "Payment succeeded", desc: "A payment is received", reason: "Arrives with proposals & payments" },
  { group: "Proposals & revenue", icon: "⚠", label: "Payment failed", desc: "A charge fails", reason: "Arrives with proposals & payments" },
  { group: "Proposals & revenue", icon: "🧾", label: "Invoice overdue", desc: "An invoice passes due", reason: "Arrives with proposals & payments" },
  { group: "Schedule & system", icon: "🕘", label: "On a schedule", desc: "A recurring date & time", reason: "Arrives with scheduled automations" },
  { group: "Schedule & system", icon: "⚯", label: "Incoming webhook", desc: "An external system pings us", reason: "Arrives with the webhooks integration" },
  { group: "Schedule & system", icon: "⚠", label: "Sender health drops", desc: "Deliverability falls", reason: "Arrives with sender-health triggers" },
  { group: "Schedule & system", icon: "⏸", label: "Agent paused / limit hit", desc: "An agent stops sending", reason: "Arrives with agent-status triggers" },
];

/** Honest-absence inputs the hosts provide (live senders scan · P1 has no
 *  capture backend, so hosts pass `leadCapture: false`). */
export interface TriggerConnectivity {
  email: boolean;
  leadCapture: boolean;
}

/**
 * Kinds whose events only exist once an email sender is connected: replies,
 * opens, clicks and unsubscribes ride the email pipeline, and sequence_quiet
 * times out a sequence that could never have sent. `meeting_booked` stays
 * available — stage moves fire it without any channel.
 */
const EMAIL_BACKED: ReadonlySet<CampaignRuleTriggerKind> = new Set([
  "reply_classified",
  "sequence_quiet",
  "email_opened",
  "link_clicked",
  "opted_out",
]);

export const TRIGGER_DISABLED_EMAIL = "Connect an email sender first";
export const TRIGGER_DISABLED_LEAD_CAPTURE = "Arrives with lead capture sources";

export interface TriggerAvailability {
  enabled: boolean;
  /** Owner-readable reason rendered under a DISABLED option (honest absence). */
  reason?: string;
}

export function triggerAvailability(
  kind: CampaignRuleTriggerKind,
  connected: TriggerConnectivity,
): TriggerAvailability {
  if (kind === "lead_captured" && !connected.leadCapture) {
    return { enabled: false, reason: TRIGGER_DISABLED_LEAD_CAPTURE };
  }
  if (EMAIL_BACKED.has(kind) && !connected.email) {
    return { enabled: false, reason: TRIGGER_DISABLED_EMAIL };
  }
  return { enabled: true };
}

/** The M1b strategy intents the creator's reply_classified multi-pick offers
 *  (labels + chip tints come from INTENT_TINT — the one vocabulary). */
export const REPLY_INTENT_OPTIONS: readonly string[] = [
  "interested",
  "booked",
  "objection_price",
  "objection_timing",
  "wrong_person",
  "info_request",
  "not_interested",
];

/**
 * "✦ Suggest more branches" (wizard step 2) — DETERMINISTIC goal-seeded
 * suggestions mirroring the canon subCampaignDefs (designed addition, flagged
 * in the fidelity log). Rule-based, never a model call — the honest split:
 * the SUGGESTIONS are mechanical, the DRAFT (if the owner picks AI in the
 * creator) is real AI via the sandbox composer.
 */
export function suggestedBranches(
  goal: string | null,
): Array<{ name: string; trigger: CampaignRuleTrigger }> {
  const interestedName: Record<string, string> = {
    book_appointments: "Interested — book a call",
    generate_leads: "Interested — qualify the lead",
    reactivate_leads: "Interested — win them back",
    drive_signups: "Interested — start the trial",
    collect_reviews: "Interested — request the review",
    promote_offer: "Interested — close the offer",
    fill_event: "Interested — confirm the seat",
    upsell_clients: "Interested — pitch the upgrade",
  };
  return [
    {
      name: interestedName[goal ?? ""] ?? "Interested follow-up",
      trigger: { kind: "reply_classified", intents: ["interested"] },
    },
    { name: "Re-engagement sequence", trigger: { kind: "sequence_quiet", days: 30 } },
  ];
}
