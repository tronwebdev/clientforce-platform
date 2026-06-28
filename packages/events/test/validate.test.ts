import { describe, expect, it } from "vitest";
import { EVENT_TYPES, EventValidationError, validateEvent } from "../src/index";

describe("validateEvent", () => {
  it("accepts a well-formed lead.replied.v1 and normalizes refs", () => {
    const event = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.LEAD_REPLIED,
      payload: { intent: "interested" },
    });
    expect(event.type).toBe("lead.replied.v1");
    expect(event.payload).toMatchObject({ intent: "interested" });
    expect(event.contactId).toBeNull();
  });

  it("rejects an unknown event type with a clear error", () => {
    expect(() =>
      validateEvent({ workspaceId: "ws1", type: "not.a.real.event", payload: {} }),
    ).toThrow(EventValidationError);
    expect(() =>
      validateEvent({ workspaceId: "ws1", type: "not.a.real.event", payload: {} }),
    ).toThrow(/Unknown event type/);
  });

  it("rejects a payload missing a required field", () => {
    expect(() =>
      validateEvent({ workspaceId: "ws1", type: EVENT_TYPES.LEAD_REPLIED, payload: {} }),
    ).toThrow(/Invalid payload for "lead.replied.v1"/);
  });

  it("rejects an invalid enum value", () => {
    expect(() =>
      validateEvent({ workspaceId: "ws1", type: EVENT_TYPES.LEAD_REPLIED, payload: { intent: "maybe" } }),
    ).toThrow(EventValidationError);
  });

  it("rejects a missing workspaceId (envelope)", () => {
    expect(() =>
      validateEvent({ type: EVENT_TYPES.LEAD_REPLIED, payload: { intent: "interested" } }),
    ).toThrow(/Invalid event envelope/);
  });
});
