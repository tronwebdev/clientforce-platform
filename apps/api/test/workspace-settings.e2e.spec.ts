/**
 * B7 (DEC-132) settings-surface e2e in a fresh workspace:
 *  - /workspaces/members returns the REAL memberships of the active
 *    workspace only (tenant-scoped read; User identity joined by id);
 *  - guardrail DEFAULTS round-trip: GET starts empty, PATCH validates and
 *    stores, and a campaign created AFTER the patch starts from the
 *    defaults while one created BEFORE keeps its own values (Q-109 —
 *    creation-time only, never a rewrite);
 *  - /credits/summary aggregates the REAL ledger (a debit and a top-up)
 *    and echoes the workspace balance — nothing fabricated for the
 *    channels that don't meter yet (Q-108);
 *  - the channels rider round-trips through the shipped guardrails PATCH.
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseGuardrails } from "@clientforce/core";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Workspace settings surface e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let earlyAgentId: string;

  const api = () => request(app.getHttpServer());
  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `wss-${suffix}`, slug: `wss-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "WSS", slug: `wss-ws-${suffix}`, creditBalance: 90, settings: {} },
      })
    ).id;
    const u1 = await owner.user.create({
      data: { email: `wss-owner-${suffix}@t.test`, name: "Owner One", authProviderId: `auth|wss-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const u2 = await owner.user.create({
      data: { email: `wss-admin-${suffix}@t.test`, authProviderId: `auth|wss2-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u2.id, workspaceId: ws, role: "ADMIN" } });
    userIds = [u1.id, u2.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|wss-${suffix}`, email: u1.email });

    // A campaign created BEFORE any defaults exist — the Q-109 control.
    const early = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Early bird",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
          dailyCap: { email: 200 },
          consent: null,
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    earlyAgentId = early.id;

    // Real ledger rows: the B6 reveal debit shape + a manual top-up.
    await owner.creditLedger.create({
      data: { workspaceId: ws, delta: -2, reason: "lead_reveal", balanceAfter: 88 },
    });
    await owner.creditLedger.create({
      data: { workspaceId: ws, delta: 100, reason: "backoffice_adjustment", balanceAfter: 188 },
    });

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
    await owner?.$disconnect();
  });

  it("members lists exactly this workspace's people with roles and identity", async () => {
    const res = await api().get("/workspaces/members").set(asOwner()).expect(200);
    expect(res.body).toHaveLength(2);
    const o = res.body.find((m: { role: string }) => m.role === "OWNER");
    expect(o.name).toBe("Owner One");
    expect(o.email).toContain("wss-owner-");
    const a = res.body.find((m: { role: string }) => m.role === "ADMIN");
    expect(a.email).toContain("wss-admin-");
  });

  it("guardrail defaults: empty → PATCH stores → NEW campaigns start from them, older ones keep their own", async () => {
    const before = await api().get("/workspaces/guardrail-defaults").set(asOwner()).expect(200);
    expect(before.body.defaults).toEqual({});

    await api()
      .patch("/workspaces/guardrail-defaults")
      .set(asOwner())
      .send({ dailyCap: { email: 77, sms: 33 }, sendingWindow: { days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "18:00", timezone: "UTC" } })
      .expect(200);

    const after = await api().get("/workspaces/guardrail-defaults").set(asOwner()).expect(200);
    expect(after.body.defaults.dailyCap.email).toBe(77);
    expect(after.body.defaults.sendingWindow.days).toContain(6);

    // A campaign created NOW starts from the defaults…
    const created = await api()
      .post("/agents")
      .set(asOwner())
      .send({ name: "Post-defaults", goal: "book_appointments" })
      .expect(201);
    const fresh = await owner.agent.findUniqueOrThrow({ where: { id: created.body.id } });
    const freshG = parseGuardrails(fresh.guardrails);
    expect(freshG.dailyCap.email).toBe(77);
    expect(freshG.dailyCap.sms).toBe(33);
    expect(freshG.sendingWindow.start).toBe("08:00");

    // …while the pre-existing campaign keeps its own values (Q-109).
    const early = await owner.agent.findUniqueOrThrow({ where: { id: earlyAgentId } });
    expect(parseGuardrails(early.guardrails).dailyCap.email).toBe(200);

    // The diff view lists both campaigns with their CURRENT values.
    const names = after.body.campaigns.map((c: { name: string }) => c.name);
    expect(names).toContain("Early bird");
  });

  it("guardrail defaults PATCH validates — a zero cap refuses 400", async () => {
    await api()
      .patch("/workspaces/guardrail-defaults")
      .set(asOwner())
      .send({ dailyCap: { email: 0 } })
      .expect(400);
  });

  it("credits summary aggregates the real ledger and echoes the balance", async () => {
    const res = await api().get("/credits/summary").set(asOwner()).expect(200);
    expect(res.body.balance).toBe(90);
    const reveal = res.body.spent.find((r: { reason: string }) => r.reason === "lead_reveal");
    expect(reveal.credits).toBe(2);
    expect(reveal.entries).toBe(1);
    const added = res.body.added.find((r: { reason: string }) => r.reason === "backoffice_adjustment");
    expect(added.credits).toBe(100);
    expect(res.body.recent[0]!.reason).toBe("backoffice_adjustment"); // newest first
  });

  it("the channels rider round-trips the shipped guardrails PATCH", async () => {
    const view = await api().get(`/agents/${earlyAgentId}/view`).set(asOwner()).expect(200);
    const g = view.body.guardrails;
    await api()
      .patch(`/agents/${earlyAgentId}`)
      .set(asOwner())
      .send({ guardrails: { ...g, channels: { email: false, voice: true } } })
      .expect(200);
    const after = await api().get(`/agents/${earlyAgentId}/view`).set(asOwner()).expect(200);
    expect(after.body.guardrails.channels).toEqual({ email: false, voice: true });
  });
});
