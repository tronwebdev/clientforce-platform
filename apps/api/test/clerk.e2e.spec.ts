/**
 * Clerk org-path e2e: org_id → Workspace.clerkOrgId resolution, just-in-time
 * membership provisioning (role seeded from org_role), DB-role authority (no
 * escalation), and rejection of unprovisioned orgs.
 *
 * Skips without a DB. Uses the dev verifier with org_id/org_role claims.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const ORG_C = `org_c_${suffix}`;
const ORG_V = `org_v_${suffix}`;
const ORG_MISSING = `org_missing_${suffix}`;

describe.skipIf(!hasDb)("API e2e (Clerk org path)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let wsC: string;
  let wsV: string;
  let userIds: string[] = [];
  let jitToken: string; // no membership yet; org_role=org:admin
  let escalateToken: string; // existing VIEWER; org_role=org:admin (must NOT escalate)
  let missingOrgToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `clerk-${suffix}`, slug: `clerk-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    const c = await owner.workspace.create({
      data: { agencyId, name: "C", slug: `c-${suffix}`, settings: {}, clerkOrgId: ORG_C },
    });
    const v = await owner.workspace.create({
      data: { agencyId, name: "V", slug: `v-${suffix}`, settings: {}, clerkOrgId: ORG_V },
    });
    wsC = c.id;
    wsV = v.id;

    const jit = await owner.user.create({
      data: { email: `jit-${suffix}@t.test`, authProviderId: `auth|jit-${suffix}` },
    });
    const dbrole = await owner.user.create({
      data: { email: `dbrole-${suffix}@t.test`, authProviderId: `auth|dbrole-${suffix}` },
    });
    // Pre-existing VIEWER membership — DB must remain authoritative.
    await owner.membership.create({ data: { userId: dbrole.id, workspaceId: wsV, role: "VIEWER" } });
    userIds = [jit.id, dbrole.id];

    await owner.contact.createMany({
      data: [
        { workspaceId: wsC, source: "seed", optOut: {}, tags: [], email: `c1-${suffix}@t.test` },
        { workspaceId: wsC, source: "seed", optOut: {}, tags: [], email: `c2-${suffix}@t.test` },
      ],
    });

    jitToken = await signDevToken(SECRET, {
      sub: `auth|jit-${suffix}`,
      email: jit.email,
      orgId: ORG_C,
      orgRole: "org:admin",
    });
    escalateToken = await signDevToken(SECRET, {
      sub: `auth|dbrole-${suffix}`,
      email: dbrole.email,
      orgId: ORG_V,
      orgRole: "org:admin",
    });
    missingOrgToken = await signDevToken(SECRET, {
      sub: `auth|jit-${suffix}`,
      email: jit.email,
      orgId: ORG_MISSING,
      orgRole: "org:member",
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.contact.deleteMany({ where: { workspaceId: { in: [wsC, wsV] } } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  it("provisions a membership just-in-time and seeds the role from org_role", async () => {
    const res = await request(app.getHttpServer()).get("/me").set("Authorization", `Bearer ${jitToken}`);
    expect(res.status).toBe(200);
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.activeWorkspace?.id).toBe(wsC);
    expect(res.body.role).toBe("ADMIN"); // org:admin → ADMIN (seed map)

    // Seeded ADMIN may write.
    const post = await request(app.getHttpServer())
      .post("/contacts")
      .set("Authorization", `Bearer ${jitToken}`)
      .send({ email: `jit-new-${suffix}@t.test` });
    expect(post.status).toBe(201);
    expect(post.body.workspaceId).toBe(wsC);
  });

  it("scopes tenant data to the org's workspace", async () => {
    const res = await request(app.getHttpServer()).get("/contacts").set("Authorization", `Bearer ${jitToken}`);
    expect(res.status).toBe(200);
    expect(res.body.every((c: { workspaceId: string }) => c.workspaceId === wsC)).toBe(true);
    // 2 seeded + 1 created above
    expect(res.body).toHaveLength(3);
  });

  it("keeps the DB role authoritative — org_role cannot escalate a VIEWER", async () => {
    const me = await request(app.getHttpServer()).get("/me").set("Authorization", `Bearer ${escalateToken}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("VIEWER"); // NOT ADMIN despite org_role=org:admin

    const post = await request(app.getHttpServer())
      .post("/contacts")
      .set("Authorization", `Bearer ${escalateToken}`)
      .send({ email: `should-fail-${suffix}@t.test` });
    expect(post.status).toBe(403);
  });

  it("rejects a token for an unprovisioned organization → 403", async () => {
    await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${missingOrgToken}`)
      .expect(403);
  });
});
