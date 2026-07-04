/**
 * P1.5 live verification (§G): one REAL SendGrid send in SANDBOX MODE through
 * the full boundary — CF_MANAGED shared pool, From agent@send.clientforce.io,
 * Reply-To on reply.clientforce.io, recipient = the §G allow-listed test
 * inbox. Gates: provider message id returned · footer carries the workspace
 * company_address VERBATIM · owner rule 1 (no from-name) and the suppression
 * check refuse as designed. Root-domain DNS untouched; nothing is delivered
 * (sandbox validates + accepts without sending). Runs in the
 * channels-live-proof GitHub workflow; never in CI tests.
 */
import { sendStep, SendBlockedError, SendGridSender } from "../src/index";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";

const TEST_INBOX = process.env.LIVE_PROOF_INBOX ?? "tronwebng@gmail.com";
const ADDRESS = process.env.LIVE_PROOF_ADDRESS ?? "Clientforce, Lagos, Nigeria";

async function main(): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY missing");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const transport = new SendGridSender(undefined, /* sandbox */ true);

  const suffix = `send-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "proof", slug: suffix, settings: {} },
  });

  try {
    console.log(`\n=== P1.5 LIVE PROOF · CF_MANAGED sandbox send ===`);
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Demo Booker",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: {
            days: [1, 2, 3, 4, 5, 6, 7],
            start: "00:00",
            end: "23:59",
            timezone: "UTC",
          },
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
        fromEmail: "agent@send.clientforce.io",
        fromName: "Clientforce Demo Agent",
        replyTo: "inbound@reply.clientforce.io",
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
    const message = await sendStep(
      { prisma: app, transport, allowlist: [TEST_INBOX] },
      {
        ...base,
        stepNodeId: "step-1",
        content: {
          subject: "A quick idea for {{company}}",
          body: "Hi {{firstName}}, this is the P1.5 sandbox-mode live proof.\n\n— {{senderName}}",
        },
      },
    );
    console.log(`SENT (sandbox): providerMessageId=${message.providerMessageId}`);
    console.log(`subject: ${message.subject}`);
    console.log(`body:\n${message.body}`);

    // Gate 1: provider id + verbatim address + unsubscribe.
    if (!message.providerMessageId) throw new Error("No provider message id returned");
    if (!message.body.includes(ADDRESS))
      throw new Error("Footer does not carry company_address verbatim");
    if (!message.body.includes("Unsubscribe: ")) throw new Error("Unsubscribe footer missing");

    // Gate 2: owner rule 3 — threaded follow-up references the first send.
    const followUp = await sendStep(
      { prisma: app, transport, allowlist: [TEST_INBOX] },
      {
        ...base,
        stepNodeId: "step-2",
        content: {
          subject: "different subject",
          body: "Bump, {{firstName}} — {{senderName}}",
          threaded: true,
        },
      },
    );
    if (followUp.inReplyToId !== message.id)
      throw new Error("Follow-up did not thread to the first send");
    console.log(
      `THREADED (sandbox): subject=${followUp.subject} inReplyToId=${followUp.inReplyToId}`,
    );

    // Gate 3: refusal paths — no from-name; suppressed recipient.
    const noName = await owner.senderConnection.create({
      data: { workspaceId: ws.id, type: "CF_MANAGED", fromEmail: "x@send.clientforce.io" },
    });
    await expectBlocked("SENDER_NO_FROM_NAME", () =>
      sendStep(
        { prisma: app, transport, allowlist: [TEST_INBOX] },
        {
          ...base,
          senderId: noName.id,
          stepNodeId: "step-1",
          content: { subject: "s", body: "b {{senderName}}" },
        },
      ),
    );
    await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.suppression.create({
        data: { workspaceId: ws.id, channel: "email", address: TEST_INBOX, reason: "MANUAL" },
      }),
    );
    await expectBlocked("SUPPRESSED", () =>
      sendStep(
        { prisma: app, transport, allowlist: [TEST_INBOX] },
        {
          ...base,
          stepNodeId: "step-3",
          content: { subject: "s", body: "b {{senderName}}" },
        },
      ),
    );

    console.log("\n§G gate passed: sandbox send + real threading + both refusal paths proven.");
    console.log("\n=== END LIVE PROOF ===");
  } finally {
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
}

async function expectBlocked(reason: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof SendBlockedError && err.reason === reason) {
      console.log(`REFUSED as designed: ${reason}`);
      return;
    }
    throw err;
  }
  throw new Error(`Expected the send to be blocked with ${reason}, but it went through`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
