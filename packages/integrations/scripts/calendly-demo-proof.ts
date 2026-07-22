/**
 * INT W2 owner-demo proof (DEC-094) — the LINK-TIER half of the booked-meeting
 * walk, run with REAL vendors end-to-end up to the send:
 *
 *   real Calendly link probe (tier-1 connect) → sandbox workspace staged →
 *   REAL model compose carrying the grounded per-lead booking link →
 *   REAL SendGrid delivery (sandbox OFF) to the DEC-014 allow-listed inbox.
 *
 * The owner then clicks the link IN THE DELIVERED EMAIL and books on their
 * real Calendly page. DETECTION (webhook → Meeting → stage → timeline →
 * Slack) is deliberately OUT of this job: it needs the paid-tier API token
 * AND a publicly reachable deployment for Calendly's webhook — the honest
 * tier line this run prints. Live-send rails mirrored from
 * `packages/channels/scripts/live-send-proof.ts` (domain-auth + DMARC gates,
 * allow-list enforced in-process). Manual dispatch only; never CI.
 */
import { writeFileSync } from "node:fs";
import { resolveTxt } from "node:dns/promises";
import { createAppPrismaClient, createPrismaClient } from "@clientforce/db";
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import { createEmailStepComposer, sendStep, SendGridSender } from "@clientforce/channels";
import { CalendlyAdapter } from "../src/calendly";
import { connectCalendlyFields } from "../src/service";
import type { IntegrationsDeps } from "../src/types";

const RECIPIENT = process.env.DEMO_RECIPIENT || "tronwebng@gmail.com";
const CALENDLY_LINK = process.env.DEMO_CALENDLY_LINK || "https://calendly.com/clientforce/30min";
const SEND_DOMAIN = process.env.LIVE_PROOF_SEND_DOMAIN ?? "send.clientforce.io";
const ADDRESS = process.env.LIVE_PROOF_ADDRESS ?? "Clientforce, Lagos, Nigeria";
const ROOT_DOMAIN = SEND_DOMAIN.split(".").slice(-2).join(".");
const SUFFIX = `w2demo${Date.now().toString(36)}`;

const gates: string[] = [];
const pass = (n: number, label: string, detail: string) => {
  const line = `GATE ✓ ${n} ${label} — ${detail}`;
  console.log(line);
  gates.push(line);
};
const fail = (n: number, label: string, detail: string): never => {
  console.error(`GATE ✗ ${n} ${label} — ${detail}`);
  process.exit(1);
};

interface SgDomain {
  domain: string;
  subdomain?: string;
  valid: boolean;
  dns?: Record<string, { valid: boolean; host: string; type: string }>;
}

/** The live-send hard gate, verbatim semantics (live-send-proof.ts). */
async function assertDomainAuthVerified(apiKey: string): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/whitelabel/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) fail(1, "domain auth", `SendGrid domain-auth lookup failed: ${res.status}`);
  const domains = (await res.json()) as SgDomain[];
  const match = domains.find(
    (d) => d.domain === SEND_DOMAIN || `${d.subdomain}.${d.domain}` === SEND_DOMAIN,
  );
  if (!match?.valid) fail(1, "domain auth", `SendGrid domain auth not valid for ${SEND_DOMAIN}`);
  const dmarc = await resolveTxt(`_dmarc.${ROOT_DOMAIN}`).catch(() => [] as string[][]);
  if (!dmarc.flat().some((t) => t.startsWith("v=DMARC1")))
    fail(1, "domain auth", `no DMARC record at _dmarc.${ROOT_DOMAIN}`);
  pass(1, "live-send hard gate", `SPF/DKIM valid for ${SEND_DOMAIN} + DMARC present at ${ROOT_DOMAIN}`);
}

async function main(): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) fail(0, "keys", "SENDGRID_API_KEY missing");
  if (!process.env.ANTHROPIC_API_KEY) fail(0, "keys", "ANTHROPIC_API_KEY missing");
  if (!process.env.FIELD_ENCRYPTION_KEY) fail(0, "keys", "FIELD_ENCRYPTION_KEY missing");

  await assertDomainAuthVerified(process.env.SENDGRID_API_KEY!);

  const owner = createPrismaClient();
  const app = createAppPrismaClient();

  // ── Sandbox workspace (fresh per run; the runner DB is throwaway) ──────────
  const agency = await owner.agency.create({ data: { name: SUFFIX, slug: SUFFIX, branding: {} } });
  const ws = (
    await owner.workspace.create({ data: { agencyId: agency.id, name: "W2 demo", slug: SUFFIX, settings: {} } })
  ).id;
  const agentId = (
    await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Booking Demo Agent",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
          dailyCap: { email: 50 },
          consent: { attestedBy: RECIPIENT, attestedAt: new Date().toISOString() },
          tracking: { openTracking: true, linkTracking: true },
          composeMode: "guided",
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    })
  ).id;
  const campaignId = (
    await owner.campaign.create({ data: { workspaceId: ws, agentId, name: "demo", graphId: "" } })
  ).id;
  const contactId = (
    await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "w2-demo",
        optOut: {},
        tags: [],
        email: RECIPIENT,
        firstName: "Godswill",
        company: "Clientforce",
      },
    })
  ).id;
  const enrollmentId = (
    await owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        workflowId: `demo-${SUFFIX}`,
        pipelineStage: "engaged",
        meta: {},
      },
    })
  ).id;
  await owner.businessContext.create({
    data: {
      workspaceId: ws,
      agentId: null,
      status: "READY",
      fields: {
        company_name: { value: "Clientforce", citations: [], source: "typed" },
        offer: {
          value: "Clientforce runs your outbound and books qualified calls straight onto your calendar.",
          citations: [],
          source: "typed",
        },
        company_address: { value: ADDRESS, citations: [], source: "typed" },
      },
    },
  });
  const senderId = (
    await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "CF_MANAGED",
        fromEmail: `agent@${SEND_DOMAIN}`,
        fromName: "Maya at Clientforce",
        status: "ACTIVE",
        domainAuthStatus: {},
      },
    })
  ).id;
  pass(2, "sandbox staged", `workspace=${ws} contact=${RECIPIENT} enrollment ACTIVE`);

  // ── Tier-1 Calendly connect: the REAL link probe ───────────────────────────
  const deps: IntegrationsDeps = { prisma: app, adapters: { calendly: new CalendlyAdapter() } };
  const row = await connectCalendlyFields(deps, {
    workspaceId: ws,
    fields: { schedulingUrl: CALENDLY_LINK },
    webhookUrlFor: (token) => `https://unused.invalid/webhooks/calendly?token=${token}`,
  });
  pass(3, "calendly link tier connected", `probe 2xx on ${CALENDLY_LINK} — status=${row.status}`);

  // ── REAL compose: the grounded per-lead booking link ───────────────────────
  const gateway = new AiGateway({ provider: new AnthropicProvider() });
  const compose = createEmailStepComposer({ prisma: app, gateway });
  const composed = await compose({
    workspaceId: ws,
    agentId,
    campaignId,
    contactId,
    enrollmentId,
    stepNodeId: "demo-step-1",
    brief: {
      objective: "Invite them to book a 30-minute walkthrough call",
      talkingPoints: [
        "this email itself was composed and sent by the Clientforce booking rails",
        "booking a slot takes under a minute",
      ],
      subjectHint: "Book the Clientforce walkthrough",
    },
    position: { index: 1, count: 1 },
    threaded: false,
  });
  const expectedLink = `${CALENDLY_LINK}?utm_source=clientforce&utm_content=${contactId}`;
  if (!composed.body.includes(`utm_content=${contactId}`))
    fail(4, "grounded link", `composed body missing the per-lead link:\n${composed.body}`);
  pass(4, "real compose grounded", `body carries ${expectedLink}`);

  // ── REAL delivery (sandbox OFF; allow-list = the recipient, in-process) ───
  process.env.SENDGRID_SANDBOX = "false";
  const message = await sendStep(
    { prisma: app, transport: new SendGridSender(), allowlist: [RECIPIENT.toLowerCase()] },
    {
      workspaceId: ws,
      campaignId,
      agentId,
      enrollmentId,
      contactId,
      senderId,
      stepNodeId: "demo-step-1",
      content: { subject: composed.subject, body: composed.body, threaded: false },
      composed: { mode: "guided", briefVersion: 1, composerVersion: composed.composerVersion },
    },
  );
  pass(5, "REAL email delivered", `to=${RECIPIENT} provider=${message.providerMessageId} subject="${message.subject}"`);

  // ── The honest detection flag (the drawer's tier line, verbatim stance) ───
  const flag =
    "link tier: booking detection OFF — Calendly exposes webhook subscriptions on paid plans only; " +
    "the paid-tier API token + a publicly reachable deployment turn on the full detection walk " +
    "(booking → Meeting → stage → timeline → Slack).";
  console.log(`GATE ○ 6 detection — ${flag}`);
  gates.push(`GATE ○ 6 detection — ${flag}`);

  writeFileSync(
    "calendly-demo-receipts.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        recipient: RECIPIENT,
        schedulingLink: CALENDLY_LINK,
        perLeadLink: expectedLink,
        composedSubject: composed.subject,
        composedBodyPreview: composed.body.slice(0, 500),
        providerMessageId: message.providerMessageId,
        gates,
      },
      null,
      2,
    ),
  );
  console.log("DEMO READY — book from the email’s link; the booking lands on the real Calendly page.");
  await owner.$disconnect();
  await app.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
