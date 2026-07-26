/**
 * INT W2 (DEC-094) Calendly webhook e2e vs real Postgres+RLS — the public
 * booking-detection endpoint end-to-end:
 *
 *   auth        — missing/unknown ?token → 401; bad/absent signature with a
 *                 signing key on the row → 401; keyless row: dev accepts,
 *                 production REJECTS (the SendGrid gate)
 *   ingest      — invitee.created → Meeting row + calendar.booked.v1 +
 *                 lead.stage_changed.v1 (goal rider, NO manual flag)
 *   idempotency — redelivery acks as duplicate, nothing doubles
 *   reschedule  — canceled(rescheduled:true) flips SILENTLY (no events); the
 *                 created(old_invitee) twin moves startAt + ONE
 *                 calendar.rescheduled.v1
 *   no-show     — invitee_no_show.created flips status, reason "no_show"
 *   unmatched   — unknown invitees ack 200-style, Meeting kept, NO events
 */
import { createHmac } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { encryptCredentials } from "@clientforce/integrations";
import { AppModule } from "../src/app.module";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `calweb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
process.env.AUTH_DEV_SECRET ??= "test-dev-secret";

const TOKEN = `tok-${suffix}`;
const SIGNING_KEY = `sk-${suffix}`;

const sign = (body: unknown, key = SIGNING_KEY, t = "1721600000"): string => {
  const v1 = createHmac("sha256", key).update(`${t}.${JSON.stringify(body)}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
};

describe.skipIf(!hasDb)("calendly webhook e2e (INT W2, DEC-094)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let contactId: string;
  let enrollmentId: string;

  const api = () => request(app.getHttpServer());

  const invitee = (over: Record<string, unknown> = {}, scheduledOver: Record<string, unknown> = {}) => ({
    event: "invitee.created",
    payload: {
      uri: `https://calendly.test/invitees/I-${suffix}-1`,
      email: `lead-${suffix}@t.test`,
      timezone: "America/Chicago",
      rescheduled: false,
      scheduled_event: {
        uri: `https://calendly.test/events/E1`,
        name: "Intro call",
        start_time: "2026-07-28T15:00:00.000000Z",
        end_time: "2026-07-28T15:30:00.000000Z",
        ...scheduledOver,
      },
      tracking: { utm_source: "clientforce", utm_content: "" },
      ...over,
    },
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "cw", slug: suffix, settings: {} } })).id;
    const agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    const campaignId = (
      await owner.campaign.create({ data: { workspaceId: ws, agentId, name: "primary", graphId: "" } })
    ).id;
    contactId = (
      await owner.contact.create({
        data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `lead-${suffix}@t.test` },
      })
    ).id;
    enrollmentId = (
      await owner.enrollment.create({
        data: {
          workspaceId: ws,
          campaignId,
          contactId,
          workflowId: `enroll-${suffix}`,
          pipelineStage: "new",
          meta: {},
        },
      })
    ).id;
    await owner.integration.create({
      data: {
        workspaceId: ws,
        provider: "calendly",
        status: "connected",
        config: { schedulingUrl: "https://calendly.com/ada", webhookToken: TOKEN, detection: true },
        scopes: [],
        credentialsEnc: encryptCredentials({ apiToken: "stubtok-pat", signingKey: SIGNING_KEY }),
      },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // The real bootstrap runs NestFactory.create(..., { rawBody: true }) —
    // mirror it so the signature verifies over the true wire bytes.
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  beforeEach(async () => {
    await owner.meeting.deleteMany({ where: { workspaceId: ws } });
    await owner.event.deleteMany({ where: { workspaceId: ws } });
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { pipelineStage: "new", meta: {} } });
  });

  afterAll(async () => {
    await app?.close();
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
  });

  it("refuses a missing or unknown webhook token (401)", async () => {
    const body = invitee();
    await api().post("/webhooks/calendly").set("calendly-webhook-signature", sign(body)).send(body).expect(401);
    await api()
      .post(`/webhooks/calendly?token=not-the-token`)
      .set("calendly-webhook-signature", sign(body))
      .send(body)
      .expect(401);
  });

  it("refuses a bad or absent signature when the row holds a signing key (401)", async () => {
    const body = invitee();
    await api().post(`/webhooks/calendly?token=${TOKEN}`).send(body).expect(401);
    await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(body, "wrong-key"))
      .send(body)
      .expect(401);
    // Tampered body vs a signature over the original.
    const tampered = invitee({ email: "attacker@evil.test" });
    await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(body))
      .send(tampered)
      .expect(401);
    expect(await owner.meeting.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it("invitee.created (utm match) → Meeting + calendar.booked.v1 + stage change with goal rider, NO manual flag", async () => {
    const body = invitee({ tracking: { utm_source: "clientforce", utm_content: contactId } });
    const res = await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(body))
      .send(body)
      .expect(201);
    expect(res.body).toMatchObject({ received: true, outcome: "booked", matchedBy: "utm" });

    const meeting = await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } });
    expect(meeting).toMatchObject({ provider: "calendly", status: "booked", contactId, enrollmentId });
    expect(meeting.startAt.toISOString()).toBe("2026-07-28T15:00:00.000Z");

    const events = await owner.event.findMany({ where: { workspaceId: ws }, orderBy: { occurredAt: "asc" } });
    expect(events.map((e) => e.type).sort()).toEqual(["calendar.booked.v1", "lead.stage_changed.v1"]);
    const stage = events.find((e) => e.type === "lead.stage_changed.v1")!;
    expect(stage.payload).toMatchObject({ fromStage: "new", toStage: "booked", goalKey: "book_appointments" });
    expect((stage.payload as { manual?: boolean }).manual).toBeUndefined();
    expect(
      (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).pipelineStage,
    ).toBe("booked");

    // Redelivery acks as duplicate — nothing doubles.
    const again = await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(body))
      .send(body)
      .expect(201);
    expect(again.body.outcome).toBe("duplicate");
    expect(await owner.meeting.count({ where: { workspaceId: ws } })).toBe(1);
    expect(await owner.event.count({ where: { workspaceId: ws } })).toBe(2);
  });

  it("an unmatched invitee acks honestly: contact-less Meeting row, ZERO events", async () => {
    const body = invitee({ email: "stranger@else.test", uri: `https://calendly.test/invitees/I-${suffix}-x` });
    const res = await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(body))
      .send(body)
      .expect(201);
    expect(res.body).toMatchObject({ received: true, outcome: "unmatched", matchedBy: "none" });
    expect((await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } })).contactId).toBeNull();
    expect(await owner.event.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it("reschedule (REAL vendor shape): canceled(rescheduled:true) flips silently; created(old_invitee, rescheduled:false) moves the row", async () => {
    // Review-round fix: rescheduled:true lives on the CANCELED twin; the
    // created twin carries old_invitee with rescheduled:FALSE. The canceled
    // half flips silently (no events — never reads as a loss); the created
    // half re-books via the move, in EITHER delivery order.
    const first = invitee({ tracking: { utm_source: "clientforce", utm_content: contactId } });
    await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(first))
      .send(first)
      .expect(201);
    await owner.event.deleteMany({ where: { workspaceId: ws } });

    const canceledHalf = {
      event: "invitee.canceled",
      payload: { uri: `https://calendly.test/invitees/I-${suffix}-1`, rescheduled: true },
    };
    const ack = await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(canceledHalf))
      .send(canceledHalf)
      .expect(201);
    expect(ack.body.outcome).toBe("rescheduling");
    // silent flip: the sweep must not remind for the abandoned slot mid-reschedule
    expect((await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } })).status).toBe("canceled");
    expect(await owner.event.count({ where: { workspaceId: ws } })).toBe(0);

    const createdHalf = invitee(
      {
        uri: `https://calendly.test/invitees/I-${suffix}-2`,
        rescheduled: false, // the REAL created-twin shape
        old_invitee: `https://calendly.test/invitees/I-${suffix}-1`,
        tracking: { utm_source: "clientforce", utm_content: contactId },
      },
      { start_time: "2026-07-30T16:00:00.000000Z", end_time: "2026-07-30T16:30:00.000000Z" },
    );
    const moved = await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(createdHalf))
      .send(createdHalf)
      .expect(201);
    expect(moved.body.outcome).toBe("rescheduled");
    const meeting = await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } });
    expect(meeting.status).toBe("booked"); // the move re-books whatever the interim state
    expect(meeting.startAt.toISOString()).toBe("2026-07-30T16:00:00.000Z");
    expect(meeting.externalId).toBe(`https://calendly.test/invitees/I-${suffix}-2`);
    const events = await owner.event.findMany({ where: { workspaceId: ws } });
    expect(events.map((e) => e.type)).toEqual(["calendar.rescheduled.v1"]);
    expect(await owner.meeting.count({ where: { workspaceId: ws } })).toBe(1); // ONE row per chain, ever

    // Redelivered PRE-reschedule created(old) must NOT resurrect a stale row
    // (the tombstone dedupe — review-round pin).
    const redelivered = invitee({ tracking: { utm_source: "clientforce", utm_content: contactId } });
    const dup = await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(redelivered))
      .send(redelivered)
      .expect(201);
    expect(dup.body.outcome).toBe("duplicate");
    expect(await owner.meeting.count({ where: { workspaceId: ws } })).toBe(1);
    expect(await owner.event.count({ where: { workspaceId: ws, type: "calendar.booked.v1" } })).toBe(0);
  });

  it("cancel + no-show flip the status with ONE calendar.canceled.v1 each shape; stage untouched", async () => {
    const body = invitee({ tracking: { utm_source: "clientforce", utm_content: contactId } });
    await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(body))
      .send(body)
      .expect(201);
    await owner.event.deleteMany({ where: { workspaceId: ws } });
    const stageBefore = (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).pipelineStage;

    const noShow = {
      event: "invitee_no_show.created",
      payload: {
        uri: `https://calendly.test/no_shows/N1`,
        invitee: `https://calendly.test/invitees/I-${suffix}-1`,
      },
    };
    const res = await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(noShow))
      .send(noShow)
      .expect(201);
    expect(res.body.outcome).toBe("canceled");
    expect((await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } })).status).toBe("no_show");
    const events = await owner.event.findMany({ where: { workspaceId: ws } });
    expect(events.map((e) => e.type)).toEqual(["calendar.canceled.v1"]);
    expect(events[0]?.payload).toMatchObject({ reason: "no_show" });
    // NO stage change on cancel/no-show — rules decide what a loss means.
    expect(
      (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).pipelineStage,
    ).toBe(stageBefore);

    // A cancel for an unknown invitee acks as ignored.
    const unknown = { event: "invitee.canceled", payload: { uri: "https://calendly.test/invitees/never", rescheduled: false } };
    const ignored = await api()
      .post(`/webhooks/calendly?token=${TOKEN}`)
      .set("calendly-webhook-signature", sign(unknown))
      .send(unknown)
      .expect(201);
    expect(ignored.body.outcome).toBe("ignored");
  });

  it("a keyless row (link-tier residue) accepts unsigned in dev but REJECTS in production (the SendGrid gate)", async () => {
    const bare = await owner.workspace.create({ data: { agencyId, name: "bare", slug: `bare-${suffix}`, settings: {} } });
    await owner.integration.create({
      data: {
        workspaceId: bare.id,
        provider: "calendly",
        status: "connected",
        config: { schedulingUrl: "https://calendly.com/bare", webhookToken: `bare-${TOKEN}` },
        scopes: [],
      },
    });
    const body = invitee({ uri: `https://calendly.test/invitees/I-${suffix}-bare`, email: "n@x.test" });
    await api().post(`/webhooks/calendly?token=bare-${TOKEN}`).send(body).expect(201);

    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await api().post(`/webhooks/calendly?token=bare-${TOKEN}`).send(body).expect(401);
    } finally {
      process.env.NODE_ENV = prior;
    }
  });
});
