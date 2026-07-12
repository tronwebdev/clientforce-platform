/**
 * Agents API e2e (C2.2): list with live metrics (RLS-scoped), status/rename
 * mutations, delete, RBAC. Skips without Postgres.
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

describe.skipIf(!hasDb)("Agents API e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let wsB: string;
  let agentId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `ag-${suffix}`, slug: `ag-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "A", slug: `ag-a-${suffix}`, settings: {} },
      })
    ).id;
    wsB = (
      await owner.workspace.create({
        data: { agencyId, name: "B", slug: `ag-b-${suffix}`, settings: {} },
      })
    ).id;

    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Booker", goal: "book_appointments", status: "ACTIVE", guardrails: {} },
    });
    agentId = agent.id;
    // A second workspace's agent must NEVER appear in ws A's list (RLS).
    await owner.agent.create({
      data: { workspaceId: wsB, name: "Other", goal: "generate_leads", guardrails: {} },
    });

    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "primary", graphId: "" },
    });
    await owner.campaignGraph.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        version: 1,
        source: "AI",
        graph: {
          entry: "s1",
          nodes: [
            { id: "s1", type: "step", channel: "email", content: { subject: "a", body: "b" } },
            { id: "d1", type: "delay", amount: 1, unit: "days" },
            { id: "s2", type: "step", channel: "email", content: { subject: "a", body: "c" } },
            { id: "e", type: "end" },
          ],
          edges: [
            { from: "s1", to: "d1" },
            { from: "d1", to: "s2" },
            { from: "s2", to: "e" },
          ],
        },
      },
    });
    const contact = await owner.contact.create({
      data: { workspaceId: ws, source: "t", optOut: {}, tags: [], email: `l-${suffix}@t.test` },
    });
    const enrollment = await owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: contact.id,
        workflowId: `enroll-ag-${suffix}`,
        pipelineStage: "booked",
        meta: {},
      },
    });
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        enrollmentId: enrollment.id,
        contactId: contact.id,
        channel: "email",
        direction: "INBOUND",
        body: "reply",
        sentAt: new Date(),
      },
    });
    await owner.senderConnection.create({
      data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: "a@send.clientforce.io", fromName: "S" },
    });

    const u1 = await owner.user.create({
      data: { email: `ag-owner-${suffix}@t.test`, authProviderId: `auth|ag-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const viewer = await owner.user.create({
      data: { email: `ag-viewer-${suffix}@t.test`, authProviderId: `auth|ag-viewer-${suffix}` },
    });
    await owner.membership.create({ data: { userId: viewer.id, workspaceId: ws, role: "VIEWER" } });
    userIds = [u1.id, viewer.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|ag-owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, { sub: `auth|ag-viewer-${suffix}`, email: viewer.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: { in: [ws, wsB] } } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  it("GET /agents returns live metrics, workspace-scoped (RLS)", async () => {
    const res = await request(app.getHttpServer()).get("/agents").set(asOwner());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1); // never workspace B's agent
    expect(res.body[0]).toMatchObject({
      id: agentId,
      name: "Booker",
      status: "ACTIVE",
      channels: ["email"],
      contacts: 1,
      replies: 1,
      bookings: 1,
      steps: 2,
      health: "Good",
    });
  });

  it("PATCH /agents/:id updates status + name; DELETE removes", async () => {
    const paused = await request(app.getHttpServer())
      .patch(`/agents/${agentId}`)
      .set(asOwner())
      .send({ status: "PAUSED", name: "Booker 2" });
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ status: "PAUSED", name: "Booker 2" });

    await request(app.getHttpServer())
      .patch(`/agents/${agentId}`)
      .set(asOwner())
      .send({ status: "NOPE" })
      .expect(400);
  });

  it("M1a (DEC-065): category persists at create, survives /draft, and locks after DRAFT", async () => {
    // Create through the wizard's path — category lands on the row.
    const created = await request(app.getHttpServer())
      .post("/agents")
      .set(asOwner())
      .send({ name: "Crafted", goal: "book_appointments", category: "Dental & Orthodontics" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "DRAFT", category: "Dental & Orthodontics" });
    const id = created.body.id as string;

    // Unknown categories are rejected (the vocabulary is the core enum).
    await request(app.getHttpServer())
      .post("/agents")
      .set(asOwner())
      .send({ name: "Bad", goal: "book_appointments", category: "Not A Category" })
      .expect(400);

    // The resume hydration payload carries it.
    const draft = await request(app.getHttpServer()).get(`/agents/${id}/draft`).set(asOwner());
    expect(draft.body.category).toBe("Dental & Orthodontics");

    // While DRAFT the wizard may re-pick…
    await request(app.getHttpServer())
      .patch(`/agents/${id}`)
      .set(asOwner())
      .send({ category: "Home Services" })
      .expect(200);

    // …but once launched the arc input is frozen (derive at creation).
    await request(app.getHttpServer()).patch(`/agents/${id}`).set(asOwner()).send({ status: "ACTIVE" });
    await request(app.getHttpServer())
      .patch(`/agents/${id}`)
      .set(asOwner())
      .send({ category: "Real Estate" })
      .expect(400);

    await request(app.getHttpServer()).delete(`/agents/${id}`).set(asOwner()).expect(200);
  });

  it("M1a (DEC-065): a guardrails PATCH with a strategy block round-trips through the A8 schema", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/agents/${agentId}`)
      .set(asOwner())
      .send({
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
          dailyCap: { email: 200 },
          consent: null,
          strategy: { strategyNotes: "Lead with the audit.", neverSay: ["cheap", "guarantee"] },
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.guardrails.strategy).toEqual({
      strategyNotes: "Lead with the audit.",
      neverSay: ["cheap", "guarantee"],
    });

    // An over-cap block is a validation error, not a silent trim.
    await request(app.getHttpServer())
      .patch(`/agents/${agentId}`)
      .set(asOwner())
      .send({
        guardrails: {
          sendingWindow: { days: [1], start: "09:00", end: "17:00", timezone: "UTC" },
          dailyCap: { email: 200 },
          consent: null,
          strategy: { neverSay: Array.from({ length: 11 }, (_, i) => `t${i}`) },
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      })
      .expect(400); // PRESENT-yet-invalid never widens — designed 400 (DEC-065)
  });

  it("L1 (DEC-072): a guardrails PATCH that OMITS language preserves the system-written rider; sending it writes it", async () => {
    const base = {
      sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 200 },
      consent: null,
      unsubscribeFooter: true,
      suppressionCheck: true,
    };
    // The distiller detected German mid-wizard (system write, not via PATCH).
    const detected = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Termine",
        goal: "book_appointments",
        status: "DRAFT",
        guardrails: { ...base, language: "de", languageSource: "detected" },
      },
    });

    // The wizard's step-5 rebuild sends guardrails WITHOUT language — the
    // detection must survive (the anti-clobber rule).
    const rebuilt = await request(app.getHttpServer())
      .patch(`/agents/${detected.id}`)
      .set(asOwner())
      .send({ guardrails: { ...base, dailyCap: { email: 150 } } });
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.guardrails.language).toBe("de");
    expect(rebuilt.body.guardrails.languageSource).toBe("detected");
    expect(rebuilt.body.guardrails.dailyCap.email).toBe(150);

    // The Settings Language row SENDS language — written as given (owner wins).
    const flipped = await request(app.getHttpServer())
      .patch(`/agents/${detected.id}`)
      .set(asOwner())
      .send({ guardrails: { ...base, language: "fr", languageSource: "owner" } });
    expect(flipped.status).toBe(200);
    expect(flipped.body.guardrails.language).toBe("fr");
    expect(flipped.body.guardrails.languageSource).toBe("owner");

    // A language outside the launch list is a designed 400 (A8 discipline).
    await request(app.getHttpServer())
      .patch(`/agents/${detected.id}`)
      .set(asOwner())
      .send({ guardrails: { ...base, language: "sv" } })
      .expect(400);

    await request(app.getHttpServer()).delete(`/agents/${detected.id}`).set(asOwner()).expect(200);
  });

  it("G3 (DEC-075): a guardrails PATCH that OMITS composeMode preserves the stored rider; sending it writes it; the draft endpoint resolves it", async () => {
    const base = {
      sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 200 },
      consent: null,
      unsubscribeFooter: true,
      suppressionCheck: true,
    };
    const draft = await owner.agent.create({
      data: { workspaceId: ws, name: "Guided draft", goal: "book_appointments", status: "DRAFT", guardrails: {} },
    });

    // Fresh drafts resolve scripted (absent = scripted, no key written).
    const fresh = await request(app.getHttpServer()).get(`/agents/${draft.id}/draft`).set(asOwner());
    expect(fresh.status).toBe(200);
    expect(fresh.body.composeMode).toBe("scripted");

    // The wizard's step-2 control SENDS composeMode — written as given.
    const flipped = await request(app.getHttpServer())
      .patch(`/agents/${draft.id}`)
      .set(asOwner())
      .send({ guardrails: { ...base, composeMode: "guided" } });
    expect(flipped.status).toBe(200);
    expect(flipped.body.guardrails.composeMode).toBe("guided");

    // The wizard's step-5 rebuild sends guardrails WITHOUT composeMode — the
    // mid-wizard flip must survive (the DEC-072 anti-clobber rule extended).
    const rebuilt = await request(app.getHttpServer())
      .patch(`/agents/${draft.id}`)
      .set(asOwner())
      .send({ guardrails: { ...base, dailyCap: { email: 150 } } });
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.guardrails.composeMode).toBe("guided");
    expect(rebuilt.body.guardrails.dailyCap.email).toBe(150);

    // Resume hydration reads the rider resolved server-side.
    const resumed = await request(app.getHttpServer()).get(`/agents/${draft.id}/draft`).set(asOwner());
    expect(resumed.body.composeMode).toBe("guided");

    // Flipping back writes scripted explicitly (never a silent key drop).
    const back = await request(app.getHttpServer())
      .patch(`/agents/${draft.id}`)
      .set(asOwner())
      .send({ guardrails: { ...base, composeMode: "scripted" } });
    expect(back.status).toBe(200);
    expect(back.body.guardrails.composeMode).toBe("scripted");

    await request(app.getHttpServer()).delete(`/agents/${draft.id}`).set(asOwner()).expect(200);
  });

  it("G3 (DEC-075): the inbox surfaces compose provenance ONLY on guided-meta outbound rows", async () => {
    const campaign = await owner.campaign.findFirst({ where: { agentId } });
    const lead = await owner.contact.create({
      data: { workspaceId: ws, source: "t", optOut: {}, tags: [], email: `g3-${suffix}@t.test`, firstName: "Ada" },
    });
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    // A guided composed send (the boundary's pass-through meta, G1/G2)…
    await owner.message.create({
      data: {
        workspaceId: ws, campaignId: campaign!.id, contactId: lead.id, channel: "email",
        direction: "OUTBOUND", subject: "hi", body: "composed text", sentAt: at(30),
        meta: { senderId: "s", mode: "guided", briefVersion: 2, composerVersion: "composer.email@v1" },
      },
    });
    // …a scripted send (no provenance keys)…
    await owner.message.create({
      data: {
        workspaceId: ws, campaignId: campaign!.id, contactId: lead.id, channel: "email",
        direction: "OUTBOUND", subject: "re: hi", body: "scripted text", sentAt: at(20),
        meta: { senderId: "s" },
      },
    });
    // …and the reply that makes it a thread.
    await owner.message.create({
      data: {
        workspaceId: ws, campaignId: campaign!.id, contactId: lead.id, channel: "email",
        direction: "INBOUND", body: "interested!", intent: "interested", sentAt: at(10), meta: {},
      },
    });

    const res = await request(app.getHttpServer()).get(`/agents/${agentId}/inbox`).set(asOwner());
    expect(res.status).toBe(200);
    const thread = res.body.threads.find((t: { contactId: string }) => t.contactId === lead.id);
    expect(thread).toBeTruthy();
    const [composedMsg, scriptedMsg, reply] = thread.messages;
    expect(composedMsg.composed).toEqual({ composerVersion: "composer.email@v1" });
    // Scripted and inbound rows carry NO composed key — unmarked, never inferred.
    expect(scriptedMsg.composed).toBeUndefined();
    expect(reply.composed).toBeUndefined();
  });

  it("a VIEWER can read but not mutate → 403", async () => {
    const viewer = { Authorization: `Bearer ${viewerToken}`, "x-workspace-id": ws };
    await request(app.getHttpServer()).get("/agents").set(viewer).expect(200);
    await request(app.getHttpServer())
      .patch(`/agents/${agentId}`)
      .set(viewer)
      .send({ status: "ACTIVE" })
      .expect(403);
    await request(app.getHttpServer()).delete(`/agents/${agentId}`).set(viewer).expect(403);
  });

  it("DELETE /agents/:id cascades", async () => {
    await request(app.getHttpServer()).delete(`/agents/${agentId}`).set(asOwner()).expect(200);
    const list = await request(app.getHttpServer()).get("/agents").set(asOwner());
    expect(list.body).toHaveLength(0);
  });
});
