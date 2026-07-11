/**
 * F1 (DEC-068) — `GET /agents/:id/outcomes` e2e: the rollup payload carries
 * per-step sent/delivered/reply/positive/opt-out with the min-n signal gates
 * baked in (none <20 · low 20–49 · ok ≥50), goal completions attribute to the
 * SEQUENCE only, and RLS scopes the read (a foreign-workspace agent is 404).
 * Requires Postgres; skips without infra.
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

const GRAPH = {
  entry: "step-1",
  nodes: [
    { id: "step-1", type: "step", channel: "email", content: { subject: "a {{firstName}}", body: "a {{company}}" } },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    { id: "step-2", type: "step", channel: "email", content: { subject: "b", body: "b" } },
    { id: "delay-2", type: "delay", amount: 3, unit: "days" },
    { id: "step-3", type: "step", channel: "email", content: { subject: "c", body: "c" } },
    {
      id: "branch-reply",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
        { when: "default", goto: "end-lost" },
      ],
    },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "step-2" },
    { from: "delay-2", to: "step-3" },
    { from: "step-2", to: "delay-2" },
    { from: "step-3", to: "branch-reply" },
  ],
};

describe.skipIf(!hasDb)("Outcomes rollup e2e (F1, DEC-068)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let wsForeign: string;
  let agentId: string;
  let bareAgentId: string;
  let foreignAgentId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `out-${suffix}`, slug: `out-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "OUT", slug: `out-${suffix}`, settings: {} },
      })
    ).id;
    wsForeign = (
      await owner.workspace.create({
        data: { agencyId, name: "OUTF", slug: `outf-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    bareAgentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Fresh", goal: "generate_leads", guardrails: {} },
      })
    ).id;
    foreignAgentId = (
      await owner.agent.create({
        data: { workspaceId: wsForeign, name: "Other", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "Booker — primary", graphId: "" },
    });
    await owner.campaignGraph.create({
      data: { workspaceId: ws, campaignId: campaign.id, version: 3, graph: GRAPH, source: "AI" },
    });

    // Ledger: 50 sends on step-1 (ok; 2 repliers, 1 interested, 1 delivered),
    // 20 on step-2 (low; 1 opt-out), 5 on step-3 (none — rates must be null).
    const base = Date.now() - 86_400_000;
    const cid = (t: string, i: number) => `oc-${t}${i}-${suffix}`;
    const mid = (t: string, i: number) => `om-${t}${i}-${suffix}`;
    const spec = [
      { step: "step-1", tag: "a", n: 50 },
      { step: "step-2", tag: "b", n: 20 },
      { step: "step-3", tag: "c", n: 5 },
    ];
    const contacts = [];
    const messages = [];
    for (const { step, tag, n } of spec) {
      for (let i = 0; i < n; i++) {
        contacts.push({
          id: cid(tag, i),
          workspaceId: ws,
          source: "import",
          optOut: {},
          tags: [],
          email: `oc-${tag}${i}-${suffix}@t.test`,
        });
        messages.push({
          id: mid(tag, i),
          workspaceId: ws,
          campaignId: campaign.id,
          contactId: cid(tag, i),
          channel: "email",
          direction: "OUTBOUND" as const,
          subject: "s",
          body: "b",
          stepNodeId: step,
          sentAt: new Date(base + i * 1000),
        });
      }
    }
    await owner.contact.createMany({ data: contacts });
    await owner.message.createMany({ data: messages });

    await owner.event.create({
      data: {
        workspaceId: ws,
        type: "email.delivered.v1",
        contactId: cid("a", 0),
        campaignId: campaign.id,
        payload: { messageId: mid("a", 0) },
        occurredAt: new Date(base + 5_000),
      },
    });
    for (const r of [
      { i: 0, intent: "interested" },
      { i: 1, intent: "replied" },
    ]) {
      const rid = `or-${r.i}-${suffix}`;
      await owner.message.create({
        data: {
          id: rid,
          workspaceId: ws,
          campaignId: campaign.id,
          contactId: cid("a", r.i),
          channel: "email",
          direction: "INBOUND",
          body: "re",
          inReplyToId: mid("a", r.i),
          intent: r.intent,
          sentAt: new Date(base + 100_000 + r.i * 1000),
        },
      });
      await owner.event.create({
        data: {
          workspaceId: ws,
          type: "email.replied.v1",
          contactId: cid("a", r.i),
          campaignId: campaign.id,
          payload: { messageId: rid, intent: r.intent },
          occurredAt: new Date(base + 100_000 + r.i * 1000),
        },
      });
    }
    // Bulk-unsub on a lead whose enrollment is not ACTIVE/PAUSED stamps ONLY
    // contactId (contacts-view emitter) — proves the contact-scoped opt-out
    // fetch arm. Second lead on step-2.
    await owner.event.create({
      data: {
        workspaceId: ws,
        type: "lead.unsubscribed.v1",
        contactId: cid("b", 1),
        payload: { source: "contacts-bulk" },
        occurredAt: new Date(base + 250_000),
      },
    });
    // Opt-out from the unsubscribe-reply path: NO campaignId on the event —
    // proves the enrollment-scoped fetch (F1 plan §0.3).
    const enrollment = await owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: cid("b", 0),
        workflowId: `enroll-out-${suffix}`,
        status: "UNSUBSCRIBED",
        pipelineStage: "new",
      },
    });
    await owner.event.create({
      data: {
        workspaceId: ws,
        type: "lead.unsubscribed.v1",
        contactId: cid("b", 0),
        enrollmentId: enrollment.id,
        payload: { channel: "email" },
        occurredAt: new Date(base + 200_000),
      },
    });
    // Goal completion after N touches — SEQUENCE attribution, never a step.
    await owner.event.create({
      data: {
        workspaceId: ws,
        type: "lead.stage_changed.v1",
        contactId: cid("a", 0),
        campaignId: campaign.id,
        payload: { fromStage: "replied", toStage: "booked", goalKey: "book_appointments", label: "Meeting booked" },
        occurredAt: new Date(base + 300_000),
      },
    });

    const user = await owner.user.create({
      data: { email: `out-${suffix}@t.test`, authProviderId: `auth|out-${suffix}` },
    });
    userId = user.id;
    await owner.membership.create({ data: { userId, workspaceId: ws, role: "OWNER" } });
    token = await signDevToken(SECRET, { sub: `auth|out-${suffix}`, email: user.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner.user.delete({ where: { id: userId } }).catch(() => {});
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
  });

  const get = (id: string) =>
    request(app.getHttpServer())
      .get(`/agents/${id}/outcomes`)
      .set({ Authorization: `Bearer ${token}`, "x-workspace-id": ws });

  it("returns per-step rollups with the min-n signal gates baked into the payload", async () => {
    const res = await get(agentId);
    expect(res.status).toBe(200);
    expect(res.body.thresholds).toEqual({ low: 20, ok: 50 });
    expect(res.body.graphVersion).toBe(3);

    const step = (id: string) => res.body.steps.find((s: { stepNodeId: string }) => s.stepNodeId === id);
    const [s1, s2, s3] = [step("step-1"), step("step-2"), step("step-3")];

    expect(s1).toMatchObject({
      channel: "email",
      sent: 50,
      delivered: 1,
      replies: 2,
      positiveReplies: 1,
      optOuts: 0,
      replyRatePct: 4,
      positiveRatePct: 2,
      optOutRatePct: 0,
      signal: "ok",
    });
    // 2 opt-outs: one via the enrollment fetch arm, one via the contact-only
    // arm (bulk-unsub emitter stamps neither campaignId nor enrollmentId).
    expect(s2).toMatchObject({ sent: 20, replies: 0, optOuts: 2, optOutRatePct: 10, signal: "low" });
    // Below the floor: raw counts stay, every rate is null — no UI can render one.
    expect(s3).toMatchObject({ sent: 5, signal: "none", replyRatePct: null, positiveRatePct: null, optOutRatePct: null });

    // Goal completion: SEQUENCE only — totals carry it, no step row has the field.
    expect(res.body.totals).toMatchObject({ sent: 75, replies: 2, optOuts: 2, goalCompletions: 1, signal: "ok" });
    expect(s1).not.toHaveProperty("goalCompletions");
  });

  it("a malformed stored graph never breaks the rollup — steps empty, totals still honest", async () => {
    const brokenAgent = await owner.agent.create({
      data: { workspaceId: ws, name: "Broken graph", goal: "book_appointments", guardrails: {} },
    });
    const brokenCampaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId: brokenAgent.id, name: "Broken — primary", graphId: "" },
    });
    await owner.campaignGraph.create({
      data: {
        workspaceId: ws,
        campaignId: brokenCampaign.id,
        version: 1,
        graph: { nodes: "not-a-graph" },
        source: "MANUAL",
      },
    });
    await owner.contact.create({
      data: { id: `oc-x0-${suffix}`, workspaceId: ws, source: "import", optOut: {}, tags: [], email: `oc-x0-${suffix}@t.test` },
    });
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId: brokenCampaign.id,
        contactId: `oc-x0-${suffix}`,
        channel: "email",
        direction: "OUTBOUND",
        body: "b",
        stepNodeId: "step-ghost",
        sentAt: new Date(),
      },
    });
    const res = await get(brokenAgent.id);
    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([]); // no renderable cards from a graph that can't parse
    expect(res.body.totals).toMatchObject({ sent: 1, signal: "none" }); // the ledger still counts
  });

  it("an agent with no campaign reports honest zeros (never 404)", async () => {
    const res = await get(bareAgentId);
    expect(res.status).toBe(200);
    expect(res.body.campaignId).toBeNull();
    expect(res.body.steps).toEqual([]);
    expect(res.body.totals).toMatchObject({ sent: 0, signal: "none", goalCompletions: 0 });
  });

  it("RLS: a foreign-workspace agent is not found", async () => {
    const res = await get(foreignAgentId);
    expect(res.status).toBe(404);
  });

  it("requires auth", async () => {
    const res = await request(app.getHttpServer()).get(`/agents/${agentId}/outcomes`);
    expect(res.status).toBe(401);
  });
});
