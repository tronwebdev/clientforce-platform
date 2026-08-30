/**
 * B9 (DEC-136) onboarding + billing e2e:
 *  - POST /workspaces riders: `businessType` lands in settings.icpProfile
 *    (registry seed, DEC-129/131) and `bold: true` flips consoleBold on the
 *    NEW workspace; bad shape → 400; second create → 409 (first-run only).
 *  - GET /plans: agency row beats the platform default per NAME; a row the
 *    backoffice editor has not saved carries `proposal: true` (D2), and the
 *    editor's save stamps `confirmed` + audits (plan.set).
 *  - POST /plans/choose: OWNER-only intent write to Agency.planTier —
 *    `charged: false` always (no platform Stripe key exists — Q-118).
 *  - /me settings: tourSeen persists per USER via PATCH (strict schema) and
 *    echoes on GET /me.
 *  - GET /me/getting-started: every done-state derived from REAL rows —
 *    all false in a fresh workspace, each flipping only when its row exists.
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONSOLE_BOLD_FLAG } from "@clientforce/core";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { signStaffToken } from "../src/backoffice/staff-token";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Onboarding + billing e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let ws = "";
  let agencyId = "";
  let founderId = "";
  let agentUserId = "";
  let staffId = "";
  let founderToken: string;
  let agentToken: string;
  let staffToken: string;

  const api = () => request(app.getHttpServer());
  const asFounder = () => ({ Authorization: `Bearer ${founderToken}`, "x-workspace-id": ws });
  const asAgent = () => ({ Authorization: `Bearer ${agentToken}`, "x-workspace-id": ws });
  const staff = () => ({ Authorization: `Bearer ${staffToken}` });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    // The founder: a User row with NO membership — the first-run principal.
    const founder = await owner.user.create({
      data: { email: `ob-founder-${suffix}@t.test`, authProviderId: `auth|ob-f-${suffix}` },
    });
    founderId = founder.id;
    founderToken = await signDevToken(SECRET, { sub: `auth|ob-f-${suffix}`, email: founder.email });

    const ops = await owner.platformStaff.create({
      data: { email: `ob-ops-${suffix}@cf.test`, name: "Ops", role: "OPERATOR", status: "ACTIVE" },
    });
    staffId = ops.id;
    staffToken = await signStaffToken({ sub: ops.id, email: ops.email, role: "OPERATOR" });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (agencyId) await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.platformStaff.delete({ where: { id: staffId } }).catch(() => {});
    for (const id of [founderId, agentUserId]) {
      if (id) await owner.user.delete({ where: { id } }).catch(() => {});
    }
    await owner.$disconnect();
  });

  it("rejects a businessType without a known shape (400, nothing created)", async () => {
    const res = await api()
      .post("/workspaces")
      .set({ Authorization: `Bearer ${founderToken}` })
      .send({ name: "Bright Smile Dental", businessType: { shape: "galaxy" }, bold: true });
    expect(res.status).toBe(400);
    expect(await owner.membership.count({ where: { userId: founderId } })).toBe(0);
  });

  it("bootstraps the workspace with icpProfile + the consoleBold flag in one write", async () => {
    const res = await api()
      .post("/workspaces")
      .set({ Authorization: `Bearer ${founderToken}` })
      .send({
        name: `Bright Smile ${suffix}`,
        businessType: { shape: "local_business", vertical: "dental" },
        bold: true,
      });
    expect(res.status).toBe(201);
    ws = res.body.id;
    const row = await owner.workspace.findUniqueOrThrow({ where: { id: ws } });
    agencyId = row.agencyId;
    expect((row.settings as { icpProfile?: { shape?: string; vertical?: string } }).icpProfile).toEqual({
      shape: "local_business",
      vertical: "dental",
    });
    const flag = await owner.featureFlag.findFirst({ where: { workspaceId: ws, key: CONSOLE_BOLD_FLAG } });
    expect(flag?.enabled).toBe(true);

    // First-run ONLY: with a membership in place the endpoint refuses.
    const again = await api()
      .post("/workspaces")
      .set({ Authorization: `Bearer ${founderToken}` })
      .send({ name: "Second Try" });
    expect(again.status).toBe(409);
  });

  it("GET /plans resolves agency-over-platform per name and marks unconfirmed rows proposals (D2)", async () => {
    // An agency-scoped SCALE row nobody confirmed (seed-style: features {}).
    await owner.plan.create({
      data: { agencyId, name: "SCALE", priceMonthly: 99_900, features: {}, limits: { workspaces: 20 } },
    });
    const res = await api().get("/plans").set(asFounder());
    expect(res.status).toBe(200);
    expect(res.body.current).toBe("GROWTH"); // the schema default — nothing chosen yet
    const scale = res.body.tiers.find((t: { name: string }) => t.name === "SCALE");
    expect(scale).toMatchObject({
      priceMonthlyCents: 99_900,
      proposal: true,
      agencyOverride: true,
    });
    expect(scale.limits).toEqual({ workspaces: 20 });
  });

  it("backoffice plan save stamps confirmed (proposal ends) and audits plan.set", async () => {
    const save = await api()
      .post("/backoffice/plans")
      .set(staff())
      .send({ agencyId, name: "GROWTH", priceMonthlyCents: 24_900, limits: { workspaces: 5, emailsPerMonth: 25_000 } });
    expect(save.status).toBe(201);

    const listed = await api().get(`/backoffice/plans?agencyId=${agencyId}`).set(staff());
    expect(listed.status).toBe(200);
    const growthRow = listed.body.find(
      (r: { name: string; agencyId: string | null }) => r.name === "GROWTH" && r.agencyId === agencyId,
    );
    expect(growthRow?.confirmed).toBe(true);

    const tenant = await api().get("/plans").set(asFounder());
    const growth = tenant.body.tiers.find((t: { name: string }) => t.name === "GROWTH");
    expect(growth).toMatchObject({
      priceMonthlyCents: 24_900,
      proposal: false,
      agencyOverride: true,
    });

    const audit = await owner.backofficeAuditLog.findFirst({
      where: { action: "plan.set", targetId: agencyId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as { name?: string }).name).toBe("GROWTH");
  });

  it("plans/choose is OWNER-only intent — records the tier, charges nothing", async () => {
    // A non-owner in the same workspace cannot choose.
    const agentUser = await owner.user.create({
      data: { email: `ob-agent-${suffix}@t.test`, authProviderId: `auth|ob-a-${suffix}` },
    });
    agentUserId = agentUser.id;
    await owner.membership.create({ data: { userId: agentUser.id, workspaceId: ws, role: "AGENT" } });
    agentToken = await signDevToken(SECRET, { sub: `auth|ob-a-${suffix}`, email: agentUser.email });
    expect((await api().post("/plans/choose").set(asAgent()).send({ tier: "SCALE" })).status).toBe(403);

    expect((await api().post("/plans/choose").set(asFounder()).send({ tier: "ULTRA" })).status).toBe(400);

    const res = await api().post("/plans/choose").set(asFounder()).send({ tier: "SCALE" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, current: "SCALE", charged: false });
    const agency = await owner.agency.findUniqueOrThrow({ where: { id: agencyId } });
    expect(agency.planTier).toBe("SCALE");
  });

  it("tour-seen persists per USER through /me/settings (strict schema)", async () => {
    const before = await api().get("/me").set(asFounder());
    expect(before.body.user.settings).toEqual({});

    expect(
      (await api().patch("/me/settings").set(asFounder()).send({ theme: "dark" })).status,
    ).toBe(400);

    const patch = await api().patch("/me/settings").set(asFounder()).send({ tourSeen: true });
    expect(patch.status).toBe(200);
    expect(patch.body.settings.tourSeen).toBe(true);

    const after = await api().get("/me").set(asFounder());
    expect(after.body.user.settings.tourSeen).toBe(true);
    // Per-user, not per-workspace-member: the AGENT's settings are untouched.
    const agentMe = await api().get("/me").set(asAgent());
    expect(agentMe.body.user.settings).toEqual({});
  });

  it("getting-started derives every done-state from real rows", async () => {
    const fresh = await api().get("/me/getting-started").set(asFounder());
    expect(fresh.status).toBe(200);
    expect(fresh.body.total).toBe(6);
    expect(fresh.body.done).toBe(0);
    expect(fresh.body.items.every((i: { done: boolean }) => !i.done)).toBe(true);

    // Flip each check by creating exactly the row it derives from.
    await owner.businessContext.create({
      data: { workspaceId: ws, agentId: null, fields: { offer: { value: "Implant consults" } } },
    });
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "First push", goal: "book_appointments", guardrails: {}, status: "ACTIVE" },
    });
    await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "CF_MANAGED",
        fromEmail: `outreach-${suffix}@send.test`,
        fromName: "Bright Smile",
        status: "ACTIVE",
        domainAuthStatus: { spf: { status: "pass" }, dkim: { status: "pass" } },
      },
    });
    const widget = await owner.widget.create({
      data: { workspaceId: ws, agentId: agent.id, design: {}, fields: {}, behaviour: {}, routing: {} },
    });
    await owner.widgetSession.create({
      data: { workspaceId: ws, widgetId: widget.id, agentId: agent.id },
    });
    await owner.integration.create({
      data: { workspaceId: ws, provider: "gcal", config: {} },
    });
    await owner.contact.create({
      data: { workspaceId: ws, source: "csv", optOut: {}, tags: [], email: `ob-c1-${suffix}@t.test` },
    });

    const full = await api().get("/me/getting-started").set(asFounder());
    expect(full.body.done).toBe(6);
    const byKey = Object.fromEntries(
      full.body.items.map((i: { key: string; done: boolean }) => [i.key, i.done]),
    );
    expect(byKey).toEqual({ core: true, campaign: true, sender: true, widget: true, calendar: true, contacts: true });
  });
});
