/**
 * R1 (DEC-074): pure trigger matching — every trigger kind against its
 * verified bus-event mapping (see the R1 PR plan comment).
 */
import { describe, expect, it } from "vitest";
import type { BusEvent } from "@clientforce/events";
import { keywordHit, matchTrigger } from "../src/match";

const event = (type: string, payload: unknown = {}): Pick<BusEvent, "type" | "payload"> =>
  ({ type, payload }) as Pick<BusEvent, "type" | "payload">;

describe("matchTrigger", () => {
  it("reply_classified matches any *.replied.v1 whose intent is in the rule's set", () => {
    const trigger = {
      kind: "reply_classified",
      intents: ["interested", "objection_price"],
    } as const;
    expect(
      matchTrigger(trigger, event("email.replied.v1", { messageId: "m", intent: "interested" })),
    ).toBe(true);
    expect(
      matchTrigger(
        trigger,
        event("sms.replied.v1", { messageId: "m", body: "x", intent: "objection_price" }),
      ),
    ).toBe(true);
    expect(
      matchTrigger(trigger, event("whatsapp.replied.v1", { messageId: "m", intent: "interested" })),
    ).toBe(true);
    expect(
      matchTrigger(trigger, event("email.replied.v1", { messageId: "m", intent: "ooo" })),
    ).toBe(false);
    expect(matchTrigger(trigger, event("email.opened.v1", { messageId: "m" }))).toBe(false);
    expect(matchTrigger(trigger, event("email.replied.v1", { messageId: "m" }))).toBe(false);
  });

  it("meeting_booked matches call.booked.v1 and the stage move to booked (A10)", () => {
    const trigger = { kind: "meeting_booked" } as const;
    expect(matchTrigger(trigger, event("call.booked.v1", { callId: "c" }))).toBe(true);
    expect(
      matchTrigger(
        trigger,
        event("lead.stage_changed.v1", { fromStage: "new", toStage: "booked" }),
      ),
    ).toBe(true);
    expect(
      matchTrigger(
        trigger,
        event("lead.stage_changed.v1", { fromStage: "new", toStage: "interested" }),
      ),
    ).toBe(false);
    expect(
      matchTrigger(trigger, event("email.replied.v1", { messageId: "m", intent: "booked" })),
    ).toBe(false);
  });

  it("opted_out matches the unsubscribe/opt-out events", () => {
    const trigger = { kind: "opted_out" } as const;
    expect(matchTrigger(trigger, event("lead.unsubscribed.v1", { channel: "email" }))).toBe(true);
    expect(matchTrigger(trigger, event("sms.opted_out.v1", { messageId: "m" }))).toBe(true);
    expect(matchTrigger(trigger, event("email.bounced.v1", { messageId: "m" }))).toBe(false);
  });

  it("engagement triggers match their SendGrid-webhook events (F1-verified producers)", () => {
    expect(
      matchTrigger({ kind: "email_opened" }, event("email.opened.v1", { messageId: "m" })),
    ).toBe(true);
    expect(
      matchTrigger(
        { kind: "email_opened" },
        event("email.clicked.v1", { messageId: "m", link: "x" }),
      ),
    ).toBe(false);
    expect(
      matchTrigger(
        { kind: "link_clicked" },
        event("email.clicked.v1", { messageId: "m", link: "x" }),
      ),
    ).toBe(true);
    expect(
      matchTrigger({ kind: "link_clicked" }, event("email.opened.v1", { messageId: "m" })),
    ).toBe(false);
  });

  it("lead_captured matches the three capture events", () => {
    const trigger = { kind: "lead_captured" } as const;
    expect(matchTrigger(trigger, event("form.submitted.v1", { formId: "f", fields: {} }))).toBe(
      true,
    );
    expect(
      matchTrigger(trigger, event("widget.lead_captured.v1", { widgetId: "w", fields: {} })),
    ).toBe(true);
    expect(matchTrigger(trigger, event("linkedin.captured.v1", { fields: {} }))).toBe(true);
    expect(matchTrigger(trigger, event("lead.enrolled.v1", {}))).toBe(false);
  });

  it("sequence_quiet NEVER matches a bus event — it is the sweep's trigger", () => {
    const trigger = { kind: "sequence_quiet", days: 30 } as const;
    for (const type of ["email.replied.v1", "lead.stage_changed.v1", "email.opened.v1"]) {
      expect(matchTrigger(trigger, event(type, { messageId: "m", intent: "interested" }))).toBe(
        false,
      );
    }
  });

  // ── SPEC A (DEC-099): call_knowledge_gap ──────────────────────────────────
  describe("call_knowledge_gap — a caller asked what the record couldn't answer", () => {
    const gap = (emptyFacets: string[], over: Record<string, unknown> = {}) =>
      event("voice.context_retrieved.v1", {
        callId: "c1",
        lookups: 2,
        found: 1,
        empty: emptyFacets.length,
        refused: 0,
        emptyFacets,
        ...over,
      });

    it("fires when a lookup came back empty", () => {
      expect(matchTrigger({ kind: "call_knowledge_gap" }, gap(["knowledge"]))).toBe(true);
    });

    it("stays SILENT when the call answered everything — the common case", () => {
      expect(matchTrigger({ kind: "call_knowledge_gap" }, gap([]))).toBe(false);
    });

    it("a REFUSED lookup is not a gap — a timeout is infrastructure, not a hole", () => {
      // Training the owner to fill a gap that was never there would be worse
      // than staying quiet: the record may have had the answer all along.
      const refusedOnly = event("voice.context_retrieved.v1", {
        callId: "c1",
        lookups: 1,
        found: 0,
        empty: 0,
        refused: 1,
        emptyFacets: [],
      });
      expect(matchTrigger({ kind: "call_knowledge_gap" }, refusedOnly)).toBe(false);
    });

    it("narrows to the facets the owner cares about", () => {
      const trigger = { kind: "call_knowledge_gap", facets: ["knowledge"] } as const;
      expect(matchTrigger(trigger, gap(["knowledge"]))).toBe(true);
      expect(matchTrigger(trigger, gap(["knowledge", "history"]))).toBe(true);
      // An empty `history` lookup on a first-ever call is simply TRUE, not a
      // knowledge gap — narrowing exists so that never pages anyone.
      expect(matchTrigger(trigger, gap(["history"]))).toBe(false);
    });

    it("absent or empty narrowing means any facet", () => {
      expect(matchTrigger({ kind: "call_knowledge_gap" }, gap(["profile"]))).toBe(true);
      expect(matchTrigger({ kind: "call_knowledge_gap", facets: [] }, gap(["profile"]))).toBe(true);
    });

    it("ignores every other event type", () => {
      for (const type of ["call.completed.v1", "email.replied.v1", "voice.compose_refused.v1"]) {
        expect(matchTrigger({ kind: "call_knowledge_gap" }, event(type, {}))).toBe(false);
      }
    });

    it("fires ONCE per call — the event is one summary, not one per lookup", () => {
      // The mass-fire guard (the Q-031 concern applied up front): a call that
      // ran a dozen lookups still produces exactly one matchable event.
      const oneCall = gap(["knowledge", "profile", "bookings"], { lookups: 12, empty: 3 });
      expect(matchTrigger({ kind: "call_knowledge_gap" }, oneCall)).toBe(true);
    });
  });

  // ── INT W2 (DEC-094) ───────────────────────────────────────────────────────
  it("meeting_rescheduled matches calendar.rescheduled.v1 only", () => {
    const trigger = { kind: "meeting_rescheduled" } as const;
    expect(
      matchTrigger(
        trigger,
        event("calendar.rescheduled.v1", {
          provider: "calendly",
          meetingId: "m",
          fromStartAt: "a",
          toStartAt: "b",
        }),
      ),
    ).toBe(true);
    expect(
      matchTrigger(
        trigger,
        event("calendar.canceled.v1", {
          provider: "calendly",
          meetingId: "m",
          startAt: "a",
          reason: "canceled",
        }),
      ),
    ).toBe(false);
    expect(
      matchTrigger(
        trigger,
        event("calendar.booked.v1", { provider: "calendly", meetingId: "m", startAt: "a" }),
      ),
    ).toBe(false);
  });

  it("meeting_canceled matches calendar.canceled.v1 (reason folds no-show in)", () => {
    const trigger = { kind: "meeting_canceled" } as const;
    expect(
      matchTrigger(
        trigger,
        event("calendar.canceled.v1", {
          provider: "calendly",
          meetingId: "m",
          startAt: "a",
          reason: "canceled",
        }),
      ),
    ).toBe(true);
    expect(
      matchTrigger(
        trigger,
        event("calendar.canceled.v1", {
          provider: "calendly",
          meetingId: "m",
          startAt: "a",
          reason: "no_show",
        }),
      ),
    ).toBe(true);
    expect(
      matchTrigger(
        trigger,
        event("calendar.rescheduled.v1", {
          provider: "calendly",
          meetingId: "m",
          fromStartAt: "a",
          toStartAt: "b",
        }),
      ),
    ).toBe(false);
  });

  it("before_meeting NEVER matches a bus event — the meeting sweep evaluates it", () => {
    const trigger = { kind: "before_meeting", hours: 24 } as const;
    for (const type of [
      "calendar.booked.v1",
      "calendar.rescheduled.v1",
      "lead.stage_changed.v1",
      "email.replied.v1",
    ]) {
      expect(matchTrigger(trigger, event(type, {}))).toBe(false);
    }
  });

  it("REGRESSION PIN (no double fire): calendar.booked.v1 does NOT match meeting_booked — the stage change is the one trigger carrier", () => {
    const trigger = { kind: "meeting_booked" } as const;
    expect(
      matchTrigger(
        trigger,
        event("calendar.booked.v1", {
          provider: "calendly",
          meetingId: "m",
          startAt: "2026-07-28T15:00:00Z",
        }),
      ),
    ).toBe(false);
    // …while the booking service's ONE stage change still fires it.
    expect(
      matchTrigger(
        trigger,
        event("lead.stage_changed.v1", { fromStage: "new", toStage: "booked", goalKey: "g" }),
      ),
    ).toBe(true);
  });

  // ── INT W3 (DEC-095) ───────────────────────────────────────────────────────
  it("payment_received matches payment.received.v1 only — the record IS the trigger carrier (no second announcement exists)", () => {
    const trigger = { kind: "payment_received" } as const;
    expect(
      matchTrigger(trigger, event("payment.received.v1", { amount: 50000, provider: "stripe" })),
    ).toBe(true);
    for (const type of [
      "lead.stage_changed.v1",
      "calendar.booked.v1",
      "email.replied.v1",
      "credits.consumed.v1",
    ]) {
      expect(matchTrigger(trigger, event(type, {}))).toBe(false);
    }
  });
});

describe("keywordHit", () => {
  it("is a case-insensitive contains over any keyword", () => {
    expect(keywordHit(["Pricing", "budget"], "What's your PRICING like?")).toBe(true);
    expect(keywordHit(["pricing"], "no thanks")).toBe(false);
  });
});

describe("widget_chat_started (WID2, DEC-102)", () => {
  it("matches the widget conversation event", () => {
    expect(
      matchTrigger({ kind: "widget_chat_started" }, event("widget.conversation_started.v1", {})),
    ).toBe(true);
  });

  it("is NOT lead_captured, in either direction", () => {
    // Starting a chat is interest; handing over contact details is a lead.
    // Conflating them would fire every "new lead" rule for every anonymous
    // visitor who ever opened the panel (the Q-031 mass-fire concern).
    expect(
      matchTrigger({ kind: "widget_chat_started" }, event("widget.lead_captured.v1", {})),
    ).toBe(false);
    expect(
      matchTrigger({ kind: "lead_captured" }, event("widget.conversation_started.v1", {})),
    ).toBe(false);
  });
});
