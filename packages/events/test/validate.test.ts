import { describe, expect, it } from "vitest";
import { EVENT_TYPES, EventValidationError, validateEvent } from "../src/index";

describe("validateEvent", () => {
  it("accepts a well-formed email.replied.v1 and normalizes refs", () => {
    const event = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.EMAIL_REPLIED,
      payload: { messageId: "m1", intent: "interested" },
    });
    expect(event.type).toBe("email.replied.v1");
    expect(event.payload).toMatchObject({ intent: "interested" });
    expect(event.contactId).toBeNull();
  });

  it("rejects an unknown event type with a clear error — incl. the de-canonized lead.replied (A9/DEC-018)", () => {
    expect(() =>
      validateEvent({ workspaceId: "ws1", type: "not.a.real.event", payload: {} }),
    ).toThrow(EventValidationError);
    expect(() =>
      validateEvent({
        workspaceId: "ws1",
        type: "lead.replied.v1",
        payload: { intent: "interested" },
      }),
    ).toThrow(/Unknown event type/);
  });

  it("rejects a payload missing a required field", () => {
    expect(() =>
      validateEvent({ workspaceId: "ws1", type: EVENT_TYPES.EMAIL_REPLIED, payload: {} }),
    ).toThrow(/Invalid payload for "email.replied.v1"/);
  });

  it("rejects an intent outside the prototype inboxCats label set (DEC-034)", () => {
    for (const bad of ["maybe", "not_now", "positive", "unknown"]) {
      expect(() =>
        validateEvent({
          workspaceId: "ws1",
          type: EVENT_TYPES.EMAIL_REPLIED,
          payload: { messageId: "m1", intent: bad },
        }),
      ).toThrow(EventValidationError);
    }
  });

  it("rejects a missing workspaceId (envelope)", () => {
    expect(() =>
      validateEvent({
        type: EVENT_TYPES.EMAIL_REPLIED,
        payload: { messageId: "m1", intent: "interested" },
      }),
    ).toThrow(/Invalid event envelope/);
  });

  // C2.8 (docs/PLAN_CONTACT_LISTS.md): the membership events are the
  // Forms/Widget/Automations join points — the payload shape is a contract.
  it("accepts list.member.added.v1 with the full payload contract", () => {
    const event = validateEvent({
      workspaceId: "ws1",
      contactId: "c1",
      type: EVENT_TYPES.LIST_MEMBER_ADDED,
      payload: { listId: "l1", listName: "Q3 dental leads", addedBy: "u1", origin: "manual" },
    });
    expect(event.type).toBe("list.member.added.v1");
    expect(event.payload).toEqual({
      listId: "l1",
      listName: "Q3 dental leads",
      addedBy: "u1",
      origin: "manual",
    });
  });

  it("accepts list.member.removed.v1 and rejects payloads missing the contract fields", () => {
    const event = validateEvent({
      workspaceId: "ws1",
      contactId: "c1",
      type: EVENT_TYPES.LIST_MEMBER_REMOVED,
      payload: { listId: "l1", listName: "Q3 dental leads", removedBy: "u1" },
    });
    expect(event.payload).toEqual({ listId: "l1", listName: "Q3 dental leads", removedBy: "u1" });

    expect(() =>
      validateEvent({
        workspaceId: "ws1",
        type: EVENT_TYPES.LIST_MEMBER_ADDED,
        payload: { listId: "l1" },
      }),
    ).toThrow(/Invalid payload for "list.member.added.v1"/);
    expect(() =>
      validateEvent({
        workspaceId: "ws1",
        type: EVENT_TYPES.LIST_MEMBER_REMOVED,
        payload: { listId: "l1", listName: "x" },
      }),
    ).toThrow(/Invalid payload for "list.member.removed.v1"/);
  });

  it("lead.stage_changed.v1 carries optional { goalKey, label } (C2.9) and stays legacy-compatible", () => {
    // C2.9 (DEC-059): goal-completion moves carry the completing campaign's
    // goal + terminal label — additive optional fields, no version bump.
    const withGoal = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.LEAD_STAGE_CHANGED,
      payload: { fromStage: "replied", toStage: "booked", goalKey: "promote_offer", label: "Purchase made" },
    });
    expect(withGoal.payload).toEqual({
      fromStage: "replied",
      toStage: "booked",
      goalKey: "promote_offer",
      label: "Purchase made",
    });

    // Legacy payloads (pre-C2.9 rows) stay valid.
    const legacy = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.LEAD_STAGE_CHANGED,
      payload: { fromStage: "new", toStage: "replied" },
    });
    expect(legacy.payload).toEqual({ fromStage: "new", toStage: "replied" });

    expect(() =>
      validateEvent({
        workspaceId: "ws1",
        type: EVENT_TYPES.LEAD_STAGE_CHANGED,
        payload: { toStage: "booked" },
      }),
    ).toThrow(/Invalid payload for "lead.stage_changed.v1"/);
  });

  it("sms.*.v1 payload contracts (P2.1/DEC-061)", () => {
    const sent = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.SMS_SENT,
      payload: { messageId: "m1", segmentCount: 2, body: "hi" },
    });
    expect(sent.payload).toEqual({ messageId: "m1", segmentCount: 2, body: "hi" });

    const failed = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.SMS_FAILED,
      payload: { messageId: "m1", reason: "undeliverable", errorCode: "30003" },
    });
    expect(failed.payload).toEqual({ messageId: "m1", reason: "undeliverable", errorCode: "30003" });

    const replied = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.SMS_REPLIED,
      payload: { messageId: "m1", body: "yes please", intent: "interested" },
    });
    expect(replied.payload).toEqual({ messageId: "m1", body: "yes please", intent: "interested" });

    expect(() =>
      validateEvent({ workspaceId: "ws1", type: EVENT_TYPES.SMS_SENT, payload: { messageId: "m1" } }),
    ).toThrow(/Invalid payload for "sms.sent.v1"/);
  });
});
