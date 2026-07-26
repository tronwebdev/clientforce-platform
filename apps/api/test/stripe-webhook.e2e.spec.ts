/**
 * INT W3 (DEC-095) Stripe webhook e2e vs real Postgres+RLS — the public
 * payment-detection endpoint end-to-end:
 *
 *   auth        — missing/unknown ?token → 401; bad/absent/tampered
 *                 Stripe-Signature with a secret on the row → 401
 *   ingest      — checkout.session.completed → payment.received.v1 with
 *                 envelope refs + the IntegrationDelivery claim (kind=payment)
 *   idempotency — redelivery of the same session acks duplicate, ONE event
 *   honesty     — other event types ack `ignored` (never a retry storm);
 *                 unmatched payers ack `unmatched` with NO event;
 *                 malformed payloads 400
 */
import { createHmac } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { encryptCredentials } from "@clientforce/integrations";
import { AppModule } from "../src/app.module";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `strweb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
process.env.AUTH_DEV_SECRET ??= "test-dev-secret";

const TOKEN = `tok-${suffix}`;
const SECRET = `whsec_${suffix}`;

// t defaults to NOW — the controller enforces a ±300s replay window, so a
// fixed past timestamp would 401 every request (a dedicated test signs stale).
const sign = (body: unknown, key = SECRET, t = String(Math.floor(Date.now() / 1000))): string => {
  const v1 = createHmac("sha256", key).update(`${t}.${JSON.stringify(body)}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
};

describe.skipIf(!hasDb)("stripe webhook e2e (INT W3, DEC-095)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let contactId: string;
  let enrollmentId: string;
  let campaignId: string;
  let integrationId: string;

  const api = () => request(app.getHttpServer());

  const checkout = (over: Record<string, unknown> = {}) => ({
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${suffix}_1`,
        amount_total: 50000,
        currency: "usd",
        client_reference_id: "",
        customer_details: { email: `payer-${suffix}@t.test` },
        ...over,
      },
    },
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "sw", slug: suffix, settings: {} } })).id;
    const agentId = (
      await owner.agent.create({ data: { workspaceId: ws, name: "Closer", goal: "close_deals", guardrails: {} } })
    ).id;
    campaignId = (
      await owner.campaign.create({ data: { workspaceId: ws, agentId, name: "primary", graphId: "" } })
    ).id;
    contactId = (
      await owner.contact.create({
        data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `payer-${suffix}@t.test` },
      })
    ).id;
    enrollmentId = (
      await owner.enrollment.create({
        data: { workspaceId: ws, campaignId, contactId, workflowId: `sw-${suffix}`, pipelineStage: "engaged", meta: {} },
      })
    ).id;
    integrationId = (
      await owner.integration.create({
        data: {
          workspaceId: ws,
          provider: "stripe",
          status: "connected",
          config: { paymentLinkUrl: "https://buy.stripe.com/demo", webhookToken: TOKEN, detection: true },
          scopes: [],
          credentialsEnc: encryptCredentials({ apiKey: "rk_stub", webhookSigningSecret: SECRET }),
        },
      })
    ).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  beforeEach(async () => {
    await owner.event.deleteMany({ where: { workspaceId: ws } });
    await owner.integrationDelivery.deleteMany({ where: { workspaceId: ws } });
  });

  afterAll(async () => {
    await app?.close();
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
  });

  it("refuses a missing or unknown webhook token (401)", async () => {
    const body = checkout();
    await api().post("/webhooks/stripe").set("stripe-signature", sign(body)).send(body).expect(401);
    await api().post("/webhooks/stripe?token=nope").set("stripe-signature", sign(body)).send(body).expect(401);
  });

  it("refuses a bad, absent, or tampered signature (401) — nothing ingests", async () => {
    const body = checkout();
    await api().post(`/webhooks/stripe?token=${TOKEN}`).send(body).expect(401);
    await api().post(`/webhooks/stripe?token=${TOKEN}`).set("stripe-signature", sign(body, "wrong")).send(body).expect(401);
    const tampered = checkout({ amount_total: 1 });
    await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(body))
      .send(tampered)
      .expect(401);
    expect(await owner.event.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it("checkout completed (reference match) → payment.received.v1 with envelope refs + the claim row", async () => {
    const body = checkout({ id: `cs_${suffix}_ref`, client_reference_id: contactId });
    const res = await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(body))
      .send(body)
      .expect(201);
    expect(res.body).toMatchObject({ ok: true, outcome: "recorded", matchedBy: "reference" });

    const events = await owner.event.findMany({ where: { workspaceId: ws, type: "payment.received.v1" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ contactId, enrollmentId, campaignId });
    expect(events[0]!.payload).toMatchObject({ amount: 50000, currency: "usd", provider: "stripe", externalId: `cs_${suffix}_ref` });

    const claim = await owner.integrationDelivery.findFirst({ where: { integrationId, kind: "payment" } });
    expect(claim).toMatchObject({ sourceEventId: `cs_${suffix}_ref`, status: "delivered" });
  });

  it("redelivery of the same session acks duplicate — ONE event ever", async () => {
    const body = checkout({ id: `cs_${suffix}_dup`, client_reference_id: contactId });
    await api().post(`/webhooks/stripe?token=${TOKEN}`).set("stripe-signature", sign(body)).send(body).expect(201);
    const again = await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(body))
      .send(body)
      .expect(201);
    expect(again.body.outcome).toBe("duplicate");
    expect(await owner.event.count({ where: { workspaceId: ws, type: "payment.received.v1" } })).toBe(1);
  });

  it("email fallback correlates; an unmatched payer acks with NO event (honest not-our-lead)", async () => {
    const byEmail = checkout({ id: `cs_${suffix}_em` }); // reference empty → email match
    const res = await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(byEmail))
      .send(byEmail)
      .expect(201);
    expect(res.body.matchedBy).toBe("email");

    const stranger = checkout({ id: `cs_${suffix}_x`, customer_details: { email: "who@elsewhere.test" } });
    const res2 = await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(stranger))
      .send(stranger)
      .expect(201);
    expect(res2.body.outcome).toBe("unmatched");
    expect(await owner.event.count({ where: { workspaceId: ws, type: "payment.received.v1" } })).toBe(1);
  });

  it("other event types ack `ignored` (never a retry storm); a typeless event 400s", async () => {
    const refund = { type: "charge.refunded", data: { object: { id: "ch_1" } } };
    const res = await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(refund))
      .send(refund)
      .expect(201);
    expect(res.body).toMatchObject({ ok: true, outcome: "ignored" });

    // A genuinely malformed event (no `type`) still 400s.
    const typeless = { data: { object: { id: "x" } } };
    await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(typeless))
      .send(typeless)
      .expect(400);
  });

  it("a completed session with a NULL amount acks `ignored` (no retry storm over setup/zero sessions)", async () => {
    // mode:"setup" card-save + zero/promo completions carry amount_total:null —
    // a boring no-op that must ack, never 400 (which would disable the endpoint).
    const noAmount = { type: "checkout.session.completed", data: { object: { id: `cs_${suffix}_setup`, amount_total: null, client_reference_id: contactId } } };
    const res = await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(noAmount))
      .send(noAmount)
      .expect(201);
    expect(res.body).toMatchObject({ ok: true, outcome: "ignored", reason: "no_amount" });
    expect(await owner.event.count({ where: { workspaceId: ws, type: "payment.received.v1" } })).toBe(0);
  });

  it("a valid signature over a STALE timestamp is refused (replay window)", async () => {
    const body = checkout({ id: `cs_${suffix}_stale`, client_reference_id: contactId });
    const staleT = String(Math.floor(Date.now() / 1000) - 3600); // 1h old
    await api()
      .post(`/webhooks/stripe?token=${TOKEN}`)
      .set("stripe-signature", sign(body, SECRET, staleT))
      .send(body)
      .expect(401);
    expect(await owner.event.count({ where: { workspaceId: ws, type: "payment.received.v1" } })).toBe(0);
  });
});
