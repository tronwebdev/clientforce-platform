/**
 * D1 (DEC-171): the bounce classifier's fixtures. Every case here is a real
 * SendGrid event shape, and every one of them had the SAME consequence before
 * this unit — permanent suppression — which is what these pin apart.
 */
import { describe, expect, it } from "vitest";
import { bounceFactsFrom, classifyBounce, classifyDrop } from "../src/bounce";
import { normalizeSendGridEvents } from "../src/webhooks";

const ev = (over: Record<string, unknown>) => ({
  email: "lead@example.test",
  timestamp: 1_780_000_000,
  sg_message_id: "msg-1.filter0001",
  ...over,
});

describe("classifyBounce (DEC-171)", () => {
  it("a 5.x.x 'bounce' type is HARD — the address does not exist", () => {
    expect(
      classifyBounce({
        event: "bounce",
        type: "bounce",
        status: "5.1.1",
        reason: "550 5.1.1 The email account that you tried to reach does not exist",
      }),
    ).toBe("hard");
  });

  it("a 4.x.x status is SOFT — a full mailbox is not a dead address", () => {
    expect(
      classifyBounce({
        event: "bounce",
        status: "4.2.2",
        reason: "452 4.2.2 The email account that you tried to reach is over quota",
      }),
    ).toBe("soft");
  });

  it("type 'blocked' OUTRANKS a 5.x.x status — a 5.7.1 block is about OUR ip, not their address", () => {
    // The whole point: suppressing the recipient for a reputation block on our
    // own sending IP would permanently destroy a perfectly good address.
    expect(
      classifyBounce({
        event: "bounce",
        type: "blocked",
        status: "5.7.1",
        reason: "550 5.7.1 Service unavailable; client blocked",
      }),
    ).toBe("soft");
  });

  it("type 'expired' is SOFT — retries timed out, nothing was proven", () => {
    expect(classifyBounce({ event: "bounce", type: "expired" })).toBe("soft");
  });

  it("bounce_classification decides when neither type nor status is usable", () => {
    expect(
      classifyBounce({ event: "bounce", classification: "Frequency or Volume Too High" }),
    ).toBe("soft");
    expect(classifyBounce({ event: "bounce", classification: "Invalid Address" })).toBe("hard");
  });

  it("an unrecognised bounce defaults to HARD — the pre-D1 behaviour, unchanged", () => {
    expect(classifyBounce({ event: "bounce" })).toBe("hard");
  });
});

describe("classifyDrop (DEC-171)", () => {
  it("'Spam Reported' is a COMPLAINT, not a bounce", () => {
    expect(classifyDrop("Spam Reported")).toBe("complaint");
  });
  it("'Unsubscribed Address' is an unsubscribe", () => {
    expect(classifyDrop("Unsubscribed Address")).toBe("unsubscribe");
  });
  it("'Bounced Address' and 'Invalid SMTP' echo a bounce", () => {
    expect(classifyDrop("Bounced Address")).toBe("bounce");
    expect(classifyDrop("Invalid SMTP")).toBe("bounce");
  });
  it("'Duplicate' proves nothing about the address — no consequence", () => {
    expect(classifyDrop("Duplicate")).toBeNull();
    expect(classifyDrop(undefined)).toBeNull();
  });
});

describe("normalizeSendGridEvents carries the classification (DEC-171)", () => {
  it("a hard bounce normalizes to bounce/hard", () => {
    const [e] = normalizeSendGridEvents([
      ev({ event: "bounce", type: "bounce", status: "5.1.1", reason: "no such user" }),
    ]);
    expect(e).toMatchObject({ type: "bounce", bounce: { kind: "hard", status: "5.1.1" } });
  });

  it("a blocked bounce normalizes to bounce/soft", () => {
    const [e] = normalizeSendGridEvents([ev({ event: "bounce", type: "blocked", status: "5.7.1" })]);
    expect(e).toMatchObject({ type: "bounce", bounce: { kind: "soft" } });
  });

  it("a 'Spam Reported' DROP normalizes to spam_report — pre-D1 it was a bounce", () => {
    const [e] = normalizeSendGridEvents([ev({ event: "dropped", reason: "Spam Reported" })]);
    expect(e!.type).toBe("spam_report");
    expect(e!.bounce).toBeUndefined();
  });

  it("a 'Duplicate' DROP normalizes to other — pre-D1 it suppressed the address", () => {
    const [e] = normalizeSendGridEvents([ev({ event: "dropped", reason: "Duplicate" })]);
    expect(e!.type).toBe("other");
  });

  it("a 'Bounced Address' DROP still echoes a bounce (unchanged)", () => {
    const [e] = normalizeSendGridEvents([ev({ event: "dropped", reason: "Bounced Address" })]);
    expect(e).toMatchObject({ type: "bounce", bounce: { kind: "hard" } });
  });

  it("sg_event_id rides through as the dedup key; absent → null (DEC-174)", () => {
    const [withId] = normalizeSendGridEvents([ev({ event: "delivered", sg_event_id: "evt-9" })]);
    expect(withId!.eventId).toBe("evt-9");
    const [without] = normalizeSendGridEvents([ev({ event: "delivered" })]);
    expect(without!.eventId).toBeNull();
  });

  it("non-bounce events carry no classification at all", () => {
    for (const event of ["delivered", "open", "click", "spamreport", "unsubscribe"]) {
      const [e] = normalizeSendGridEvents([ev({ event })]);
      expect(e!.bounce).toBeUndefined();
    }
  });
});

describe("bounceFactsFrom", () => {
  it("pulls only string fields, dropping empties", () => {
    expect(bounceFactsFrom({ event: "bounce", type: "", status: "5.1.1", reason: 42 })).toEqual({
      event: "bounce",
      status: "5.1.1",
    });
  });
});
