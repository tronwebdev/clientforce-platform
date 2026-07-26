/**
 * INT W5 (DEC-101) — the Zapier app's surface, DERIVED from the registries the
 * rest of the product already enumerates. Nothing here is hand-listed, because
 * a hand-listed parallel surface is a surface that silently rots: the picker
 * learned this (`ACCOUNT_ACTION_OPTIONS` enumerates core's kinds verbatim) and
 * Zapier inherits the same discipline.
 *
 * Two registries, two sources of truth, both pinned at COMPILE time:
 *
 *  1. `ZAPIER_ACTION_EXPOSURE` — a NON-PARTIAL Record over core's
 *     `CampaignRuleActionKind`. Every rule-action kind must carry an explicit
 *     decision: exposed as a Zapier action, or declined WITH A REASON. Adding a
 *     kind to `campaignRuleActionSchema` therefore fails this file to compile
 *     until someone decides what Zapier should do with it. Capabilities that do
 *     not exist yet (forms, proposals) simply have no kind, so they cannot
 *     appear — and they surface automatically the day they are registered.
 *
 *  2. `ZAPIER_TRIGGERS` — keyed specs whose `eventTypes` are typed as the
 *     catalog's `EventType`, so a trigger can never name an event the bus does
 *     not publish. Triggers read the PERSISTED `Event` log (the same emissions
 *     the webhook action publishes), which is why they need no new delivery
 *     path, no subscription store and no SSRF surface.
 *
 * The inbound writes (create/update contact, enroll) live in
 * `@clientforce/core`'s `zapier.ts`: they create or route records rather than
 * acting on an existing enrollment, so they are a different category, pinned
 * exhaustively in their own right (owner ruling, 2026-07-26).
 */
import type { CampaignRuleActionKind } from "@clientforce/core";
import { ZAPIER_INBOUND_WRITE_KINDS, type ZapierInboundWriteKind } from "@clientforce/core";
import type { EventType } from "@clientforce/events";

// ── Actions: the exposure decision, one per rule-action kind ─────────────────

export type ZapierActionExposure =
  | {
      exposed: true;
      /** Zapier "create" key — stable, snake_case, never renamed once shipped. */
      key: string;
      /** Menu label a Zapier user picks. Must not overstate what the step does. */
      label: string;
      help: string;
    }
  | { exposed: false; reason: string };

/**
 * NON-PARTIAL BY DESIGN. A new `CampaignRuleActionKind` breaks this build until
 * it is decided — that is the whole mechanism the owner asked for, and it is
 * why this is a Record rather than a filtered list.
 */
export const ZAPIER_ACTION_EXPOSURE: Record<CampaignRuleActionKind, ZapierActionExposure> = {
  // Campaign-graph scoped: a node id is meaningful only inside ONE campaign's
  // graph, so an external caller could only ever pass a dangling reference.
  // Already excluded from ACCOUNT_ACTION_KINDS for the same reason.
  move_to_node: {
    exposed: false,
    reason: "targets a node in a specific campaign graph — dangling for an external caller",
  },
  end_enrollment: {
    exposed: true,
    key: "end_enrollment",
    label: "End enrollment",
    help: "Stop the contact's campaign. Their run is cancelled and the enrollment is marked done.",
  },
  pause_enrollment: {
    exposed: true,
    key: "pause_enrollment",
    label: "Pause enrollment",
    help: "Pause the contact's campaign. Nothing further sends until it is resumed.",
  },
  suppress_contact: {
    exposed: true,
    key: "suppress_contact",
    label: "Suppress contact",
    help: "Add the contact to the suppression list and opt them out. Use this to honour an unsubscribe recorded in another tool.",
  },
  set_stage: {
    exposed: true,
    key: "set_stage",
    label: "Set pipeline stage",
    help: "Move the contact to a pipeline stage. Publishes a stage-changed event only when the stage actually changes.",
  },
  notify_team: {
    exposed: true,
    key: "notify_team",
    label: "Notify the team",
    help: "Post an internal notification about this contact. Goes to your team, never to the contact.",
  },
  add_tag: {
    exposed: true,
    key: "add_tag",
    label: "Add tag",
    help: "Add a tag to the contact. Tags are a set — adding one twice is harmless.",
  },
  // These are FLAGS, not sends (Q-039). Labelled so a Zapier user cannot read
  // them as "send a message": they change what the NEXT boundary-gated message
  // says, and if no such message follows, nothing happens.
  send_booking_link: {
    exposed: true,
    key: "flag_booking_link",
    label: "Include booking link in the next message",
    help: "Flags the contact so the next message Clientforce composes carries your booking link. This does NOT send anything on its own.",
  },
  send_payment_link: {
    exposed: true,
    key: "flag_payment_link",
    label: "Include payment link in the next message",
    help: "Flags the contact so the next message Clientforce composes carries your payment link. This does NOT send anything on its own.",
  },
  // Circular from Zapier's side: Zapier is already the webhook destination, so
  // "have Clientforce POST a webhook" is a step a Zap would never want.
  send_webhook: {
    exposed: false,
    reason: "Zapier is itself the webhook destination — exposing it would only create a round trip",
  },
  create_crm_deal: {
    exposed: true,
    key: "create_crm_deal",
    label: "Create CRM deal",
    help: "Push the contact into HubSpot as a deal. Requires the HubSpot integration to be connected.",
  },
  update_deal_stage: {
    exposed: true,
    key: "update_deal_stage",
    label: "Update CRM deal stage",
    help: "Move the contact's HubSpot deal to a named stage. Refuses if no deal has been created yet.",
  },
  // Held for v1: the engine's causation-depth cap bounds NESTED automations,
  // but a Zap re-entering from OUTSIDE starts at depth 0 every time. A Zap that
  // triggers on automation activity and calls this would loop without bound,
  // spending credits and sends on every pass. Needs its own re-entry budget
  // before it is safe to expose (Q-059).
  run_automation: {
    exposed: false,
    reason:
      "external re-entry restarts causation depth, so a Zap could loop unbounded — needs a re-entry budget first (Q-059)",
  },
};

/** The exposed rule-actions, in registry order — what the manifest renders. */
export const ZAPIER_EXPOSED_ACTIONS = (
  Object.entries(ZAPIER_ACTION_EXPOSURE) as [CampaignRuleActionKind, ZapierActionExposure][]
)
  .filter((entry): entry is [CampaignRuleActionKind, Extract<ZapierActionExposure, { exposed: true }>] =>
    entry[1].exposed,
  )
  .map(([kind, spec]) => ({ kind, ...spec }));

// ── Triggers: derived over the catalog, read from the persisted Event log ────

export const ZAPIER_TRIGGER_KEYS = [
  "meeting_booked",
  "reply_received",
  "stage_changed",
  "contact_enrolled",
  "call_knowledge_gap",
] as const;
export type ZapierTriggerKey = (typeof ZAPIER_TRIGGER_KEYS)[number];

export interface ZapierTriggerSpec {
  label: string;
  help: string;
  /** Typed as the catalog's union — a trigger cannot name an unpublished event. */
  eventTypes: readonly EventType[];
  /**
   * Optional payload predicate, for events whose OCCURRENCE is not the signal.
   * Mirrors what the rule matcher does, so the Zap and a rule agree on what
   * "happened" means rather than each deciding separately.
   */
  matches?: (payload: Record<string, unknown>) => boolean;
}

/** NON-PARTIAL: a new trigger key must carry a spec. */
export const ZAPIER_TRIGGERS: Record<ZapierTriggerKey, ZapierTriggerSpec> = {
  meeting_booked: {
    label: "Meeting booked",
    help: "A meeting was booked for a contact.",
    eventTypes: ["calendar.booked.v1"],
  },
  reply_received: {
    label: "Reply received",
    help: "A contact replied on any channel — email, SMS or WhatsApp.",
    eventTypes: ["email.replied.v1", "sms.replied.v1", "whatsapp.replied.v1"],
  },
  stage_changed: {
    label: "Pipeline stage changed",
    help: "A contact moved to a different pipeline stage.",
    eventTypes: ["lead.stage_changed.v1"],
  },
  // The dispatch asked for "campaign launched". No campaign-LIFECYCLE event
  // exists in the catalog (nothing is published when a campaign goes live), and
  // A9 forbids inventing trigger-only event kinds. The honest nearest emission
  // is per-contact enrolment, so that is what this trigger is NAMED after —
  // calling it "campaign launched" would describe something the payload cannot
  // support. A real campaign-lifecycle event is filed as Q-058.
  contact_enrolled: {
    label: "Contact enrolled in campaign",
    help: "A contact was enrolled into one of your campaigns.",
    eventTypes: ["lead.enrolled.v1"],
  },
  call_knowledge_gap: {
    label: "Call hit a knowledge gap",
    help: "A live call hit a question your knowledge base could not answer.",
    eventTypes: ["voice.context_retrieved.v1"],
    // The event is published for EVERY retrieval; the gap is the non-empty
    // facet list. Same predicate the rule matcher applies, so a Zap and a rule
    // never disagree about whether a gap occurred.
    matches: (payload) => {
      const empty = payload.emptyFacets;
      return Array.isArray(empty) && empty.length > 0;
    },
  },
};

/** Every event type any trigger reads — the rail's poll filter. */
export const ZAPIER_TRIGGER_EVENT_TYPES: readonly EventType[] = [
  ...new Set(Object.values(ZAPIER_TRIGGERS).flatMap((t) => [...t.eventTypes])),
];

export const isZapierTriggerKey = (value: string): value is ZapierTriggerKey =>
  (ZAPIER_TRIGGER_KEYS as readonly string[]).includes(value);

// ── The app manifest, built from both registries ─────────────────────────────

export interface ZapierManifestTrigger {
  key: ZapierTriggerKey;
  noun: string;
  label: string;
  help: string;
}
export interface ZapierManifestCreate {
  key: string;
  label: string;
  help: string;
  /** Which registry the step came from — the manifest never hides its origin. */
  origin: "rule_action" | "inbound_write";
}
export interface ZapierManifest {
  version: number;
  triggers: ZapierManifestTrigger[];
  creates: ZapierManifestCreate[];
}

const INBOUND_WRITE_MANIFEST: Record<ZapierInboundWriteKind, { label: string; help: string }> = {
  create_contact: {
    label: "Create contact",
    help: "Create a contact in Clientforce. Needs an email or a phone number.",
  },
  update_contact: {
    label: "Update contact",
    help: "Update an existing contact matched by email or phone. Never creates one — a miss is reported so a typo cannot fill your workspace with junk.",
  },
  enroll_in_campaign: {
    label: "Enroll contact in campaign",
    help: "Enroll a contact into a campaign. Suppression, opt-out and email-validation checks all still apply.",
  },
};

/**
 * The manifest the Zapier app definition renders. Built by ENUMERATION, so the
 * published app and the product's vocabulary cannot drift: a kind that is not
 * registered has no entry, and a registered kind that nobody decided about
 * fails the build long before it reaches Zapier.
 */
export function buildZapierManifest(version = 1): ZapierManifest {
  return {
    version,
    triggers: ZAPIER_TRIGGER_KEYS.map((key) => ({
      key,
      noun: ZAPIER_TRIGGERS[key].label,
      label: ZAPIER_TRIGGERS[key].label,
      help: ZAPIER_TRIGGERS[key].help,
    })),
    creates: [
      ...ZAPIER_INBOUND_WRITE_KINDS.map((kind) => ({
        key: kind,
        label: INBOUND_WRITE_MANIFEST[kind].label,
        help: INBOUND_WRITE_MANIFEST[kind].help,
        origin: "inbound_write" as const,
      })),
      ...ZAPIER_EXPOSED_ACTIONS.map((a) => ({
        key: a.key,
        label: a.label,
        help: a.help,
        origin: "rule_action" as const,
      })),
    ],
  };
}
