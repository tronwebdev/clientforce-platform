/**
 * Enrollments API e2e (P1.6): enrolling creates the row + starts ONE workflow
 * (id `enroll-<enrollmentId>`, double-enroll is a no-op), listing scopes by
 * agent, signal-reply reaches the engine, RBAC enforced. The engine is a
 * capturing fake — the real Temporal path is covered by the workflows package
 * integration tests + the live proof.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import type { CampaignWorkflowInput } from "@clientforce/workflows";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { WORKFLOW_ENGINE, type WorkflowEngine } from "../src/enrollments/workflow-engine";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

class FakeEngine implements WorkflowEngine {
  started: CampaignWorkflowInput[] = [];
  signals: Array<{ enrollmentId: string; intent: string }> = [];
  async start(input: CampaignWorkflowInput) {
    const deduped = this.started.some((s) => s.enrollmentId === input.enrollmentId);
    this.started.push(input);
    return { workflowId: `enroll-${input.enrollmentId}`, deduped };
  }
  async signalReply(enrollmentId: string, intent: string) {
    this.signals.push({ enrollmentId, intent });
  }
}

const GRAPH = {
  entry: "s1",
  nodes: [
    { id: "s1", type: "step", channel: "email", content: { subject: "Hi {{firstName}}", body: "b" } },
    { id: "d1", type: "delay", amount: 2, unit: "days" },
    { id: "s2", type: "step", channel: "email", content: { subject: "x", body: "c", threaded: true } },
    {
      id: "br",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-a", pipeline: "booked" },
        { when: "default", goto: "end-b" },
      ],
    },
    { id: "end-a", type: "end" },
    { id: "end-b", type: "end" },
  ],
  edges: [
    { from: "s1", to: "d1" },
    { from: "d1", to: "s2" },
    { from: "s2", to: "br" },
  ],
};

describe.skipIf(!hasDb)("Enrollments API e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const engine = new FakeEngine();
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let bareAgentId: string;
  let contactId: string;
  let senderId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `enr-${suffix}`, slug: `enr-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "ENR", slug: `enr-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    // An agent with no campaign/graph — proves the 422 planning gate.
    bareAgentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Unplanned", goal: "generate_leads", guardrails: {} },
      })
    ).id;
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "Booker — primary", graphId: "" },
    });
    await owner.campaignGraph.create({
      data: { workspaceId: ws, campaignId: campaign.id, version: 1, graph: GRAPH, source: "AI" },
    });
    senderId = (
      await owner.senderConnection.create({
        data: {
          workspaceId: ws,
          type: "CF_MANAGED",
          fromEmail: "agent@send.clientforce.io",
          fromName: "Sam Rivers",
        },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "import",
          optOut: {},
          tags: [],
          email: `lead-${suffix}@t.test`,
          firstName: "Dara",
        },
      })
    ).id;

    const u1 = await owner.user.create({
      data: { email: `enr-owner-${suffix}@t.test`, authProviderId: `auth|enr-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const viewer = await owner.user.create({
      data: { email: `enr-viewer-${suffix}@t.test`, authProviderId: `auth|enr-viewer-${suffix}` },
    });
    await owner.membership.create({ data: { userId: viewer.id, workspaceId: ws, role: "VIEWER" } });
    userIds = [u1.id, viewer.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|enr-owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, {
      sub: `auth|enr-viewer-${suffix}`,
      email: viewer.email,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WORKFLOW_ENGINE)
      .useValue(engine)
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

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });
  let enrollmentId: string;

  it("POST /enrollments creates the row and starts the workflow with the persisted graph", async () => {
    const res = await request(app.getHttpServer())
      .post("/enrollments")
      .set(asOwner())
      .send({ agentId, contactId });
    expect(res.status).toBe(201);
    enrollmentId = res.body.id;
    expect(res.body.workflowId).toBe(`enroll-${enrollmentId}`);
    expect(res.body.workflowDeduped).toBe(false);
    expect(res.body.pipelineStage).toBe("new");

    expect(engine.started).toHaveLength(1);
    const input = engine.started[0];
    expect(input).toMatchObject({ workspaceId: ws, agentId, contactId, senderId });
    expect(input.graph.entry).toBe("s1");
    expect(input.graph.nodes).toHaveLength(6);
  });

  it("double-enroll is a no-op: same enrollment id, workflow start deduped by id", async () => {
    const res = await request(app.getHttpServer())
      .post("/enrollments")
      .set(asOwner())
      .send({ agentId, contactId });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(enrollmentId);
    expect(res.body.workflowDeduped).toBe(true);
    const rows = await owner.enrollment.findMany({ where: { workspaceId: ws } });
    expect(rows).toHaveLength(1);
  });

  it("enrolling on an unplanned agent is refused (422) — plan first (P1.4)", async () => {
    const res = await request(app.getHttpServer())
      .post("/enrollments")
      .set(asOwner())
      .send({ agentId: bareAgentId, contactId });
    expect(res.status).toBe(422);
  });

  it("GET /enrollments?agentId= lists with contact summaries", async () => {
    const res = await request(app.getHttpServer())
      .get("/enrollments")
      .query({ agentId })
      .set(asOwner());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].contact).toMatchObject({ firstName: "Dara" });
  });

  it("POST /enrollments/:id/signal-reply delivers the intent to the engine", async () => {
    const res = await request(app.getHttpServer())
      .post(`/enrollments/${enrollmentId}/signal-reply`)
      .set(asOwner())
      .send({ intent: "interested" });
    expect(res.status).toBe(201);
    expect(engine.signals).toEqual([{ enrollmentId, intent: "interested" }]);

    await request(app.getHttpServer())
      .post(`/enrollments/does-not-exist/signal-reply`)
      .set(asOwner())
      .send({ intent: "interested" })
      .expect(404);
  });

  it("a VIEWER cannot enroll or signal → 403", async () => {
    const viewer = { Authorization: `Bearer ${viewerToken}`, "x-workspace-id": ws };
    await request(app.getHttpServer())
      .post("/enrollments")
      .set(viewer)
      .send({ agentId, contactId })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/enrollments/${enrollmentId}/signal-reply`)
      .set(viewer)
      .send({ intent: "interested" })
      .expect(403);
  });
});
