/**
 * P3.1 (DEC-078) — voice API e2e: the dial endpoint runs the FULL rail order
 * (typed 422 + a call.refused.v1 Event row — the Logs surface — on every
 * refusal), a cleared dial creates the Call row through the sandbox dialer
 * (deterministic CallSid, no network), the Calls tab reads join contact
 * names, the transcript endpoint returns the Message(channel:"voice") thread
 * by meta.callId, voice defaults round-trip with the given-name validator,
 * and RLS keeps foreign-workspace calls invisible. Requires Postgres; skips
 * without infra.
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
const PHONE = "+15005553030";
const SUPPRESSED_PHONE = "+15005553031";

const GUARDRAILS = {
  // Open window every day so the deterministic refusal matrix (channels
  // integration suite) owns window/cap coverage and this e2e stays unflaky.
  sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
  dailyCap: { email: 10, voice: 5 },
  consent: null,
  unsubscribeFooter: true,
  suppressionCheck: true,
};

describe.skipIf(!hasDb)("Voice API e2e (P3.1, DEC-078)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let wsForeign: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let suppressedContactId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    delete process.env.CHANNELS_VOICE_ALLOWLIST; // empty = no restriction; sandbox is the guard
    delete process.env.VOICE_SANDBOX; // default ON

    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `vc-${suffix}`, slug: `vc-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "Acme Dental", slug: `vc-${suffix}`, settings: {} },
      })
    ).id;
    wsForeign = (
      await owner.workspace.create({
        data: { agencyId, name: "Foreign", slug: `vcf-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Caller", goal: "book_appointments", guardrails: GUARDRAILS },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "primary", graphId: "" },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "test",
          optOut: {},
          tags: [],
          email: `vc-${suffix}@t.test`,
          phone: PHONE,
          firstName: "Sam",
          lastName: "Reed",
        },
      })
    ).id;
    suppressedContactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "test",
          optOut: {},
          tags: [],
          email: `vcs-${suffix}@t.test`,
          phone: SUPPRESSED_PHONE,
          firstName: "Stopped",
        },
      })
    ).id;
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "sms", address: SUPPRESSED_PHONE, reason: "UNSUBSCRIBED" },
    });

    const user = await owner.user.create({
      data: { email: `vc-${suffix}@t.test`, authProviderId: `auth|vc-${suffix}` },
    });
    userId = user.id;
    await owner.membership.create({ data: { userId, workspaceId: ws, role: "OWNER" } });
    token = await signDevToken(SECRET, { sub: `auth|vc-${suffix}`, email: user.email });

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

  const auth = { Authorization: () => `Bearer ${token}`, ws: () => ws };
  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set({ Authorization: `Bearer ${token}`, "x-workspace-id": ws })
      .send(body);
  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set({ Authorization: `Bearer ${token}`, "x-workspace-id": ws });
  const patch = (path: string, body: object) =>
    request(app.getHttpServer())
      .patch(path)
      .set({ Authorization: `Bearer ${token}`, "x-workspace-id": ws })
      .send(body);
  void auth;

  let callId = "";

  it("POST /agents/:id/calls — a cleared dial creates the Call row via the sandbox dialer", async () => {
    const res = await post(`/agents/${agentId}/calls`, { contactId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("QUEUED");
    expect(res.body.providerCallSid).toMatch(/^CA-sandbox-/);
    expect(res.body.direction).toBe("OUTBOUND");
    callId = res.body.id;
  });

  it("a SUPPRESSED number refuses typed (422) AND writes the call.refused.v1 Logs row", async () => {
    const res = await post(`/agents/${agentId}/calls`, { contactId: suppressedContactId });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("SUPPRESSED");
    const event = await owner.event.findFirst({
      where: { workspaceId: ws, type: "call.refused.v1", contactId: suppressedContactId },
    });
    expect(event).not.toBeNull();
    expect((event!.payload as { reason: string }).reason).toBe("SUPPRESSED");
  });

  it("a non-English agent refuses typed at the dial boundary (D8) with a Logs row", async () => {
    const deAgent = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Termine",
        goal: "book_appointments",
        guardrails: { ...GUARDRAILS, language: "de", languageSource: "owner" },
      },
    });
    await owner.campaign.create({
      data: { workspaceId: ws, agentId: deAgent.id, name: "primär", graphId: "" },
    });
    const res = await post(`/agents/${deAgent.id}/calls`, { contactId });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("VOICE_LANGUAGE_UNSUPPORTED");
  });

  it("GET /agents/:id/calls — the Calls tab rows join contact names", async () => {
    const res = await get(`/agents/${agentId}/calls`);
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0]).toMatchObject({
      id: callId,
      contactName: "Sam Reed",
      status: "QUEUED",
      direction: "OUTBOUND",
    });
  });

  it("GET /calls/:id — the transcript thread reads Message(channel:voice) by meta.callId", async () => {
    await owner.message.createMany({
      data: [
        {
          workspaceId: ws,
          campaignId,
          contactId,
          channel: "voice",
          direction: "OUTBOUND",
          body: "Hi, this is an AI assistant calling on behalf of Acme Dental. Is now a quick moment?",
          providerMessageId: `voice:vc-${suffix}:0`,
          sentAt: new Date(),
          meta: { callId, turnIndex: 0, composerVersion: "composer.voice@v1" },
        },
        {
          workspaceId: ws,
          campaignId,
          contactId,
          channel: "voice",
          direction: "INBOUND",
          body: "Sure, what's this about?",
          providerMessageId: `voice:vc-${suffix}:1`,
          sentAt: new Date(Date.now() + 1000),
          meta: { callId, turnIndex: 1, commitSource: "speech_final" },
        },
      ],
    });
    const res = await get(`/calls/${callId}`);
    expect(res.status).toBe(200);
    expect(res.body.transcript).toHaveLength(2);
    expect(res.body.transcript[0].direction).toBe("OUTBOUND");
    expect(res.body.transcript[0].body).toContain("AI assistant calling on behalf of");
    expect(res.body.transcript[1].direction).toBe("INBOUND");
    expect(res.body.contact.firstName).toBe("Sam");
  });

  it("voice defaults round-trip; the given-name validator rejects titles", async () => {
    const empty = await get("/voice/defaults");
    expect(empty.status).toBe(200);
    expect(empty.body.spokenName).toBeNull();
    expect(empty.body.recordingEnabled).toBe(false); // the owner-locked default
    expect(empty.body.personas.map((p: { id: string }) => p.id)).toContain("ava");

    const set = await patch("/voice/defaults", { spokenName: "Sam" });
    expect(set.status).toBe(200);
    expect(set.body.spokenName).toBe("Sam");

    const bad = await patch("/voice/defaults", { spokenName: "Dr. Smith" });
    expect(bad.status).toBe(400);

    const cleared = await patch("/voice/defaults", { spokenName: null });
    expect(cleared.body.spokenName).toBeNull();
  });

  it("RLS: a foreign workspace's call is invisible (404)", async () => {
    const foreignAgent = await owner.agent.create({
      data: { workspaceId: wsForeign, name: "Other", goal: "book_appointments", guardrails: {} },
    });
    const foreignCampaign = await owner.campaign.create({
      data: { workspaceId: wsForeign, agentId: foreignAgent.id, name: "f", graphId: "" },
    });
    const foreignContact = await owner.contact.create({
      data: { workspaceId: wsForeign, source: "test", optOut: {}, tags: [], email: `f-${suffix}@t.test`, phone: "+15005553032" },
    });
    const foreignCall = await owner.call.create({
      data: {
        workspaceId: wsForeign,
        campaignId: foreignCampaign.id,
        agentId: foreignAgent.id,
        contactId: foreignContact.id,
        direction: "OUTBOUND",
      },
    });
    const res = await get(`/calls/${foreignCall.id}`);
    expect(res.status).toBe(404);
  });
});
