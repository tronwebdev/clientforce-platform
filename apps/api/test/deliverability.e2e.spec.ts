/**
 * D1 e2e: the hardened event webhook and the deliverability rule route.
 *
 * The webhook cases here are the ones a unit test cannot reach, because they
 * are about the ROUTE rather than the function: that a real signature over the
 * real request bytes is accepted (the raw-body defect, DEC-170), that a
 * replayed batch has no second effect (DEC-174), and that an event nobody can
 * correlate is COUNTED rather than silently dropped.
 *
 * Requires Postgres (skips without DB env). No network.
 */
import { createSign, generateKeyPairSync } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `d1e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
/** The bare base64 SPKI form SendGrid's console actually hands an owner. */
const BARE_KEY = publicKey.export({ type: "spki", format: "der" }).toString("base64");

describe.skipIf(!hasDb)("D1 · deliverability e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let ownerToken: string;
  let viewerToken: string;
  let userIds: string[] = [];
  let messageProviderId: string;
  let contactEmail: string;

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    agencyId = (
      await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } })
    ).id;
    ws = (
      await owner.workspace.create({ data: { agencyId, name: "D1", slug: suffix, settings: {} } })
    ).id;
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Probe", goal: "book_appointments", guardrails: {} },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId: agent.id, name: "c", graphId: "g1" },
    });
    contactEmail = `lead-${suffix}@t.test`;
    const contact = await owner.contact.create({
      data: { workspaceId: ws, source: "seed", optOut: {}, tags: [], email: contactEmail },
    });
    messageProviderId = `<d1-${suffix}@send.clientforce.io>`;
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: contact.id,
        channel: "email",
        direction: "OUTBOUND",
        body: "seed",
        providerMessageId: messageProviderId,
        sentAt: new Date(),
        meta: {},
      },
    });

    const u1 = await owner.user.create({
      data: { email: `d1-owner-${suffix}@t.test`, authProviderId: `auth|d1-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const viewer = await owner.user.create({
      data: { email: `d1-viewer-${suffix}@t.test`, authProviderId: `auth|d1-viewer-${suffix}` },
    });
    await owner.membership.create({ data: { userId: viewer.id, workspaceId: ws, role: "VIEWER" } });
    userIds = [u1.id, viewer.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|d1-owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, {
      sub: `auth|d1-viewer-${suffix}`,
      email: viewer.email,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner.$disconnect();
  });

  afterEach(() => {
    delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  });

  /* ───────────────────── the signed webhook (DEC-170) ───────────────────── */

  const post = (rawBody: string, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post("/webhooks/sendgrid")
      .set("content-type", "application/json")
      .set(headers)
      .send(rawBody);

  const sign = (rawBody: string, timestamp: string): string => {
    const signer = createSign("sha256");
    signer.update(timestamp + rawBody);
    return signer.sign(privateKey, "base64");
  };

  const batch = (events: Record<string, unknown>[]): string =>
    JSON.stringify(
      events.map((e) => ({
        email: contactEmail,
        timestamp: Math.floor(Date.now() / 1000),
        sg_message_id: `${messageProviderId.replace(/^<|>$/g, "")}.filter1`,
        ...e,
      })),
    );

  it("accepts a REAL signature over the REAL request bytes, using the bare key", async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = BARE_KEY;
    const raw = batch([{ event: "open", sg_event_id: `sig-ok-${suffix}` }]);
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await post(raw, {
      "x-twilio-email-event-webhook-signature": sign(raw, ts),
      "x-twilio-email-event-webhook-timestamp": ts,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ received: 1 });
  });

  it("rejects a tampered body with 401", async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = BARE_KEY;
    const raw = batch([{ event: "open", sg_event_id: `sig-tamper-${suffix}` }]);
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = sign(raw, ts);
    const tampered = raw.replace('"open"', '"click"');
    const res = await post(tampered, {
      "x-twilio-email-event-webhook-signature": signature,
      "x-twilio-email-event-webhook-timestamp": ts,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a missing signature with 401 when a key is configured", async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = BARE_KEY;
    const res = await post(batch([{ event: "open", sg_event_id: `sig-none-${suffix}` }]));
    expect(res.status).toBe(401);
  });

  it("a junk key is a 401, never a 500 — a 500 is a retry loop", async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = "not-a-key-at-all";
    const raw = batch([{ event: "open", sg_event_id: `sig-junk-${suffix}` }]);
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await post(raw, {
      "x-twilio-email-event-webhook-signature": sign(raw, ts),
      "x-twilio-email-event-webhook-timestamp": ts,
    });
    expect(res.status).toBe(401);
  });

  /* ─────────────────────── idempotency (DEC-174) ─────────────────────── */

  it("a REPLAYED batch is a no-op — the rate that pauses senders can't be inflated", async () => {
    const eventId = `dedup-${suffix}`;
    const raw = batch([{ event: "bounce", type: "bounce", status: "5.1.1", sg_event_id: eventId }]);

    const first = await post(raw);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ received: 1, duplicatesSkipped: 0, eventsPublished: 1 });

    // SendGrid retries until acked. The second delivery must change nothing.
    const eventsAfterFirst = await owner.event.count({
      where: { workspaceId: ws, type: "email.bounced.v1" },
    });
    const second = await post(raw);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ received: 1, duplicatesSkipped: 1, eventsPublished: 0 });
    expect(
      await owner.event.count({ where: { workspaceId: ws, type: "email.bounced.v1" } }),
    ).toBe(eventsAfterFirst);
  });

  it("an event that cannot be correlated is COUNTED, not silently dropped", async () => {
    const res = await post(
      JSON.stringify([
        {
          event: "bounce",
          type: "bounce",
          email: `orphan-${suffix}@t.test`,
          timestamp: Math.floor(Date.now() / 1000),
          sg_message_id: `no-such-message-${suffix}`,
          sg_event_id: `orphan-${suffix}`,
        },
      ]),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ received: 1, unresolved: 1, suppressionsApplied: 0 });
  });

  /* ───────────────── the rule route (DEC-173) ───────────────── */

  it("GET /deliverability/rule answers with the platform defaults before anything is set", async () => {
    const res = await request(app.getHttpServer())
      .get("/deliverability/rule")
      .set(asOwner())
      .expect(200);
    expect(res.body).toMatchObject({
      configured: false,
      rule: {
        pauseOnBounceRate: true,
        bounceRateThreshold: 0.02,
        softBounceThreshold: 3,
        softBounceWindowDays: 30,
      },
    });
  });

  it("PATCH upserts and the GET then reports it as configured", async () => {
    await request(app.getHttpServer())
      .patch("/deliverability/rule")
      .set(asOwner())
      .send({ bounceRateThreshold: 0.05, pauseOnBounceRate: false })
      .expect(200);
    const res = await request(app.getHttpServer())
      .get("/deliverability/rule")
      .set(asOwner())
      .expect(200);
    expect(res.body).toMatchObject({
      configured: true,
      rule: { bounceRateThreshold: 0.05, pauseOnBounceRate: false, softBounceThreshold: 3 },
    });
    // Put it back so ordering between specs can never matter.
    await owner.deliverabilityRule.deleteMany({ where: { workspaceId: ws } });
  });

  it("rejects a threshold below the 0.1% floor — a footgun, not a setting", async () => {
    await request(app.getHttpServer())
      .patch("/deliverability/rule")
      .set(asOwner())
      .send({ bounceRateThreshold: 0.00001 })
      .expect(400);
  });

  it("rejects an empty patch", async () => {
    await request(app.getHttpServer())
      .patch("/deliverability/rule")
      .set(asOwner())
      .send({})
      .expect(400);
  });

  it("a VIEWER may read the rule but not change it", async () => {
    const viewer = { Authorization: `Bearer ${viewerToken}`, "x-workspace-id": ws };
    await request(app.getHttpServer()).get("/deliverability/rule").set(viewer).expect(200);
    await request(app.getHttpServer())
      .patch("/deliverability/rule")
      .set(viewer)
      .send({ pauseOnBounceRate: false })
      .expect(403);
  });
});
