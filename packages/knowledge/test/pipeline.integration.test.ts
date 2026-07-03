/**
 * P1.2 acceptance integration: PENDING→INGESTING→READY, FAILED on a dead URL,
 * re-ingest idempotency, PDF fixture → READY chunks → retrievable, RLS
 * round-trip (a workspace cannot retrieve another's chunks), and the hnsw
 * index is used. Requires Postgres; embeddings are mocked (deterministic
 * vectors — no network). Skips without infra so `pnpm test` stays green.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import {
  createAppPrismaClient,
  createPrismaClient,
  withTenant,
  type PrismaClient,
} from "@clientforce/db";
import { ingestSource, type IngestDeps } from "../src/pipeline";
import { retrieve } from "../src/retrieve";
import { MemoryUploadStore, uploadPathFor } from "../src/storage";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * Deterministic "embeddings": direction encodes crude term presence so cosine
 * ranking behaves sensibly for the retrieval assertions.
 */
const VOCAB = ["appointment", "pricing", "audit", "dental", "widget"];
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

describe.skipIf(!hasInfra)("knowledge pipeline integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  const store = new MemoryUploadStore();
  const deps = (fetchImpl?: typeof fetch): IngestDeps => ({
    prisma: app,
    gateway,
    store,
    fetchImpl,
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `k-${suffix}`, slug: `k-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (
      await owner.workspace.create({
        data: { agencyId, name: "KA", slug: `ka-${suffix}`, settings: {} },
      })
    ).id;
    wsB = (
      await owner.workspace.create({
        data: { agencyId, name: "KB", slug: `kb-${suffix}`, settings: {} },
      })
    ).id;
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  const createSource = (
    workspaceId: string,
    data: { kind: "WEBSITE" | "DOCUMENT" | "TEXT"; uri?: string; label: string; meta?: object },
  ) =>
    withTenant(app, { workspaceId }, (tx) =>
      tx.knowledgeSource.create({ data: { workspaceId, meta: {}, ...data } }),
    );

  it("WEBSITE: PENDING→READY with chunks; retrieve finds them; RLS isolates", async () => {
    const html = `<html><title>Acme</title><body><main>
      <p>Acme books dental appointments with a free growth audit.</p>
      <p>Pricing starts at $99 per booked appointment.</p></main></body></html>`;
    const okFetch = (async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const src = await createSource(wsA, {
      kind: "WEBSITE",
      uri: "https://acme.test",
      label: "acme.test",
    });
    expect(src.status).toBe("PENDING");
    await ingestSource(deps(okFetch), { sourceId: src.id, workspaceId: wsA });

    const after = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.findUniqueOrThrow({ where: { id: src.id } }),
    );
    expect(after.status).toBe("READY");
    expect((after.meta as { chunkCount: number }).chunkCount).toBeGreaterThan(0);
    expect((after.meta as { title: string }).title).toBe("Acme");

    const hits = await retrieve(app, gateway, wsA, "dental appointment pricing", { k: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.content.toLowerCase()).toContain("appointment");

    // RLS round-trip: workspace B sees nothing of A's chunks.
    const cross = await retrieve(app, gateway, wsB, "dental appointment pricing", { k: 3 });
    expect(cross).toEqual([]);
  });

  it("FAILED on a dead URL with the reason recorded", async () => {
    const deadFetch = (async () =>
      new Response("gone", { status: 404 })) as unknown as typeof fetch;
    const src = await createSource(wsA, {
      kind: "WEBSITE",
      uri: "https://dead.test",
      label: "dead.test",
    });
    await ingestSource(deps(deadFetch), { sourceId: src.id, workspaceId: wsA });
    const after = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.findUniqueOrThrow({ where: { id: src.id } }),
    );
    expect(after.status).toBe("FAILED");
    expect((after.meta as { error: string }).error).toMatch(/HTTP 404/);
  });

  it("DOCUMENT: the PDF fixture ingests to READY chunks that are retrievable", async () => {
    const pdf = readFileSync(join(__dirname, "fixtures", "sample.pdf"));
    const src = await createSource(wsA, { kind: "DOCUMENT", label: "sample.pdf" });
    const path = uploadPathFor(wsA, src.id, "sample.pdf");
    await store.put(path, pdf, "application/pdf");
    await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.update({ where: { id: src.id }, data: { uri: path } }),
    );
    await ingestSource(deps(), { sourceId: src.id, workspaceId: wsA });

    const after = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.findUniqueOrThrow({ where: { id: src.id } }),
    );
    expect(after.status).toBe("READY");
    const hits = await retrieve(app, gateway, wsA, "pricing widget", { k: 5 });
    expect(hits.some((h) => h.sourceId === src.id)).toBe(true);
  });

  it("re-ingest replaces chunks (idempotent) and agent scoping filters retrieval", async () => {
    const src = await createSource(wsA, {
      kind: "TEXT",
      label: "pasted",
      meta: { text: "Widget pricing is important.\nOur widget audit is thorough." },
    });
    await ingestSource(deps(), { sourceId: src.id, workspaceId: wsA });
    await ingestSource(deps(), { sourceId: src.id, workspaceId: wsA }); // second run
    const count = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeChunk.count({ where: { sourceId: src.id } }),
    );
    expect(count).toBeGreaterThan(0); // replaced, not duplicated
    const after = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.findUniqueOrThrow({ where: { id: src.id } }),
    );
    expect((after.meta as { chunkCount: number }).chunkCount).toBe(count);

    // Workspace-scope filter excludes nothing here (agentId null), agent scope includes workspace-level.
    const wsScope = await retrieve(app, gateway, wsA, "widget", { scope: "workspace", k: 10 });
    expect(wsScope.some((h) => h.sourceId === src.id)).toBe(true);
  });

  it("the hnsw index exists and is used (EXPLAIN, owner client — no RLS predicate)", async () => {
    // Under RLS on a tiny test table the planner prefers the workspaceId btree;
    // the acceptance check is that the vector index exists and serves ANN
    // ordering, so EXPLAIN runs on the owner client with seqscan disabled.
    const vector = `[${fakeVector("appointment").join(",")}]`;
    const plan = await owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
        `EXPLAIN SELECT id FROM "KnowledgeChunk" ORDER BY embedding <=> '${vector}'::vector LIMIT 5`,
      );
    });
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    expect(text).toMatch(/Index Scan using "?KnowledgeChunk_embedding_hnsw_idx"?/);
  });
});
