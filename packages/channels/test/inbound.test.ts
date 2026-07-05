/**
 * Inbound Parse normalization (P1.7) — pure unit tests over real-shaped
 * SendGrid Inbound Parse form fields.
 */
import { describe, expect, it } from "vitest";
import {
  extractReferencedIds,
  MalformedInboundError,
  normalizeInboundParse,
  parseAddress,
} from "../src/inbound";

describe("parseAddress", () => {
  it("parses display-name form and lowercases", () => {
    expect(parseAddress('"Godswill O." <TronWebNG@Gmail.com>')).toEqual({
      email: "tronwebng@gmail.com",
      name: "Godswill O.",
    });
    expect(parseAddress("Jane <jane@acme.io>")).toEqual({ email: "jane@acme.io", name: "Jane" });
  });

  it("passes bare addresses through", () => {
    expect(parseAddress("  lead@acme.io ")).toEqual({ email: "lead@acme.io" });
  });
});

describe("extractReferencedIds", () => {
  const headers = [
    "Received: by mx.example.com;",
    "In-Reply-To: <abc-123@send.clientforce.io>",
    "References: <first@send.clientforce.io>",
    " <abc-123@send.clientforce.io>",
    "Subject: Re: hello",
  ].join("\r\n");

  it("collects In-Reply-To + folded References, deduped", () => {
    expect(extractReferencedIds(headers).sort()).toEqual([
      "<abc-123@send.clientforce.io>",
      "<first@send.clientforce.io>",
    ]);
  });

  it("returns [] when the headers carry no thread ids", () => {
    expect(extractReferencedIds("Subject: fresh mail\r\nFrom: a@b.c")).toEqual([]);
  });
});

describe("normalizeInboundParse", () => {
  const form = {
    from: "Godswill <tronwebng@gmail.com>",
    to: "agent-reply@reply.clientforce.io",
    subject: "Re: A quick idea for Tronweb",
    text: "Sounds interesting — how do we book a call?",
    headers: "In-Reply-To: <abc-123@send.clientforce.io>",
  };

  it("normalizes a well-formed Inbound Parse payload", () => {
    const inbound = normalizeInboundParse(form);
    expect(inbound).toMatchObject({
      fromEmail: "tronwebng@gmail.com",
      fromName: "Godswill",
      to: "agent-reply@reply.clientforce.io",
      subject: "Re: A quick idea for Tronweb",
      referencedIds: ["<abc-123@send.clientforce.io>"],
    });
  });

  it("falls back to html when text is absent", () => {
    const inbound = normalizeInboundParse({ ...form, text: undefined, html: "<p>ok</p>" });
    expect(inbound.text).toBe("<p>ok</p>");
  });

  it("throws MalformedInboundError when essentials are missing", () => {
    expect(() => normalizeInboundParse({ to: "x@y.z" })).toThrow(MalformedInboundError);
    expect(() => normalizeInboundParse({ ...form, text: undefined })).toThrow(
      MalformedInboundError,
    );
  });
});
