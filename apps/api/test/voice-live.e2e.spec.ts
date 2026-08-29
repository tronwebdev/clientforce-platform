/**
 * B4.5 (DEC-128) live-call presence e2e in a fresh workspace:
 *  - GET /calls/live tells the shell the truth: a young QUEUED dial shows as
 *    ringing, an answered call shows IN_PROGRESS, a stale QUEUED row ages out;
 *  - the transcript reads MID-CALL: the per-turn rows (same providerMessageId
 *    scheme the voice service writes) come back from GET /calls/:id while the
 *    call is still IN_PROGRESS;
 *  - JUMP IN: marks the row (meta.takenOver), publishes call.taken_over.v1,
 *    returns the room + sandbox truthfully; double jump-in and jump-in on a
 *    finished call refuse with typed 409s;
 *  - the bridge webhook admits a marked call's browser leg into its conference
 *    room (<Conference> TwiML) and rejects an unmarked one;
 *  - the taken-over call's TERMINAL state lands from the contact leg's status
 *    webhook — the one terminal stamp, with caller attribution.
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { awakeTimezone } from "./clock";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Live-call presence e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let callId: string;
  const sid = `CA-sandbox-live-${suffix}`;

  const api = () => request(app.getHttpServer());
  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    delete process.env.VOICE_SANDBOX; // default ON — redirect is a recorded no-op
    delete process.env.TWILIO_API_KEY_SID; // keyless — jump-in says sandbox
    delete process.env.TWILIO_AUTH_TOKEN; // webhooks unsigned outside production
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `lv-${suffix}`, slug: `lv-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "LV", slug: `lv-ws-${suffix}`, settings: {} },
      })
    ).id;
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Live caller", goal: "book_appointments", guardrails: {} },
    });
    agentId = agent.id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "live — primary", graphId: "" },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "t",
          optOut: {},
          tags: [],
          email: `lv-lead-${suffix}@t.test`,
          phone: "+15125550166",
          firstName: "Nia",
          lastName: "Reed",
          timezone: awakeTimezone(),
          callConsent: "granted",
        },
      })
    ).id;
    const u1 = await owner.user.create({
      data: { email: `lv-owner-${suffix}@t.test`, authProviderId: `auth|lv-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|lv-owner-${suffix}`, email: u1.email });

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
    await owner?.$disconnect();
  });

  it("the live feed tells the phase truth: young QUEUED rings, answered is IN_PROGRESS, stale ages out", async () => {
    callId = (
      await owner.call.create({
        data: {
          workspaceId: ws,
          campaignId,
          agentId,
          contactId,
          caller: "ada",
          direction: "OUTBOUND",
          status: "QUEUED",
          providerCallSid: sid,
        },
      })
    ).id;
    let live = await api().get("/calls/live").set(asOwner()).expect(200);
    expect(live.body.calls.map((c: { id: string }) => c.id)).toContain(callId);
    expect(live.body.calls[0].status).toBe("QUEUED");
    expect(live.body.calls[0].contactName).toBe("Nia Reed");

    // The voice service answers: IN_PROGRESS + startedAt (what withCallStarted writes).
    await owner.call.update({
      where: { id: callId },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
    live = await api().get("/calls/live").set(asOwner()).expect(200);
    const row = live.body.calls.find((c: { id: string }) => c.id === callId);
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.takenOver).toBe(false);

    // A dial that never connected must not haunt the canvas: age it out.
    const stale = await owner.call.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        caller: "ada",
        direction: "OUTBOUND",
        status: "QUEUED",
        createdAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    live = await api().get("/calls/live").set(asOwner()).expect(200);
    expect(live.body.calls.map((c: { id: string }) => c.id)).not.toContain(stale.id);
  });

  it("the transcript reads MID-CALL: per-turn rows come back while IN_PROGRESS", async () => {
    // The same rows the voice service's live feed writes (persistLatestTurn):
    // channel voice, meta.callId, providerMessageId = voice:{sid}:{index}.
    await owner.message.createMany({
      data: [
        {
          workspaceId: ws,
          campaignId,
          contactId,
          channel: "voice",
          direction: "OUTBOUND",
          body: "Hi — this is Ada, the clinic's AI assistant.",
          providerMessageId: `voice:${sid}:0`,
          sentAt: new Date(Date.now() - 20_000),
          meta: { callId, turnIndex: 0 },
        },
        {
          workspaceId: ws,
          campaignId,
          contactId,
          channel: "voice",
          direction: "INBOUND",
          body: "Oh hi — I was hoping to move my appointment.",
          providerMessageId: `voice:${sid}:1`,
          sentAt: new Date(Date.now() - 12_000),
          meta: { callId, turnIndex: 1 },
        },
      ],
    });
    const detail = await api().get(`/calls/${callId}`).set(asOwner()).expect(200);
    expect(detail.body.call.status).toBe("IN_PROGRESS");
    expect(detail.body.transcript).toHaveLength(2);
    expect(detail.body.transcript[0].direction).toBe("OUTBOUND");
    expect(detail.body.transcript[1].body).toContain("move my appointment");
  });

  it("JUMP IN marks the row, publishes the transition, and refuses honestly after", async () => {
    const res = await api().post(`/voice/calls/${callId}/jump-in`).set(asOwner()).expect(201);
    expect(res.body.sandbox).toBe(true); // keyless + sandbox sid — no Device, no network
    expect(res.body.room).toBe(`cf-call-${callId}`);

    const call = await owner.call.findUnique({ where: { id: callId } });
    const meta = call!.meta as { takenOver?: { byUserId?: string } };
    expect(meta.takenOver?.byUserId).toBe(userIds[0]);
    const ev = await owner.event.findFirst({
      where: { workspaceId: ws, type: "call.taken_over.v1" },
    });
    expect(ev!.payload).toMatchObject({ callId, byUserId: userIds[0] });

    const again = await api().post(`/voice/calls/${callId}/jump-in`).set(asOwner()).expect(409);
    expect(again.body.reason).toBe("ALREADY_TAKEN");
  });

  it("the bridge webhook admits the marked call into its room and rejects an unmarked one", async () => {
    const joined = await api()
      .post("/webhooks/twilio-browser-bridge")
      .type("form")
      .send({ joinCallId: callId, CallSid: `CA-browser-${suffix}` })
      .expect(201);
    expect(joined.text).toContain(`<Conference beep="false" endConferenceOnExit="true">cf-call-${callId}</Conference>`);

    const unmarked = await owner.call.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        caller: "ada",
        direction: "OUTBOUND",
        status: "IN_PROGRESS",
        startedAt: new Date(),
      },
    });
    const rejected = await api()
      .post("/webhooks/twilio-browser-bridge")
      .type("form")
      .send({ joinCallId: unmarked.id, CallSid: `CA-browser2-${suffix}` })
      .expect(201);
    expect(rejected.text).toContain("<Reject/>");
    await owner.call.delete({ where: { id: unmarked.id } });
  });

  it("the taken-over call's terminal state lands ONCE, from the contact leg's status webhook", async () => {
    await api()
      .post("/webhooks/twilio-voice-status")
      .type("form")
      .send({ CallSid: sid, CallStatus: "completed", CallDuration: "184" })
      .expect(201);
    const call = await owner.call.findUnique({ where: { id: callId } });
    expect(call!.status).toBe("COMPLETED");
    expect(call!.outcome).toBe("completed");
    expect(call!.durationSec).toBe(184);

    const after = await api().post(`/voice/calls/${callId}/jump-in`).set(asOwner()).expect(409);
    expect(after.body.reason).toBe("NOT_LIVE");

    const live = await api().get("/calls/live").set(asOwner()).expect(200);
    expect(live.body.calls.map((c: { id: string }) => c.id)).not.toContain(callId);
  });
});
