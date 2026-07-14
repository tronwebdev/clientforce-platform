/**
 * W3-4 sequence-editor e2e (DEC-076): the graph-versioning semantics and the
 * three-layer manual-edit gate, proven against real Postgres + RLS.
 *
 * Versioning: an enrollment's durable run executes the graph PINNED into its
 * workflow input at start — the capturing fake records exactly what Temporal
 * would pin, and Temporal replays inputs immutably (the workflow never
 * re-fetches; see packages/workflows). So the observable contract proven
 * here — contact A's input stays the v1 graph while contact B starts on the
 * edited v2, with `meta.graphVersion` auditing both — IS the live semantics;
 * the real Temporal walk is covered by the workflows integration tests and
 * the guided send path (compose → checks → boundary → footer-once) by the
 * G1/G2 live proofs, which key off the same `mode`/`brief` node fields these
 * edits write.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute, type CampaignGraph } from "@clientforce/core";
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
  async start(input: CampaignWorkflowInput) {
    const deduped = this.started.some((s) => s.enrollmentId === input.enrollmentId);
    this.started.push(input);
    return { workflowId: `enroll-${input.enrollmentId}`, deduped };
  }
  async signalReply() {
    /* not exercised here */
  }
}

/** The M1b playbook shape the planner emits today (v1, source AI). */
const GRAPH_V1 = {
  entry: "step-1",
  nodes: [
    { id: "step-1", type: "step", channel: "email", content: { subject: "Hello {{company}}", body: "Hi {{firstName}}, most practices lose bookings to phone tag. Our scheduler fills the gaps automatically." } },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    { id: "step-2", type: "step", channel: "email", content: { subject: "Following up", body: "Hi {{firstName}}, clients see 12 extra bookings a month. Setup takes one 20-minute call." } },
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
    { id: "step-reframe", type: "step", channel: "email", content: { body: "Value first.", threaded: true } },
    { id: "step-ack", type: "step", channel: "email", content: { body: "Later then.", threaded: true } },
    { id: "step-referral", type: "step", channel: "email", content: { body: "Who instead?", threaded: true } },
    { id: "step-answer", type: "step", channel: "email", content: { body: "Here's the answer.", threaded: true } },
    { id: "step-close", type: "step", channel: "email", content: { body: "All good.", threaded: true } },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "step-2" },
    { from: "step-2", to: "branch-reply" },
    { from: "step-reframe", to: "end-lost" },
    { from: "step-ack", to: "end-lost" },
    { from: "step-referral", to: "end-lost" },
    { from: "step-answer", to: "end-lost" },
    { from: "step-close", to: "end-lost" },
  ],
};

describe.skipIf(!hasDb)("W3-4 sequence editor e2e (DEC-076)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const engine = new FakeEngine();
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let contactA: string;
  let contactB: string;
  let userIds: string[] = [];
  let ownerToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `seq-${suffix}`, slug: `seq-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "SEQ", slug: `seq-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Editor", goal: "book_appointments", status: "ACTIVE", guardrails: {} },
      })
    ).id;
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "Editor — primary", graphId: "" },
    });
    const g1 = await owner.campaignGraph.create({
      data: { workspaceId: ws, campaignId: campaign.id, version: 1, graph: GRAPH_V1, source: "AI" },
    });
    await owner.campaign.update({ where: { id: campaign.id }, data: { graphId: g1.id } });
    await owner.senderConnection.create({
      data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: "agent@send.clientforce.io", fromName: "Sam" },
    });
    contactA = (
      await owner.contact.create({
        data: { workspaceId: ws, source: "import", optOut: {}, tags: [], email: `a-${suffix}@t.test`, firstName: "Ada" },
      })
    ).id;
    contactB = (
      await owner.contact.create({
        data: { workspaceId: ws, source: "import", optOut: {}, tags: [], email: `b-${suffix}@t.test`, firstName: "Bea" },
      })
    ).id;
    const u1 = await owner.user.create({
      data: { email: `seq-owner-${suffix}@t.test`, authProviderId: `auth|seq-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|seq-owner-${suffix}`, email: u1.email });

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

  it("a mid-sequence enrollment is pinned to the version it enrolled under", async () => {
    const res = await request(app.getHttpServer())
      .post("/enrollments")
      .set(asOwner())
      .send({ agentId, contactId: contactA });
    expect(res.status).toBe(201);
    expect(engine.started).toHaveLength(1);
    expect(engine.started[0]!.graphVersion).toBe(1);
    // DEC-076: the enrolled version is auditable on the row.
    expect((res.body.meta as { graphVersion?: number }).graphVersion).toBe(1);
  });

  it("an edit (add step + flip to guided) persists as v2 MANUAL through the edit gate", async () => {
    const graph = JSON.parse(JSON.stringify(GRAPH_V1)) as CampaignGraph;
    // add a step at the main-sequence end (the mutation helpers' shape)…
    graph.nodes.splice(3, 0,
      { id: "delay-added-1", type: "delay", amount: 2, unit: "days" },
      { id: "step-added-1", type: "step", channel: "email", content: { subject: "Follow-up 3", body: "Hi {{firstName}}, one more thought for {{company}}…" } },
    );
    graph.edges = graph.edges.filter((e) => !(e.from === "step-2" && e.to === "branch-reply"));
    graph.edges.push({ from: "step-2", to: "delay-added-1" }, { from: "delay-added-1", to: "step-added-1" }, { from: "step-added-1", to: "branch-reply" });
    // …and flip step-2 to guided (brief instead of copy).
    graph.nodes = graph.nodes.map((n) =>
      n.id === "step-2" && n.type === "step"
        ? { id: n.id, type: n.type, channel: n.channel, content: {}, mode: "guided" as const, brief: { objective: "Land the value message", talkingPoints: ["12 extra bookings a month on average", "Setup takes one 20-minute call", "Phone-tag losses stop immediately"], subjectHint: "the bookings their phone line is leaking" } }
        : n,
    );
    const res = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.source).toBe("MANUAL");
    expect(res.body.repaired).toEqual([]);
  });

  it("the in-flight enrollment is untouched — its pinned input is still the v1 graph", async () => {
    // The fake captured what Temporal pins immutably into the run's history:
    // v1, WITHOUT the added step, step-2 still scripted.
    const pinned = engine.started[0]!;
    expect(pinned.graphVersion).toBe(1);
    expect(pinned.graph.nodes.some((n) => n.id === "step-added-1")).toBe(false);
    const s2 = pinned.graph.nodes.find((n) => n.id === "step-2");
    expect(s2?.type === "step" && s2.mode).toBeUndefined();
    // The row's audit still says v1.
    const rows = await request(app.getHttpServer()).get(`/enrollments?agentId=${agentId}`).set(asOwner());
    const a = (rows.body as Array<{ contactId: string; meta: { graphVersion?: number } }>).find((r) => r.contactId === contactA);
    expect(a?.meta.graphVersion).toBe(1);
  });

  it("a NEW enrollment starts on the edited v2 graph — and its walk includes the new + guided steps", async () => {
    const res = await request(app.getHttpServer())
      .post("/enrollments")
      .set(asOwner())
      .send({ agentId, contactId: contactB });
    expect(res.status).toBe(201);
    expect(engine.started).toHaveLength(2);
    const input = engine.started[1]!;
    expect(input.graphVersion).toBe(2);
    expect((res.body.meta as { graphVersion?: number }).graphVersion).toBe(2);
    const s2 = input.graph.nodes.find((n) => n.id === "step-2");
    expect(s2?.type === "step" && s2.mode).toBe("guided");
    // The pure executor (the workflow's dry-run twin) walks the edited graph:
    // intro → guided step-2 → added step → branch default → end.
    const actions = execute(input.graph);
    const sends = actions.filter((x) => x.kind === "send").map((x) => x.nodeId);
    expect(sends).toEqual(["step-1", "step-2", "step-added-1"]);
  });

  it("an intentionally-invalid edit is rejected 422 with the precise reason (nothing persists)", async () => {
    // Drop the not_interested playbook case — reply-strategy coverage must
    // never be reduced by a sequence edit.
    const graph = JSON.parse(JSON.stringify(GRAPH_V1)) as CampaignGraph;
    graph.nodes = graph.nodes.map((n) =>
      n.id === "branch-reply" && n.type === "branch"
        ? { ...n, cases: n.cases.filter((c) => c.when === "default" || c.when.intent !== "not_interested") }
        : n,
    );
    const res = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/lost its case for intent "not_interested"/);
    const latest = await request(app.getHttpServer()).get(`/planner/graph?agentId=${agentId}`).set(asOwner());
    expect(latest.body.graph.version).toBe(2); // v2 is still the newest — nothing persisted
  });

  it("the deterministic auto-repair path fixes the unambiguous and reports it", async () => {
    const current = (await request(app.getHttpServer()).get(`/planner/graph?agentId=${agentId}`).set(asOwner())).body.graph.graph as CampaignGraph;
    const messy = {
      ...current,
      edges: [...current.edges, { from: "step-1", to: "delay-1" }, { from: "ghost", to: "step-1" }],
    };
    const res = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph: messy });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body.repaired).toEqual([
      "dropped duplicate edge step-1→delay-1",
      "dropped edge ghost → step-1 (unknown node)",
    ]);
  });

  it("a guided edit with an invalid brief is refused at the SHAPE layer (min 3 talking points → 400)", async () => {
    const current = (await request(app.getHttpServer()).get(`/planner/graph?agentId=${agentId}`).set(asOwner())).body.graph.graph as CampaignGraph;
    const bad = {
      ...current,
      nodes: current.nodes.map((n) =>
        n.id === "step-2" && n.type === "step"
          ? { ...n, brief: { objective: "x", talkingPoints: ["only", "two"] } }
          : n,
      ),
    };
    const res = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph: bad });
    // Layer 1 (zod shape on the DTO) rejects before anything else runs.
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.issues)).toMatch(/talkingPoints/);
  });

  it("sms steps are gated on sender capability (DEC-061) — no Twilio sender, no sms edit", async () => {
    const current = (await request(app.getHttpServer()).get(`/planner/graph?agentId=${agentId}`).set(asOwner())).body.graph.graph as CampaignGraph;
    const withSms = {
      ...current,
      nodes: current.nodes.map((n) =>
        n.id === "step-1" && n.type === "step" ? { ...n, channel: "sms" as const, content: { body: "Hi {{firstName}} — quick nudge." } } : n,
      ),
    };
    const res = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph: withSms });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/can't send on yet/);
  });
});
