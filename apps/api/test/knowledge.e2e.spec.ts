/**
 * Knowledge API e2e (P1.2): source CRUD, DOCUMENT multipart upload, live
 * status transitions, retrieval, RBAC, and the CONNECTOR rejection (DEC-023).
 *
 * Requires Postgres (skips without DB env, like api.e2e). No Redis and no
 * network: the enqueuer is overridden to run the real pipeline inline with a
 * memory blob store, stubbed fetch, and deterministic fake embeddings.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { ingestSource, MemoryUploadStore, type IngestJobPayload } from "@clientforce/knowledge";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { PrismaService } from "../src/db/prisma.service";
import {
  INGEST_ENQUEUER,
  KNOWLEDGE_GATEWAY,
  UPLOAD_STORE,
  type IngestEnqueuer,
} from "../src/knowledge/knowledge.providers";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fixture = (name: string) =>
  readFileSync(
    join(__dirname, "..", "..", "..", "packages", "knowledge", "test", "fixtures", name),
  );

/** Deterministic embeddings: direction encodes crude term presence. */
const VOCAB = ["pricing", "audit", "fixture", "appointment"];
function fakeVector(text: string): number[] {
  const v = new Array(1536).fill(0.0001);
  const lower = text.toLowerCase();
  VOCAB.forEach((term, i) => {
    if (lower.includes(term)) v[i] = 1;
  });
  return v;
}

const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async () => ({ input: {}, usage: { inputTokens: 0, outputTokens: 0 } }),
  },
  embeddings: {
    embed: async (texts) => ({
      vectors: texts.map(fakeVector),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    }),
  },
  config: { maxRetries: 0 },
});

const PAGE_HTML = `<html><head><title>Acme</title></head><body><main>
  <p>Acme runs a free growth audit for dental clinics.</p>
  <p>Pricing starts at $99 per booked appointment.</p></main></body></html>`;
const stubFetch = (async () =>
  new Response(PAGE_HTML, {
    status: 200,
    headers: { "content-type": "text/html" },
  })) as unknown as typeof fetch;

describe.skipIf(!hasDb)("Knowledge API e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let viewerToken: string;
  const store = new MemoryUploadStore();

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `kn-${suffix}`, slug: `kn-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (
      await owner.workspace.create({
        data: { agencyId, name: "KA", slug: `kna-${suffix}`, settings: {} },
      })
    ).id;
    wsB = (
      await owner.workspace.create({
        data: { agencyId, name: "KB", slug: `knb-${suffix}`, settings: {} },
      })
    ).id;

    const u1 = await owner.user.create({
      data: { email: `kn-owner-${suffix}@t.test`, authProviderId: `auth|kn-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsA, role: "OWNER" } });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsB, role: "OWNER" } });
    const viewer = await owner.user.create({
      data: { email: `kn-viewer-${suffix}@t.test`, authProviderId: `auth|kn-viewer-${suffix}` },
    });
    await owner.membership.create({
      data: { userId: viewer.id, workspaceId: wsA, role: "VIEWER" },
    });
    userIds = [u1.id, viewer.id];

    ownerToken = await signDevToken(SECRET, { sub: `auth|kn-owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, {
      sub: `auth|kn-viewer-${suffix}`,
      email: viewer.email,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UPLOAD_STORE)
      .useValue(store)
      .overrideProvider(KNOWLEDGE_GATEWAY)
      .useValue(gateway)
      .overrideProvider(INGEST_ENQUEUER)
      .useFactory({
        factory: (prisma: PrismaService): IngestEnqueuer => ({
          // Inline "worker": runs the real pipeline synchronously on enqueue.
          enqueue: (payload: IngestJobPayload) =>
            ingestSource({ prisma: prisma.app, gateway, store, fetchImpl: stubFetch }, payload),
        }),
        inject: [PrismaService],
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.knowledgeSource.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  const asOwner = (ws = wsA) => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  it("POST /knowledge/sources (WEBSITE) → 201 and the source reaches READY with chunks", async () => {
    const res = await request(app.getHttpServer())
      .post("/knowledge/sources")
      .set(asOwner())
      .send({ kind: "WEBSITE", uri: "https://acme.test" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("WEBSITE");
    expect(res.body.label).toBe("acme.test");

    const list = await request(app.getHttpServer()).get("/knowledge/sources").set(asOwner());
    const row = list.body.find((s: { id: string }) => s.id === res.body.id);
    expect(row.status).toBe("READY");
    expect(row.meta.chunkCount).toBeGreaterThan(0);
    expect(row.meta.title).toBe("Acme");
  });

  it("POST /knowledge/sources/upload (DOCUMENT, PDF fixture) → READY and retrievable", async () => {
    const res = await request(app.getHttpServer())
      .post("/knowledge/sources/upload")
      .set(asOwner())
      .field("label", "sample.pdf")
      .attach("file", fixture("sample.pdf"), "sample.pdf");
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("DOCUMENT");
    expect(res.body.uri).toMatch(new RegExp(`^workspaces/${wsA}/knowledge/${res.body.id}/`));

    const retrieved = await request(app.getHttpServer())
      .post("/knowledge/retrieve")
      .set(asOwner())
      .send({ query: "pricing fixture", k: 5 });
    expect(retrieved.status).toBe(201);
    expect(retrieved.body.some((c: { sourceId: string }) => c.sourceId === res.body.id)).toBe(true);
  });

  it("rejects unsupported upload types → 400", async () => {
    await request(app.getHttpServer())
      .post("/knowledge/sources/upload")
      .set(asOwner())
      .attach("file", Buffer.from("x"), "image.png")
      .expect(400);
  });

  it("POST TEXT source → READY; scope=workspace lists it; agentId filter excludes it", async () => {
    const res = await request(app.getHttpServer())
      .post("/knowledge/sources")
      .set(asOwner())
      .send({ kind: "TEXT", label: "pasted", text: "Our audit process takes two weeks." });
    expect(res.status).toBe(201);
    expect(res.body.agentId).toBeNull();

    const wsList = await request(app.getHttpServer())
      .get("/knowledge/sources?scope=workspace")
      .set(asOwner());
    expect(wsList.body.some((s: { id: string }) => s.id === res.body.id)).toBe(true);

    const agentList = await request(app.getHttpServer())
      .get("/knowledge/sources?agentId=nope")
      .set(asOwner());
    expect(agentList.body).toEqual([]);
  });

  it("CONNECTOR creation is rejected (DEC-023 designed-but-inert) → 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/knowledge/sources")
      .set(asOwner())
      .send({ kind: "CONNECTOR", provider: "google-drive", label: "Drive" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not yet supported/);
  });

  it("invalid payloads → 400 with zod issues", async () => {
    const res = await request(app.getHttpServer())
      .post("/knowledge/sources")
      .set(asOwner())
      .send({ kind: "WEBSITE", uri: "not-a-url" });
    expect(res.status).toBe(400);
    expect(res.body.issues?.[0]?.path).toBe("uri");
  });

  it("a VIEWER cannot create sources → 403", async () => {
    await request(app.getHttpServer())
      .post("/knowledge/sources")
      .set({ Authorization: `Bearer ${viewerToken}`, "x-workspace-id": wsA })
      .send({ kind: "TEXT", label: "nope", text: "nope" })
      .expect(403);
  });

  it("workspace B sees none of A's sources or chunks (RLS)", async () => {
    const list = await request(app.getHttpServer()).get("/knowledge/sources").set(asOwner(wsB));
    expect(list.body).toEqual([]);
    const retrieved = await request(app.getHttpServer())
      .post("/knowledge/retrieve")
      .set(asOwner(wsB))
      .send({ query: "pricing fixture" });
    expect(retrieved.body).toEqual([]);
  });

  it("DELETE removes the source, its chunks, and the blob", async () => {
    const created = await request(app.getHttpServer())
      .post("/knowledge/sources/upload")
      .set(asOwner())
      .attach("file", Buffer.from("Audit pricing memo: fixture facts."), "memo.txt");
    expect(created.status).toBe(201);
    const { id, uri } = created.body;

    await request(app.getHttpServer())
      .delete(`/knowledge/sources/${id}`)
      .set(asOwner())
      .expect(200);
    const chunks = await owner.knowledgeChunk.count({ where: { sourceId: id } });
    expect(chunks).toBe(0);
    await expect(store.get(uri)).rejects.toThrow(/Not found/);

    await request(app.getHttpServer())
      .delete(`/knowledge/sources/${id}`)
      .set(asOwner())
      .expect(404);
  });
});
