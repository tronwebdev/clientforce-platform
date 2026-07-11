/**
 * R1 (DEC-073): pure trigger matching — every trigger kind against its
 * verified bus-event mapping (see the R1 PR plan comment).
 */
import { describe, expect, it } from "vitest";
import type { BusEvent } from "@clientforce/events";
import { keywordHit, matchTrigger } from "../src/match";

const event = (type: string, payload: unknown = {}): Pick<BusEvent, "type" | "payload"> =>
  ({ type, payload }) as Pick<BusEvent, "type" | "payload">;

describe("matchTrigger", () => {
  it("reply_classified matches any *.replied.v1 whose intent is in the rule's set", () => {
    const trigger = { kind: "reply_classified", intents: ["interested", "objection_price"] } as const;
    expect(matchTrigger(trigger, event("email.replied.v1", { messageId: "m", intent: "interested" }))).toBe(true);
    expect(matchTrigger(trigger, event("sms.replied.v1", { messageId: "m", body: "x", intent: "objection_price" }))).toBe(true);
    expect(matchTrigger(trigger, event("whatsapp.replied.v1", { messageId: "m", intent: "interested" }))).toBe(true);
    expect(matchTrigger(trigger, event("email.replied.v1", { messageId: "m", intent: "ooo" }))).toBe(false);
    expect(matchTrigger(trigger, event("email.opened.v1", { messageId: "m" }))).toBe(false);
    expect(matchTrigger(trigger, event("email.replied.v1", { messageId: "m" }))).toBe(false);
  });

  it("meeting_booked matches call.booked.v1 and the stage move to booked (A10)", () => {
    const trigger = { kind: "meeting_booked" } as const;
    expect(matchTrigger(trigger, event("call.booked.v1", { callId: "c" }))).toBe(true);
    expect(matchTrigger(trigger, event("lead.stage_changed.v1", { fromStage: "new", toStage: "booked" }))).toBe(true);
    expect(matchTrigger(trigger, event("lead.stage_changed.v1", { fromStage: "new", toStage: "interested" }))).toBe(false);
    expect(matchTrigger(trigger, event("email.replied.v1", { messageId: "m", intent: "booked" }))).toBe(false);
  });

  it("opted_out matches the unsubscribe/opt-out events", () => {
    const trigger = { kind: "opted_out" } as const;
    expect(matchTrigger(trigger, event("lead.unsubscribed.v1", { channel: "email" }))).toBe(true);
    expect(matchTrigger(trigger, event("sms.opted_out.v1", { messageId: "m" }))).toBe(true);
    expect(matchTrigger(trigger, event("email.bounced.v1", { messageId: "m" }))).toBe(false);
  });

  it("engagement triggers match their SendGrid-webhook events (F1-verified producers)", () => {
    expect(matchTrigger({ kind: "email_opened" }, event("email.opened.v1", { messageId: "m" }))).toBe(true);
    expect(matchTrigger({ kind: "email_opened" }, event("email.clicked.v1", { messageId: "m", link: "x" }))).toBe(false);
    expect(matchTrigger({ kind: "link_clicked" }, event("email.clicked.v1", { messageId: "m", link: "x" }))).toBe(true);
    expect(matchTrigger({ kind: "link_clicked" }, event("email.opened.v1", { messageId: "m" }))).toBe(false);
  });

  it("lead_captured matches the three capture events", () => {
    const trigger = { kind: "lead_captured" } as const;
    expect(matchTrigger(trigger, event("form.submitted.v1", { formId: "f", fields: {} }))).toBe(true);
    expect(matchTrigger(trigger, event("widget.lead_captured.v1", { widgetId: "w", fields: {} }))).toBe(true);
    expect(matchTrigger(trigger, event("linkedin.captured.v1", { fields: {} }))).toBe(true);
    expect(matchTrigger(trigger, event("lead.enrolled.v1", {}))).toBe(false);
  });

  it("sequence_quiet NEVER matches a bus event — it is the sweep's trigger", () => {
    const trigger = { kind: "sequence_quiet", days: 30 } as const;
    for (const type of ["email.replied.v1", "lead.stage_changed.v1", "email.opened.v1"]) {
      expect(matchTrigger(trigger, event(type, { messageId: "m", intent: "interested" }))).toBe(false);
    }
  });
});

describe("keywordHit", () => {
  it("is a case-insensitive contains over any keyword", () => {
    expect(keywordHit(["Pricing", "budget"], "What's your PRICING like?")).toBe(true);
    expect(keywordHit(["pricing"], "no thanks")).toBe(false);
  });
});
