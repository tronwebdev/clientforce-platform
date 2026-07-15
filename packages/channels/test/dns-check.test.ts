/**
 * P5 W1 (DEC-083): DNS verification states — verified / failed (with copyable
 * expected records) / unchecked (lookup or provider unavailable), and the
 * never-cached-as-verified rule: a check that cannot confirm writes its own
 * honest state, it never inherits a previous pass.
 */
import { describe, expect, it } from "vitest";
import { checkSenderDns, type DnsCheckDeps } from "../src/dns-check";

const CF_SENDER = { type: "CF_MANAGED", fromEmail: "agent@send.clientforce.io" } as const;
const NOW = new Date("2026-07-15T12:00:00Z");

const sgResponse = (domains: unknown) =>
  ({ ok: true, json: async () => domains }) as unknown as Response;

const sgDomain = (valid: boolean, recordsValid = valid) => ({
  domain: "clientforce.io",
  subdomain: "send",
  valid,
  dns: {
    mail_cname: { valid: recordsValid, host: "send.clientforce.io", type: "cname", data: "u123.wl.sendgrid.net" },
    dkim1: { valid: recordsValid, host: "s1._domainkey.clientforce.io", type: "cname", data: "s1.domainkey.u123.wl.sendgrid.net" },
    dkim2: { valid: recordsValid, host: "s2._domainkey.clientforce.io", type: "cname", data: "s2.domainkey.u123.wl.sendgrid.net" },
  },
});

const deps = (over: Partial<DnsCheckDeps> = {}): DnsCheckDeps => ({
  resolveTxt: async () => [["v=DMARC1; p=none;"]],
  sendgridApiKey: "sg-test",
  fetchImpl: (async () => sgResponse([sgDomain(true)])) as unknown as typeof fetch,
  now: () => NOW,
  ...over,
});

describe("checkSenderDns", () => {
  it("verified walk: SendGrid-valid SPF/DKIM + DMARC present → all pass, lastCheckedAt stamped", async () => {
    const status = await checkSenderDns(deps(), CF_SENDER);
    expect(status?.spf).toMatchObject({ status: "verified", pass: true, lastCheckedAt: NOW.toISOString() });
    expect(status?.dkim).toMatchObject({ status: "verified", pass: true });
    expect(status?.dmarc).toMatchObject({ status: "verified", pass: true });
    expect(status?.dmarc.found).toContain("v=DMARC1");
  });

  it("failed walk: invalid provider records → failed with COPYABLE expected records", async () => {
    const status = await checkSenderDns(
      deps({ fetchImpl: (async () => sgResponse([sgDomain(false)])) as unknown as typeof fetch }),
      CF_SENDER,
    );
    expect(status?.dkim.status).toBe("failed");
    expect(status?.dkim.pass).toBe(false);
    expect(status?.dkim.expected).toContain("s1._domainkey.clientforce.io");
    expect(status?.dkim.expected).toContain("s1.domainkey.u123.wl.sendgrid.net");
  });

  it("missing DMARC → failed with the expected TXT record to publish", async () => {
    const status = await checkSenderDns(deps({ resolveTxt: async () => [] }), CF_SENDER);
    expect(status?.dmarc.status).toBe("failed");
    expect(status?.dmarc.expected).toContain("_dmarc.clientforce.io");
    expect(status?.dmarc.expected).toContain("v=DMARC1");
  });

  it("domain not authenticated in SendGrid at all → failed (not unchecked — the provider answered)", async () => {
    const status = await checkSenderDns(
      deps({ fetchImpl: (async () => sgResponse([])) as unknown as typeof fetch }),
      CF_SENDER,
    );
    expect(status?.spf.status).toBe("failed");
    expect(status?.spf.detail).toContain("not authenticated");
  });

  it("no provider key → SPF/DKIM unchecked (honest), DMARC still really checked", async () => {
    const noKey = deps();
    delete (noKey as { sendgridApiKey?: string }).sendgridApiKey;
    const status = await checkSenderDns(noKey, CF_SENDER);
    expect(status?.spf).toMatchObject({ status: "unchecked", pass: false });
    expect(status?.dkim.status).toBe("unchecked");
    expect(status?.dmarc.status).toBe("verified");
  });

  it("provider/API error → unchecked with the reason — NEVER a pass, never a fake fail", async () => {
    const status = await checkSenderDns(
      deps({ fetchImpl: (async () => ({ ok: false, status: 503 }) as unknown as Response) as unknown as typeof fetch }),
      CF_SENDER,
    );
    expect(status?.spf).toMatchObject({ status: "unchecked", pass: false });
    expect(status?.spf.detail).toContain("could not verify");
  });

  it("resolver error (not NXDOMAIN) → DMARC unchecked, not failed", async () => {
    const status = await checkSenderDns(
      deps({
        resolveTxt: async () => {
          const err = new Error("timeout") as NodeJS.ErrnoException;
          err.code = "ETIMEOUT";
          throw err;
        },
      }),
      CF_SENDER,
    );
    expect(status?.dmarc.status).toBe("unchecked");
    expect(status?.dmarc.detail).toContain("could not verify");
  });

  it("OAuth/SMTP tier: direct SPF lookup, DKIM honestly unknowable, DMARC real", async () => {
    const status = await checkSenderDns(
      deps({
        resolveTxt: async (host: string) =>
          host.startsWith("_dmarc.") ? [["v=DMARC1; p=quarantine;"]] : [["v=spf1 include:_spf.google.com ~all"]],
      }),
      { type: "SMTP", fromEmail: "sales@example.com" },
    );
    expect(status?.spf).toMatchObject({ status: "verified", pass: true });
    expect(status?.spf.found).toContain("v=spf1");
    expect(status?.dkim.status).toBe("unchecked");
    expect(status?.dmarc.status).toBe("verified");
  });

  it("SMS senders have no DNS posture — null, nothing written", async () => {
    expect(await checkSenderDns(deps(), { type: "TWILIO_SMS", fromEmail: "+15550100" })).toBeNull();
  });
});
