/**
 * Channels API e2e (P1.5): sender CRUD (CF_MANAGED live, other tiers inert),
 * test-send through the FULL boundary (owner rules + allow-list), and the
 * public SendGrid webhook applying suppressions. Requires Postgres (skips
 * without DB env). No network — the transport is a capturing fake.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailSender, RenderedEmail } from "@clientforce/channels";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { EMAIL_TRANSPORT } from "../src/channels/channels.providers";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_INBOX = `inbox-${suffix}@allowed.test`;
const ADDRESS = "42 Demo Street, Austin TX";

class CapturingSender implements EmailSender {
  sent: RenderedEmail[] = [];
  async send(email: RenderedEmail) {
    this.sent.push(email);
    return { providerMessageId: `<api-${this.sent.length}-${suffix}@send.clientforce.io>` };
  }
}

describe.skipIf(!hasDb)("Channels API e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let viewerToken: string;
  const transport = new CapturingSender();

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    process.env.CHANNELS_ALLOWLIST = TEST_INBOX;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `sn-${suffix}`, slug: `sn-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "SN", slug: `sn-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: {
          workspaceId: ws,
          name: "Booker",
          goal: "book_appointments",
          // Full-week window so the e2e is independent of the wall clock.
          guardrails: {
            sendingWindow: {
              days: [1, 2, 3, 4, 5, 6, 7],
              start: "00:00",
              end: "23:59",
              timezone: "UTC",
            },
            dailyCap: { email: 100 },
            consent: null,
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } },
      },
    });

    const u1 = await owner.user.create({
      data: { email: `sn-owner-${suffix}@t.test`, authProviderId: `auth|sn-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const viewer = await owner.user.create({
      data: { email: `sn-viewer-${suffix}@t.test`, authProviderId: `auth|sn-viewer-${suffix}` },
    });
    await owner.membership.create({ data: { userId: viewer.id, workspaceId: ws, role: "VIEWER" } });
    userIds = [u1.id, viewer.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|sn-owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, {
      sub: `auth|sn-viewer-${suffix}`,
      email: viewer.email,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(transport)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    delete process.env.CHANNELS_ALLOWLIST;
    await app?.close();
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });
  let senderId: string;

  it("POST /senders creates CF_MANAGED; other tiers are designed-but-inert (400)", async () => {
    const res = await request(app.getHttpServer())
      .post("/senders")
      .set(asOwner())
      .send({ type: "CF_MANAGED", fromEmail: "agent@send.clientforce.io", fromName: "Sam Rivers" });
    expect(res.status).toBe(201);
    senderId = res.body.id;

    await request(app.getHttpServer())
      .post("/senders")
      .set(asOwner())
      .send({ type: "GMAIL_OAUTH", fromEmail: "me@gmail.test" })
      .expect(400);

    const list = await request(app.getHttpServer()).get("/senders").set(asOwner());
    expect(list.body).toHaveLength(1);
  });

  it("POST /senders/test-send goes through the full boundary and returns a provider id", async () => {
    const res = await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asOwner())
      .send({ senderId, agentId, to: TEST_INBOX });
    expect(res.status).toBe(201);
    expect(res.body.providerMessageId).toMatch(/^<api-/);
    const email = transport.sent.at(-1)!;
    expect(email.fromName).toBe("Sam Rivers");
    expect(email.body).toContain("Sam Rivers");
    expect(email.body).toContain(ADDRESS); // owner rule 2, verbatim
    expect(email.subject).toBe("Clientforce test send");
  });

  it("test-send to a non-allow-listed recipient is refused (§G phase rule)", async () => {
    const res = await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asOwner())
      .send({ senderId, agentId, to: `stranger-${suffix}@other.test` });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /webhooks/sendgrid is public and applies suppressions via Message resolution", async () => {
    const message = await owner.message.findFirstOrThrow({ where: { workspaceId: ws } });
    const res = await request(app.getHttpServer())
      .post("/webhooks/sendgrid")
      .send([
        {
          event: "unsubscribe",
          email: TEST_INBOX,
          timestamp: Math.floor(Date.now() / 1000),
          sg_message_id: `${message.providerMessageId!.replace(/^<|>$/g, "")}.filter1`,
        },
      ]);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: 1, suppressionsApplied: 1 });
    const suppression = await owner.suppression.findFirst({
      where: { workspaceId: ws, address: TEST_INBOX },
    });
    expect(suppression?.reason).toBe("UNSUBSCRIBED");

    // …and a further test-send to that inbox is now blocked at the boundary.
    const blocked = await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asOwner())
      .send({ senderId, agentId, to: TEST_INBOX });
    expect(blocked.status).toBeGreaterThanOrEqual(400);
  });

  it("a VIEWER cannot create senders or test-send → 403", async () => {
    const viewer = { Authorization: `Bearer ${viewerToken}`, "x-workspace-id": ws };
    await request(app.getHttpServer())
      .post("/senders")
      .set(viewer)
      .send({ type: "CF_MANAGED", fromEmail: "x@send.clientforce.io" })
      .expect(403);
    await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(viewer)
      .send({ senderId, agentId, to: TEST_INBOX })
      .expect(403);
  });
});
