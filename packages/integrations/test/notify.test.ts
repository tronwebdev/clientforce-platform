/**
 * INT W1 (DEC-093): pure notifier units — the event→kind match matrix (the
 * matchTrigger meeting_booked parity) + deterministic notification copy.
 */
import { describe, expect, it } from "vitest";
import type { BusEvent } from "@clientforce/events";
import { SLACK_NOTIFICATION_KINDS } from "@clientforce/core";
import { matchNotificationKind, notificationText } from "../src/notify";

const event = (type: string, payload: unknown = {}): BusEvent => ({
  id: "evt1",
  workspaceId: "ws1",
  type: type as BusEvent["type"],
  contactId: null,
  enrollmentId: null,
  campaignId: null,
  senderId: null,
  payload,
  occurredAt: new Date(0).toISOString(),
});

describe("matchNotificationKind", () => {
  it("maps every reply channel to new_reply", () => {
    for (const t of ["email.replied.v1", "sms.replied.v1", "whatsapp.replied.v1"]) {
      expect(matchNotificationKind(event(t, { intent: "interested" }))).toBe("new_reply");
    }
  });

  it("maps call.booked and stage→booked to meeting_booked (the matchTrigger predicate)", () => {
    expect(matchNotificationKind(event("call.booked.v1", { callId: "c1" }))).toBe("meeting_booked");
    expect(
      matchNotificationKind(event("lead.stage_changed.v1", { fromStage: "new", toStage: "booked" })),
    ).toBe("meeting_booked");
  });

  it("maps a goal-completing stage change to goal_completed — but booked wins when both apply", () => {
    expect(
      matchNotificationKind(
        event("lead.stage_changed.v1", { fromStage: "new", toStage: "won", goalKey: "close_deal", label: "Deal closed" }),
      ),
    ).toBe("goal_completed");
    expect(
      matchNotificationKind(
        event("lead.stage_changed.v1", { fromStage: "new", toStage: "booked", goalKey: "book_meeting" }),
      ),
    ).toBe("meeting_booked");
  });

  it("never matches integration or unrelated events (loop safety)", () => {
    expect(matchNotificationKind(event("integration.notified.v1", { provider: "slack", kind: "new_reply" }))).toBeNull();
    expect(matchNotificationKind(event("email.sent.v1"))).toBeNull();
    expect(matchNotificationKind(event("lead.stage_changed.v1", { fromStage: "a", toStage: "b" }))).toBeNull();
  });

  it("INT W2 REGRESSION PIN: calendar.* record events NEVER notify — the stage change is the one carrier", () => {
    // The booking service publishes calendar.booked.v1 AND the stage change
    // per booking; mapping both would double-post every meeting_booked.
    expect(
      matchNotificationKind(event("calendar.booked.v1", { provider: "calendly", meetingId: "m1", startAt: "2026-07-28T15:00:00Z" })),
    ).toBeNull();
    expect(
      matchNotificationKind(event("calendar.rescheduled.v1", { provider: "calendly", meetingId: "m1", fromStartAt: "a", toStartAt: "b" })),
    ).toBeNull();
    expect(
      matchNotificationKind(event("calendar.canceled.v1", { provider: "calendly", meetingId: "m1", startAt: "a", reason: "canceled" })),
    ).toBeNull();
  });

  it("every SLACK_NOTIFICATION_KINDS value is reachable from some event (vocabulary drift guard)", () => {
    const reachable = new Set(
      [
        event("email.replied.v1", { intent: "interested" }),
        event("call.booked.v1", { callId: "c" }),
        event("lead.stage_changed.v1", { fromStage: "a", toStage: "won", goalKey: "g" }),
      ].map((e) => matchNotificationKind(e)),
    );
    for (const kind of SLACK_NOTIFICATION_KINDS) expect(reachable.has(kind)).toBe(true);
  });
});

describe("notificationText", () => {
  it("is deterministic, owner-readable, and degrades without a contact", () => {
    expect(notificationText("new_reply", { contact: "Ada Lovelace", intent: "objection_price" })).toBe(
      "↩ New reply from Ada Lovelace — objection price",
    );
    expect(notificationText("new_reply", {})).toBe("↩ New reply");
    expect(notificationText("meeting_booked", { contact: "Ada" })).toBe("📅 Meeting booked with Ada");
    expect(notificationText("goal_completed", { label: "Deal closed", contact: "Ada" })).toBe(
      "🎯 Goal completed — Deal closed (Ada)",
    );
    expect(notificationText("notify_team", { note: "Hot lead!" })).toBe("🔔 Hot lead!");
    expect(notificationText("notify_team", {})).toBe("🔔 Automation rule fired");
  });
});
