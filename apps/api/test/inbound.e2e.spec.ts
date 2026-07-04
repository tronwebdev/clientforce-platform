/**
 * Inbound Parse webhook e2e (P1.7): URL-token gate, INBOUND Message
 * persistence with thread anchoring, classify-job enqueue (fake queue), and
 * the event webhook's typed-event enrichment (engagement awareness).
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { CLASSIFY_QUEUE } from "../src/channels/webhooks.controller";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const LEAD = `lead-${suffix}@acme.test`;
const TOKEN = `tok-${suffix}`;

class FakeQueue {
  jobs: Array<{ name: string; data: unknown }> = [];
  async add(name: string, data: unknown) {
    this.jobs.push({ name, data });
  }
}

describe.skipIf(!hasDb)("Inbound webhook e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const queue = new FakeQueue();
  let agencyId: string;
  let ws: string;
  let campaignId: string;
  let contactId: string;
  let outboundId: string;

  beforeAll(async () => {
    process.env.INBOUND_PARSE_TOKEN = TOKEN;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `inb-${suffix}`, slug: `inb-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "INB", slug: `inb-${suffix}`, settings: {} },
      })
    ).id;
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Booker", goal: "book_appointments", guardrails: {} },
    });
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId: agent.id, name: "primary", graphId: "" },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: { workspaceId: ws, source: "import", optOut: {}, tags: [], email: LEAD },
      })
    ).id;
    outboundId = (
      await owner.message.create({
        data: {
          workspaceId: ws,
          campaignId,
          contactId,
          channel: "email",
          direction: "OUTBOUND",
          subject: "A quick idea",
          body: "hi",
          providerMessageId: `SGX-inb-${suffix}`,
          stepNodeId: "s1",
          sentAt: new Date(),
          meta: { rfcMessageId: `<rfc-inb-${suffix}@send.clientforce.io>` },
        },
      })
    ).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLASSIFY_QUEUE)
      .useValue(queue)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    delete process.env.INBOUND_PARSE_TOKEN;
    await app?.close();
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.event.deleteMany({ where: { workspaceId: ws } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
  });

  const form = () => ({
    from: `Dara <${LEAD}>`,
    to: "agent@reply.clientforce.io",
    subject: "Re: A quick idea",
    text: "Keen — how do we book a call?",
    headers: `In-Reply-To: <rfc-inb-${suffix}@send.clientforce.io>`,
  });

  it("rejects a wrong/missing token (Inbound Parse is unsigned — the token IS the auth)", async () => {
    await request(app.getHttpServer())
      .post("/webhooks/sendgrid-inbound?token=wrong")
      .field("from", form().from)
      .field("text", form().text)
      .expect(401);
    await request(app.getHttpServer())
      .post("/webhooks/sendgrid-inbound")
      .field("from", form().from)
      .field("text", form().text)
      .expect(401);
  });

  it("persists the reply as an INBOUND Message on the resolved thread and enqueues classification", async () => {
    const f = form();
    const res = await request(app.getHttpServer())
      .post(`/webhooks/sendgrid-inbound?token=${TOKEN}`)
      .field("from", f.from)
      .field("to", f.to)
      .field("subject", f.subject)
      .field("text", f.text)
      .field("headers", f.headers);
    expect(res.status).toBe(201);
    expect(res.body.matched).toBe(true);

    const message = await owner.message.findUniqueOrThrow({
      where: { id: res.body.messageId },
    });
    expect(message).toMatchObject({
      direction: "INBOUND",
      workspaceId: ws,
      contactId,
      inReplyToId: outboundId,
      body: f.text,
    });
    expect(queue.jobs).toEqual([
      { name: "classify", data: { workspaceId: ws, messageId: message.id } },
    ]);
  });

  it("acknowledges unmatched mail without detail", async () => {
    const res = await request(app.getHttpServer())
      .post(`/webhooks/sendgrid-inbound?token=${TOKEN}`)
      .field("from", `stranger-${suffix}@nowhere.test`)
      .field("text", "who dis");
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true, matched: false });
  });

  it("event webhook enrichment: an open becomes a persisted email.opened.v1 Event row", async () => {
    const res = await request(app.getHttpServer())
      .post("/webhooks/sendgrid")
      .send([
        {
          event: "open",
          email: LEAD,
          timestamp: Math.floor(Date.now() / 1000),
          sg_message_id: `SGX-inb-${suffix}.filter001`,
        },
      ]);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ received: 1, eventsPublished: 1 });
    const row = await owner.event.findFirst({
      where: { workspaceId: ws, type: "email.opened.v1", contactId },
    });
    expect(row).not.toBeNull();
    expect(row?.payload).toMatchObject({ messageId: outboundId });
  });
});
