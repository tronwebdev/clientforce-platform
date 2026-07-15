/**
 * Platform backoffice API e2e (B1 W1, DEC-079). Proves the access model and the
 * operator surface end to end against real Postgres (skips without DB env):
 *
 *   - a platform-staff login sees ALL tenants (cross-tenant, RLS-exempt);
 *   - a tenant credential CANNOT open the backoffice (audience mismatch → 401);
 *   - a disabled / non-allow-listed staff token → 403;
 *   - suspend → the tenant's sends refuse TYPED (TENANT_SUSPENDED) → reactivate
 *     restores (driven through the real /senders/test-send boundary);
 *   - a manual credit grant lands as an append-only ledger row + moved balance;
 *   - every mutation writes a backoffice audit row.
 *
 * No network — the email transport is a capturing fake.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailSender, RenderedEmail } from "@clientforce/channels";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { signStaffToken } from "../src/backoffice/staff-token";
import { EMAIL_TRANSPORT } from "../src/channels/channels.providers";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_INBOX = `bo-inbox-${suffix}@allowed.test`;
const ADDRESS = "42 Demo Street, Austin TX";

class CapturingSender implements EmailSender {
  sent: RenderedEmail[] = [];
  async send(email: RenderedEmail) {
    this.sent.push(email);
    return { providerMessageId: `<bo-${this.sent.length}-${suffix}@send.clientforce.io>` };
  }
}

describe.skipIf(!hasDb)("Platform backoffice API e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyA: string;
  let agencyB: string;
  let wsA: string;
  let wsB: string;
  let agentId: string;
  let senderId: string;
  let tenantUserId: string;
  let staffActiveId: string;
  let staffDisabledId: string;
  let staffToken: string;
  let disabledStaffToken: string;
  let ghostStaffToken: string;
  let tenantToken: string;
  const transport = new CapturingSender();

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    process.env.CHANNELS_ALLOWLIST = TEST_INBOX;
    owner = createPrismaClient();

    // Two agencies so "sees all tenants" is a real cross-tenant assertion.
    const a = await owner.agency.create({
      data: { name: `bo-A ${suffix}`, slug: `bo-a-${suffix}`, branding: {} },
    });
    const b = await owner.agency.create({
      data: { name: `bo-B ${suffix}`, slug: `bo-b-${suffix}`, branding: {} },
    });
    agencyA = a.id;
    agencyB = b.id;
    wsA = (await owner.workspace.create({ data: { agencyId: agencyA, name: "A", slug: `bo-a-${suffix}`, settings: {}, creditBalance: 0 } })).id;
    wsB = (await owner.workspace.create({ data: { agencyId: agencyB, name: "B", slug: `bo-b-${suffix}`, settings: {} } })).id;

    // wsA gets a full send setup so the suspension→refusal loop is real.
    agentId = (
      await owner.agent.create({
        data: {
          workspaceId: wsA,
          name: "Booker",
          goal: "book_appointments",
          guardrails: {
            sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
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
        workspaceId: wsA,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } },
      },
    });
    senderId = (
      await owner.senderConnection.create({
        data: { workspaceId: wsA, type: "CF_MANAGED", status: "ACTIVE", fromEmail: "agent@send.clientforce.io", fromName: "Sam Rivers", dailyLimit: 100 },
      })
    ).id;

    // A tenant user + OWNER membership in wsA — drives test-send AND proves a
    // valid tenant credential cannot open the backoffice.
    const tenantUser = await owner.user.create({
      data: { email: `bo-tenant-${suffix}@t.test`, authProviderId: `auth|bo-tenant-${suffix}` },
    });
    tenantUserId = tenantUser.id;
    await owner.membership.create({ data: { userId: tenantUser.id, workspaceId: wsA, role: "OWNER" } });
    tenantToken = await signDevToken(SECRET, { sub: `auth|bo-tenant-${suffix}`, email: tenantUser.email });

    // Platform staff: one ACTIVE operator, one DISABLED.
    const active = await owner.platformStaff.create({
      data: { email: `bo-ops-${suffix}@cf.test`, name: "Ops", role: "OPERATOR", status: "ACTIVE" },
    });
    const disabled = await owner.platformStaff.create({
      data: { email: `bo-ops-off-${suffix}@cf.test`, name: "Ex Ops", role: "OPERATOR", status: "DISABLED" },
    });
    staffActiveId = active.id;
    staffDisabledId = disabled.id;
    staffToken = await signStaffToken({ sub: active.id, email: active.email, role: "OPERATOR" });
    disabledStaffToken = await signStaffToken({ sub: disabled.id, email: disabled.email, role: "OPERATOR" });
    // A well-formed staff-audience token whose email is NOT in the allow-list.
    ghostStaffToken = await signStaffToken({ sub: "ghost", email: `ghost-${suffix}@nope.test`, role: "OPERATOR" });

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
    if (owner) {
      await owner.backofficeAuditLog.deleteMany({ where: { operatorId: { in: [staffActiveId, staffDisabledId] } } });
      await owner.creditLedger.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await owner.message.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await owner.agency.delete({ where: { id: agencyA } }).catch(() => undefined);
      await owner.agency.delete({ where: { id: agencyB } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: tenantUserId } });
      await owner.platformStaff.deleteMany({ where: { id: { in: [staffActiveId, staffDisabledId] } } });
    }
    await owner?.$disconnect();
  });

  const staff = () => ({ Authorization: `Bearer ${staffToken}` });
  const asTenant = () => ({ Authorization: `Bearer ${tenantToken}`, "x-workspace-id": wsA });

  // ── Access model ───────────────────────────────────────────────────────────

  it("rejects an unauthenticated request (401)", async () => {
    await request(app.getHttpServer()).get("/backoffice/agencies").expect(401);
  });

  it("a TENANT credential cannot open the backoffice (401 — audience mismatch)", async () => {
    // The exact same token authenticates tenant routes:
    await request(app.getHttpServer()).get("/me").set(asTenant()).expect(200);
    // …but is rejected by the backoffice, proving the surfaces are separate.
    await request(app.getHttpServer())
      .get("/backoffice/agencies")
      .set({ Authorization: `Bearer ${tenantToken}` })
      .expect(401);
  });

  it("a DISABLED or non-allow-listed staff token is rejected (403)", async () => {
    await request(app.getHttpServer())
      .get("/backoffice/agencies")
      .set({ Authorization: `Bearer ${disabledStaffToken}` })
      .expect(403);
    await request(app.getHttpServer())
      .get("/backoffice/agencies")
      .set({ Authorization: `Bearer ${ghostStaffToken}` })
      .expect(403);
  });

  it("login mints a token for an active operator only", async () => {
    const ok = await request(app.getHttpServer())
      .post("/backoffice/session")
      .send({ email: `bo-ops-${suffix}@cf.test` });
    expect(ok.status).toBe(201);
    expect(typeof ok.body.token).toBe("string");
    expect(ok.body.staff.role).toBe("OPERATOR");

    // A tenant email is not a platform operator.
    await request(app.getHttpServer())
      .post("/backoffice/session")
      .send({ email: `bo-tenant-${suffix}@t.test` })
      .expect(401);
  });

  it("an active operator sees ALL tenants (cross-tenant, RLS-exempt)", async () => {
    const res = await request(app.getHttpServer()).get("/backoffice/agencies").set(staff());
    expect(res.status).toBe(200);
    const ids = res.body.map((a: { id: string }) => a.id);
    expect(ids).toContain(agencyA);
    expect(ids).toContain(agencyB);
    const rowA = res.body.find((a: { id: string }) => a.id === agencyA);
    expect(rowA.workspaces.some((w: { id: string }) => w.id === wsA)).toBe(true);
  });

  it("search filters agencies by name/slug", async () => {
    const res = await request(app.getHttpServer())
      .get(`/backoffice/agencies?q=bo-a-${suffix}`)
      .set(staff());
    expect(res.status).toBe(200);
    const ids = res.body.map((a: { id: string }) => a.id);
    expect(ids).toContain(agencyA);
    expect(ids).not.toContain(agencyB);
  });

  // ── Suspend → send refuses typed → reactivate restores ───────────────────────

  it("suspend → the tenant's test-send refuses TENANT_SUSPENDED → reactivate restores", async () => {
    // Baseline: an active workspace sends fine through the full boundary.
    await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asTenant())
      .send({ senderId, agentId, to: TEST_INBOX })
      .expect(201);

    // Suspend the workspace via the backoffice (typed, audited).
    const suspended = await request(app.getHttpServer())
      .post(`/backoffice/workspaces/${wsA}/suspend`)
      .set(staff())
      .send({ reason: "e2e: manual suspension" });
    expect(suspended.status).toBe(201);
    expect(suspended.body.status).toBe("SUSPENDED");

    // The send is now refused with the TYPED reason (422, not 500).
    const blocked = await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asTenant())
      .send({ senderId, agentId, to: TEST_INBOX });
    expect(blocked.status).toBe(422);
    expect(blocked.body.reason).toBe("TENANT_SUSPENDED");

    // Reactivate → sending is restored.
    const reactivated = await request(app.getHttpServer())
      .post(`/backoffice/workspaces/${wsA}/reactivate`)
      .set(staff())
      .send({ reason: "e2e: restore" });
    expect(reactivated.body.status).toBe("ACTIVE");
    await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asTenant())
      .send({ senderId, agentId, to: TEST_INBOX })
      .expect(201);
  });

  it("agency suspension also refuses the tenant's sends", async () => {
    await request(app.getHttpServer())
      .post(`/backoffice/agencies/${agencyA}/suspend`)
      .set(staff())
      .send({ reason: "e2e: agency-level suspension" })
      .expect(201);
    const blocked = await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asTenant())
      .send({ senderId, agentId, to: TEST_INBOX });
    expect(blocked.status).toBe(422);
    expect(blocked.body.reason).toBe("TENANT_SUSPENDED");
    await request(app.getHttpServer())
      .post(`/backoffice/agencies/${agencyA}/reactivate`)
      .set(staff())
      .send({ reason: "e2e: restore" })
      .expect(201);
  });

  // ── Manual credit grant → append-only ledger + moved balance ─────────────────

  it("a manual credit grant lands as a ledger row with reason and moves the balance", async () => {
    const grant = await request(app.getHttpServer())
      .post(`/backoffice/workspaces/${wsA}/credit-adjustments`)
      .set(staff())
      .send({ delta: 500, reason: "e2e: promo grant" });
    expect(grant.status).toBe(201);
    expect(grant.body.balanceAfter).toBe(500);
    expect(grant.body.entry.delta).toBe(500);
    expect(grant.body.entry.reason).toBe("e2e: promo grant");
    // The ledger row references the audit row for traceability.
    expect(grant.body.entry.refId).toBe(grant.body.auditId);

    const clawback = await request(app.getHttpServer())
      .post(`/backoffice/workspaces/${wsA}/credit-adjustments`)
      .set(staff())
      .send({ delta: -200, reason: "e2e: correction" });
    expect(clawback.body.balanceAfter).toBe(300);

    // Cached balance matches the ledger sum.
    const ws = await owner.workspace.findUniqueOrThrow({ where: { id: wsA } });
    expect(ws.creditBalance).toBe(300);
    const ledger = await owner.creditLedger.findMany({ where: { workspaceId: wsA } });
    expect(ledger.reduce((s, r) => s + r.delta, 0)).toBe(300);

    // Zero deltas are rejected.
    await request(app.getHttpServer())
      .post(`/backoffice/workspaces/${wsA}/credit-adjustments`)
      .set(staff())
      .send({ delta: 0, reason: "noop" })
      .expect(400);
  });

  // ── Audit trail ──────────────────────────────────────────────────────────────

  it("every mutation wrote an audit row (operator, action, target, reason)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/backoffice/audit-log?targetId=${wsA}`)
      .set(staff());
    expect(res.status).toBe(200);
    const actions = res.body.map((r: { action: string }) => r.action);
    expect(actions).toContain("workspace.suspend");
    expect(actions).toContain("workspace.reactivate");
    expect(actions).toContain("workspace.credit.adjust");
    expect(res.body.every((r: { operatorEmail: string }) => r.operatorEmail === `bo-ops-${suffix}@cf.test`)).toBe(true);
    expect(res.body.every((r: { reason: string | null }) => typeof r.reason === "string")).toBe(true);
  });
});
