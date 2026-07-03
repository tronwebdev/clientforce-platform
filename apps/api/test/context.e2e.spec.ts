/**
 * Context API e2e (P1.3): distill → poll → gaps → Type it / ✦ Let AI / Undo,
 * the workspace-layer routing of company_address, and RBAC. Requires
 * Postgres (skips without DB env). No Redis and no network: the distill
 * enqueuer runs the real distiller inline with fake embeddings + a
 * prompt-parsing fake completion provider.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import { distill, type DistillTarget } from "@clientforce/context";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { ingestSource, MemoryUploadStore } from "@clientforce/knowledge";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { PrismaService } from "../src/db/prisma.service";
import { DISTILL_ENQUEUER, type DistillEnqueuer } from "../src/context/context.providers";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const VOCAB = ["appointment", "pricing", "audit", "address", "different"];
function fakeVector(text: string): number[] {
  const v = new Array(1536).fill(0.0001);
  const lower = text.toLowerCase();
  VOCAB.forEach((term, i) => {
    if (lower.includes(term)) v[i] = 1;
  });
  return v;
}

/** Fills core + pricing + company_address, citing real evidence ids from the prompt. */
const FILLS = ["offer", "usp", "tone", "pricing", "company_address"];
const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string }) => {
      const ids = [...params.prompt.matchAll(/^\[([0-9a-f-]{36})\]$/gim)].map((m) => m[1]!);
      const requested = [...params.prompt.matchAll(/^- ([a-z_]+) — /gim)].map((m) => m[1]!);
      return {
        input: {
          fields: requested
            .filter((k) => FILLS.includes(k))
            .map((key) => ({ key, value: `Distilled ${key}`, citations: [ids[0]!] })),
          rawSummary: "Distilled brief.",
          proposedAsks: [],
        },
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  },
  embeddings: {
    embed: async (texts: string[]) => ({
      vectors: texts.map(fakeVector),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    }),
  },
  config: { maxRetries: 0 },
});

describe.skipIf(!hasDb)("Context API e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let agentId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `cx-${suffix}`, slug: `cx-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (
      await owner.workspace.create({
        data: { agencyId, name: "CX", slug: `cx-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: wsA, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;

    const u1 = await owner.user.create({
      data: { email: `cx-owner-${suffix}@t.test`, authProviderId: `auth|cx-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsA, role: "OWNER" } });
    const viewer = await owner.user.create({
      data: { email: `cx-viewer-${suffix}@t.test`, authProviderId: `auth|cx-viewer-${suffix}` },
    });
    await owner.membership.create({
      data: { userId: viewer.id, workspaceId: wsA, role: "VIEWER" },
    });
    userIds = [u1.id, viewer.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|cx-owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, {
      sub: `auth|cx-viewer-${suffix}`,
      email: viewer.email,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DISTILL_ENQUEUER)
      .useFactory({
        factory: (prisma: PrismaService): DistillEnqueuer => ({
          // Inline "worker": runs the real distiller synchronously on enqueue.
          enqueue: async (target: DistillTarget) => {
            await distill({ prisma: prisma.app, gateway }, target);
          },
        }),
        inject: [PrismaService],
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    // Workspace knowledge through the real pipeline (real chunk ids).
    const prisma = app.get(PrismaService);
    const { withTenant } = await import("@clientforce/db");
    const src = await withTenant(prisma.app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.create({
        data: {
          workspaceId: wsA,
          kind: "TEXT",
          label: "site",
          meta: {
            text:
              "Acme books dental appointments with a free growth audit. Pricing starts at 99 dollars. " +
              "We are different because we guarantee results. Our address is 1 Main St, Austin TX.",
          },
        },
      }),
    );
    await ingestSource(
      { prisma: prisma.app, gateway, store: new MemoryUploadStore() },
      { sourceId: src.id, workspaceId: wsA },
    );
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.knowledgeSource.deleteMany({ where: { workspaceId: wsA } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": wsA });

  it("POST /context/distill (workspace layer) → row READY with cited fields; GET /context returns merged", async () => {
    const res = await request(app.getHttpServer()).post("/context/distill").set(asOwner()).send({});
    expect(res.status).toBe(201);

    const ctx = await request(app.getHttpServer()).get("/context").set(asOwner());
    expect(ctx.status).toBe(200);
    expect(ctx.body.workspace.status).toBe("READY");
    expect(ctx.body.merged.offer.source).toBe("distilled");
    expect(ctx.body.merged.offer.citations.length).toBeGreaterThan(0);
  });

  it("GET /context/gaps merges layers: workspace-covered fields covered, rest open", async () => {
    const res = await request(app.getHttpServer())
      .get(`/context/gaps?agentId=${agentId}&goal=book_appointments`)
      .set(asOwner());
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.gaps.map((g: { key: string }) => [g.key, g]));
    expect(by.offer.status).toBe("covered");
    expect(by.offer.coveredBy).toBe("workspace");
    expect(by.company_address.status).toBe("covered");
    expect(by.icp.status).toBe("open");
    expect(by.booking_link.status).toBe("open");
    expect(res.body.launchReady).toBe(false);
  });

  it("Type it + ✦ Let AI resolve gaps; launchReady flips; Undo re-opens", async () => {
    await request(app.getHttpServer())
      .post("/context/answers")
      .set(asOwner())
      .send({ agentId, key: "icp", value: "Dentists in Austin" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/context/delegate")
      .set(asOwner())
      .send({ agentId, key: "booking_link" })
      .expect(201);

    const gaps = await request(app.getHttpServer())
      .get(`/context/gaps?agentId=${agentId}&goal=book_appointments`)
      .set(asOwner());
    const by = Object.fromEntries(gaps.body.gaps.map((g: { key: string }) => [g.key, g]));
    expect(by.icp.status).toBe("typed");
    expect(by.booking_link.status).toBe("ai_decides");
    expect(gaps.body.launchReady).toBe(true);

    await request(app.getHttpServer())
      .post("/context/undo")
      .set(asOwner())
      .send({ agentId, key: "booking_link" })
      .expect(201);
    const after = await request(app.getHttpServer())
      .get(`/context/gaps?agentId=${agentId}&goal=book_appointments`)
      .set(asOwner());
    expect(after.body.gaps.find((g: { key: string }) => g.key === "booking_link").status).toBe(
      "open",
    );
    expect(after.body.launchReady).toBe(false);
  });

  it("company_address answers write to the WORKSPACE layer even with agentId (owner edit 3)", async () => {
    await request(app.getHttpServer())
      .post("/context/answers")
      .set(asOwner())
      .send({ agentId, key: "company_address", value: "2 Oak Ave, Dallas TX" })
      .expect(201);
    const ctx = await request(app.getHttpServer()).get("/context").set(asOwner());
    expect(ctx.body.workspace.fields.company_address.source).toBe("typed");
    const agentCtx = await request(app.getHttpServer())
      .get(`/context?agentId=${agentId}`)
      .set(asOwner());
    expect(agentCtx.body.agent.fields.company_address).toBeUndefined();
  });

  it("typed answers survive the re-distill that answering triggers (DEC-024)", async () => {
    const ctx = await request(app.getHttpServer())
      .get(`/context?agentId=${agentId}`)
      .set(asOwner());
    expect(ctx.body.agent.fields.icp).toEqual({
      value: "Dentists in Austin",
      citations: [],
      source: "typed",
    });
  });

  it("a VIEWER cannot write answers → 403", async () => {
    await request(app.getHttpServer())
      .post("/context/answers")
      .set({ Authorization: `Bearer ${viewerToken}`, "x-workspace-id": wsA })
      .send({ agentId, key: "icp", value: "nope" })
      .expect(403);
  });

  it("invalid payloads → 400 with zod issues", async () => {
    const res = await request(app.getHttpServer())
      .post("/context/answers")
      .set(asOwner())
      .send({ key: "not_a_field", value: "x" });
    expect(res.status).toBe(400);
    expect(res.body.issues?.length).toBeGreaterThan(0);
  });
});
