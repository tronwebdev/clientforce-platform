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
});
