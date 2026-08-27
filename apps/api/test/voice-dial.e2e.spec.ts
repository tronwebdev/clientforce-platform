/**
 * Ada outbound dial-rail e2e (B3c-1, DEC-118/119) in a fresh workspace:
 *  - consent gates the dial: unknown → typed CALL_CONSENT_REQUIRED (+ the
 *    call.refused.v1 Logs row); granted → the sandbox dial places a Call row
 *    with caller attribution;
 *  - contact-local quiet hours refuse in the CONTACT's own timezone;
 *  - the lifetime max-attempts cap and the unanswered-attempts threshold
 *    refuse typed (voicemail-only delivery is Q-085 — never a silent retry);
 *  - best_time outside the window queues: a QUEUED Call row carrying its
 *    deterministic scheduledAt from the shared window resolver;
 *  - the consent flip on PATCH /contacts/:id writes provenance to the
 *    timeline; the CSV import's explicit call-consent column persists + logs;
 *  - a voice step passes the manual-edit graph gate (PUT /planner/graph).
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
import { CALL_DIAL_QUEUE_TOKEN } from "../src/voice/voice.providers";
import { awakeTimezone } from "./clock";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Ada outbound dial rail e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  const queuedJobs: unknown[][] = [];

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    delete process.env.VOICE_SANDBOX; // default ON — keyless deterministic sids
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `vd-${suffix}`, slug: `vd-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "V", slug: `vd-ws-${suffix}`, settings: {} },
      })
    ).id;

    const agent = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Caller",
        goal: "book_appointments",
        // A 24/7 window in UTC so agent-tz checks are clock-independent; the
        // CONTACT-local floor is what the quiet-hours test exercises.
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
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "t",
          optOut: {},
          tags: [],
          email: `vd-lead-${suffix}@t.test`,
          phone: "+15125550100",
          firstName: "Vera",
          lastName: "Dial",
          // A CURRENTLY-awake clock: the 08:00–21:00 contact-local floor
          // otherwise makes every non-timing gate test hostage to the
          // runner's wall hour (red after 21:00 UTC, green all day).
          timezone: awakeTimezone(),
        },
      })
    ).id;

    const u1 = await owner.user.create({
      data: { email: `vd-owner-${suffix}@t.test`, authProviderId: `auth|vd-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|vd-owner-${suffix}`, email: u1.email });

    // The endpoint 503s without a queue (no phantom schedules) — the spec
    // runs without Redis, so a capturing fake stands in.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CALL_DIAL_QUEUE_TOKEN)
      .useValue({ add: async (...args: unknown[]) => { queuedJobs.push(args); } })
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

  it("unknown consent refuses typed — Ada may not call; the Logs row lands", async () => {
    const res = await request(app.getHttpServer())
      .post(`/agents/${agentId}/calls`)
      .set(asOwner())
      .send({ contactId });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("CALL_CONSENT_REQUIRED");
    const refused = await owner.event.findFirst({
      where: { workspaceId: ws, contactId, type: "call.refused.v1" },
    });
    expect((refused!.payload as { reason: string }).reason).toBe("CALL_CONSENT_REQUIRED");
  });

  it("granted consent + open window dials (sandbox) with caller attribution", async () => {
    await owner.contact.update({ where: { id: contactId }, data: { callConsent: "granted" } });
    const res = await request(app.getHttpServer())
      .post(`/agents/${agentId}/calls`)
      .set(asOwner())
      .send({ contactId });
    // The fixture clock is awake by construction — the dial clears.
    expect(res.status).toBe(201);
    const call = await owner.call.findFirst({ where: { workspaceId: ws, contactId } });
    expect(call!.caller).toBe("ada");
    expect(call!.placedById).toBe(userIds[0]);
    expect(call!.providerCallSid).toContain("CA-sandbox-");
    await owner.call.deleteMany({ where: { workspaceId: ws } }); // clean slate for the caps tests
  });

  it("contact-local quiet hours refuse in THEIR timezone", async () => {
    // Pick a timezone where it is currently outside 08:00–21:00 local:
    // scan offsets until one lands in the quiet band.
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
    const quietZone = zones.find((z) => {
      const h = local(z);
      return h < 8 || h >= 21;
    });
    expect(quietZone).toBeTruthy(); // 26 hour-zones span the globe — one is always asleep
    await owner.contact.update({ where: { id: contactId }, data: { timezone: quietZone! } });
    const res = await request(app.getHttpServer())
      .post(`/agents/${agentId}/calls`)
      .set(asOwner())
      .send({ contactId });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("OUTSIDE_QUIET_HOURS");
    expect(res.body.message).toContain(quietZone!);
  });

  it("best_time outside the window QUEUES with the deterministic schedule", async () => {
    const res = await request(app.getHttpServer())
      .post(`/agents/${agentId}/calls`)
      .set(asOwner())
      .send({ contactId, when: "best_time" });
    expect(res.status).toBe(201);
    expect(res.body.queued).toBe(true);
    const call = await owner.call.findUnique({ where: { id: res.body.id } });
    expect(call!.status).toBe("QUEUED");
    expect(call!.providerCallSid).toBeNull();
    const meta = call!.meta as { scheduledAt?: string; window?: { timezone: string } };
    expect(meta.scheduledAt).toBeTruthy();
    expect(new Date(meta.scheduledAt!).getTime()).toBeGreaterThan(Date.now());
    expect(meta.window?.timezone).toBe((await owner.contact.findUnique({ where: { id: contactId } }))!.timezone);
    expect(queuedJobs.length).toBe(1);
    // Pending-row dedup: a second ask returns the SAME queued call, no twin.
    const again = await request(app.getHttpServer())
      .post(`/agents/${agentId}/calls`)
      .set(asOwner())
      .send({ contactId, when: "best_time" });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(res.body.id);
    expect(await owner.call.count({ where: { workspaceId: ws, status: "QUEUED" } })).toBe(1);
    await owner.call.deleteMany({ where: { workspaceId: ws } });
    // Restore the awake clock for the caps tests below.
    await owner.contact.update({ where: { id: contactId }, data: { timezone: awakeTimezone() } });
  });

  it("the lifetime attempt cap and the unanswered threshold refuse typed", async () => {
    // Guardrails rider: cap 3 / voicemail threshold 2 (the defaults).
    // Attempts count PLACED calls only (providerCallSid set) — refusal rows
    // never burn the cap, so the fixtures carry sids like real dials.
    for (let i = 0; i < 2; i++) {
      await owner.call.create({
        data: {
          workspaceId: ws,
          campaignId,
          agentId,
          contactId,
          direction: "OUTBOUND",
          status: "FAILED",
          outcome: "no_answer",
          caller: "ada",
          providerCallSid: `CA-sandbox-cap-${suffix}-${i}`,
        },
      });
    }
    const res = await request(app.getHttpServer())
      .post(`/agents/${agentId}/calls`)
      .set(asOwner())
      .send({ contactId, when: "best_time" });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("CALL_RETRIES_EXHAUSTED");
    expect(res.body.message).toContain("answering-machine detection");

    await owner.call.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        direction: "OUTBOUND",
        status: "COMPLETED",
        outcome: "completed",
        caller: "ada",
        providerCallSid: `CA-sandbox-cap-${suffix}-2`,
      },
    });
    const capped = await request(app.getHttpServer())
      .post(`/agents/${agentId}/calls`)
      .set(asOwner())
      .send({ contactId, when: "best_time" });
    expect(capped.status).toBe(422);
    expect(capped.body.reason).toBe("CALL_MAX_ATTEMPTS");

    // A sid-less row (a crash between row-create and the provider dial, or a
    // canceled queue entry) is not a placed call — it burns nothing.
    await owner.call.deleteMany({ where: { workspaceId: ws } });
    await owner.call.create({
      data: {
        workspaceId: ws,
        campaignId,
        agentId,
        contactId,
        direction: "OUTBOUND",
        status: "FAILED",
        outcome: "canceled",
        caller: "ada",
      },
    });
    const stillOpen = await request(app.getHttpServer())
      .post(`/agents/${agentId}/calls`)
      .set(asOwner())
      .send({ contactId, when: "best_time" });
    expect(stillOpen.status).toBe(201); // sid-less rows burn nothing; the clock is open
    await owner.call.deleteMany({ where: { workspaceId: ws } });
  });

  it("the consent flip writes provenance to the timeline", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/contacts/${contactId}`)
      .set(asOwner())
      .send({ callConsent: "denied" });
    expect(res.status).toBe(200);
    const ev = await owner.event.findFirst({
      where: { workspaceId: ws, contactId, type: "contact.call_consent.v1" },
      orderBy: { occurredAt: "desc" },
    });
    expect(ev!.payload).toMatchObject({ value: "denied", how: "staff", byUserId: userIds[0] });
  });

  it("the CSV import's explicit call-consent column persists + logs; absent stays unknown", async () => {
    const res = await request(app.getHttpServer())
      .post("/contacts/import")
      .set(asOwner())
      .send({
        rows: [
          { email: `vd-csv-yes-${suffix}@t.test`, callConsent: "granted" },
          { email: `vd-csv-no-${suffix}@t.test`, callConsent: "denied" },
          { email: `vd-csv-unset-${suffix}@t.test` },
        ],
      });
    expect(res.status).toBe(201);
    const [yes, no, unset] = await Promise.all([
      owner.contact.findFirst({ where: { workspaceId: ws, email: `vd-csv-yes-${suffix}@t.test` } }),
      owner.contact.findFirst({ where: { workspaceId: ws, email: `vd-csv-no-${suffix}@t.test` } }),
      owner.contact.findFirst({ where: { workspaceId: ws, email: `vd-csv-unset-${suffix}@t.test` } }),
    ]);
    expect(yes!.callConsent).toBe("granted");
    expect(no!.callConsent).toBe("denied");
    expect(unset!.callConsent).toBe("unknown");
    const events = await owner.event.findMany({
      where: { workspaceId: ws, type: "contact.call_consent.v1", contactId: { in: [yes!.id, no!.id, unset!.id] } },
    });
    expect(events).toHaveLength(2); // defaulted unknown is a non-event
  });

  it("a voice step passes the manual-edit graph gate", async () => {
    const res = await request(app.getHttpServer())
      .put("/planner/graph")
      .set(asOwner())
      .send({
        agentId,
        graph: {
          entry: "s1",
          nodes: [
            { id: "s1", type: "step", channel: "email", content: { subject: "Hello", body: "A note." } },
            { id: "d1", type: "delay", amount: 2, unit: "days" },
            { id: "s2", type: "step", channel: "voice", content: {} },
            { id: "e1", type: "end" },
          ],
          edges: [
            { from: "s1", to: "d1" },
            { from: "d1", to: "s2" },
            { from: "s2", to: "e1" },
          ],
        },
      });
    expect([200, 201]).toContain(res.status);
  });
});
