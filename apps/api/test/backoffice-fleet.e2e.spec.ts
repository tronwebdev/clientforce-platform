/**
 * Platform backoffice API e2e — B1 W4 (DEC-082): kill switch · feature flags ·
 * read-only impersonation · fleet health + version pins. Real Postgres (skips
 * without DB env), no network (capturing email transport). Proves:
 *
 *   - a per-agency/per-channel kill switch refuses the tenant's sends TYPED
 *     (CHANNEL_KILLED, 422) through the REAL /senders/test-send boundary, and
 *     clearing it restores sending — the W1 TENANT_SUSPENDED machinery, one
 *     scope narrower (no fork);
 *   - a per-tenant feature flag toggles + is audited (flag.set);
 *   - impersonation is audited (impersonate.start), read-only (no write path),
 *     and its message viewer returns rendered previews only;
 *   - fleet health CONSUMES P5-W1 (wired:false when unset — honest pending) and
 *     surfaces abuse/deliverability outliers from the event ledger;
 *   - version pins are read-only platform-scope visibility.
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
const TEST_INBOX = `bo-w4-${suffix}@allowed.test`;
const ADDRESS = "42 Demo Street, Austin TX";

class CapturingSender implements EmailSender {
  sent: RenderedEmail[] = [];
  async send(email: RenderedEmail) {
    this.sent.push(email);
    return { providerMessageId: `<bo-w4-${this.sent.length}-${suffix}@send.clientforce.io>` };
  }
}

describe.skipIf(!hasDb)("Platform backoffice W4 e2e (fleet · kill switch · flags · impersonation)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let agentId: string;
  let senderId: string;
  let tenantUserId: string;
  let staffId: string;
  let staffToken: string;
  let tenantToken: string;
  const transport = new CapturingSender();

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    process.env.CHANNELS_ALLOWLIST = TEST_INBOX;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `bo-w4 ${suffix}`, slug: `bo-w4-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (
      await owner.workspace.create({
        data: { agencyId, name: "A", slug: `bo-w4-a-${suffix}`, settings: {}, creditBalance: 0 },
      })
    ).id;

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
        data: {
          workspaceId: wsA,
          type: "CF_MANAGED",
          status: "ACTIVE",
          fromEmail: "agent@send.clientforce.io",
          fromName: "Sam Rivers",
          dailyLimit: 100,
        },
      })
    ).id;
    await owner.contact.create({
      data: { workspaceId: wsA, source: "manual", optOut: {}, tags: [], email: TEST_INBOX },
    });

    // Seed >= OUTLIER_FLOOR (5) bounce events so wsA is a deliverability outlier.
    await owner.event.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        workspaceId: wsA,
        type: "email.bounced.v1",
        payload: { messageId: `m-${i}-${suffix}`, reason: "550 mailbox unavailable" },
      })),
    });

    const tenantUser = await owner.user.create({
      data: { email: `bo-w4-tenant-${suffix}@t.test`, authProviderId: `auth|bo-w4-${suffix}` },
    });
    tenantUserId = tenantUser.id;
    await owner.membership.create({ data: { userId: tenantUser.id, workspaceId: wsA, role: "OWNER" } });
    tenantToken = await signDevToken(SECRET, { sub: `auth|bo-w4-${suffix}`, email: tenantUser.email });

    const staffRow = await owner.platformStaff.create({
      data: { email: `bo-w4-ops-${suffix}@cf.test`, name: "Ops", role: "OPERATOR", status: "ACTIVE" },
    });
    staffId = staffRow.id;
    staffToken = await signStaffToken({ sub: staffRow.id, email: staffRow.email, role: "OPERATOR" });

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
      await owner.backofficeAuditLog.deleteMany({ where: { operatorId: staffId } });
      await owner.killSwitch.deleteMany({ where: { agencyId } });
      await owner.featureFlag.deleteMany({ where: { workspaceId: wsA } });
      await owner.event.deleteMany({ where: { workspaceId: wsA } });
      await owner.message.deleteMany({ where: { workspaceId: wsA } });
      await owner.contact.deleteMany({ where: { workspaceId: wsA } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: tenantUserId } });
      await owner.platformStaff.deleteMany({ where: { id: staffId } });
    }
    await owner?.$disconnect();
  });

  const staff = () => ({ Authorization: `Bearer ${staffToken}` });
  const asTenant = () => ({ Authorization: `Bearer ${tenantToken}`, "x-workspace-id": wsA });

  // ── Kill switch → send refuses typed → clear restores ────────────────────────

  it("kill the email channel → test-send refuses CHANNEL_KILLED (422) → clear restores", async () => {
    // Baseline: an un-killed channel sends fine through the full boundary.
    await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asTenant())
      .send({ senderId, agentId, to: TEST_INBOX })
      .expect(201);

    // Kill email for the agency (typed, audited).
    const killed = await request(app.getHttpServer())
      .post("/backoffice/kill-switches")
      .set(staff())
      .send({ agencyId, channel: "email", active: true, reason: "e2e: abuse spike" });
    expect(killed.status).toBe(201);
    expect(killed.body.active).toBe(true);
    expect(killed.body.channel).toBe("email");

    // The send is now refused with the TYPED reason (422, not 500) — same
    // boundary machinery as W1's TENANT_SUSPENDED.
    const blocked = await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asTenant())
      .send({ senderId, agentId, to: TEST_INBOX });
    expect(blocked.status).toBe(422);
    expect(blocked.body.reason).toBe("CHANNEL_KILLED");

    // Clear the switch → sending is restored (the row survives, active=false).
    const cleared = await request(app.getHttpServer())
      .post("/backoffice/kill-switches")
      .set(staff())
      .send({ agencyId, channel: "email", active: false, reason: "e2e: cleared" });
    expect(cleared.body.active).toBe(false);
    await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asTenant())
      .send({ senderId, agentId, to: TEST_INBOX })
      .expect(201);

    // The switch is listed with its current state.
    const list = await request(app.getHttpServer()).get("/backoffice/kill-switches").set(staff());
    expect(list.status).toBe(200);
    const row = list.body.find((r: { agencyId: string; channel: string }) => r.agencyId === agencyId && r.channel === "email");
    expect(row).toBeTruthy();
    expect(row.active).toBe(false);
  });

  it("killing a DIFFERENT channel does not block email", async () => {
    await request(app.getHttpServer())
      .post("/backoffice/kill-switches")
      .set(staff())
      .send({ agencyId, channel: "sms", active: true, reason: "e2e: sms only" })
      .expect(201);
    // Email still flows — the switch is per-channel.
    await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asTenant())
      .send({ senderId, agentId, to: TEST_INBOX })
      .expect(201);
  });

  // ── Feature flags → toggle + audited ─────────────────────────────────────────

  it("a per-tenant feature flag toggles and is audited", async () => {
    const on = await request(app.getHttpServer())
      .post(`/backoffice/workspaces/${wsA}/flags`)
      .set(staff())
      .send({ key: "new_editor", enabled: true });
    expect(on.status).toBe(201);
    expect(on.body).toMatchObject({ key: "new_editor", enabled: true });

    const list = await request(app.getHttpServer()).get(`/backoffice/workspaces/${wsA}/flags`).set(staff());
    expect(list.body.find((f: { key: string }) => f.key === "new_editor").enabled).toBe(true);

    // Flip it off (upsert, not a duplicate row).
    await request(app.getHttpServer())
      .post(`/backoffice/workspaces/${wsA}/flags`)
      .set(staff())
      .send({ key: "new_editor", enabled: false })
      .expect(201);
    const after = await owner.featureFlag.findMany({ where: { workspaceId: wsA, key: "new_editor" } });
    expect(after.length).toBe(1);
    expect(after[0]!.enabled).toBe(false);
  });

  // ── Impersonation → audited, read-only ───────────────────────────────────────

  it("impersonation is audited (impersonate.start), read-only, with a message viewer", async () => {
    const session = await request(app.getHttpServer())
      .post("/backoffice/impersonate")
      .set(staff())
      .send({ workspaceId: wsA, reason: "e2e: support ticket #7" });
    expect(session.status).toBe(201);
    expect(session.body.readOnly).toBe(true);
    expect(session.body.workspaceId).toBe(wsA);
    expect(session.body.agency.id).toBe(agencyId);
    expect(typeof session.body.auditId).toBe("string");

    // The read-only viewer returns rendered previews of the tenant's messages.
    const msgs = await request(app.getHttpServer())
      .get(`/backoffice/workspaces/${wsA}/messages`)
      .set(staff());
    expect(msgs.status).toBe(200);
    expect(Array.isArray(msgs.body)).toBe(true);
    expect(msgs.body.length).toBeGreaterThan(0);
    expect(msgs.body[0]).toHaveProperty("preview");
    expect(msgs.body[0]).toHaveProperty("direction");

    // The start was audited to the accountable operator.
    const audit = await owner.backofficeAuditLog.findFirst({
      where: { action: "impersonate.start", targetId: wsA },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit!.reason).toBe("e2e: support ticket #7");
    expect(audit!.operatorId).toBe(staffId);
  });

  // ── Fleet health (consume P5-W1) + version pins ──────────────────────────────

  it("fleet health CONSUMES P5-W1's shared computation + surfaces outliers", async () => {
    const res = await request(app.getHttpServer()).get("/backoffice/fleet-health").set(staff());
    expect(res.status).toBe(200);
    // P5-W1 is on main → the backoffice consumes `computeSenderHealth` in-process
    // (never a SECOND computation). The seeded sender appears with P5-W1's output;
    // below the sample floor its score is null / status low_data — honest, not fake.
    expect(res.body.health.wired).toBe(true);
    const scored = res.body.health.scores.find((s: { senderId: string }) => s.senderId === senderId);
    expect(scored).toBeTruthy();
    expect(scored.workspaceId).toBe(wsA);
    expect(["healthy", "watch", "at_risk", "paused", "low_data"]).toContain(scored.status);
    expect(scored.score === null || typeof scored.score === "number").toBe(true);
    // The 6 seeded bounces make wsA a deliverability outlier (backoffice threshold).
    const outlier = res.body.outliers.find(
      (o: { workspaceId: string; metric: string }) => o.workspaceId === wsA && o.metric === "bounces",
    );
    expect(outlier).toBeTruthy();
    expect(outlier.count).toBeGreaterThanOrEqual(5);
    expect(outlier.agencyId).toBe(agencyId);
  });

  it("version pins are read-only platform-scope visibility", async () => {
    const res = await request(app.getHttpServer()).get("/backoffice/version-pins").set(staff());
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("platform");
    expect(res.body.models.some((m: { task: string }) => m.task === "planner")).toBe(true);
    expect(res.body.prompts.length).toBeGreaterThan(0);
    expect(res.body.prompts.every((p: { version: number }) => typeof p.version === "number")).toBe(true);
  });

  // ── Access model still holds for the W4 surface ──────────────────────────────

  it("a tenant credential cannot reach the W4 surface (401)", async () => {
    await request(app.getHttpServer())
      .get("/backoffice/fleet-health")
      .set({ Authorization: `Bearer ${tenantToken}` })
      .expect(401);
    await request(app.getHttpServer())
      .post("/backoffice/kill-switches")
      .set({ Authorization: `Bearer ${tenantToken}` })
      .send({ agencyId, channel: "email", active: true, reason: "nope" })
      .expect(401);
  });
});
