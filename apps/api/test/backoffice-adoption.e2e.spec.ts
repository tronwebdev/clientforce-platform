/**
 * Platform backoffice W3 e2e (B1 W3, DEC-081): the adoption dashboard computes
 * the activation funnel, DAU/WAU, and feature adoption from the local
 * TelemetryEvent store, with a statistical-honesty floor. Real Postgres (skips
 * without DB env). Telemetry payloads are id/label-only (privacy rail).
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
const WS1 = `w3-ws1-${suffix}`;
const WS2 = `w3-ws2-${suffix}`;
const NOW = new Date();

describe.skipIf(!hasDb)("Platform backoffice W3 e2e — adoption dashboard", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let staffToken: string;
  let tenantToken: string;
  const actorIds = [`w3-u1-${suffix}`, `w3-u2-${suffix}`, `w3-u3-${suffix}`];

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    const t = (name: string, workspaceId: string | null, props: Record<string, unknown>, actorId?: string) => ({
      name,
      actorType: "system",
      actorId: actorId ?? null,
      workspaceId,
      props,
      occurredAt: NOW,
    });
    await owner.telemetryEvent.createMany({
      data: [
        // signup (3 distinct users), agent (2 ws), launch (2 ws), send (2 ws),
        // reply (1 ws), goal (1 ws) → a funnel that narrows.
        ...actorIds.map((a) => t("product.signup.v1", null, { actorId: a }, a)),
        t("product.agent_created.v1", WS1, { workspaceId: WS1, agentId: "a1", actorId: actorIds[0] }),
        t("product.agent_created.v1", WS2, { workspaceId: WS2, agentId: "a2", actorId: actorIds[1] }),
        t("product.agent_launched.v1", WS1, { workspaceId: WS1, agentId: "a1", actorId: actorIds[0] }),
        t("product.agent_launched.v1", WS2, { workspaceId: WS2, agentId: "a2", actorId: actorIds[1] }),
        t("product.send.v1", WS1, { workspaceId: WS1, channel: "email" }),
        t("product.send.v1", WS2, { workspaceId: WS2, channel: "sms" }),
        t("product.reply.v1", WS1, { workspaceId: WS1, channel: "email" }),
        t("product.goal.v1", WS1, { workspaceId: WS1, goal: "booked" }),
        t("feature.first_used.v1", WS1, { workspaceId: WS1, feature: "sequence_editor" }),
        t("feature.first_used.v1", WS2, { workspaceId: WS2, feature: "sequence_editor" }),
        t("feature.first_used.v1", WS1, { workspaceId: WS1, feature: "guided_mode" }),
      ],
    });

    const staff = await owner.platformStaff.create({ data: { email: `w3-ops-${suffix}@cf.test`, role: "ADMIN", status: "ACTIVE" } });
    staffToken = await signStaffToken({ sub: staff.id, email: staff.email, role: "ADMIN" });
    tenantToken = await signDevToken(SECRET, { sub: `auth|w3-${suffix}`, email: `w3-tenant-${suffix}@t.test` });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner) {
      await owner.telemetryEvent.deleteMany({ where: { OR: [{ workspaceId: { in: [WS1, WS2] } }, { actorId: { in: actorIds } }] } });
      await owner.platformStaff.deleteMany({ where: { email: `w3-ops-${suffix}@cf.test` } });
    }
    await owner?.$disconnect();
  });

  const staff = () => ({ Authorization: `Bearer ${staffToken}` });
  const window = `from=${new Date(NOW.getTime() - 3_600_000).toISOString()}&to=${new Date(NOW.getTime() + 3_600_000).toISOString()}`;

  it("a tenant credential cannot read adoption (401)", async () => {
    await request(app.getHttpServer())
      .get("/backoffice/adoption")
      .set({ Authorization: `Bearer ${tenantToken}` })
      .expect(401);
  });

  it("computes the activation funnel, DAU/WAU, and feature adoption", async () => {
    const res = await request(app.getHttpServer()).get(`/backoffice/adoption?${window}`).set(staff());
    expect(res.status).toBe(200);
    const byStep = Object.fromEntries(res.body.funnel.map((s: { step: string; count: number }) => [s.step, s.count]));
    expect(byStep.signup).toBe(3);
    expect(byStep.agent).toBe(2);
    expect(byStep.launch).toBe(2);
    expect(byStep["first send"]).toBe(2);
    expect(byStep["first reply"]).toBe(1);
    expect(byStep.goal).toBe(1);

    // conversion send → reply = 1/2 = 50%
    const reply = res.body.funnel.find((s: { step: string }) => s.step === "first reply");
    expect(reply.conversionPct).toBe(50);

    // DAU/WAU = active workspaces (WS1 + WS2) in the recent window.
    expect(res.body.dau).toBe(2);
    expect(res.body.wau).toBe(2);

    // feature adoption matrix
    const feat = Object.fromEntries(res.body.featureAdoption.map((f: { feature: string; workspaces: number }) => [f.feature, f.workspaces]));
    expect(feat.sequence_editor).toBe(2);
    expect(feat.guided_mode).toBe(1);

    expect(res.body.lowData).toBe(false);
  });

  it("flags low data below the sample floor", async () => {
    // A future window with no events → below floor.
    const empty = `from=${new Date(NOW.getTime() + 7_200_000).toISOString()}&to=${new Date(NOW.getTime() + 10_800_000).toISOString()}`;
    const res = await request(app.getHttpServer()).get(`/backoffice/adoption?${empty}`).set(staff());
    expect(res.status).toBe(200);
    expect(res.body.lowData).toBe(true);
  });
});
