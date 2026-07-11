/**
 * P1.5 acceptance integration: the send boundary end-to-end against Postgres
 * with a capturing fake transport — happy path (tokens + verbatim
 * company_address footer + Message persisted as rendered), the three owner
 * rules, suppression/opt-out, guardrail window + caps, real threading, and
 * webhook suppression side-effects. Skips without infra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  decryptField,
  encryptField,
  withTenant,
  type PrismaClient,
  type SenderConnection,
} from "@clientforce/db";
import { sendStep, type SendDeps } from "../src/send";
import { applyEmailEvent, normalizeSendGridEvents, resolveEventWorkspace } from "../src/webhooks";
import { SendBlockedError, type EmailSender, type RenderedEmail } from "../src/types";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const ADDRESS = "1 Main Street, Austin TX 78701";
/** Tuesday 10:00 UTC — inside the default Mon–Fri 09:00–17:00 UTC window. */
const IN_WINDOW = () => new Date("2026-07-07T10:00:00Z");

class CapturingSender implements EmailSender {
  sent: RenderedEmail[] = [];
  private n = 0;
  async send(email: RenderedEmail, _sender: SenderConnection) {
    this.sent.push(email);
    return { providerMessageId: `<msg-${++this.n}-${suffix}@send.clientforce.io>` };
  }
}

describe.skipIf(!hasInfra)("sendStep boundary integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let senderId: string;
  let contactId: string;
  const transport = new CapturingSender();
  const deps = (over: Partial<SendDeps> = {}): SendDeps => ({
    prisma: app,
    transport,
    now: IN_WINDOW,
    allowlist: [],
    ...over,
  });
  const params = (over: Record<string, unknown> = {}) => ({
    workspaceId: ws,
    campaignId,
    agentId,
    contactId,
    senderId,
    stepNodeId: "step-1",
    content: {
      subject: "A free audit for {{company}}",
      body: "Hi {{firstName}},\n— {{senderName}}",
    },
    ...over,
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `ch-${suffix}`, slug: `ch-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "CH", slug: `ch-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "primary", graphId: "g1" },
      })
    ).id;
    senderId = (
      await owner.senderConnection.create({
        data: {
          workspaceId: ws,
          type: "CF_MANAGED",
          fromEmail: "agent@send.clientforce.io",
          fromName: "Sam Rivers",
          replyTo: "inbound@reply.clientforce.io",
          dailyLimit: 50,
        },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "seed",
          optOut: {},
          tags: [],
          email: `lead-${suffix}@t.test`,
          firstName: "Ada",
          company: "Analytical",
        },
      })
    ).id;
    // Owner rule 2 depends on the workspace-layer company_address.
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        status: "READY",
        fields: {
          company_address: { value: ADDRESS, citations: [], source: "typed" },
        },
      },
    });
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("happy path: tokens render, footer carries company_address VERBATIM, Message persisted as rendered", async () => {
    const message = await sendStep(deps(), params());
    const email = transport.sent.at(-1)!;

    expect(email.to).toContain("@t.test");
    expect(email.subject).toBe("A free audit for Analytical");
    expect(email.body).toContain("Hi Ada,");
    expect(email.body).toContain("— Sam Rivers");
    // Owner rule 2: verbatim address + unsubscribe present (A8 literal true).
    expect(email.body).toContain(ADDRESS);
    expect(email.body).toContain("Unsubscribe: ");
    expect(email.headers?.["List-Unsubscribe"]).toContain("reply.clientforce.io");
    // A6: persisted AS RENDERED, provider id recorded.
    expect(message.body).toBe(email.body);
    expect(message.subject).toBe(email.subject);
    expect(message.providerMessageId).toMatch(/^<msg-/);
    expect(message.direction).toBe("OUTBOUND");
    expect(message.stepNodeId).toBe("step-1");
  });

  it("L1 (DEC-072): a GERMAN agent's footer renders the pre-translated constants — address verbatim, label deterministic", async () => {
    const germanAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: ws,
          name: "Termine",
          goal: "book_appointments",
          guardrails: {
            sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
            dailyCap: { email: 50 },
            consent: null,
            language: "de",
            languageSource: "detected",
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;
    const germanCampaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId: germanAgentId, name: "primär", graphId: "g-de" },
      })
    ).id;
    // Own contact — the threading tests key off the shared contact's latest
    // message and must not see this send.
    const germanContactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "seed",
          optOut: {},
          tags: [],
          email: `lead-de-${suffix}@t.test`,
          firstName: "Britta",
          company: "Berliner Dental",
        },
      })
    ).id;

    const message = await sendStep(
      deps(),
      params({
        agentId: germanAgentId,
        campaignId: germanCampaignId,
        contactId: germanContactId,
        content: { subject: "Ein kostenloses Audit für {{company}}", body: "Hallo {{firstName}}," },
      }),
    );
    const email = transport.sent.at(-1)!;

    // The German unsubscribe label from COMPLIANCE_STRINGS — never "Unsubscribe".
    expect(email.body).toContain(`Abmelden: `);
    expect(email.body).not.toContain("Unsubscribe:");
    // The address stays VERBATIM (owner rule 2 — addresses are never translated)…
    expect(email.body).toContain(ADDRESS);
    // …the link itself and the machine headers are language-independent.
    expect(email.body).toMatch(/Abmelden: https:\/\/reply\.clientforce\.io\/u\//);
    expect(email.headers?.["List-Unsubscribe"]).toContain("reply.clientforce.io");
    expect(message.body).toBe(email.body);
  });

  it("owner rule 3: a threaded follow-up carries In-Reply-To/References and inherits the subject", async () => {
    const first = await withTenant(app, { workspaceId: ws }, (tx) =>
      tx.message.findFirstOrThrow({
        where: { workspaceId: ws, contactId },
        orderBy: { sentAt: "desc" },
      }),
    );
    const followUp = await sendStep(
      deps(),
      params({
        stepNodeId: "step-2",
        content: {
          subject: "totally different subject",
          body: "Bump {{firstName}} — {{senderName}}",
          threaded: true,
        },
      }),
    );
    const email = transport.sent.at(-1)!;
    expect(email.inReplyTo).toBe(first.providerMessageId);
    expect(email.references).toEqual([first.providerMessageId]);
    expect(email.subject).toBe("Re: A free audit for Analytical"); // inherited, not the step's own
    expect(followUp.inReplyToId).toBe(first.id);
    expect((followUp.meta as { threaded: boolean }).threaded).toBe(true);
  });

  it("owner rule 3: threading uses the wire RFC Message-ID, never the provider's internal id", async () => {
    // SendGrid-shaped transport: X-Message-Id (returned to webhooks) differs
    // from the RFC Message-ID actually on the wire. In-Reply-To must use the
    // wire id — the P1.6 live-proof header gate caught this conflation.
    class SplitIdSender implements EmailSender {
      sent: RenderedEmail[] = [];
      private n = 0;
      async send(email: RenderedEmail) {
        this.sent.push(email);
        const n = ++this.n;
        return {
          providerMessageId: `SGX-${n}-${suffix}`,
          rfcMessageId: `<rfc-${n}-${suffix}@send.clientforce.io>`,
        };
      }
    }
    const split = new SplitIdSender();
    const contact = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "seed",
        optOut: {},
        tags: [],
        email: `split-${suffix}@t.test`,
        firstName: "Cy",
        company: "SplitCo",
      },
    });
    const first = await sendStep(
      deps({ transport: split }),
      params({ contactId: contact.id, stepNodeId: "s1" }),
    );
    expect(first.providerMessageId).toBe(`SGX-1-${suffix}`); // webhook correlation id, kept
    expect((first.meta as { rfcMessageId?: string }).rfcMessageId).toBe(
      `<rfc-1-${suffix}@send.clientforce.io>`,
    );

    await sendStep(
      deps({ transport: split }),
      params({
        contactId: contact.id,
        stepNodeId: "s2",
        content: { subject: "ignored", body: "Bump {{firstName}} — {{senderName}}", threaded: true },
      }),
    );
    const email = split.sent.at(-1)!;
    expect(email.inReplyTo).toBe(`<rfc-1-${suffix}@send.clientforce.io>`);
    expect(email.references).toEqual([`<rfc-1-${suffix}@send.clientforce.io>`]);
  });

  it("owner rule 3: a faux-'Re:' on a fresh thread is stripped and audited, never emitted", async () => {
    const fresh = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "seed",
        optOut: {},
        tags: [],
        email: `fresh-${suffix}@t.test`,
        firstName: "Bea",
        company: "FreshCo",
      },
    });
    const message = await sendStep(
      deps(),
      params({
        contactId: fresh.id,
        content: {
          subject: "Re: Fwd: our {{company}} plan",
          body: "Hi {{firstName}} — {{senderName}}",
        },
      }),
    );
    const email = transport.sent.at(-1)!;
    expect(email.subject).toBe("our FreshCo plan");
    expect(email.inReplyTo).toBeUndefined();
    expect((message.meta as { sanitized?: string }).sanitized).toMatch(/faux thread prefix/);
  });

  it("owner rule 1: a sender without a from-name FAILS the send", async () => {
    const noName = await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "CF_MANAGED",
        fromEmail: "b@send.clientforce.io",
        fromName: "  ",
      },
    });
    await expect(sendStep(deps(), params({ senderId: noName.id }))).rejects.toMatchObject({
      reason: "SENDER_NO_FROM_NAME",
    });
  });

  it("owner rule 2: no workspace company_address → send refused, never a placeholder", async () => {
    const row = await owner.businessContext.findFirstOrThrow({
      where: { workspaceId: ws, agentId: null },
    });
    await owner.businessContext.update({ where: { id: row.id }, data: { fields: {} } });
    await expect(sendStep(deps(), params())).rejects.toMatchObject({
      reason: "NO_COMPANY_ADDRESS",
    });
    await owner.businessContext.update({
      where: { id: row.id },
      data: { fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } } },
    });
  });

  it("suppression + opt-out both block (A7/A8)", async () => {
    const victim = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "seed",
        optOut: { email: true },
        tags: [],
        email: `opted-${suffix}@t.test`,
        firstName: "Opt",
        company: "OutCo",
      },
    });
    await expect(sendStep(deps(), params({ contactId: victim.id }))).rejects.toMatchObject({
      reason: "OPTED_OUT",
    });

    const suppressed = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "seed",
        optOut: {},
        tags: [],
        email: `supp-${suffix}@t.test`,
        firstName: "Sue",
        company: "PressedCo",
      },
    });
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: suppressed.email!, reason: "MANUAL" },
    });
    await expect(sendStep(deps(), params({ contactId: suppressed.id }))).rejects.toMatchObject({
      reason: "SUPPRESSED",
    });
  });

  it("guardrails: outside the sending window and over the daily cap both block (A8)", async () => {
    await expect(
      sendStep(deps({ now: () => new Date("2026-07-05T10:00:00Z") }), params()), // Sunday
    ).rejects.toMatchObject({ reason: "OUTSIDE_SENDING_WINDOW" });

    await owner.agent.update({
      where: { id: agentId },
      data: {
        guardrails: {
          sendingWindow: {
            days: [1, 2, 3, 4, 5, 6, 7],
            start: "00:00",
            end: "23:59",
            timezone: "UTC",
          },
          dailyCap: { email: 1 },
          consent: null,
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    await expect(sendStep(deps(), params())).rejects.toMatchObject({ reason: "DAILY_CAP_REACHED" });
    await owner.agent.update({ where: { id: agentId }, data: { guardrails: {} } });
  });

  it("§G allow-list: a non-allow-listed recipient is refused when a list is set", async () => {
    await expect(
      sendStep(deps({ allowlist: ["tronwebng@gmail.com"] }), params()),
    ).rejects.toMatchObject({ reason: "RECIPIENT_NOT_ALLOWLISTED" });
  });

  it("webhooks: bounce/unsubscribe write Suppression + Contact.optOut; workspace resolved via Message", async () => {
    const message = await withTenant(app, { workspaceId: ws }, (tx) =>
      tx.message.findFirstOrThrow({ where: { workspaceId: ws, contactId } }),
    );
    const email = (await owner.contact.findUniqueOrThrow({ where: { id: contactId } })).email!;
    const [event] = normalizeSendGridEvents([
      {
        event: "unsubscribe",
        email,
        timestamp: 1720000000,
        sg_message_id: `${message.providerMessageId!.replace(/^<|>$/g, "")}.filter001`,
      },
    ]);
    expect(await resolveEventWorkspace(owner, event!)).toBe(ws);

    const result = await applyEmailEvent(app, ws, event!);
    expect(result.suppressed).toBe(true);
    const row = await owner.suppression.findFirst({
      where: { workspaceId: ws, address: email },
    });
    expect(row?.reason).toBe("UNSUBSCRIBED");
    const contact = await owner.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect((contact.optOut as { email?: boolean }).email).toBe(true);
    // …and the boundary now refuses this contact.
    await expect(sendStep(deps(), params())).rejects.toBeInstanceOf(SendBlockedError);
  });

  it("field encryption round-trips; a wrong key fails closed", () => {
    const key = Buffer.from(new Array(32).fill(7)).toString("base64");
    const other = Buffer.from(new Array(32).fill(9)).toString("base64");
    const enc = encryptField("smtp-password-123", key);
    expect(decryptField(enc, key)).toBe("smtp-password-123");
    expect(() => decryptField(enc, other)).toThrow();
  });
});
