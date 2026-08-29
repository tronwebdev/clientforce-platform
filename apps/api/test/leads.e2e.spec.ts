/**
 * B6 (DEC-131) lead-finder + intent-tier e2e in a fresh workspace:
 *  - config tells the keyless truth (provider not configured, BuyerPing off,
 *    shape-registry filters — no B2B nouns for a local shape);
 *  - Ada search ranks the OWN book honestly: a lapsed contact and a not-now
 *    contact surface with factual receipts AND differentiated fits (no flat
 *    numbers — B6 review fix 2), a fact-less contact reports scored:false,
 *    and an active enrollment, a happy customer and an opted-out contact are
 *    suppressed;
 *  - Direct search answers providerConfigured:false keylessly and reveal
 *    refuses 503 — never fabricated rows, never a phantom charge;
 *  - BuyerPing connect/disconnect round-trips the Integration row; watch
 *    topics CRUD; hide upserts;
 *  - the intent consumer maps a form.submitted event onto an IntentSignal
 *    row with the vertical-flavored receipt, skips suppressed contacts, and
 *    the signal then rides the Ada search as the second tier.
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { createIntentConsumer } from "@clientforce/leads";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Lead finder + intent tier e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let appClient: ReturnType<typeof createAppPrismaClient>;
  let agencyId: string;
  let ws: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let lapsedId: string;
  let lostId: string;
  let blankId: string;

  const api = () => request(app.getHttpServer());
  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    delete process.env.APOLLO_API_KEY; // the keyless posture under test
    owner = createPrismaClient();
    appClient = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `lf-${suffix}`, slug: `lf-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: {
          agencyId,
          name: "LF",
          slug: `lf-ws-${suffix}`,
          creditBalance: 100,
          settings: {
            icpProfile: { shape: "local_business", vertical: "dental", titles: ["Owner"] },
          },
        },
      })
    ).id;
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Finder", goal: "generate_leads", guardrails: {} },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId: agent.id, name: "finder — primary", graphId: "" },
    });

    const mkContact = (n: number, extra: object = {}) =>
      owner.contact.create({
        data: {
          workspaceId: ws,
          source: "t",
          optOut: {},
          tags: [],
          email: `lf-c${n}-${suffix}@t.test`,
          firstName: `C${n}`,
          lastName: "Lead",
          title: "Owner",
          ...extra,
        },
      });
    // Lapsed: outbound touch 90 days ago, nothing since.
    const lapsed = await mkContact(1);
    lapsedId = lapsed.id;
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: lapsed.id,
        channel: "email",
        direction: "OUTBOUND",
        body: "old touch",
        sentAt: daysAgo(90),
      },
    });
    // Lost: replied not-now.
    const lost = await mkContact(2);
    lostId = lost.id;
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: lost.id,
        channel: "email",
        direction: "INBOUND",
        intent: "not_interested",
        body: "not right now",
        sentAt: daysAgo(30),
      },
    });
    // Suppressed trio: active enrollment / happy stage / opted out.
    const active = await mkContact(3);
    await owner.enrollment.create({
      data: { workspaceId: ws, campaignId: campaign.id, contactId: active.id, workflowId: `t-${suffix}-a`, pipelineStage: "new", status: "ACTIVE" },
    });
    const happy = await mkContact(4);
    await owner.enrollment.create({
      data: { workspaceId: ws, campaignId: campaign.id, contactId: happy.id, workflowId: `t-${suffix}-h`, pipelineStage: "booked", status: "DONE" },
    });
    await mkContact(5, { optOut: { email: true } });
    // Never-touched and title-less: nothing to score from — the honest
    // "unscored" contract (B6 review fix 2).
    const blank = await mkContact(6, { title: null });
    blankId = blank.id;

    const u1 = await owner.user.create({
      data: { email: `lf-owner-${suffix}@t.test`, authProviderId: `auth|lf-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|lf-owner-${suffix}`, email: u1.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await appClient?.$disconnect();
    await owner?.$disconnect();
  });

  it("config tells the keyless truth with shape-registry filters", async () => {
    const res = await api().get("/leads/config").set(asOwner()).expect(200);
    expect(res.body.providerConfigured).toBe(false);
    expect(res.body.buyerping.connected).toBe(false);
    expect(res.body.profile.shape).toBe("local_business");
    const labels = res.body.directFilters.map((f: { label: string }) => f.label);
    expect(labels).toContain("WHERE");
    expect(labels).not.toContain("FUNDING"); // a company-shape noun stays out
  });

  it("Ada search ranks the own book honestly and suppresses the already-yours", async () => {
    const res = await api().post("/leads/search").set(asOwner()).send({ mode: "ada" }).expect(201);
    expect(res.body.providerConfigured).toBe(false);
    const ids = res.body.candidates.map((c: { contactId: string }) => c.contactId);
    expect(ids).toContain(lapsedId);
    expect(ids).toContain(lostId);
    expect(ids).toContain(blankId);
    expect(res.body.candidates).toHaveLength(3); // active, happy and opted-out never surface
    const lost = res.body.candidates.find((c: { contactId: string }) => c.contactId === lostId);
    expect(lost.fitReasons.join(" ")).toContain("not-now");
    const lapsed = res.body.candidates.find((c: { contactId: string }) => c.contactId === lapsedId);
    expect(lapsed.fitReasons.join(" ")).toContain("quiet");
    expect(lapsed.revealed).toBe(true); // own contacts have nothing to buy
    // B6 review fix 2 — no flat fits: real own-book facts move the number.
    // Lapsed = targeted title + a fresh 90-day lapse; lost = title + a prior
    // reply; the two land on DIFFERENT fits, both scored.
    expect(lapsed.scored).toBe(true);
    expect(lost.scored).toBe(true);
    expect(lapsed.fit).not.toBe(lost.fit);
    expect(lapsed.fitReasons.join(" ")).toContain("still warm");
    // …and a contact with nothing to score from says so instead of wearing
    // a made-up number.
    const blank = res.body.candidates.find((c: { contactId: string }) => c.contactId === blankId);
    expect(blank.scored).toBe(false);
  });

  it("Direct search and reveal answer keylessly — no rows, no charge", async () => {
    const res = await api()
      .post("/leads/search")
      .set(asOwner())
      .send({ mode: "direct", filters: { query: "owner" } })
      .expect(201);
    expect(res.body.providerConfigured).toBe(false);
    expect(res.body.candidates).toHaveLength(0);
    await api().post("/leads/reveal").set(asOwner()).send({ providerRef: "x1" }).expect(503);
    const ledger = await owner.creditLedger.count({ where: { workspaceId: ws } });
    expect(ledger).toBe(0);
  });

  it("BuyerPing connect/disconnect round-trips the Integration row; topics CRUD; hide upserts", async () => {
    await api().post("/leads/buyerping").set(asOwner()).send({ enabled: true }).expect(201);
    expect(await owner.integration.count({ where: { workspaceId: ws, provider: "buyerping" } })).toBe(1);
    const t = await api().post("/leads/watch-topics").set(asOwner()).send({ kind: "topic", label: "Implants" }).expect(201);
    const cfg = await api().get("/leads/config").set(asOwner()).expect(200);
    expect(cfg.body.buyerping.connected).toBe(true);
    expect(cfg.body.watchTopics.map((x: { label: string }) => x.label)).toContain("Implants");
    await api().delete(`/leads/watch-topics/${t.body.id}`).set(asOwner()).expect(200);
    await api().post("/leads/hide").set(asOwner()).send({ provider: "apollo", providerRef: "p1" }).expect(201);
    await api().post("/leads/hide").set(asOwner()).send({ provider: "apollo", providerRef: "p1" }).expect(201);
    expect(await owner.leadExclusion.count({ where: { workspaceId: ws } })).toBe(1);
    await api().post("/leads/buyerping").set(asOwner()).send({ enabled: false }).expect(201);
    expect(await owner.integration.count({ where: { workspaceId: ws, provider: "buyerping" } })).toBe(0);
  });

  it("the intent consumer writes vertical-flavored receipts, skips the suppressed, and the signal rides the search", async () => {
    const consumer = createIntentConsumer({
      prisma: appClient,
      profileFor: async () => ({ shape: "local_business", vertical: "dental" }),
    });
    const base = {
      id: `ev-${suffix}`,
      workspaceId: ws,
      enrollmentId: null,
      campaignId: null,
      senderId: null,
      occurredAt: new Date().toISOString(),
    };
    // A pricing question from the LAPSED contact — lands with dental wording.
    await consumer.handle({
      ...base,
      id: `ev1-${suffix}`,
      type: "email.replied.v1" as never,
      contactId: lapsedId,
      payload: { intent: "objection_price" },
    });
    // The opted-out contact never lands a signal.
    const optedOut = await owner.contact.findFirst({
      where: { workspaceId: ws, email: `lf-c5-${suffix}@t.test` },
    });
    await consumer.handle({
      ...base,
      id: `ev2-${suffix}`,
      type: "form.submitted.v1" as never,
      contactId: optedOut!.id,
      payload: { formId: "f1", fields: {} },
    });
    const signals = await owner.intentSignal.findMany({ where: { workspaceId: ws } });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.contactId).toBe(lapsedId);
    expect(signals[0]!.receipt).toBe("asked what treatment would cost");

    const res = await api().post("/leads/search").set(asOwner()).send({ mode: "ada" }).expect(201);
    const lapsed = res.body.candidates.find((c: { contactId: string }) => c.contactId === lapsedId);
    expect(lapsed.intentWeight).toBeGreaterThan(0);
    expect(lapsed.intentReceipts).toContain("asked what treatment would cost");
    // Fit stays the headline: ordering is fit-first, intent second.
    const fits = res.body.candidates.map((c: { fit: number }) => c.fit);
    expect([...fits].sort((a, b) => b - a)).toEqual(fits);
  });
});
