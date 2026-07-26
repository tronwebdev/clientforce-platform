import { describe, expect, it } from "vitest";
import {
  hasThreadPrefix,
  MissingTokenError,
  renderTokens,
  stripThreadPrefix,
  withReplyPrefix,
} from "../src/render";
import { normalizeSendGridEvents } from "../src/webhooks";

const contact = {
  firstName: "Ada",
  lastName: "Lovelace",
  company: "Analytical",
  email: "ada@a.test",
};

describe("renderTokens", () => {
  it("renders all supported tokens including {{senderName}}", () => {
    expect(
      renderTokens("Hi {{firstName}} of {{company}} — {{senderName}}", contact, "Sam Rivers"),
    ).toBe("Hi Ada of Analytical — Sam Rivers");
  });

  it("a referenced-but-missing token fails the send (house rule)", () => {
    expect(() => renderTokens("Hi {{firstName}}", { ...contact, firstName: null }, "S")).toThrow(
      MissingTokenError,
    );
    expect(() => renderTokens("{{unknownToken}}", contact, "S")).toThrow(MissingTokenError);
  });

  // C2.7: {{custom.<key>|fallback}} — value-or-fallback, never blank.
  it("custom token renders the contact's value when present", () => {
    expect(
      renderTokens("{{custom.industry|your industry}}", { ...contact, custom: { industry: "Dental" } }, "S"),
    ).toBe("Dental");
  });

  it("custom token falls back when the value is missing or empty", () => {
    expect(renderTokens("{{custom.industry|your industry}}", { ...contact, custom: {} }, "S")).toBe(
      "your industry",
    );
    expect(
      renderTokens("{{custom.industry|your industry}}", { ...contact, custom: { industry: "" } }, "S"),
    ).toBe("your industry");
  });

  it("custom token with no value AND no fallback fails the send (never blank)", () => {
    expect(() => renderTokens("{{custom.industry}}", { ...contact, custom: {} }, "S")).toThrow(
      MissingTokenError,
    );
    expect(() => renderTokens("{{custom.industry|}}", contact, "S")).toThrow(MissingTokenError);
  });

  it("custom and standard tokens compose in one body", () => {
    expect(
      renderTokens(
        "Hi {{firstName}}, {{custom.plan|the plan}} awaits",
        { ...contact, custom: { plan: "Growth" } },
        "S",
      ),
    ).toBe("Hi Ada, Growth awaits");
  });

  // INT W2 (DEC-094): {{calendarLink}} — DATA_MODEL's render-time token,
  // boundary-resolved from the workspace booking config.
  it("{{calendarLink}} renders the boundary-resolved booking link", () => {
    expect(
      renderTokens("Book here: {{calendarLink}}", contact, "S", {
        calendarLink: "https://calendly.com/ada?utm_source=clientforce&utm_content=c1",
      }),
    ).toBe("Book here: https://calendly.com/ada?utm_source=clientforce&utm_content=c1");
  });

  it("{{calendarLink}} with no resolved value fails the send (missing booking config — house rule)", () => {
    expect(() => renderTokens("Book: {{calendarLink}}", contact, "S")).toThrow(MissingTokenError);
    expect(() => renderTokens("Book: {{calendarLink}}", contact, "S", {})).toThrow(MissingTokenError);
    expect(() => renderTokens("Book: {{ calendarLink }}", contact, "S", { calendarLink: undefined })).toThrow(
      MissingTokenError,
    );
  });
});

describe("thread prefix helpers (owner rule 3)", () => {
  it("detects and strips stacked Re:/Fwd: prefixes", () => {
    expect(hasThreadPrefix("Re: hello")).toBe(true);
    expect(hasThreadPrefix("FWD: re: hello")).toBe(true);
    expect(hasThreadPrefix("Regarding hello")).toBe(false);
    expect(stripThreadPrefix("Re: Fwd: RE: hello")).toBe("hello");
  });

  it("withReplyPrefix never double-prefixes", () => {
    expect(withReplyPrefix("hello")).toBe("Re: hello");
    expect(withReplyPrefix("Re: hello")).toBe("Re: hello");
  });
});

describe("normalizeSendGridEvents", () => {
  it("parses sample SendGrid payloads into normalized shapes", () => {
    const sample = [
      {
        event: "delivered",
        email: "a@t.test",
        timestamp: 1720000000,
        sg_message_id: "abc123.filter0001",
      },
      {
        event: "open",
        email: "a@t.test",
        timestamp: 1720000100,
        sg_message_id: "abc123.filter0001",
      },
      { event: "bounce", email: "b@t.test", timestamp: 1720000200, reason: "550 no mailbox" },
      { event: "spamreport", email: "c@t.test", timestamp: 1720000300 },
      { event: "unsubscribe", email: "d@t.test", timestamp: 1720000400 },
      { event: "processed", email: "a@t.test", timestamp: 1720000500 },
    ];
    const events = normalizeSendGridEvents(sample);
    expect(events.map((e) => e.type)).toEqual([
      "delivered",
      "open",
      "bounce",
      "spam_report",
      "unsubscribe",
      "other",
    ]);
    // The ".filterNNN" suffix is stripped so ids match persisted Messages.
    expect(events[0]!.providerMessageId).toBe("abc123");
    expect(events[2]!.providerMessageId).toBeNull();
    expect(events[0]!.occurredAt.toISOString()).toBe(new Date(1720000000 * 1000).toISOString());
  });

  it("rejects malformed payloads", () => {
    expect(() => normalizeSendGridEvents([{ email: "x" }])).toThrow();
  });
});
