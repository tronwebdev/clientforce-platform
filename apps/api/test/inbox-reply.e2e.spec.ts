/**
 * Reply-spine API e2e (B3b, DEC-116/117) in a fresh workspace:
 *  - a human reply lands through the REAL send boundary (keyless sandbox
 *    transport — nothing delivered, the Message row + reply provenance
 *    persist) and PLACES the reply-hold with its timeline event;
 *  - a step-origin send against the held enrollment REFUSES typed
 *    (ENROLLMENT_HELD) at the boundary — Ada is genuinely paused;
 *  - Resume releases the hold (timeline event) and the same step send passes;
 *  - who may send = who may work the inbox: an AGENT member's reply is 201
 *    (owner ruling — no new permission tier);
 *  - assign + snooze round-trip through ThreadState with real validation;
 *  - the DEC-114 rule table fires from facts: not-now + a win-back campaign
 *    → add_winback (live), enrolled → the rule stops; paid without a review
 *    campaign → ask_review (deferred). Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KeylessSandboxSender, sendStep } from "@clientforce/channels";
import { DEFAULT_GUARDRAILS } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Inbox reply spine e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let appClient: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let enrollmentId: string;
  let senderId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let agentToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    delete process.env.SENDGRID_API_KEY; // the keyless sandbox transport path
    owner = createPrismaClient();
    appClient = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `rp-${suffix}`, slug: `rp-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "R", slug: `rp-ws-${suffix}`, settings: {} },
      })
    ).id;

    // The boundary's compliance rail: workspace context with company_address.
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        fields: {
          company_address: { value: "1 Main St, Austin TX 78701", citations: [], source: "typed" },
          offer: { value: "Implant consults, $2,400 per plan", citations: [], source: "typed" },
        },
      },
    });
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "CF_MANAGED",
        fromEmail: `hello@rp-${suffix}.test`,
        fromName: "Reply Spine Test",
        status: "ACTIVE",
      },
    });
    senderId = sender.id;

    const agent = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Host",
        goal: "book_appointments",
        // The FULL A8 shape with a 24/7 window so the step-send assertions
        // are clock-independent (a partial object fails the schema by design).
        guardrails: {
          ...DEFAULT_GUARDRAILS,
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
        },
      },
    });
    agentId = agent.id;
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "host — primary", graphId: "" },
    });
    campaignId = campaign.id;
    const contact = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "t",
        optOut: {},
        tags: [],
        email: `rp-lead-${suffix}@t.test`,
        firstName: "Lea",
        lastName: "Reply",
        emailVerdict: "valid", // past the LH1 enrollment gate
      },
    });
    contactId = contact.id;
    enrollmentId = (
      await owner.enrollment.create({
        data: {
          workspaceId: ws,
          campaignId,
          contactId,
          workflowId: `rp-wf-${suffix}`,
          pipelineStage: "contacted",
          status: "ACTIVE",
        },
      })
    ).id;
    // The conversation: one outbound step + one inbound question.
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        channel: "email",
        direction: "OUTBOUND",
        subject: "Consult slots",
        body: "We have consult slots on the 21st.",
        senderId,
        sentAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        channel: "email",
        direction: "INBOUND",
        body: "How long is recovery?",
        intent: "question",
        sentAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });

    const u1 = await owner.user.create({
      data: { email: `rp-owner-${suffix}@t.test`, authProviderId: `auth|rp-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const member = await owner.user.create({
      data: { email: `rp-agent-${suffix}@t.test`, authProviderId: `auth|rp-agent-${suffix}` },
    });
    await owner.membership.create({ data: { userId: member.id, workspaceId: ws, role: "AGENT" } });
    userIds = [u1.id, member.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|rp-owner-${suffix}`, email: u1.email });
    agentToken = await signDevToken(SECRET, { sub: `auth|rp-agent-${suffix}`, email: member.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
    await appClient?.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });
  const asAgent = () => ({ Authorization: `Bearer ${agentToken}`, "x-workspace-id": ws });
  const stepParams = () => ({
    workspaceId: ws,
    campaignId,
    agentId,
    enrollmentId,
    contactId,
    senderId,
    stepNodeId: "rp-step-1",
    content: { subject: "Follow-up", body: "Checking in." },
  });

  it("a human reply sends through the boundary and places the hold + event", async () => {
    const res = await request(app.getHttpServer())
      .post("/inbox/reply")
      .set(asOwner())
      .send({ campaignId, contactId, channel: "email", body: "Three days for most people.", draft: "none" });
    expect(res.status).toBe(201);
    expect(res.body.heldEnrollments).toEqual([enrollmentId]);

    const msg = await owner.message.findFirst({
      where: { workspaceId: ws, contactId, direction: "OUTBOUND" },
      orderBy: { sentAt: "desc" },
    });
    expect(msg!.body).toContain("Three days for most people.");
    expect(msg!.body).toContain("1 Main St, Austin TX 78701"); // the compliance footer rode along
    expect(msg!.stepNodeId).toBeNull();
    expect((msg!.meta as { reply?: { draft: string } }).reply?.draft).toBe("none");

    const hold = await owner.enrollmentReplyHold.findFirst({
      where: { enrollmentId, releasedAt: null },
    });
    expect(hold).toBeTruthy();
    const heldEvent = await owner.event.findFirst({
      where: { workspaceId: ws, contactId, type: "enrollment.held.v1" },
    });
    expect(heldEvent).toBeTruthy();
  });

  it("a step-origin send against the held enrollment refuses typed at the boundary", async () => {
    await expect(
      sendStep({ prisma: appClient, transport: new KeylessSandboxSender() }, stepParams()),
    ).rejects.toMatchObject({ reason: "ENROLLMENT_HELD" });
  });

  it("Resume releases the hold (event) and the same step send passes", async () => {
    const res = await request(app.getHttpServer())
      .post("/inbox/resume")
      .set(asOwner())
      .send({ contactId });
    expect(res.status).toBe(201);
    expect(res.body.released).toBe(1);
    const resumedEvent = await owner.event.findFirst({
      where: { workspaceId: ws, contactId, type: "enrollment.resumed.v1" },
    });
    expect(resumedEvent).toBeTruthy();

    const sent = await sendStep(
      { prisma: appClient, transport: new KeylessSandboxSender() },
      stepParams(),
    );
    expect(sent.stepNodeId).toBe("rp-step-1");
  });

  it("an AGENT member's reply is 201 — the existing role set sends (owner ruling)", async () => {
    const res = await request(app.getHttpServer())
      .post("/inbox/reply")
      .set(asAgent())
      .send({ campaignId, contactId, channel: "email", body: "Happy to book you Thursday.", draft: "none" });
    expect(res.status).toBe(201);
    // Restore: release the hold this reply placed.
    await request(app.getHttpServer()).post("/inbox/resume").set(asOwner()).send({ contactId });
  });

  it("assign + snooze round-trip; a non-member assignee rejects", async () => {
    const bad = await request(app.getHttpServer())
      .patch("/inbox/thread-state")
      .set(asOwner())
      .send({ campaignId, contactId, assigneeUserId: "not-a-member" });
    expect(bad.status).toBe(400);

    const assign = await request(app.getHttpServer())
      .patch("/inbox/thread-state")
      .set(asOwner())
      .send({ campaignId, contactId, assigneeUserId: userIds[1] });
    expect(assign.status).toBe(200);

    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const snooze = await request(app.getHttpServer())
      .patch("/inbox/thread-state")
      .set(asOwner())
      .send({ campaignId, contactId, snoozedUntil: until });
    expect(snooze.status).toBe(200);

    const inbox = await request(app.getHttpServer()).get("/inbox").set(asOwner());
    const thread = (inbox.body.threads as Array<Record<string, unknown>>).find(
      (t) => t.contactId === contactId,
    )!;
    expect((thread.assignee as { id: string }).id).toBe(userIds[1]);
    expect(thread.snoozedUntil).toBe(until);
    expect(thread.adaHeld).toBe(false);
  });

  it("the rule table: not-now + a win-back campaign fires add_winback; enrolling stops it", async () => {
    // The not-now fact.
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        channel: "email",
        direction: "INBOUND",
        body: "not right now",
        intent: "objection_timing",
        sentAt: new Date(),
      },
    });
    // No win-back campaign yet → the rule cannot map to a real action; the
    // contact is booked-free/paid-free/quiet-free too → nothing fires.
    const before = await request(app.getHttpServer())
      .get(`/contacts/${contactId}/timeline`)
      .set(asOwner());
    expect(before.body.nextStep).toBeNull();

    const winback = await owner.agent.create({
      data: { workspaceId: ws, name: "Win back", goal: "winback_deals", guardrails: {} },
    });
    const wbCampaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId: winback.id, name: "winback — primary", graphId: "" },
    });
    // A campaign WITHOUT a graph cannot take an enrollment — the rule must
    // not offer it (DEC-114's map-to-a-real-action bar).
    const graphless = await request(app.getHttpServer())
      .get(`/contacts/${contactId}/timeline`)
      .set(asOwner());
    expect(graphless.body.nextStep).toBeNull();

    await owner.campaignGraph.create({
      data: {
        workspaceId: ws,
        campaignId: wbCampaign.id,
        version: 1,
        source: "MANUAL",
        graph: {
          entry: "wb-step-1",
          nodes: [
            {
              id: "wb-step-1",
              type: "step",
              channel: "email",
              content: { subject: "An honest second try", body: "Worth another look when the timing works." },
            },
          ],
        },
      },
    });
    const firing = await request(app.getHttpServer())
      .get(`/contacts/${contactId}/timeline`)
      .set(asOwner());
    expect(firing.body.nextStep).toMatchObject({ key: "add_winback", live: true, agentId: winback.id });
    expect(firing.body.nextStep.provenance).toContain("Said not now");

    // Once the contact is in the win-back campaign, the rule stops firing
    // (the enrollment row is what the slot's shipped write creates).
    await owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId: wbCampaign.id,
        contactId,
        workflowId: `rp-wb-wf-${suffix}`,
        pipelineStage: "new",
        status: "ACTIVE",
      },
    });
    const after = await request(app.getHttpServer())
      .get(`/contacts/${contactId}/timeline`)
      .set(asOwner());
    expect(after.body.nextStep?.key).not.toBe("add_winback");
  });

  it("paid without a review campaign → ask_review renders deferred", async () => {
    await owner.event.create({
      data: {
        workspaceId: ws,
        contactId,
        campaignId,
        type: "payment.received.v1",
        payload: { amount: 240_000, channel: "email" },
      },
    });
    const res = await request(app.getHttpServer())
      .get(`/contacts/${contactId}/timeline`)
      .set(asOwner());
    expect(res.body.nextStep).toMatchObject({ key: "ask_review", live: false });
    expect(res.body.nextStep.provenance).toContain("Paid");
  });
});
