/**
 * W2 (#94) — the trigger DISPLAY map over R1's `campaignRuleTriggerSchema`:
 * exhaustive kind coverage drift-guarded against the schema itself (never a
 * parallel union), canon chip strings, the honest-absence availability
 * mapping, and the deterministic goal-seeded suggestions.
 */
import { describe, expect, it } from "vitest";
import { campaignRuleTriggerSchema } from "@clientforce/core";
import type { CampaignRuleTrigger, CampaignRuleTriggerKind } from "@clientforce/core";
import { INTENT_TINT } from "../lib/intents";
import {
  REPLY_INTENT_OPTIONS,
  suggestedBranches,
  TRIGGER_DISABLED_EMAIL,
  TRIGGER_DISABLED_LEAD_CAPTURE,
  TRIGGER_OPTIONS,
  triggerAvailability,
  triggerChip,
  triggerLabel,
} from "../lib/triggers";

/** R1's kinds, read from the schema itself — the one source of truth. */
const SCHEMA_KINDS = campaignRuleTriggerSchema.options.map(
  (o) => o.shape.kind.value,
) as CampaignRuleTriggerKind[];

describe("trigger display map (lib/triggers)", () => {
  it("covers exactly R1's kinds — the display layer can never fork the union", () => {
    expect(new Set(TRIGGER_OPTIONS.map((o) => o.kind))).toEqual(new Set(SCHEMA_KINDS));
    // INT W2 (DEC-094): + meeting_rescheduled · meeting_canceled · before_meeting.
    // INT W3 (DEC-095): + payment_received.
    expect(TRIGGER_OPTIONS).toHaveLength(11);
  });

  it("owner labels are the canon strings", () => {
    expect(Object.fromEntries(TRIGGER_OPTIONS.map((o) => [o.kind, o.label]))).toEqual({
      reply_classified: "Reply classified as…",
      sequence_quiet: "No reply for N days",
      email_opened: "Email opened",
      link_clicked: "Link clicked",
      meeting_booked: "Meeting booked",
      opted_out: "Unsubscribed / opted out",
      lead_captured: "Form / lead captured",
      // INT W2: labels verbatim from the retired canon absent entries.
      meeting_rescheduled: "Meeting rescheduled",
      meeting_canceled: "Meeting canceled / no-show",
      before_meeting: "Before a meeting",
      // INT W3: the canon literal from the retired absent entry.
      payment_received: "Payment succeeded",
    });
    for (const o of TRIGGER_OPTIONS) expect(triggerLabel(o.kind)).toBe(o.label);
  });

  it("reply_classified chips carry the INTENT_TINT labels VERBATIM", () => {
    expect(triggerChip({ kind: "reply_classified", intents: ["interested"] })).toBe(
      `💬 Reply: ${INTENT_TINT.interested!.label}`,
    );
    expect(triggerChip({ kind: "reply_classified", intents: ["interested"] })).toBe("💬 Reply: Interested");
    expect(
      triggerChip({ kind: "reply_classified", intents: ["objection_price", "wrong_person"] }),
    ).toBe("💬 Reply: Price objection · Wrong person");
    // Unknown intents render themselves in the chip (the C2.9 verbatim rule).
    expect(triggerChip({ kind: "reply_classified", intents: ["mystery_value"] })).toBe("💬 Reply: mystery_value");
  });

  it("sequence_quiet chips render the canon '⏱ No reply · N days' (singular-aware)", () => {
    expect(triggerChip({ kind: "sequence_quiet", days: 30 })).toBe("⏱ No reply · 30 days");
    expect(triggerChip({ kind: "sequence_quiet", days: 1 })).toBe("⏱ No reply · 1 day");
  });

  it("before_meeting chips render '⏰ Before meeting · N hours' (singular-aware) — INT W2", () => {
    expect(triggerChip({ kind: "before_meeting", hours: 24 })).toBe("⏰ Before meeting · 24 hours");
    expect(triggerChip({ kind: "before_meeting", hours: 1 })).toBe("⏰ Before meeting · 1 hour");
  });

  it("parameterless kinds chip as their label; every entry's chip agrees with triggerChip", () => {
    const cases: CampaignRuleTrigger[] = [
      { kind: "email_opened" },
      { kind: "link_clicked" },
      { kind: "meeting_booked" },
      { kind: "meeting_rescheduled" },
      { kind: "meeting_canceled" },
      { kind: "payment_received" },
      { kind: "opted_out" },
      { kind: "lead_captured" },
    ];
    for (const t of cases) expect(triggerChip(t)).toBe(triggerLabel(t.kind));
    for (const o of TRIGGER_OPTIONS) {
      for (const t of cases) expect(o.chip(t)).toBe(triggerChip(t));
    }
  });

  it("availability maps exhaustively: email-backed kinds gate on the sender, lead_captured on capture, meeting kinds never", () => {
    const emailBacked: CampaignRuleTriggerKind[] = [
      "reply_classified",
      "sequence_quiet",
      "email_opened",
      "link_clicked",
      "opted_out",
    ];
    // INT W2: the meeting kinds ride calendar detection / the meeting sweep,
    // never email — always enabled (the meeting_booked precedent).
    // INT W3: payment_received rides payment detection, never email — the
    // same always-on stance (the meeting_booked precedent).
    const alwaysOn: CampaignRuleTriggerKind[] = [
      "meeting_booked",
      "meeting_rescheduled",
      "meeting_canceled",
      "before_meeting",
      "payment_received",
    ];
    for (const kind of SCHEMA_KINDS) {
      // fully connected → everything picks
      expect(triggerAvailability(kind, { email: true, leadCapture: true })).toEqual({ enabled: true });
      const bare = triggerAvailability(kind, { email: false, leadCapture: false });
      if (emailBacked.includes(kind)) {
        expect(bare).toEqual({ enabled: false, reason: TRIGGER_DISABLED_EMAIL });
      } else if (kind === "lead_captured") {
        expect(bare).toEqual({ enabled: false, reason: TRIGGER_DISABLED_LEAD_CAPTURE });
      } else {
        expect(alwaysOn).toContain(kind);
        expect(bare).toEqual({ enabled: true });
      }
      // each flag gates only its own kinds
      expect(triggerAvailability(kind, { email: true, leadCapture: false }).enabled).toBe(
        kind !== "lead_captured",
      );
      expect(triggerAvailability(kind, { email: false, leadCapture: true }).enabled).toBe(
        !emailBacked.includes(kind),
      );
    }
    expect(TRIGGER_DISABLED_EMAIL).toBe("Connect an email sender first");
    expect(TRIGGER_DISABLED_LEAD_CAPTURE).toBe("Arrives with lead capture sources");
  });

  it("the reply multi-pick offers the M1b strategy intents, all known to INTENT_TINT", () => {
    expect([...REPLY_INTENT_OPTIONS]).toEqual([
      "interested",
      "booked",
      "objection_price",
      "objection_timing",
      "wrong_person",
      "info_request",
      "not_interested",
    ]);
    for (const i of REPLY_INTENT_OPTIONS) expect(INTENT_TINT[i]).toBeDefined();
  });

  it("suggestedBranches is deterministic, goal-seeded, and R1-parseable", () => {
    const a = suggestedBranches("book_appointments");
    expect(a).toEqual(suggestedBranches("book_appointments"));
    expect(a).toEqual([
      { name: "Interested — book a call", trigger: { kind: "reply_classified", intents: ["interested"] } },
      { name: "Re-engagement sequence", trigger: { kind: "sequence_quiet", days: 30 } },
    ]);
    // unknown/custom goals fall back to the generic name, same triggers
    expect(suggestedBranches("custom")[0]!.name).toBe("Interested follow-up");
    expect(suggestedBranches(null)[0]!.name).toBe("Interested follow-up");
    for (const s of [...a, ...suggestedBranches(null)]) {
      expect(campaignRuleTriggerSchema.safeParse(s.trigger).success).toBe(true);
    }
  });
});
