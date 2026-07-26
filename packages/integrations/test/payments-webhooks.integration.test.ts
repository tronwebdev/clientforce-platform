/**
 * INT W3 (DEC-095) vs REAL Postgres + RLS:
 *  - payment ingest: claim-first idempotency (IntegrationDelivery
 *    kind=payment on the session id), reference→email→none correlation,
 *    envelope refs off the latest ACTIVE enrollment, `payment.received.v1`
 *    published ONCE, unmatched payers acked without events — and the event
 *    fires a `payment_received` rule through the REAL engine exactly once.
 *  - webhook delivery: the guard runs for real (public IP literals skip DNS;
 *    global fetch stubbed so no packet leaves), signature verifiable with
 *    the stored secret, claim-then-send dedupe, url fallback, failure and
 *    guard-refusal recorded on the ledger, run outcome never changes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { evaluateEventForRules, type RuleEngineDeps } from "@clientforce/automations";
import { deliverWebhook, ingestPayment, signWebhookBody, type IntegrationsDeps, type PaymentDeps } from "../src";

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `intw3-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasInfra)("payment ingest + webhook delivery (INT W3)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let campaignId: string;
  let contactId: string;
  let enrollmentId: string;
  let stripeRowId: string;
  let webhooksRowId: string;
  const published: Array<{ type: string; payload: unknown; contactId?: string; enrollmentId?: string; campaignId?: string }> = [];

  const paymentDeps = (): PaymentDeps => ({
    prisma: app,
    publish: async (input) => {
      published.push(input as (typeof published)[number]);
    },
  });
  const intDeps = (): IntegrationsDeps => ({
    prisma: app,
    adapters: {},
    publish: async (input) => {
      published.push(input as (typeof published)[number]);
    },
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "w3", slug: suffix, settings: {} } })).id;
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
        data: { workspaceId: ws, campaignId, contactId, workflowId: `w3-${suffix}`, pipelineStage: "engaged", meta: {} },
      })
    ).id;
    stripeRowId = (
      await owner.integration.create({
        data: {
          workspaceId: ws,
          provider: "stripe",
          status: "connected",
          config: { paymentLinkUrl: "https://buy.stripe.com/demo", webhookToken: `tok-${suffix}`, detection: true },
          scopes: [],
        },
      })
    ).id;
    webhooksRowId = (
      await owner.integration.create({
        data: {
          workspaceId: ws,
          provider: "webhooks",
          status: "connected",
          config: { defaultUrl: "https://1.1.1.1:8443/hook", signingSecret: `whsec_cf_${suffix}` },
          scopes: [],
        },
      })
    ).id;
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reference match → recorded once with envelope refs + the claim row; redelivery acks duplicate", async () => {
    published.length = 0;
    const first = await ingestPayment(paymentDeps(), {
      workspaceId: ws,
      integrationId: stripeRowId,
      externalId: `cs_${suffix}_1`,
      amount: 50000,
      currency: "usd",
      clientReferenceId: contactId,
    });
    expect(first).toEqual({ outcome: "recorded", contactId, matchedBy: "reference" });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "payment.received.v1",
      contactId,
      enrollmentId,
      campaignId,
      payload: { amount: 50000, currency: "usd", provider: "stripe", externalId: `cs_${suffix}_1` },
    });

    const dup = await ingestPayment(paymentDeps(), {
      workspaceId: ws,
      integrationId: stripeRowId,
      externalId: `cs_${suffix}_1`,
      amount: 50000,
      clientReferenceId: contactId,
    });
    expect(dup.outcome).toBe("duplicate");
    expect(published).toHaveLength(1); // never a second event

    const claims = await owner.integrationDelivery.findMany({
      where: { integrationId: stripeRowId, kind: "payment" },
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]!.status).toBe("delivered");
  });

  it("email fallback correlates when the reference is absent", async () => {
    published.length = 0;
    const res = await ingestPayment(paymentDeps(), {
      workspaceId: ws,
      integrationId: stripeRowId,
      externalId: `cs_${suffix}_2`,
      amount: 1200,
      payerEmail: `PAYER-${suffix}@T.TEST`, // case-insensitive
    });
    expect(res).toEqual({ outcome: "recorded", contactId, matchedBy: "email" });
  });

  it("unmatched payer → acked, claimed, NO event (honest not-our-lead)", async () => {
    published.length = 0;
    const res = await ingestPayment(paymentDeps(), {
      workspaceId: ws,
      integrationId: stripeRowId,
      externalId: `cs_${suffix}_3`,
      amount: 900,
      payerEmail: `stranger-${suffix}@elsewhere.test`,
    });
    expect(res).toEqual({ outcome: "unmatched", contactId: null, matchedBy: "none" });
    expect(published).toHaveLength(0);
  });

  it("payment.received.v1 fires a payment_received rule through the REAL engine exactly once", async () => {
    const rule = await owner.campaignRule.create({
      data: {
        workspaceId: ws,
        campaignId,
        order: 0,
        enabled: true,
        trigger: { kind: "payment_received" },
        actions: [{ kind: "add_tag", tag: "paid" }],
      },
    });
    const deps: RuleEngineDeps = { prisma: app };
    const event = {
      id: `evt-${suffix}-pay`,
      workspaceId: ws,
      type: "payment.received.v1" as const,
      contactId,
      enrollmentId,
      campaignId,
      senderId: null,
      payload: { amount: 50000, provider: "stripe" },
      occurredAt: new Date().toISOString(),
    };
    const summary = await evaluateEventForRules(deps, event);
    expect(summary.matched).toBe(1);
    const again = await evaluateEventForRules(deps, event); // redelivery
    expect(again.runs.filter((r) => r.status === "fired")).toHaveLength(0);
    const contact = await owner.contact.findUnique({ where: { id: contactId } });
    expect(contact!.tags).toContain("paid");
    await owner.campaignRule.delete({ where: { id: rule.id } });
  });

  it("webhook delivery: guard passes the public literal, the POST is signed verifiably, claim dedupes", async () => {
    published.length = 0;
    const seen: Array<{ url: string; body: string; sig: string; eventHeader: string }> = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(url),
        body: String(init?.body),
        sig: String((init?.headers as Record<string, string>)["x-clientforce-signature"]),
        eventHeader: String((init?.headers as Record<string, string>)["x-clientforce-event"]),
      });
      return new Response("ok", { status: 200 });
    });
    const payload = {
      v: 1 as const,
      eventId: `evt-${suffix}-wh`,
      type: "payment.received.v1",
      occurredAt: new Date().toISOString(),
      workspaceId: ws,
      contactId,
      rule: { id: "rule-1" },
      payload: { amount: 50000 },
    };
    const res = await deliverWebhook(intDeps(), {
      workspaceId: ws,
      payload,
      sourceEventId: `evt-${suffix}-wh#rule:rule-1#a:0`,
    });
    expect(res.delivered).toBe(true);
    expect(res.target).toBe("https://1.1.1.1:8443/hook");
    expect(seen).toHaveLength(1);
    // The signature verifies with the stored workspace secret over "t.body".
    const sig = seen[0]!.sig.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    expect(sig).not.toBeNull();
    const expected = signWebhookBody(`whsec_cf_${suffix}`, sig![1]!, seen[0]!.body);
    expect(sig![2]).toBe(expected);
    expect(seen[0]!.eventHeader).toBe("payment.received.v1");
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ v: 1, type: "payment.received.v1", rule: { id: "rule-1" } });

    // Redelivery under the SAME source key → claim dedupe, no second POST.
    const dup = await deliverWebhook(intDeps(), {
      workspaceId: ws,
      payload,
      sourceEventId: `evt-${suffix}-wh#rule:rule-1#a:0`,
    });
    expect(dup.delivered).toBe(true); // the settled row reports honestly
    expect(dup.detail).toContain("duplicate");
    expect(seen).toHaveLength(1);
  });

  it("action url overrides the default; a 500 settles failed without throwing", async () => {
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://8.8.8.8/override");
      return new Response("boom", { status: 500 });
    });
    const res = await deliverWebhook(intDeps(), {
      workspaceId: ws,
      url: "https://8.8.8.8/override",
      payload: {
        v: 1,
        eventId: `evt-${suffix}-o`,
        type: "t",
        occurredAt: new Date().toISOString(),
        workspaceId: ws,
        rule: { id: "r" },
        payload: {},
      },
      sourceEventId: `evt-${suffix}-o#rule:r#a:0`,
    });
    expect(res.delivered).toBe(false);
    // Transient 5xx from the vendor spine classifies before the delivery
    // wrapper — the ledger row records the failure either way.
    const row = await owner.integrationDelivery.findFirst({
      where: { integrationId: webhooksRowId, sourceEventId: `evt-${suffix}-o#rule:r#a:0` },
    });
    expect(row!.status).toBe("failed");
  });

  it("a private destination refuses TYPED, names the rule, settles failed — no fetch happens", async () => {
    let fetched = 0;
    vi.stubGlobal("fetch", async () => {
      fetched += 1;
      return new Response("ok", { status: 200 });
    });
    const res = await deliverWebhook(intDeps(), {
      workspaceId: ws,
      url: "https://169.254.169.254/latest/meta-data",
      payload: {
        v: 1,
        eventId: `evt-${suffix}-ssrf`,
        type: "t",
        occurredAt: new Date().toISOString(),
        workspaceId: ws,
        rule: { id: "r" },
        payload: {},
      },
      sourceEventId: `evt-${suffix}-ssrf#rule:r#a:0`,
    });
    expect(res.delivered).toBe(false);
    expect(res.detail).toContain("non-public");
    expect(fetched).toBe(0);
    const row = await owner.integrationDelivery.findFirst({
      where: { integrationId: webhooksRowId, sourceEventId: `evt-${suffix}-ssrf#rule:r#a:0` },
    });
    expect(row!.status).toBe("failed");
  });

  // ── Review-round pins (DEC-095 amendment) ────────────────────────────────

  it("publish failure leaves the claim RECOVERABLE (failed, not delivered) — a redelivery re-drives + publishes once", async () => {
    published.length = 0;
    const ext = `cs_${suffix}_pubfail`;
    const throwingDeps: PaymentDeps = { prisma: app, publish: async () => { throw new Error("bus down"); }, log: () => {} };
    // The publish throws → ingest rethrows (controller 5xx → Stripe retries) and
    // the claim is `failed`, NOT `delivered`: the event was never emitted, so the
    // ledger must not read "delivered" and swallow the loss.
    await expect(
      ingestPayment(throwingDeps, { workspaceId: ws, integrationId: stripeRowId, externalId: ext, amount: 7777, clientReferenceId: contactId }),
    ).rejects.toThrow();
    let claim = await owner.integrationDelivery.findFirst({ where: { integrationId: stripeRowId, sourceEventId: ext, kind: "payment" } });
    expect(claim!.status).toBe("failed");
    expect(published).toHaveLength(0);

    // Stripe redelivers the SAME session — a working publish re-drives the failed
    // row to delivered and emits payment.received.v1 exactly once.
    const res = await ingestPayment(paymentDeps(), { workspaceId: ws, integrationId: stripeRowId, externalId: ext, amount: 7777, clientReferenceId: contactId });
    expect(res).toEqual({ outcome: "recorded", contactId, matchedBy: "reference" });
    expect(published).toHaveLength(1);
    claim = await owner.integrationDelivery.findFirst({ where: { integrationId: stripeRowId, sourceEventId: ext, kind: "payment" } });
    expect(claim!.status).toBe("delivered");

    // A further redelivery is now a true duplicate — no re-publish.
    const dup = await ingestPayment(paymentDeps(), { workspaceId: ws, integrationId: stripeRowId, externalId: ext, amount: 7777, clientReferenceId: contactId });
    expect(dup.outcome).toBe("duplicate");
    expect(published).toHaveLength(1);
  });

  it("the outbound allowance brake EXCLUDES inbound payment claims (a busy payment day never holds Slack/webhook sends)", async () => {
    // Fresh workspace so the day-count starts clean.
    const w = (await owner.workspace.create({ data: { agencyId, name: "allow", slug: `${suffix}-allow`, settings: {} } })).id;
    const wStripe = (await owner.integration.create({ data: { workspaceId: w, provider: "stripe", status: "connected", config: { webhookToken: `tok-allow-${suffix}`, detection: true }, scopes: [] } })).id;
    await owner.integration.create({ data: { workspaceId: w, provider: "webhooks", status: "connected", config: { defaultUrl: "https://1.1.1.1:8443/hook", signingSecret: `whsec_cf_allow_${suffix}` }, scopes: [] } });
    const wContact = (await owner.contact.create({ data: { workspaceId: w, source: "test", optOut: {}, tags: [], email: `allow-${suffix}@t.test` } })).id;

    // Two inbound payment claims (delivered rows) already exist for the day…
    await ingestPayment(paymentDeps(), { workspaceId: w, integrationId: wStripe, externalId: `cs_${suffix}_al1`, amount: 100, clientReferenceId: wContact });
    await ingestPayment(paymentDeps(), { workspaceId: w, integrationId: wStripe, externalId: `cs_${suffix}_al2`, amount: 100, clientReferenceId: wContact });

    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
    const depsAllow1: IntegrationsDeps = { prisma: app, adapters: {}, publish: async () => {}, config: { dailyDeliveryAllowance: 1 } };
    const whPayload = (id: string) => ({ v: 1 as const, eventId: `evt-${suffix}-${id}`, type: "t", occurredAt: new Date().toISOString(), workspaceId: w, rule: { id: "r" }, payload: {} });

    // …yet the FIRST outbound webhook still delivers — payments don't count.
    const first = await deliverWebhook(depsAllow1, { workspaceId: w, payload: whPayload("al-a"), sourceEventId: `${suffix}-al-a` });
    expect(first.delivered).toBe(true);
    // The brake still bites the SECOND outbound (one real outbound row now counts).
    const second = await deliverWebhook(depsAllow1, { workspaceId: w, payload: whPayload("al-b"), sourceEventId: `${suffix}-al-b` });
    expect(second.delivered).toBe(false);
    expect(second.detail).toContain("held");
  });

  it("an oversized 4xx error body is capped, not buffered whole (the detail preview stays bounded)", async () => {
    const huge = "X".repeat(2_000_000); // 2 MB
    vi.stubGlobal("fetch", async () => new Response(huge, { status: 400 }));
    const res = await deliverWebhook(intDeps(), {
      workspaceId: ws,
      url: "https://8.8.8.8/cap",
      payload: { v: 1, eventId: `evt-${suffix}-cap`, type: "t", occurredAt: new Date().toISOString(), workspaceId: ws, rule: { id: "r" }, payload: {} },
      sourceEventId: `evt-${suffix}-cap#rule:r#a:0`,
    });
    expect(res.delivered).toBe(false);
    // The preview is sliced to 140 chars — the whole 2 MB body never rides the detail.
    expect(res.detail!.length).toBeLessThan(200);
  });

  it("email fallback resolves DETERMINISTICALLY to the oldest contact when an email is shared", async () => {
    published.length = 0;
    const w = (await owner.workspace.create({ data: { agencyId, name: "dup", slug: `${suffix}-dup`, settings: {} } })).id;
    const wStripe = (await owner.integration.create({ data: { workspaceId: w, provider: "stripe", status: "connected", config: { webhookToken: `tok-dup-${suffix}`, detection: true }, scopes: [] } })).id;
    const shared = `dup-${suffix}@t.test`;
    const older = (await owner.contact.create({ data: { workspaceId: w, source: "test", optOut: {}, tags: [], email: shared } })).id;
    await owner.contact.create({ data: { workspaceId: w, source: "test", optOut: {}, tags: [], email: shared } }); // a second, newer row
    const res = await ingestPayment(paymentDeps(), { workspaceId: w, integrationId: wStripe, externalId: `cs_${suffix}_dup`, amount: 4200, payerEmail: shared });
    expect(res).toEqual({ outcome: "recorded", contactId: older, matchedBy: "email" });
  });
});
