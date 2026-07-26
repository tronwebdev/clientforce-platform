/**
 * Pure trigger/condition matching (R1, DEC-074). Every trigger kind maps to
 * EXISTING bus event kinds (A9 — names ossify; the plan comment on the R1 PR
 * lists the verified mapping):
 *
 *   reply_classified — any `*.replied.v1` (email/sms/whatsapp) whose payload
 *                      intent is in the rule's set (there is NO separate
 *                      reply.classified event — the intent rides the payload)
 *   meeting_booked   — `call.booked.v1`, or `lead.stage_changed.v1` reaching
 *                      stage "booked" (A10: booked is a pipeline stage)
 *   opted_out        — `lead.unsubscribed.v1` / `sms.opted_out.v1`
 *   email_opened     — `email.opened.v1` (SendGrid webhook producer, F1-verified)
 *   link_clicked     — `email.clicked.v1` (same producer)
 *   lead_captured    — `form.submitted.v1` / `widget.lead_captured.v1` /
 *                      `linkedin.captured.v1`
 *   widget_chat_started — `widget.conversation_started.v1` (WID2, DEC-101): a
 *                      visitor opened a conversation on an embedded widget.
 *                      Distinct from lead_captured on purpose — starting a
 *                      chat is interest, handing over contact details is a
 *                      lead, and conflating them would fire every "new lead"
 *                      rule for every anonymous panel-opener
 *   sequence_quiet   — NEVER matches a bus event; the worker sweep evaluates it
 *   call_knowledge_gap — `voice.context_retrieved.v1` with a non-empty
 *                      `emptyFacets` (SPEC A, DEC-099): a real customer asked
 *                      something the record could not answer. ONE firing per
 *                      call, because the event is one summary per call
 *   meeting_rescheduled — `calendar.rescheduled.v1` (INT W2, DEC-094)
 *   meeting_canceled — `calendar.canceled.v1` (payload reason folds no-show in)
 *   before_meeting   — NEVER matches a bus event; the meeting sweep evaluates
 *                      it (the sequence_quiet pattern, re-arms per reschedule)
 *
 * DELIBERATELY UNMAPPED (INT W2 no-double-fire pin): `calendar.booked.v1` is
 * the booking RECORD — the booking service also publishes the ONE
 * `lead.stage_changed.v1` (toStage "booked") that carries meeting_booked;
 * mapping both would double-fire every rule and double-post Slack.
 */
import type { CampaignRuleTrigger } from "@clientforce/core";
import type { BusEvent } from "@clientforce/events";

const OPTED_OUT_EVENTS = new Set(["lead.unsubscribed.v1", "sms.opted_out.v1"]);
const LEAD_CAPTURED_EVENTS = new Set([
  "form.submitted.v1",
  "widget.lead_captured.v1",
  "linkedin.captured.v1",
]);

export function matchTrigger(
  trigger: CampaignRuleTrigger,
  event: Pick<BusEvent, "type" | "payload">,
): boolean {
  switch (trigger.kind) {
    case "reply_classified": {
      if (!event.type.endsWith(".replied.v1")) return false;
      const intent = (event.payload as { intent?: unknown }).intent;
      return typeof intent === "string" && trigger.intents.includes(intent);
    }
    case "meeting_booked": {
      if (event.type === "call.booked.v1") return true;
      if (event.type !== "lead.stage_changed.v1") return false;
      return (event.payload as { toStage?: unknown }).toStage === "booked";
    }
    case "opted_out":
      return OPTED_OUT_EVENTS.has(event.type);
    case "widget_chat_started":
      return event.type === "widget.conversation_started.v1";
    case "email_opened":
      return event.type === "email.opened.v1";
    case "link_clicked":
      return event.type === "email.clicked.v1";
    case "lead_captured":
      return LEAD_CAPTURED_EVENTS.has(event.type);
    case "meeting_rescheduled":
      return event.type === "calendar.rescheduled.v1";
    case "meeting_canceled":
      return event.type === "calendar.canceled.v1";
    case "payment_received":
      // INT W3 (DEC-095): the checkout ingest's record event IS the trigger
      // carrier (unlike calendar.booked.v1 there is no second announcement —
      // payments move no stage, so no double-fire surface exists).
      return event.type === "payment.received.v1";
    case "sequence_quiet":
      return false;
    case "call_knowledge_gap": {
      if (event.type !== "voice.context_retrieved.v1") return false;
      const empty = (event.payload as { emptyFacets?: unknown }).emptyFacets;
      // No gap, no fire — a call where everything was answered is the
      // common case and must stay silent.
      if (!Array.isArray(empty) || empty.length === 0) return false;
      // Absent/empty narrowing = any facet. Otherwise at least one of the
      // facets the owner cares about has to be among the gaps.
      if (!trigger.facets || trigger.facets.length === 0) return true;
      return empty.some((f) => typeof f === "string" && trigger.facets!.includes(f));
    }
    case "before_meeting":
      // NEVER a bus event — the meeting sweep evaluates it (fire-once per
      // (meeting, startAt); a reschedule re-arms under a new synthetic key).
      return false;
  }
}

/** Case-insensitive substring match — the keyword REFINEMENT condition. */
export function keywordHit(keywords: readonly string[], text: string): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
