/**
 * B4 e2e (DEC-124 + DEC-120 expansion 2) in a fresh workspace:
 *  - the widgets admin surface: `ensure` mints ONE widget with its public
 *    credential and is idempotent; PATCH round-trips the consent-ask toggle
 *    and flows; the overview read tells the one-flag truth;
 *  - the consent ask rides the PUBLIC capture spec ONLY when the workspace
 *    toggle is on (default OFF — the spec carries just the sms-reminder
 *    consent otherwise);
 *  - a TICKED box flips Contact.callConsent to granted with the form as
 *    provenance (contact.call_consent.v1, how:"widget_form"), retry-safe
 *    (no duplicate event) and existing-contact-safe; an UNTICKED box
 *    records NOTHING — unknown stands, consent is never inferred.
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WIDGET_CONTRACT_VERSION } from "@clientforce/core";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Widget consent-ask e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let publicId: string;
  let widgetId: string;

  const api = () => request(app.getHttpServer());
  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });
  const boot = () => ({
    contractVersion: WIDGET_CONTRACT_VERSION,
    widgetId: publicId,
    sessionId: null,
    event: { type: "boot" as const },
  });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `wc-${suffix}`, slug: `wc-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "WC", slug: `wc-ws-${suffix}`, settings: {} },
      })
    ).id;
    await owner.agent.create({
      data: { workspaceId: ws, name: "Desk", goal: "book_appointments", guardrails: {} },
    });
    const u1 = await owner.user.create({
      data: { email: `wc-owner-${suffix}@t.test`, authProviderId: `auth|wc-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|wc-owner-${suffix}`, email: u1.email });

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

  it("ensure mints ONE widget with its public credential and is idempotent; overview tells the truth", async () => {
    const before = await api().get("/widgets/overview").set(asOwner()).expect(200);
    expect(before.body.installed).toBe(false);

    const first = await api().post("/widgets/ensure").set(asOwner()).send({}).expect(201);
    expect(first.body.publicId).toMatch(/^wgt_[a-z0-9]{8,32}$/);
    expect(first.body.consentAsk).toBe(false); // the ruled default
    publicId = first.body.publicId;
    widgetId = first.body.id;

    const second = await api().post("/widgets/ensure").set(asOwner()).send({}).expect(201);
    expect(second.body.id).toBe(widgetId); // no twins

    const after = await api().get("/widgets/overview").set(asOwner()).expect(200);
    expect(after.body.installed).toBe(true);
    expect(after.body.chats30d).toBe(0);
  });

  it("default OFF: the public capture spec carries only the sms-reminder consent", async () => {
    const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
    const res = await api()
      .post("/widget/v1/session")
      .send({
        ...boot(),
        sessionId: booted.body.sessionId,
        event: { type: "quick_action", action: "schedule_callback" },
      })
      .expect(201);
    expect(res.body.capture.consent.key).toBe("smsReminder");
    expect(res.body.capture.consents).toBeUndefined();
  });

  it("toggle ON: the ask rides the spec; a ticked box flips consent with the form as provenance", async () => {
    const patched = await api()
      .patch(`/widgets/${widgetId}`)
      .set(asOwner())
      .send({ consentAsk: true })
      .expect(200);
    expect(patched.body.consentAsk).toBe(true);

    const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
    const asked = await api()
      .post("/widget/v1/session")
      .send({
        ...boot(),
        sessionId: booted.body.sessionId,
        event: { type: "quick_action", action: "schedule_callback" },
      })
      .expect(201);
    expect(asked.body.capture.consents).toHaveLength(1);
    expect(asked.body.capture.consents[0].key).toBe("callConsent");

    const when = new Date(Date.now() + 24 * 3600_000).toISOString();
    const phone = `+1512777${String(Date.now()).slice(-4)}`; // FIXED — the retry hits the SAME contact
    const submit = () =>
      api()
        .post("/widget/v1/session")
        .send({
          ...boot(),
          sessionId: booted.body.sessionId,
          event: {
            type: "capture_submit",
            fields: {
              name: "Wren Call",
              phone,
              when,
              smsReminder: "false",
              callConsent: "true",
            },
          },
        });
    const done = await submit().expect(201);
    expect(done.body.outcome.kind).toBe("callback_scheduled");

    const contact = await owner.contact.findFirst({
      where: { workspaceId: ws, firstName: "Wren" },
    });
    expect((contact as { callConsent?: string })!.callConsent).toBe("granted");
    const ev = await owner.event.findFirst({
      where: { workspaceId: ws, contactId: contact!.id, type: "contact.call_consent.v1" },
    });
    expect(ev!.payload).toMatchObject({ value: "granted", how: "widget_form" });

    // Retry-safe: a fresh ask + the same tick again writes NO second
    // provenance event (the change-guard — consent is already granted).
    await api()
      .post("/widget/v1/session")
      .send({
        ...boot(),
        sessionId: booted.body.sessionId,
        event: { type: "quick_action", action: "schedule_callback" },
      })
      .expect(201);
    await submit().expect(201);
    const count = await owner.event.count({
      where: { workspaceId: ws, contactId: contact!.id, type: "contact.call_consent.v1" },
    });
    expect(count).toBe(1);
  });

  it("UNTICKED records nothing — unknown stands, never inferred", async () => {
    const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
    await api()
      .post("/widget/v1/session")
      .send({
        ...boot(),
        sessionId: booted.body.sessionId,
        event: { type: "quick_action", action: "schedule_callback" },
      })
      .expect(201);
    const when = new Date(Date.now() + 24 * 3600_000).toISOString();
    await api()
      .post("/widget/v1/session")
      .send({
        ...boot(),
        sessionId: booted.body.sessionId,
        event: {
          type: "capture_submit",
          fields: {
            name: "Uma Quiet",
            phone: `+1512888${String(Date.now()).slice(-4)}`,
            when,
            smsReminder: "false",
            callConsent: "false",
          },
        },
      })
      .expect(201);
    const contact = await owner.contact.findFirst({ where: { workspaceId: ws, firstName: "Uma" } });
    expect((contact as { callConsent?: string })!.callConsent).toBe("unknown");
    const ev = await owner.event.findFirst({
      where: { workspaceId: ws, contactId: contact!.id, type: "contact.call_consent.v1" },
    });
    expect(ev).toBeNull();
  });
});
