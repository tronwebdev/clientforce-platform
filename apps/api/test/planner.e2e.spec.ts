/**
 * Planner API e2e (P1.4): POST /planner/plan enqueues (inline here) → GET
 * /planner/graph returns the persisted latest version; RBAC; unknown agent
 * 404. Requires Postgres (skips without DB env). No Redis/network — the
 * enqueuer runs the real planner inline with a prompt-parsing fake provider.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import { planCampaign, type PlanTarget } from "@clientforce/planner";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { PrismaService } from "../src/db/prisma.service";
import { PLAN_ENQUEUER, type PlanEnqueuer } from "../src/planner/planner.providers";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const FACT = "free growth audit";
// M1b (DEC-066): the fake emits the v4 shape — six-case REPLY PLAYBOOK with
// stage pins and strategy steps (validateAll requires it at generation).
const goodGraph = (prompt: string) => ({
  entry: "step-1",
  nodes: [
    {
      id: "step-1",
      type: "step",
      channel: "email",
      content: {
        subject: "Hello {{company}}",
        body: `Hi {{firstName}}, ${prompt.includes(FACT) ? FACT : "our service"} could help {{company}}.`,
      },
    },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    {
      id: "branch-reply",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
        { when: { intent: "objection_price" }, goto: "step-reframe", pipeline: "replied" },
        { when: { intent: "objection_timing" }, goto: "step-ack", pipeline: "replied" },
        { when: { intent: "wrong_person" }, goto: "step-referral", pipeline: "replied" },
        { when: { intent: "info_request" }, goto: "step-answer", pipeline: "replied" },
        { when: { intent: "not_interested" }, goto: "step-close", pipeline: "lost" },
        { when: "default", goto: "end-lost" },
      ],
    },
    { id: "step-reframe", type: "step", channel: "email", content: { body: "Value first, {{firstName}}.", threaded: true } },
    { id: "step-ack", type: "step", channel: "email", content: { body: "Understood — later then.", threaded: true } },
    { id: "step-referral", type: "step", channel: "email", content: { body: "Who should I ask?", threaded: true } },
    { id: "step-answer", type: "step", channel: "email", content: { body: "Here is the answer.", threaded: true } },
    { id: "step-close", type: "step", channel: "email", content: { body: "All good — door's open.", threaded: true } },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "branch-reply" },
    { from: "step-reframe", to: "branch-reply" },
    { from: "step-ack", to: "branch-reply" },
    { from: "step-referral", to: "end-lost" },
    { from: "step-answer", to: "branch-reply" },
    { from: "step-close", to: "end-lost" },
  ],
});

const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string }) => ({
      input: goodGraph(params.prompt),
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  },
  embeddings: {
    embed: async (texts: string[]) => ({
      vectors: texts.map(() => new Array(1536).fill(0.001)),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    }),
  },
  config: { maxRetries: 0 },
});

describe.skipIf(!hasDb)("Planner API e2e", () => {
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
      data: { name: `pn-${suffix}`, slug: `pn-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (
      await owner.workspace.create({
        data: { agencyId, name: "PN", slug: `pn-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: wsA, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    await owner.businessContext.create({
      data: {
        workspaceId: wsA,
        agentId: null,
        status: "READY",
        fields: {
          offer: {
            value: `We run a ${FACT} for clinics.`,
            citations: [
              {
                chunkId: "c1",
                sourceId: "s1",
                sourceLabel: "site",
                sourceType: "TEXT",
                locator: "site",
                quote: "q",
              },
            ],
            source: "distilled",
          },
        },
        rawSummary: "brief",
      },
    });

    const u1 = await owner.user.create({
      data: { email: `pn-owner-${suffix}@t.test`, authProviderId: `auth|pn-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsA, role: "OWNER" } });
    const viewer = await owner.user.create({
      data: { email: `pn-viewer-${suffix}@t.test`, authProviderId: `auth|pn-viewer-${suffix}` },
    });
    await owner.membership.create({
      data: { userId: viewer.id, workspaceId: wsA, role: "VIEWER" },
    });
    userIds = [u1.id, viewer.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|pn-owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, {
      sub: `auth|pn-viewer-${suffix}`,
      email: viewer.email,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLAN_ENQUEUER)
      .useFactory({
        factory: (prisma: PrismaService): PlanEnqueuer => ({
          enqueue: async (target: PlanTarget) => {
            await planCampaign({ prisma: prisma.app, gateway }, target);
          },
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
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": wsA });

  it("POST /planner/plan → GET /planner/graph returns the persisted v1 with grounded copy", async () => {
    await request(app.getHttpServer())
      .post("/planner/plan")
      .set(asOwner())
      .send({ agentId })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/planner/graph?agentId=${agentId}`)
      .set(asOwner());
    expect(res.status).toBe(200);
    expect(res.body.campaign.agentId).toBe(agentId);
    expect(res.body.graph.version).toBe(1);
    expect(res.body.graph.source).toBe("AI");
    const copy = JSON.stringify(res.body.graph.graph);
    expect(copy).toContain("{{firstName}}");
    expect(copy).toContain(FACT);
  });

  it("GET /planner/graph with no campaign yet → nulls", async () => {
    const spare = await owner.agent.create({
      data: { workspaceId: wsA, name: "Spare", goal: "custom", guardrails: {} },
    });
    const res = await request(app.getHttpServer())
      .get(`/planner/graph?agentId=${spare.id}`)
      .set(asOwner());
    expect(res.body).toEqual({ campaign: null, graph: null });
  });

  it("unknown agent → 404; VIEWER → 403", async () => {
    await request(app.getHttpServer())
      .post("/planner/plan")
      .set(asOwner())
      .send({ agentId: "nope" })
      .expect(404);
    await request(app.getHttpServer())
      .post("/planner/plan")
      .set({ Authorization: `Bearer ${viewerToken}`, "x-workspace-id": wsA })
      .send({ agentId })
      .expect(403);
  });
});
