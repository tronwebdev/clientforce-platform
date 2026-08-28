/**
 * B3d e2e (DEC-122 + DEC-120 expansion 1) in a fresh workspace:
 *  - the autonomy rider round-trips through the guardrails PATCH, an OMITTED
 *    rider is preserved (the launch-rebuild clobber guard), and a level
 *    CHANGE lands campaign.autonomy_changed.v1 with who + old → new;
 *  - level 1 ("ask first") boundary belt-and-braces: a scheduled step send
 *    with no APPROVED approval refuses typed APPROVAL_REQUIRED; approving
 *    the row releases the SAME send (the keyless sandbox transport);
 *  - GET /approvals assembles the three item sources typed (row park ·
 *    campaign proposal · needs-reply thread) and the campaign scope
 *    excludes workspace-level proposals;
 *  - POST /approvals/:id/decide writes the decision + the receipt event and
 *    reads back idempotently once decided;
 *  - POST /inbox/consent-ask sends ONE fixed line through the boundary with
 *    meta.consentAsk marked; a deterministic affirmative reply on that
 *    thread flips callConsent granted with the MESSAGE linked (how:"reply"),
 *    and an ambiguous reply flips nothing.
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_GUARDRAILS } from "@clientforce/core";
import { maybeFlipConsentFromReply, sendStep, SendBlockedError } from "@clientforce/channels";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { awakeTimezone } from "./clock";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const A8_24x7 = {
  ...DEFAULT_GUARDRAILS,
  sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
};

describe.skipIf(!hasDb)("Autonomy + approvals e2e", () => {
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

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    delete process.env.SENDGRID_API_KEY; // keyless sandbox transport
    owner = createPrismaClient();
    appClient = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `ap-${suffix}`, slug: `ap-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "AP", slug: `ap-ws-${suffix}`, settings: {} },
      })
    ).id;
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        fields: {
          company_address: { value: "1 Main St, Austin TX 78701", citations: [], source: "typed" },
          offer: { value: "Consults, $2,400 per plan", citations: [], source: "typed" },
        },
      },
    });
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "CF_MANAGED",
        fromEmail: `hello@ap-${suffix}.test`,
        fromName: "Approvals Test",
        status: "ACTIVE",
      },
    });
    senderId = sender.id;
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Asker", goal: "book_appointments", guardrails: A8_24x7 },
    });
    agentId = agent.id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "asker — primary", graphId: "" },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "t",
          optOut: {},
          tags: [],
          email: `ap-lead-${suffix}@t.test`,
          phone: "+15125550199",
          firstName: "Ana",
          lastName: "Park",
          emailVerdict: "valid",
          timezone: awakeTimezone(),
        },
      })
    ).id;
    enrollmentId = (
      await owner.enrollment.create({
        data: {
          workspaceId: ws,
          campaignId,
          contactId,
          status: "ACTIVE",
          pipelineStage: "enrolled",
          workflowId: `ap-wf-${suffix}`,
        },
      })
    ).id;
    const u1 = await owner.user.create({
      data: { email: `ap-owner-${suffix}@t.test`, authProviderId: `auth|ap-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|ap-owner-${suffix}`, email: u1.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await appClient?.$disconnect();
    await owner?.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  it("the autonomy rider round-trips, an omitted rider is preserved, and a change lands the receipt event", async () => {
    const toAsk = await request(app.getHttpServer())
      .patch(`/agents/${agentId}`)
      .set(asOwner())
      .send({ guardrails: { ...A8_24x7, autonomy: "ask" } });
    expect(toAsk.status).toBe(200);
    const ev = await owner.event.findFirst({
      where: { workspaceId: ws, type: "campaign.autonomy_changed.v1" },
      orderBy: { occurredAt: "desc" },
    });
    expect(ev!.payload).toMatchObject({ from: "limits", to: "ask", byUserId: userIds[0] });
    expect(ev!.campaignId).toBe(campaignId);

    // The launch-rebuild clobber guard: a PATCH that OMITS the rider keeps it.
    const omitting = await request(app.getHttpServer())
      .patch(`/agents/${agentId}`)
      .set(asOwner())
      .send({ guardrails: A8_24x7 });
    expect(omitting.status).toBe(200);
    const stored = await owner.agent.findUnique({ where: { id: agentId }, select: { guardrails: true } });
    expect((stored!.guardrails as { autonomy?: string }).autonomy).toBe("ask");
    // No change ⇒ no second receipt.
    const evCount = await owner.event.count({
      where: { workspaceId: ws, type: "campaign.autonomy_changed.v1" },
    });
    expect(evCount).toBe(1);
  });

  it("level 1: an unapproved step send refuses typed; approving the row releases the SAME send", async () => {
    const stepNodeId = `ap-step-${suffix}`;
    const params = {
      workspaceId: ws,
      campaignId,
      agentId,
      enrollmentId,
      contactId,
      senderId,
      stepNodeId,
      content: { subject: "Hello", body: "A scheduled line." },
      origin: "step" as const,
    };
    const deps = {
      prisma: appClient,
      transport: {
        // The keyless-sandbox shape: no network, a deterministic provider id.
        async send() {
          return { providerMessageId: `<sandbox-${suffix}@test>` };
        },
      },
    };
    await expect(sendStep(deps as never, params)).rejects.toMatchObject({
      reason: "APPROVAL_REQUIRED",
    } satisfies Partial<SendBlockedError>);

    const approval = await owner.approval.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        enrollmentId,
        contactId,
        kind: "step_send",
        reason: "A scheduled email to Ana Park — this campaign asks first.",
        meta: { stepNodeId, channel: "email" },
      },
    });
    // Approve through the endpoint — the receipt event rides the decision.
    const decide = await request(app.getHttpServer())
      .post(`/approvals/${approval.id}/decide`)
      .set(asOwner())
      .send({ decision: "approved" });
    expect(decide.status).toBe(201);
    expect(decide.body.status).toBe("APPROVED");
    const message = await sendStep(deps as never, params);
    expect(message.id).toBeTruthy();
    const decidedEv = await owner.event.findFirst({
      where: { workspaceId: ws, type: "approval.decided.v1" },
      orderBy: { occurredAt: "desc" },
    });
    expect(decidedEv!.payload).toMatchObject({
      approvalId: approval.id,
      decision: "approved",
      byUserId: userIds[0],
    });
    // Idempotent read-back once decided.
    const again = await request(app.getHttpServer())
      .post(`/approvals/${approval.id}/decide`)
      .set(asOwner())
      .send({ decision: "dismissed" });
    expect(again.body.status).toBe("APPROVED");
  });

  it("GET /approvals assembles the three sources typed; the campaign scope excludes proposals", async () => {
    // A pending park row.
    const park = await owner.approval.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        enrollmentId,
        contactId,
        kind: "step_send",
        reason: "A scheduled email to Ana Park — this campaign asks first.",
        meta: { stepNodeId: `ap-park-${suffix}`, channel: "email" },
      },
    });
    // A campaign proposal (B2.6 shape).
    const draft = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: `Win back the not-nows ${suffix}`,
        goal: "winback_lapsed",
        status: "DRAFT",
        guardrails: {},
        suggestion: {
          v: 1,
          signal: "winback_stalled",
          reason: "3 people said not now and went quiet.",
          count: 3,
          at: new Date().toISOString(),
        },
      },
    });
    // A needs-reply thread: outbound then a NEWER inbound.
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        direction: "OUTBOUND",
        channel: "email",
        body: "Opening line",
        sentAt: new Date(Date.now() - 60_000),
      },
    });
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        direction: "INBOUND",
        channel: "email",
        body: "Tell me more about pricing?",
        sentAt: new Date(),
      },
    });

    const all = await request(app.getHttpServer()).get("/approvals").set(asOwner());
    expect(all.status).toBe(200);
    const kinds = (all.body.items as Array<{ kind: string }>).map((i) => i.kind);
    expect(kinds).toContain("step_send");
    expect(kinds).toContain("campaign_proposal");
    expect(kinds).toContain("reply_draft");

    const scoped = await request(app.getHttpServer())
      .get(`/approvals?agentId=${agentId}`)
      .set(asOwner());
    const scopedKinds = (scoped.body.items as Array<{ kind: string }>).map((i) => i.kind);
    expect(scopedKinds).toContain("step_send");
    expect(scopedKinds).toContain("reply_draft");
    expect(scopedKinds).not.toContain("campaign_proposal");

    await owner.approval.delete({ where: { id: park.id } });
    await owner.agent.delete({ where: { id: draft.id } });
  });

  it("the may-we-call ask sends marked; a plain yes flips consent with the message linked; ambiguous flips nothing", async () => {
    const res = await request(app.getHttpServer())
      .post("/inbox/consent-ask")
      .set(asOwner())
      .send({ agentId, contactId });
    expect(res.status).toBe(201);
    const ask = await owner.message.findUnique({ where: { id: res.body.message.id } });
    expect((ask!.meta as { consentAsk?: boolean }).consentAsk).toBe(true);
    expect((ask!.meta as { reply?: { userId: string } }).reply?.userId).toBe(userIds[0]);

    // An AMBIGUOUS reply on the thread: nothing flips.
    const published: Array<{ type: string; payload: unknown }> = [];
    const bus = { publish: async (e: { type: string; payload: unknown }) => void published.push(e) };
    const ambiguous = await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        direction: "INBOUND",
        channel: "email",
        body: "what would the call be about?",
        inReplyToId: ask!.id,
        sentAt: new Date(),
      },
    });
    const flippedNo = await maybeFlipConsentFromReply({ prisma: appClient, bus } as never, ws, {
      id: ambiguous.id,
      contactId,
      campaignId,
      inReplyToId: ask!.id,
      body: ambiguous.body,
    });
    expect(flippedNo).toBe(false);
    let contact = await owner.contact.findUnique({ where: { id: contactId } });
    expect((contact as { callConsent?: string })!.callConsent).toBe("unknown");

    // A PLAIN yes: consent flips granted with THE MESSAGE as provenance.
    const yes = await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        direction: "INBOUND",
        channel: "email",
        body: "Yes please",
        inReplyToId: ask!.id,
        sentAt: new Date(),
      },
    });
    const flipped = await maybeFlipConsentFromReply({ prisma: appClient, bus } as never, ws, {
      id: yes.id,
      contactId,
      campaignId,
      inReplyToId: ask!.id,
      body: yes.body,
    });
    expect(flipped).toBe(true);
    contact = await owner.contact.findUnique({ where: { id: contactId } });
    expect((contact as { callConsent?: string })!.callConsent).toBe("granted");
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "contact.call_consent.v1",
      payload: { value: "granted", how: "reply", messageId: yes.id },
    });

    // Idempotent: a second yes publishes nothing more.
    const flippedAgain = await maybeFlipConsentFromReply({ prisma: appClient, bus } as never, ws, {
      id: yes.id,
      contactId,
      campaignId,
      inReplyToId: ask!.id,
      body: yes.body,
    });
    expect(flippedAgain).toBe(false);
    expect(published).toHaveLength(1);
  });
});
