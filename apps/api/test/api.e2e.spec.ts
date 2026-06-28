/**
 * API e2e (T3/#4 acceptance): auth, tenancy resolution + RLS round-trip, RBAC.
 *
 * Requires Postgres (users/memberships/contacts under RLS). Skips when no DB env
 * is present so `pnpm test` stays green without infra. Uses the dev HS256 verifier
 * (AUTH_DEV_SECRET) to mint tokens — no external auth provider needed.
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

describe.skipIf(!hasDb)("API e2e (auth + tenancy + RBAC)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let viewerToken: string;
  let strangerToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `api-${suffix}`, slug: `api-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    const a = await owner.workspace.create({ data: { agencyId, name: "A", slug: `a-${suffix}`, settings: {} } });
    const b = await owner.workspace.create({ data: { agencyId, name: "B", slug: `b-${suffix}`, settings: {} } });
    wsA = a.id;
    wsB = b.id;

    const u1 = await owner.user.create({
      data: { email: `owner-${suffix}@t.test`, name: "Owner One", authProviderId: `auth|owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsA, role: "OWNER" } });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsB, role: "OWNER" } });

    const viewer = await owner.user.create({
      data: { email: `viewer-${suffix}@t.test`, authProviderId: `auth|viewer-${suffix}` },
    });
    await owner.membership.create({ data: { userId: viewer.id, workspaceId: wsA, role: "VIEWER" } });

    const stranger = await owner.user.create({
      data: { email: `stranger-${suffix}@t.test`, authProviderId: `auth|stranger-${suffix}` },
    });
    userIds = [u1.id, viewer.id, stranger.id];

    await owner.contact.createMany({
      data: [
        { workspaceId: wsA, source: "seed", optOut: {}, tags: [], email: `a1-${suffix}@t.test` },
        { workspaceId: wsA, source: "seed", optOut: {}, tags: [], email: `a2-${suffix}@t.test` },
        { workspaceId: wsB, source: "seed", optOut: {}, tags: [], email: `b1-${suffix}@t.test` },
      ],
    });

    ownerToken = await signDevToken(SECRET, { sub: `auth|owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, { sub: `auth|viewer-${suffix}`, email: viewer.email });
    strangerToken = await signDevToken(SECRET, { sub: `auth|stranger-${suffix}`, email: stranger.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.contact.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  it("GET /healthz is public → 200", async () => {
    const res = await request(app.getHttpServer()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /me without a token → 401", async () => {
    await request(app.getHttpServer()).get("/me").expect(401);
  });

  it("GET /me with a valid token → 200 with user + memberships + active workspace", async () => {
    const res = await request(app.getHttpServer()).get("/me").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(`owner-${suffix}@t.test`);
    expect(res.body.memberships).toHaveLength(2);
    expect(res.body.activeWorkspace?.id).toBeTruthy();
    expect(res.body.role).toBe("OWNER");
  });

  it("switching the active workspace changes visible rows (RLS round-trip)", async () => {
    const inA = await request(app.getHttpServer())
      .get("/contacts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-workspace-id", wsA);
    expect(inA.status).toBe(200);
    expect(inA.body).toHaveLength(2);
    expect(inA.body.every((c: { workspaceId: string }) => c.workspaceId === wsA)).toBe(true);

    const inB = await request(app.getHttpServer())
      .get("/contacts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-workspace-id", wsB);
    expect(inB.body).toHaveLength(1);
    expect(inB.body[0].workspaceId).toBe(wsB);
  });

  it("a VIEWER is denied a write → POST /contacts 403", async () => {
    await request(app.getHttpServer())
      .post("/contacts")
      .set("Authorization", `Bearer ${viewerToken}`)
      .set("x-workspace-id", wsA)
      .send({ email: `nope-${suffix}@t.test` })
      .expect(403);
  });

  it("an OWNER may write → POST /contacts 201 in the active workspace", async () => {
    const res = await request(app.getHttpServer())
      .post("/contacts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-workspace-id", wsA)
      .send({ email: `owner-new-${suffix}@t.test` });
    expect(res.status).toBe(201);
    expect(res.body.workspaceId).toBe(wsA);
  });

  it("a principal with no membership → 403", async () => {
    await request(app.getHttpServer()).get("/me").set("Authorization", `Bearer ${strangerToken}`).expect(403);
  });
});
