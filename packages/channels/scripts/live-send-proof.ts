/**
 * A3 live-SEND proof (DEC-060a) — the one run where sandbox is OFF and a real
 * email is delivered to the DEC-014 allow-listed inbox through the FULL
 * boundary (footer + suppression + window + caps enforced).
 *
 * HARD GATE, asserted before any live send and never bypassable:
 *   1. SendGrid domain authentication for the send domain reports valid
 *      (SPF + DKIM verified by SendGrid).
 *   2. A DMARC policy record exists at _dmarc.<root> (read-only DNS lookup —
 *      root-domain DNS is never touched, only observed).
 * The DEC-014 allow-list REMAINS the recipient filter: the same run proves a
 * non-allow-listed recipient still refuses with RECIPIENT_NOT_ALLOWLISTED.
 *
 * Runs only in the live-send-proof GitHub workflow (manual dispatch); never CI.
 */
import { resolveTxt } from "node:dns/promises";
import { sendStep, SendBlockedError, SendGridSender } from "../src/index";
import { createAppPrismaClient, createPrismaClient } from "@clientforce/db";

const TEST_INBOX = process.env.LIVE_PROOF_INBOX ?? "tronwebng@gmail.com";
const ADDRESS = process.env.LIVE_PROOF_ADDRESS ?? "Clientforce, Lagos, Nigeria";
const SEND_DOMAIN = process.env.LIVE_PROOF_SEND_DOMAIN ?? "send.clientforce.io";
const ROOT_DOMAIN = SEND_DOMAIN.split(".").slice(-2).join(".");

interface SgDomain {
  domain: string;
  subdomain?: string;
  valid: boolean;
  dns?: Record<string, { valid: boolean; host: string; type: string }>;
}

async function assertDomainAuthVerified(apiKey: string): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/whitelabel/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`SendGrid domain-auth lookup failed: ${res.status}`);
  const domains = (await res.json()) as SgDomain[];
  // The FROM is agent@SEND_DOMAIN — the gate must require the SEND domain's
  // own authentication. A root-domain fallback here once let the proof reach
  // SendGrid only to 403 on sender identity (66-round).
  const match = domains.find(
    (d) => d.domain === SEND_DOMAIN || `${d.subdomain}.${d.domain}` === SEND_DOMAIN,
  );
  if (!match) throw new Error(`GATE FAILED: no SendGrid authenticated domain for ${SEND_DOMAIN}`);
  if (!match.valid) {
    const bad = Object.entries(match.dns ?? {})
      .filter(([, v]) => !v.valid)
      .map(([k, v]) => `${k} (${v.type} ${v.host})`);
    throw new Error(`GATE FAILED: SendGrid domain auth not valid for ${SEND_DOMAIN} — failing records: ${bad.join(", ") || "unknown"}`);
  }
  console.log(`GATE 1 OK: SendGrid domain auth VALID for ${SEND_DOMAIN} (SPF/DKIM verified by SendGrid)`);

  const dmarc = await resolveTxt(`_dmarc.${ROOT_DOMAIN}`).catch(() => [] as string[][]);
  const record = dmarc.flat().find((t) => t.startsWith("v=DMARC1"));
  if (!record) throw new Error(`GATE FAILED: no DMARC record at _dmarc.${ROOT_DOMAIN}`);
  console.log(`GATE 2 OK: DMARC present — ${record}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("SENDGRID_API_KEY missing");

  console.log("\n=== A3 LIVE-SEND PROOF (sandbox OFF for this run only) ===");
  await assertDomainAuthVerified(apiKey);

  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  // Sandbox EXPLICITLY OFF — this is the whole point of this proof; the gate
  // above has already passed or we never get here.
  const transport = new SendGridSender(undefined, /* sandbox */ false);

  const suffix = `live-send-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "live-proof", slug: suffix, settings: {} },
  });

  try {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Live Proof Agent",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
          dailyCap: { email: 10 },
          consent: null,
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws.id, agentId: agent.id, name: "primary", graphId: "" },
    });
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws.id,
        type: "CF_MANAGED",
        fromEmail: `agent@${SEND_DOMAIN}`,
        fromName: "Clientforce Live Proof",
        replyTo: `inbound@reply.${ROOT_DOMAIN}`,
      },
    });
    const contact = await owner.contact.create({
      data: {
        workspaceId: ws.id,
        source: "live-proof",
        optOut: {},
        tags: [],
        email: TEST_INBOX,
        firstName: "Godswill",
        company: "Tronweb",
      },
    });
    // The blocked path's contact: NOT on the allow-list, never receives mail.
    const outsider = await owner.contact.create({
      data: {
        workspaceId: ws.id,
        source: "live-proof",
        optOut: {},
        tags: [],
        email: `blocked-${Date.now()}@example.com`,
        firstName: "Blocked",
      },
    });
    await owner.businessContext.create({
      data: {
        workspaceId: ws.id,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } },
      },
    });

    const base = {
      workspaceId: ws.id,
      campaignId: campaign.id,
      agentId: agent.id,
      contactId: contact.id,
      senderId: sender.id,
    };

    // LIVE SEND — one real delivery to the DEC-014 inbox.
    const message = await sendStep(
      { prisma: app, transport, allowlist: [TEST_INBOX] },
      {
        ...base,
        stepNodeId: "live-1",
        content: {
          subject: "Clientforce live-send proof (A3/DEC-060a)",
          body: "Hi {{firstName}}, this is the ONE real delivery of the A3 live-send proof — full boundary enforced.\n\n— {{senderName}}",
        },
      },
    );
    if (!message.providerMessageId) throw new Error("No provider message id returned");
    if (!message.body.includes(ADDRESS)) throw new Error("Footer does not carry company_address verbatim");
    if (!message.body.includes("Unsubscribe: ")) throw new Error("Unsubscribe footer missing");
    console.log(`DELIVERED (live): providerMessageId=${message.providerMessageId}`);
    console.log(`RFC message id (check the received headers): ${message.providerMessageId}@${SEND_DOMAIN}`);
    console.log(`subject: ${message.subject}`);

    // Same run: a non-allow-listed recipient MUST refuse (DEC-014 stands).
    try {
      await sendStep(
        { prisma: app, transport, allowlist: [TEST_INBOX] },
        {
          ...base,
          contactId: outsider.id,
          stepNodeId: "live-2",
          content: { subject: "must never send", body: "never {{senderName}}" },
        },
      );
      throw new Error("Non-allow-listed recipient was NOT refused — DEC-014 violated");
    } catch (err) {
      if (err instanceof SendBlockedError && err.reason === "RECIPIENT_NOT_ALLOWLISTED") {
        console.log(`REFUSED as designed (live mode): RECIPIENT_NOT_ALLOWLISTED for ${outsider.email}`);
      } else {
        throw err;
      }
    }

    console.log("\nA3 gate passed: domain auth verified · one live delivery · allow-list still enforced.");
    console.log("=== END LIVE-SEND PROOF ===");
  } finally {
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
