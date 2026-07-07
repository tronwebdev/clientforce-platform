/**
 * C2.7 contact custom fields e2e (docs/PLAN_CUSTOM_FIELDS.md acceptance):
 * admin-only def creation, slug keys, 30-active cap, key/type immutability,
 * custom-value validation on contacts, archive-preserves-values, RLS scoping.
 * Same harness as api.e2e.spec.ts — skips without a DB.
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
const suffix = `cf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("contact custom fields e2e (C2.7)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let agentToken: string;

  const api = () => request(app.getHttpServer());
  const asOwner = (r: request.Test) =>
    r.set("Authorization", `Bearer ${ownerToken}`).set("x-workspace-id", wsA);
  const asAgent = (r: request.Test) =>
    r.set("Authorization", `Bearer ${agentToken}`).set("x-workspace-id", wsA);

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: suffix, slug: suffix, branding: {} },
    });
    agencyId = agency.id;
    wsA = (await owner.workspace.create({ data: { agencyId, name: "A", slug: `a-${suffix}`, settings: {} } })).id;
    wsB = (await owner.workspace.create({ data: { agencyId, name: "B", slug: `b-${suffix}`, settings: {} } })).id;

    const u1 = await owner.user.create({
      data: { email: `owner-${suffix}@t.test`, authProviderId: `auth|owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsA, role: "OWNER" } });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsB, role: "OWNER" } });
    const u2 = await owner.user.create({
      data: { email: `agent-${suffix}@t.test`, authProviderId: `auth|agent-${suffix}` },
    });
    // AGENT can write contacts (fill values) but is NOT an admin — no def creation.
    await owner.membership.create({ data: { userId: u2.id, workspaceId: wsA, role: "AGENT" } });
    userIds = [u1.id, u2.id];

    ownerToken = await signDevToken(SECRET, { sub: `auth|owner-${suffix}`, email: u1.email });
    agentToken = await signDevToken(SECRET, { sub: `auth|agent-${suffix}`, email: u2.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.contact.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await owner.contactFieldDef.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  it("admin creates a def — label slugs to the immutable key", async () => {
    const res = await asOwner(api().post("/contact-fields")).send({ label: "Source URL " });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe("source_url");
    expect(res.body.type).toBe("TEXT");
    expect(res.body.archived).toBe(false);
  });

  it("non-admin (AGENT) def creation → 403; listing stays readable", async () => {
    await asAgent(api().post("/contact-fields")).send({ label: "Nope" }).expect(403);
    const list = await asAgent(api().get("/contact-fields"));
    expect(list.status).toBe(200);
    expect(list.body.some((d: { key: string }) => d.key === "source_url")).toBe(true);
  });

  it("duplicate key → designed 409", async () => {
    const res = await asOwner(api().post("/contact-fields")).send({ label: "source url" });
    expect(res.status).toBe(409);
  });

  it("key and type are immutable — PATCH with them → 400; label/archived PATCH ok", async () => {
    const list = await asOwner(api().get("/contact-fields"));
    const def = list.body.find((d: { key: string }) => d.key === "source_url");
    await asOwner(api().patch(`/contact-fields/${def.id}`)).send({ key: "hacked" }).expect(400);
    await asOwner(api().patch(`/contact-fields/${def.id}`)).send({ type: "NUMBER" }).expect(400);
    const renamed = await asOwner(api().patch(`/contact-fields/${def.id}`)).send({ label: "Website" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.label).toBe("Website");
    expect(renamed.body.key).toBe("source_url");
  });

  it("contact create/update accepts valid custom values; unknown keys reject", async () => {
    await asOwner(api().post("/contact-fields")).send({ label: "Industry" }).expect(201);
    const created = await asOwner(api().post("/contacts")).send({
      email: `c1-${suffix}@t.test`,
      custom: { industry: "Dental" },
    });
    expect(created.status).toBe(201);
    expect(created.body.custom).toEqual({ industry: "Dental" });

    await asOwner(api().post("/contacts"))
      .send({ email: `c2-${suffix}@t.test`, custom: { nonexistent: "x" } })
      .expect(400);

    const patched = await asOwner(api().patch(`/contacts/${created.body.id}`)).send({
      custom: { industry: "Ortho", source_url: "https://x.test" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.custom).toEqual({ industry: "Ortho", source_url: "https://x.test" });
  });

  it("archived def: values preserved, key no longer accepted, hidden from active use", async () => {
    const list = await asOwner(api().get("/contact-fields"));
    const industry = list.body.find((d: { key: string }) => d.key === "industry");
    await asOwner(api().patch(`/contact-fields/${industry.id}`)).send({ archived: true }).expect(200);

    // key now rejects on write…
    await asOwner(api().post("/contacts"))
      .send({ email: `c3-${suffix}@t.test`, custom: { industry: "x" } })
      .expect(400);

    // …but stored values survive (archive-never-delete).
    const rows = await asOwner(api().get("/contacts"));
    const c1 = rows.body.find((c: { email: string }) => c.email === `c1-${suffix}@t.test`);
    expect(c1.custom.industry).toBe("Ortho");

    // un-archive restores acceptance.
    await asOwner(api().patch(`/contact-fields/${industry.id}`)).send({ archived: false }).expect(200);
  });

  it("31st ACTIVE def → designed 422 (archived defs don't count)", async () => {
    const existing = await asOwner(api().get("/contact-fields"));
    const activeNow = existing.body.filter((d: { archived: boolean }) => !d.archived).length;
    await owner.contactFieldDef.createMany({
      data: Array.from({ length: 30 - activeNow }, (_, i) => ({
        workspaceId: wsA,
        key: `filler_${i}`,
        label: `Filler ${i}`,
        origin: "manual",
        options: [],
      })),
    });
    const res = await asOwner(api().post("/contact-fields")).send({ label: "One Too Many" });
    expect(res.status).toBe(422);
  });

  it("defs are RLS-scoped — workspace B sees none of A's fields", async () => {
    const inB = await api()
      .get("/contact-fields")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-workspace-id", wsB);
    expect(inB.status).toBe(200);
    expect(inB.body).toHaveLength(0);
  });
});
