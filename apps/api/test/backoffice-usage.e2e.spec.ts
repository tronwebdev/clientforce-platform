/**
 * Platform backoffice W2 e2e (B1 W2, DEC-080): usage rollup, provider-invoice
 * reconciliation, and the effective-dated credit-price editor. Real Postgres
 * (skips without DB env). Uses an isolated historic period (April 2019) so the
 * platform-wide reconciliation counts see only this test's seeded rows.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { signStaffToken } from "../src/backoffice/staff-token";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const P_START = new Date("2019-04-01T00:00:00.000Z");
const P_END = new Date("2019-04-30T23:59:59.000Z");
const AT = new Date("2019-04-15T12:00:00.000Z");
// A unique action so the pricing test is independent of the (unseeded-in-CI)
// global credit-price defaults.
const ACT = `price_w2_${suffix}`;

describe.skipIf(!hasDb)("Platform backoffice W2 e2e — usage · reconciliation · pricing", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let staffToken: string;
  let tenantToken: string;
  let tenantUserId: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    agencyId = (await owner.agency.create({ data: { name: `w2-${suffix}`, slug: `w2-${suffix}`, branding: {} } })).id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "W2", slug: `w2-${suffix}`, settings: {} } })).id;
    const agent = await owner.agent.create({ data: { workspaceId: ws, name: "A", goal: "book_appointments", guardrails: {} } });
    const campaign = await owner.campaign.create({ data: { workspaceId: ws, agentId: agent.id, name: "C", graphId: "" } });
    const contact = await owner.contact.create({ data: { workspaceId: ws, source: "manual", optOut: {}, tags: [], email: `c-${suffix}@x.test` } });

    // Metered usage: 3 OUTBOUND email sends, one 180s call, and two ledger moves.
    await owner.message.createMany({
      data: Array.from({ length: 3 }, (_v, i) => ({
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: contact.id,
        channel: "email",
        direction: "OUTBOUND" as const,
        subject: `m${i}`,
        body: "b",
        sentAt: AT,
        stepNodeId: "t",
      })),
    });
    await owner.event.create({ data: { workspaceId: ws, type: "call.completed.v1", payload: { callId: "x", durationSec: 180, outcome: "done" }, occurredAt: AT, createdAt: AT } });
    await owner.creditLedger.createMany({
      data: [
        { workspaceId: ws, delta: 500, reason: "grant", balanceAfter: 500, createdAt: AT },
        { workspaceId: ws, delta: -120, reason: "burn", balanceAfter: 380, createdAt: AT },
      ],
    });

    // Provider invoices for April 2019: email matches (3), voice varies (5 vs 3),
    // anthropic is a metric we don't meter (→ null / not reconcilable).
    await owner.providerInvoice.createMany({
      data: [
        { provider: "sendgrid", metric: "email_sends", quantity: 3, amount: 300, periodStart: P_START, periodEnd: P_END },
        { provider: "twilio", metric: "voice_minutes", quantity: 5, amount: 600, periodStart: P_START, periodEnd: P_END },
        { provider: "anthropic", metric: "ai_tokens", quantity: 1_000_000, amount: 1500, periodStart: P_START, periodEnd: P_END },
      ],
    });

    // A platform default for the unique action, so the pricing test has a known baseline.
    await owner.creditPrice.create({ data: { agencyId: null, action: ACT, credits: 1, effectiveFrom: new Date("2019-01-01T00:00:00.000Z") } });

    const staff = await owner.platformStaff.create({ data: { email: `w2-ops-${suffix}@cf.test`, name: "Ops", role: "ADMIN", status: "ACTIVE" } });
    staffToken = await signStaffToken({ sub: staff.id, email: staff.email, role: "ADMIN" });
    const tenantUser = await owner.user.create({ data: { email: `w2-tenant-${suffix}@t.test`, authProviderId: `auth|w2-${suffix}` } });
    tenantUserId = tenantUser.id;
    await owner.membership.create({ data: { userId: tenantUser.id, workspaceId: ws, role: "OWNER" } });
    tenantToken = await signDevToken(SECRET, { sub: `auth|w2-${suffix}`, email: tenantUser.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner) {
      await owner.providerInvoice.deleteMany({ where: { periodStart: P_START } });
      await owner.creditPrice.deleteMany({ where: { OR: [{ agencyId }, { action: ACT }] } });
      await owner.creditLedger.deleteMany({ where: { workspaceId: ws } });
      await owner.event.deleteMany({ where: { workspaceId: ws } });
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.backofficeAuditLog.deleteMany({ where: { targetId: { in: [agencyId, ws, "platform"] } } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: tenantUserId } });
      await owner.platformStaff.deleteMany({ where: { email: `w2-ops-${suffix}@cf.test` } });
    }
    await owner?.$disconnect();
  });

  const staff = () => ({ Authorization: `Bearer ${staffToken}` });

  it("a tenant credential cannot read W2 usage (401)", async () => {
    await request(app.getHttpServer())
      .get(`/backoffice/usage?scope=workspace&id=${ws}`)
      .set({ Authorization: `Bearer ${tenantToken}` })
      .expect(401);
  });

  it("usage rollup matches the seeded consumption (AI spend honest-absent)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/backoffice/usage?scope=workspace&id=${ws}&from=2019-04-01T00:00:00.000Z&to=2019-04-30T23:59:59.000Z`)
      .set(staff());
    expect(res.status).toBe(200);
    expect(res.body.sendsByChannel.email).toBe(3);
    expect(res.body.voiceMinutes).toBe(3);
    expect(res.body.creditBurn).toBe(120);
    expect(res.body.creditGranted).toBe(500);
    expect(res.body.aiSpendCredits).toBeNull(); // never a fabricated number
  });

  it("reconciliation matches the fixture (email 0-variance; voice varies; AI not metered)", async () => {
    const res = await request(app.getHttpServer())
      .get("/backoffice/reconciliation?month=2019-04")
      .set(staff());
    expect(res.status).toBe(200);
    const byProvider = Object.fromEntries(res.body.map((r: { provider: string }) => [r.provider, r]));
    expect(byProvider.sendgrid.meteredQuantity).toBe(3);
    expect(byProvider.sendgrid.variance).toBe(0);
    expect(byProvider.sendgrid.matchesInvoice).toBe(true);
    expect(byProvider.twilio.meteredQuantity).toBe(3);
    expect(byProvider.twilio.variance).toBe(-2);
    expect(byProvider.twilio.matchesInvoice).toBe(false);
    // AI is not metered → honest null, never a fabricated match/mismatch.
    expect(byProvider.anthropic.meteredQuantity).toBeNull();
    expect(byProvider.anthropic.matchesInvoice).toBeNull();
  });

  it("credit-price editor: an agency override takes effect effective-dated, with history + audit", async () => {
    // Baseline: no agency override → the platform default resolves (= 1).
    const before = await request(app.getHttpServer())
      .get(`/backoffice/credit-prices?agencyId=${agencyId}`)
      .set(staff());
    const emailBefore = before.body.effective.find((e: { action: string }) => e.action === ACT);
    expect(emailBefore?.credits).toBe(1);

    // Append a past-dated override → it is effective now.
    await request(app.getHttpServer())
      .post("/backoffice/credit-prices")
      .set(staff())
      .send({ agencyId, action: ACT, credits: 7, effectiveFrom: "2019-02-01T00:00:00.000Z" })
      .expect(201);
    const after = await request(app.getHttpServer())
      .get(`/backoffice/credit-prices?agencyId=${agencyId}`)
      .set(staff());
    const emailAfter = after.body.effective.find((e: { action: string }) => e.action === ACT);
    expect(emailAfter.credits).toBe(7);
    expect(after.body.history.some((r: { agencyId: string | null; credits: number }) => r.agencyId === agencyId && r.credits === 7)).toBe(true);

    // A newer override supersedes it (history keeps both).
    await request(app.getHttpServer())
      .post("/backoffice/credit-prices")
      .set(staff())
      .send({ agencyId, action: ACT, credits: 9 })
      .expect(201);
    const latest = await request(app.getHttpServer())
      .get(`/backoffice/credit-prices?agencyId=${agencyId}`)
      .set(staff());
    expect(latest.body.effective.find((e: { action: string }) => e.action === ACT).credits).toBe(9);
    expect(latest.body.history.filter((r: { agencyId: string | null }) => r.agencyId === agencyId).length).toBe(2);

    // Every price change is audited.
    const audit = await request(app.getHttpServer())
      .get(`/backoffice/audit-log?targetId=${agencyId}`)
      .set(staff());
    expect(audit.body.filter((r: { action: string }) => r.action === "price.set").length).toBe(2);
  });
});
