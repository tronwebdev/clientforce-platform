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

/** R1-UI (DEC-088, additive): canon card/drawer glyphs per kind
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

/** R1-UI (DEC-088, additive): canon picker descriptions per kind. */
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
