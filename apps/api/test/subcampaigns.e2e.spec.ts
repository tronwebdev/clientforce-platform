/**
 * #90 (DEC-077) sub-campaign creation e2e: the branch-creation mutation as
 * ONE atomic decision against real Postgres + RLS — the graph gains its
 * SubcampaignNode-headed chain as the next MANUAL version through the same
 * three-layer gate as every edit (with the creator's explicit "admit-new"
 * carve-out), and the entry trigger — R1's `campaignRuleTriggerSchema`
 * verbatim — lands as a `CampaignRule` row whose terminal `move_to_node`
 * targets the container. A 422 persists NEITHER row (one `withTenant`
 * transaction). The engine fake records exactly what Temporal pins, so the
 * "new enrollments carry the container" assertion is the live semantics
 * (DEC-076); the durable walk + real trigger fire is W3's staging proof.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeStep, type CampaignGraph } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, withTenant, type PrismaClient } from "@clientforce/db";
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

/** The M1b playbook shape (the sequence-editor spec's fixture, verbatim). */
const GRAPH_V1 = {
  entry: "step-1",
  nodes: [
    { id: "step-1", type: "step", channel: "email", content: { subject: "Hello {{company}}", body: "Hi {{firstName}}, most practices lose bookings to phone tag." } },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    { id: "step-2", type: "step", channel: "email", content: { subject: "Following up", body: "Hi {{firstName}}, clients see 12 extra bookings a month." } },
    {
      id: "branch-reply",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
        { when: { intent: "objection_price" }, goto: "step-reframe", pipeline: "replied" },
        { when: "default", goto: "end-lost" },
      ],
    },
    { id: "step-reframe", type: "step", channel: "email", content: { body: "Value first.", threaded: true } },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "step-2" },
    { from: "step-2", to: "branch-reply" },
    { from: "step-reframe", to: "end-lost" },
  ],
};

describe.skipIf(!hasDb)("#90 sub-campaign creation e2e (DEC-077)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  const engine = new FakeEngine();
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let subcampaignId = "";

  let appClient: PrismaClient;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    appClient = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `sub-${suffix}`, slug: `sub-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "SUB", slug: `sub-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Brancher", goal: "book_appointments", status: "ACTIVE", guardrails: {} },
      })
    ).id;
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "Brancher — primary", graphId: "" },
    });
    campaignId = campaign.id;
    const g1 = await owner.campaignGraph.create({
      data: { workspaceId: ws, campaignId, version: 1, graph: GRAPH_V1, source: "AI" },
    });
    await owner.campaign.update({ where: { id: campaignId }, data: { graphId: g1.id } });
    await owner.senderConnection.create({
      data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: "agent@send.clientforce.io", fromName: "Sam" },
    });
    contactId = (
      await owner.contact.create({
        data: { workspaceId: ws, source: "import", optOut: {}, tags: [], email: `c-${suffix}@t.test`, firstName: "Cam" },
      })
    ).id;
    const u1 = await owner.user.create({
      data: { email: `sub-owner-${suffix}@t.test`, authProviderId: `auth|sub-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|sub-owner-${suffix}`, email: u1.email });

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
    await appClient?.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });
  const latestVersion = async () =>
    (await owner.campaignGraph.findFirstOrThrow({ where: { campaignId }, orderBy: { version: "desc" } })).version;
  const ruleCount = () => owner.campaignRule.count({ where: { campaignId } });

  it("creates the branch atomically: MANUAL v2 + pointer + the R1 entry rule targeting the container", async () => {
    const res = await request(app.getHttpServer())
      .post("/planner/subcampaign")
      .set(asOwner())
      .send({
        agentId,
        name: "Interested follow-up",
        trigger: { kind: "reply_classified", intents: ["interested"] },
        seed: [
          { channel: "email", content: { subject: "Booking?", body: "Hi {{firstName}}, grab a slot." } },
          { channel: "email", content: { body: "Still open, {{firstName}}.", threaded: true }, delayDays: 3 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(2);
    expect(res.body.source).toBe("MANUAL");
    expect(res.body.repaired).toEqual([]);
    expect(res.body.subcampaignId).toBe("subcampaign-added-1");
    expect(res.body.stepIds).toEqual(["step-added-1", "step-added-2"]);
    subcampaignId = res.body.subcampaignId as string;

    // The container landed in the persisted graph, named, chain + own end.
    const graph = res.body.graph as CampaignGraph;
    expect(graph.nodes.find((n) => n.id === subcampaignId)).toMatchObject({
      type: "subcampaign",
      ref: "Interested follow-up",
    });
    expect(graph.nodes.some((n) => n.id === "end-added-1")).toBe(true);

    // The pointer moved…
    const campaign = await owner.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.graphId).toBe(res.body.id);
    // …and the rule row is R1's vocabulary verbatim, moving into the container.
    const rules = await owner.campaignRule.findMany({ where: { campaignId } });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      order: 1,
      enabled: true,
      trigger: { kind: "reply_classified", intents: ["interested"] },
      actions: [{ kind: "move_to_node", targetNodeId: subcampaignId }],
    });
    expect(res.body.ruleId).toBe(rules[0]!.id);
  });

  it("a NEW enrollment pins the edited graph — the container rides the workflow input (DEC-076 semantics)", async () => {
    const res = await request(app.getHttpServer())
      .post("/enrollments")
      .set(asOwner())
      .send({ agentId, contactId });
    expect(res.status).toBe(201);
    const input = engine.started[0]!;
    expect(input.graphVersion).toBe(2);
    expect(input.graph.nodes.some((n) => n.id === subcampaignId)).toBe(true);
  });

  it("a duplicate trigger refuses 422 — and persists NEITHER a graph version NOR a rule", async () => {
    const before = await latestVersion();
    const res = await request(app.getHttpServer())
      .post("/planner/subcampaign")
      .set(asOwner())
      .send({
        agentId,
        name: "Interested again",
        trigger: { kind: "reply_classified", intents: ["interested"] },
      });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/already enters on this trigger/);
    expect(await latestVersion()).toBe(before);
    expect(await ruleCount()).toBe(1);
  });

  it("an overlapping-but-different trigger coexists (R1 row order arbitrates) — order appends", async () => {
    const res = await request(app.getHttpServer())
      .post("/planner/subcampaign")
      .set(asOwner())
      .send({
        agentId,
        name: "Hot replies",
        trigger: { kind: "reply_classified", intents: ["interested", "booked"] },
      });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(3);
    expect(res.body.subcampaignId).toBe("subcampaign-added-2");
    const rules = await owner.campaignRule.findMany({ where: { campaignId }, orderBy: { order: "asc" } });
    expect(rules.map((r) => r.order)).toEqual([1, 2]);
  });

  it("intents outside the taxonomy refuse at the API boundary (R1's documented contract)", async () => {
    const before = await latestVersion();
    const res = await request(app.getHttpServer())
      .post("/planner/subcampaign")
      .set(asOwner())
      .send({
        agentId,
        name: "Mystery",
        trigger: { kind: "reply_classified", intents: ["interested", "totally_made_up"] },
      });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/totally_made_up/);
    expect(await latestVersion()).toBe(before);
    expect(await ruleCount()).toBe(2);
  });

  it("a seed on a channel the workspace can't send refuses 422 through the gate — nothing persists", async () => {
    const before = await latestVersion();
    const res = await request(app.getHttpServer())
      .post("/planner/subcampaign")
      .set(asOwner())
      .send({
        agentId,
        name: "SMS nudge",
        trigger: { kind: "sequence_quiet", days: 30 },
        seed: [{ channel: "sms", content: { body: "Hi {{firstName}} — nudge." } }],
      });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/can't send on yet/);
    expect(await latestVersion()).toBe(before);
    expect(await ruleCount()).toBe(2);
  });

  it("the shape layer rejects a malformed trigger outright (400, layer 1)", async () => {
    const res = await request(app.getHttpServer())
      .post("/planner/subcampaign")
      .set(asOwner())
      .send({ agentId, name: "No trigger", trigger: { kind: "when_pigs_fly" } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.issues)).toMatch(/trigger/);
  });

  it("a raw PUT can't smuggle a NEW container in (the preserve rail) — but graphs that HAVE one keep editing", async () => {
    const current = (
      await request(app.getHttpServer()).get(`/planner/graph?agentId=${agentId}`).set(asOwner())
    ).body.graph.graph as CampaignGraph;

    // Smuggle: an extra orphan container without the creator (no entry rule).
    const smuggled: CampaignGraph = {
      ...current,
      nodes: [
        ...current.nodes,
        { id: "sub-smuggled", type: "subcampaign", ref: "No trigger" },
        { id: "end-smuggled", type: "end" },
      ],
      edges: [...current.edges, { from: "sub-smuggled", to: "end-smuggled" }],
    };
    const refused = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph: smuggled });
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toMatch(/created through "Add a sub-campaign"/);

    // Ordinary edits on the stored graph (which contains sub-campaigns) pass.
    const edited: CampaignGraph = {
      ...current,
      nodes: current.nodes.map((n) =>
        n.id === "step-added-1" && n.type === "step"
          ? { ...n, content: { ...n.content, body: "Hi {{firstName}}, updated booking note." } }
          : n,
      ),
    };
    const ok = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph: edited });
    expect(ok.status).toBe(200);
    expect(ok.body.source).toBe("MANUAL");
  });

  it("a PUT that drops a stored container refuses 422 — rules route contacts into it", async () => {
    const current = (
      await request(app.getHttpServer()).get(`/planner/graph?agentId=${agentId}`).set(asOwner())
    ).body.graph.graph as CampaignGraph;
    const dropped: CampaignGraph = {
      ...current,
      nodes: current.nodes.filter(
        (n) => n.id !== subcampaignId && n.id !== "step-added-1" && n.id !== "delay-added-1" && n.id !== "step-added-2" && n.id !== "end-added-1",
      ),
      edges: current.edges.filter(
        (e) =>
          ![subcampaignId, "step-added-1", "delay-added-1", "step-added-2"].includes(e.from) &&
          ![subcampaignId, "step-added-1", "delay-added-1", "step-added-2", "end-added-1"].includes(e.to),
      ),
    };
    const res = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph: dropped });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/can't remove the sub-campaign "Interested follow-up"/);
  });

  it("a PUT that removes a node an enabled rule moves contacts to refuses 422 — no edit can orphan a trigger", async () => {
    // A rule targeting a CHAIN step (not the container — that's already
    // preserved): the general rule-target guard must hold for any node.
    const chainRule = await owner.campaignRule.create({
      data: {
        workspaceId: ws,
        campaignId,
        order: 90,
        trigger: { kind: "meeting_booked" },
        actions: [{ kind: "move_to_node", targetNodeId: "step-added-1" }],
        enabled: true,
      },
    });
    const current = (
      await request(app.getHttpServer()).get(`/planner/graph?agentId=${agentId}`).set(asOwner())
    ).body.graph.graph as CampaignGraph;
    // The REAL mutation removes the step cleanly — only the rule reference
    // makes this edit unsafe, and only the gate can see that.
    const removed = removeStep(current, "step-added-1");
    const refused = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph: removed });
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toMatch(/an automation rule moves contacts to it/);
    // Disable the rule → the same edit passes (retarget-or-disable path).
    await owner.campaignRule.update({ where: { id: chainRule.id }, data: { enabled: false } });
    const ok = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({ agentId, graph: removed });
    expect(ok.status).toBe(200);
  });

  it("the branch and its rule land in ONE transaction — a mid-write failure persists neither (the withTenant mechanism, pinned)", async () => {
    const versionBefore = await latestVersion();
    const rulesBefore = await ruleCount();
    await expect(
      withTenant(appClient, { workspaceId: ws }, async (tx) => {
        await tx.campaignGraph.create({
          data: { workspaceId: ws, campaignId, version: 99, source: "MANUAL", graph: GRAPH_V1 },
        });
        await tx.campaignRule.create({
          data: {
            workspaceId: ws,
            campaignId,
            order: 99,
            trigger: { kind: "meeting_booked" },
            actions: [{ kind: "move_to_node", targetNodeId: "subcampaign-added-1" }],
            enabled: true,
          },
        });
        // Both writes are in — now the transaction dies mid-flight, exactly
        // the failure the endpoint's single tenant.run guards against.
        throw new Error("mid-write failure");
      }),
    ).rejects.toThrow("mid-write failure");
    expect(await owner.campaignGraph.count({ where: { campaignId, version: 99 } })).toBe(0);
    expect(await owner.campaignRule.count({ where: { campaignId, order: 99 } })).toBe(0);
    expect(await latestVersion()).toBe(versionBefore);
    expect(await ruleCount()).toBe(rulesBefore);
  });
});
