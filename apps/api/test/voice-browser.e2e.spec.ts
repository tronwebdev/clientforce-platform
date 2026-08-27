/**
 * Human browser calling e2e (B3c-2, DEC-118(1)/(2)/(3)) in a fresh workspace:
 *  - a human dial reaches an unknown-consent contact (the ruled asymmetry:
 *    consent gates Ada, never a person) but NEVER a DNC one — typed refusal
 *    + the call.refused.v1 Logs row;
 *  - keyless sandbox start: Call row caller "human" with placer attribution
 *    and a deterministic sandbox sid; the sandbox-only finish resolves it and
 *    publishes call.completed.v1 with caller attribution — while a LIVE row
 *    refuses the client-reported finish (409): its truth is the provider's;
 *  - the bridge webhook returns <Dial> TwiML with the server-resolved number
 *    (never the client's), stamps the parent CallSid, and — with the
 *    workspace recording toggle ON — adds record + the callee-leg whisper;
 *  - the dial-result webhook lands the bridged leg's outcome + duration and
 *    publishes with caller "human"; the recording callback lands the pointer;
 *  - PATCH /voice/defaults round-trips recordingEnabled (OFF by default).
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_GUARDRAILS } from "@clientforce/core";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Human browser calling e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let dncContactId: string;
  let userIds: string[] = [];
  let ownerToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    delete process.env.VOICE_SANDBOX;
    delete process.env.TWILIO_API_KEY_SID; // keyless — the sandbox posture
    delete process.env.TWILIO_AUTH_TOKEN; // webhooks unsigned outside production
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `vb-${suffix}`, slug: `vb-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "VB", slug: `vb-ws-${suffix}`, settings: {} },
      })
    ).id;
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Caller",
        goal: "book_appointments",
        guardrails: {
          ...DEFAULT_GUARDRAILS,
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
        },
      },
    });
    agentId = agent.id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "caller — primary", graphId: "" },
      })
    ).id;
    // Consent deliberately UNKNOWN — a human may still call (Ada may not).
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "t",
          optOut: {},
          tags: [],
          email: `vb-lead-${suffix}@t.test`,
          phone: "+15125550177",
          firstName: "Hana",
          lastName: "Vale",
        },
      })
    ).id;
    dncContactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "t",
          optOut: { sms: true },
          tags: [],
          email: `vb-dnc-${suffix}@t.test`,
          phone: "+15125550178",
          firstName: "Dee",
        },
      })
    ).id;
    const u1 = await owner.user.create({
      data: { email: `vb-owner-${suffix}@t.test`, authProviderId: `auth|vb-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|vb-owner-${suffix}`, email: u1.email });

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

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  it("unknown consent never blocks a HUMAN dial; DNC always does (typed + Logs row)", async () => {
    // Timing can legitimately refuse depending on the wall clock — outside
    // the 08:00–21:00 contact floor the human dial refuses on the clock, not
    // on consent. Both legs pin the asymmetry: the reason is NEVER consent.
    const res = await request(app.getHttpServer())
      .post("/voice/browser-calls")
      .set(asOwner())
      .send({ agentId, contactId });
    if (res.status === 422) {
      expect(["OUTSIDE_QUIET_HOURS", "OUTSIDE_SENDING_WINDOW"]).toContain(res.body.reason);
    } else {
      expect(res.status).toBe(201);
      await owner.call.deleteMany({ where: { workspaceId: ws } });
    }

    const dnc = await request(app.getHttpServer())
      .post("/voice/browser-calls")
      .set(asOwner())
      .send({ agentId, contactId: dncContactId });
    expect(dnc.status).toBe(422);
    expect(dnc.body.reason).toBe("OPTED_OUT");
    const refused = await owner.event.findFirst({
      where: { workspaceId: ws, contactId: dncContactId, type: "call.refused.v1" },
    });
    expect((refused!.payload as { reason: string }).reason).toBe("OPTED_OUT");
  });

  it("keyless sandbox: the row carries human attribution + a sandbox sid; finish resolves + publishes", async () => {
    // Give the contact an always-open clock: their own timezone can't be
    // controlled in a wall-clock test, so scan for a zone currently awake.
    const zones = [
      "Pacific/Kiritimati", "Pacific/Auckland", "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata",
      "Europe/Berlin", "UTC", "America/Sao_Paulo", "America/New_York", "America/Chicago",
      "America/Denver", "America/Los_Angeles", "Pacific/Honolulu",
    ];
    const local = (tz: string) =>
      Number(
        new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" })
          .formatToParts(new Date())
          .find((p) => p.type === "hour")!.value,
      );
    const awake = zones.find((z) => {
      const h = local(z);
      return h >= 9 && h < 20;
    });
    expect(awake).toBeTruthy();
    await owner.contact.update({ where: { id: contactId }, data: { timezone: awake! } });

    const res = await request(app.getHttpServer())
      .post("/voice/browser-calls")
      .set(asOwner())
      .send({ agentId, contactId });
    expect(res.status).toBe(201);
    expect(res.body.sandbox).toBe(true);
    expect(res.body.token).toBeUndefined();
    const call = await owner.call.findUnique({ where: { id: res.body.callId } });
    expect(call!.caller).toBe("human");
    expect(call!.placedById).toBe(userIds[0]);
    expect(call!.providerCallSid).toContain("CA-sandbox-browser-");
    expect((call!.meta as { sandbox?: boolean }).sandbox).toBe(true);

    const fin = await request(app.getHttpServer())
      .post(`/voice/browser-calls/${call!.id}/finish`)
      .set(asOwner())
      .send({ outcome: "completed", durationSec: 42 });
    expect(fin.status).toBe(201);
    const done = await owner.call.findUnique({ where: { id: call!.id } });
    expect(done!.status).toBe("COMPLETED");
    expect(done!.durationSec).toBe(42);
    const ev = await owner.event.findFirst({
      where: { workspaceId: ws, contactId, type: "call.completed.v1" },
      orderBy: { occurredAt: "desc" },
    });
    expect(ev!.payload).toMatchObject({ callId: call!.id, durationSec: 42, caller: "human" });
  });

  it("a LIVE row refuses the client-reported finish — provider truth only", async () => {
    const live = await owner.call.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        direction: "OUTBOUND",
        status: "IN_PROGRESS",
        caller: "human",
        placedById: userIds[0],
        providerCallSid: `CA-live-${suffix}`,
        meta: { browser: true, sandbox: false },
      },
    });
    const fin = await request(app.getHttpServer())
      .post(`/voice/browser-calls/${live.id}/finish`)
      .set(asOwner())
      .send({ outcome: "completed", durationSec: 10 });
    expect(fin.status).toBe(409);
    expect(fin.body.reason).toBe("NOT_SANDBOX");
    await owner.call.delete({ where: { id: live.id } });
  });

  it("the bridge webhook dials the SERVER's number, stamps the sid, and records only when the toggle is on", async () => {
    // Recording OFF (the default): plain <Dial>, no whisper, no record attrs.
    const row = await owner.call.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        direction: "OUTBOUND",
        status: "QUEUED",
        caller: "human",
        placedById: userIds[0],
        meta: { browser: true, sandbox: false },
      },
    });
    const off = await request(app.getHttpServer())
      .post("/webhooks/twilio-browser-bridge")
      .type("form")
      .send({ callId: row.id, CallSid: `CA-parent-${suffix}-1` });
    expect(off.status).toBe(201);
    expect(off.text).toContain("<Dial");
    expect(off.text).toContain("+15125550177"); // the CONTACT's number, server-resolved
    expect(off.text).not.toContain("record=");
    expect(off.text).not.toContain("twilio-browser-whisper");
    const stamped = await owner.call.findUnique({ where: { id: row.id } });
    expect(stamped!.providerCallSid).toBe(`CA-parent-${suffix}-1`);
    expect(stamped!.status).toBe("IN_PROGRESS");

    // The dial-result callback lands the bridged leg's outcome + duration.
    const result = await request(app.getHttpServer())
      .post(`/webhooks/twilio-browser-dial-result?callId=${row.id}`)
      .type("form")
      .send({ DialCallStatus: "completed", DialCallDuration: "63" });
    expect(result.status).toBe(201);
    const doneRow = await owner.call.findUnique({ where: { id: row.id } });
    expect(doneRow!.status).toBe("COMPLETED");
    expect(doneRow!.durationSec).toBe(63);

    // Recording ON: the TwiML carries record + the callee-leg whisper, and
    // the recording callback lands the pointer on the row.
    const patch = await request(app.getHttpServer())
      .patch("/voice/defaults")
      .set(asOwner())
      .send({ recordingEnabled: true });
    expect(patch.status).toBe(200);
    expect(patch.body.recordingEnabled).toBe(true);
    const row2 = await owner.call.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        direction: "OUTBOUND",
        status: "QUEUED",
        caller: "human",
        placedById: userIds[0],
        meta: { browser: true, sandbox: false },
      },
    });
    const on = await request(app.getHttpServer())
      .post("/webhooks/twilio-browser-bridge")
      .type("form")
      .send({ callId: row2.id, CallSid: `CA-parent-${suffix}-2` });
    expect(on.text).toContain('record="record-from-answer-dual"');
    expect(on.text).toContain("twilio-browser-whisper");

    const whisper = await request(app.getHttpServer())
      .post(`/webhooks/twilio-browser-whisper?callId=${row2.id}`)
      .type("form")
      .send({ CallSid: `CA-callee-${suffix}` });
    expect(whisper.text).toContain("<Say>This call may be recorded for quality.</Say>");

    const rec = await request(app.getHttpServer())
      .post("/webhooks/twilio-voice-recording")
      .type("form")
      .send({
        CallSid: `CA-parent-${suffix}-2`,
        RecordingSid: `RE-${suffix}`,
        RecordingUrl: "https://api.twilio.com/rec/RE-test",
        RecordingStatus: "completed",
        RecordingDuration: "61",
      });
    expect(rec.status).toBe(201);
    const withRec = await owner.call.findUnique({ where: { id: row2.id } });
    expect((withRec!.meta as { recording?: { sid: string } }).recording?.sid).toBe(`RE-${suffix}`);

    // Restore the default: OFF (the seeded workspace never records).
    const restore = await request(app.getHttpServer())
      .patch("/voice/defaults")
      .set(asOwner())
      .send({ recordingEnabled: false });
    expect(restore.body.recordingEnabled).toBe(false);
    await owner.call.deleteMany({ where: { workspaceId: ws } });
  });

  it("with the browser secrets present, start mints a real device token bound to the TwiML App", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACtestaccount";
    process.env.TWILIO_API_KEY_SID = "SKtestkey";
    process.env.TWILIO_API_KEY_SECRET = "testsecret";
    process.env.TWILIO_TWIML_APP_SID = "APtestapp";
    try {
      const res = await request(app.getHttpServer())
        .post("/voice/browser-calls")
        .set(asOwner())
        .send({ agentId, contactId });
      expect(res.status).toBe(201);
      expect(res.body.sandbox).toBe(false);
      const [, payload] = (res.body.token as string).split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64").toString());
      expect(claims.iss).toBe("SKtestkey");
      expect(claims.sub).toBe("ACtestaccount");
      expect(claims.grants.voice.outgoing.application_sid).toBe("APtestapp");
      const call = await owner.call.findUnique({ where: { id: res.body.callId } });
      expect(call!.status).toBe("QUEUED"); // the bridge stamps it, not the start
      expect(call!.providerCallSid).toBeNull();
    } finally {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_API_KEY_SID;
      delete process.env.TWILIO_API_KEY_SECRET;
      delete process.env.TWILIO_TWIML_APP_SID;
      await owner.call.deleteMany({ where: { workspaceId: ws } });
    }
  });
});
