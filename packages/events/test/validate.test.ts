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

  it("rejects an intent outside the pinned label set (DEC-034/DEC-068)", () => {
    for (const bad of ["maybe", "not_now", "positive", "unknown", "objection", "price"]) {
      expect(() =>
        validateEvent({
          workspaceId: "ws1",
          type: EVENT_TYPES.EMAIL_REPLIED,
          payload: { messageId: "m1", intent: bad },
        }),
      ).toThrow(EventValidationError);
    }
  });

  // M1b (DEC-068): the six-intent reply taxonomy is ADDITIVE — new values
  // validate on both replied events, every legacy value still validates.
  it("accepts the M1b strategy intents AND every legacy intent (additive extension)", () => {
    const intents = [
      "objection_price",
      "objection_timing",
      "wrong_person",
      "info_request",
      "not_interested",
      // legacy set — pinned so a future edit can never turn additive into destructive
      "interested",
      "booked",
      "replied",
      "question",
      "not",
      "ooo",
      "unsubscribe",
    ];
    for (const intent of intents) {
      const email = validateEvent({
        workspaceId: "ws1",
        type: EVENT_TYPES.EMAIL_REPLIED,
        payload: { messageId: "m1", intent },
      });
      expect(email.payload).toMatchObject({ intent });
      const sms = validateEvent({
        workspaceId: "ws1",
        type: EVENT_TYPES.SMS_REPLIED,
        payload: { messageId: "m1", body: "…", intent },
      });
      expect(sms.payload).toMatchObject({ intent });
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

  // R1 (DEC-074): one per-agent rule evaluation outcome — the CampaignRuleRun
  // row's Logs twin. The payload shape is a contract (A9 names ossify).
  it("accepts automation.rule.run.v1 with the full payload contract", () => {
    const event = validateEvent({
      workspaceId: "ws1",
      contactId: "c1",
      enrollmentId: "e1",
      campaignId: "cmp1",
      type: EVENT_TYPES.AUTOMATION_RULE_RUN,
      payload: { ruleId: "r1", runId: "run1", status: "fired", trigger: "reply_classified" },
    });
    expect(event.type).toBe("automation.rule.run.v1");
    expect(event.payload).toEqual({
      ruleId: "r1",
      runId: "run1",
      status: "fired",
      trigger: "reply_classified",
    });
    expect(() =>
      validateEvent({
        workspaceId: "ws1",
        type: EVENT_TYPES.AUTOMATION_RULE_RUN,
        payload: { status: "fired" },
      }),
    ).toThrow(/Invalid payload for "automation.rule.run.v1"/);
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

  it("integration.*.v1 payload contracts (INT W1/DEC-093)", () => {
    // connected: `accountLabel` is ADDITIVE optional — legacy {provider}-only
    // payloads stay valid (no version bump).
    const legacyConnected = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.INTEGRATION_CONNECTED,
      payload: { provider: "slack" },
    });
    expect(legacyConnected.payload).toEqual({ provider: "slack" });
    const connected = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.INTEGRATION_CONNECTED,
      payload: { provider: "slack", accountLabel: "BrightPath workspace" },
    });
    expect(connected.payload).toEqual({ provider: "slack", accountLabel: "BrightPath workspace" });

    const disconnected = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.INTEGRATION_DISCONNECTED,
      payload: { provider: "slack", reason: "user" },
    });
    expect(disconnected.payload).toEqual({ provider: "slack", reason: "user" });
    // "revoked" is NOT an emitted reason in W1 — a dead token keeps the row
    // and rides status_changed; the catalog must not document a phantom
    // emission path (review-round pin; widens additively when an emitter exists).
    for (const bad of ["meteor", "revoked"]) {
      expect(() =>
        validateEvent({
          workspaceId: "ws1",
          type: EVENT_TYPES.INTEGRATION_DISCONNECTED,
          payload: { provider: "slack", reason: bad },
        }),
      ).toThrow(/Invalid payload for "integration.disconnected.v1"/);
    }

    // status transitions carry the honest state set, typed from → to.
    const transition = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.INTEGRATION_STATUS_CHANGED,
      payload: { provider: "slack", from: "connected", to: "revoked" },
    });
    expect(transition.payload).toEqual({ provider: "slack", from: "connected", to: "revoked" });
    expect(() =>
      validateEvent({
        workspaceId: "ws1",
        type: EVENT_TYPES.INTEGRATION_STATUS_CHANGED,
        payload: { provider: "slack", from: "connected", to: "broken" },
      }),
    ).toThrow(/Invalid payload for "integration.status_changed.v1"/);

    const notified = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.INTEGRATION_NOTIFIED,
      payload: { provider: "slack", kind: "new_reply", target: "#alerts", sourceEventId: "evt1" },
    });
    expect(notified.payload).toEqual({
      provider: "slack",
      kind: "new_reply",
      target: "#alerts",
      sourceEventId: "evt1",
    });

    const held = validateEvent({
      workspaceId: "ws1",
      type: EVENT_TYPES.INTEGRATION_DELIVERY_HELD,
      payload: { provider: "slack", reason: "workspace_delivery_allowance" },
    });
    expect(held.payload).toEqual({ provider: "slack", reason: "workspace_delivery_allowance" });
  });
});
