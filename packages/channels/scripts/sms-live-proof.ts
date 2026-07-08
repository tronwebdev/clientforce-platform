/**
 * P2.1 live SMS proof (DEC-061/063) — one REAL SMS through the FULL boundary
 * (window/caps/opt-out/suppression/opt-out line enforced) to the owner's
 * allow-listed test number, plus the refusal rails in the same run:
 *   - a non-allow-listed number refuses (RECIPIENT_NOT_ALLOWLISTED — DEC-063);
 *   - a STOP-suppressed number refuses (SUPPRESSED — DEC-062 rail 2).
 * The test number arrives ONLY via env (Key Vault SMS-TEST-NUMBER, masked in
 * the workflow) — never in dispatch inputs or logs (public repo).
 * Runs only in the sms-live-proof GitHub workflow; never CI.
 */
import { sendSmsStep, SMS_OPT_OUT_LINE } from "../src/send-sms";
import { TwilioSmsSender } from "../src/twilio";
import { SendBlockedError } from "../src/types";
import { createAppPrismaClient, createPrismaClient, encryptField, withTenant } from "@clientforce/db";

const NUMBER = process.env.SMS_TEST_NUMBER ?? "";
const MSID = process.env.SMS_TEST_MESSAGING_SERVICE_SID ?? "";

async function main(): Promise<void> {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error("GATE FAILED: Twilio credentials missing");
  }
  if (!/^\+[1-9]\d{6,14}$/.test(NUMBER)) {
    throw new Error("GATE FAILED: SMS_TEST_NUMBER missing or not E.164 (Key Vault SMS-TEST-NUMBER)");
  }
  if (!/^MG[a-zA-Z0-9]{32}$/.test(MSID)) {
    throw new Error("GATE FAILED: SMS_TEST_MESSAGING_SERVICE_SID missing (Key Vault SMS-MESSAGING-SERVICE-SID)");
  }

  console.log("\n=== P2.1 LIVE SMS PROOF (SMS_SANDBOX off for this run only) ===");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const transport = new TwilioSmsSender(undefined, undefined, /* sandbox */ false);

  const suffix = `sms-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "sms-proof", slug: suffix, settings: {} },
  });

  try {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "SMS Proof Agent",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
          dailyCap: { email: 10, sms: 10 },
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
        type: "TWILIO_SMS",
        fromEmail: NUMBER, // display only in this proof; sends route via the messaging service
        fromName: "Clientforce SMS Proof",
        credentialsEnc: encryptField(JSON.stringify({ messagingServiceSid: MSID })),
      },
    });
    const contact = await owner.contact.create({
      data: { workspaceId: ws.id, source: "sms-proof", optOut: {}, tags: [], phone: NUMBER, email: `p-${suffix}@t.test`, firstName: "Godswill" },
    });

    const base = {
      workspaceId: ws.id,
      campaignId: campaign.id,
      agentId: agent.id,
      contactId: contact.id,
      senderId: sender.id,
    };

    // ONE live SMS — the boundary appends the opt-out line (first outbound).
    const message = await sendSmsStep(
      { prisma: app, transport, allowlist: [NUMBER] },
      { ...base, stepNodeId: "live-sms-1", content: { body: "Hi {{firstName}} — Clientforce P2.1 live SMS proof, full boundary enforced." } },
    );
    if (!message.providerMessageId.startsWith("SM")) throw new Error("No Twilio message SID returned");
    if (!message.body.endsWith(SMS_OPT_OUT_LINE)) throw new Error("Opt-out line missing from the first outbound");
    console.log(`DELIVERED (live): providerMessageId=${message.providerMessageId} segments=${(message.meta as { segments?: number }).segments}`);

    // Refusal 1 (DEC-063): non-allow-listed number.
    const outsider = await owner.contact.create({
      data: { workspaceId: ws.id, source: "sms-proof", optOut: {}, tags: [], phone: "+15005550009", email: `o-${suffix}@t.test` },
    });
    await expectBlocked("RECIPIENT_NOT_ALLOWLISTED", () =>
      sendSmsStep({ prisma: app, transport, allowlist: [NUMBER] }, { ...base, contactId: outsider.id, stepNodeId: "live-sms-2", content: { body: "never" } }),
    );

    // Refusal 2 (DEC-062): STOP-suppressed number refuses even when allow-listed.
    await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.suppression.create({ data: { workspaceId: ws.id, channel: "sms", address: NUMBER, reason: "UNSUBSCRIBED", source: "sms-proof" } }),
    );
    await expectBlocked("SUPPRESSED", () =>
      sendSmsStep({ prisma: app, transport, allowlist: [NUMBER] }, { ...base, stepNodeId: "live-sms-3", content: { body: "must refuse" } }),
    );

    console.log("\nP2.1 gate passed: one live delivery · allow-list refusal · STOP-suppression refusal.");
    console.log("Reply STOP to the received SMS, then check Settings → Suppression on staging to see rail 2 land from the real webhook.");
    console.log("=== END LIVE SMS PROOF ===");
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
      console.log(`REFUSED as designed (live mode): ${reason}`);
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
