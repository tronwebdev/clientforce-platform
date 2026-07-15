/**
 * P5 W1 (DEC-083) e2e: sender health + warmup + DNS over the API, vs real
 * Postgres+RLS with vendors mocked — fresh senders stamp a ramp; the score
 * endpoint computes deterministically (low_data below the floor, never a fake
 * score); the DNS re-check walks verified → unchecked honestly (never
 * cached-as-verified) and is role-gated; and the SendGrid webhook fast path
 * collapses a bouncing sender so the very next send refuses SENDER_UNHEALTHY
 * (reversible — recovery restores).
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WARMUP_CURVE_VERSION, type DnsCheckDeps, type EmailSender, type RenderedEmail } from "@clientforce/channels";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { DNS_CHECK_DEPS, EMAIL_TRANSPORT } from "../src/channels/channels.providers";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_INBOX = `inbox-shs-${suffix}@allowed.test`;

class CapturingSender implements EmailSender {
  sent: RenderedEmail[] = [];
  async send(email: RenderedEmail) {
    this.sent.push(email);
    return { providerMessageId: `<shs-${this.sent.length}-${suffix}@send.clientforce.io>` };
  }
}

/** Swappable DNS deps — each test picks the world the checker sees. */
const dnsWorld: { resolveTxt: DnsCheckDeps["resolveTxt"] } = {
  resolveTxt: async () => [["v=DMARC1; p=none;"]],
};
const dnsDeps: DnsCheckDeps = {
  resolveTxt: (host) => dnsWorld.resolveTxt(host),
  sendgridApiKey: "sg-e2e",
  fetchImpl: (async () => ({
    ok: true,
    json: async () => [
      {
        domain: "clientforce.io",
        subdomain: "send",
        valid: true,
        dns: {
          mail_cname: { valid: true, host: "send.clientforce.io", type: "cname", data: "u1.wl.sendgrid.net" },
          dkim1: { valid: true, host: "s1._domainkey.clientforce.io", type: "cname", data: "s1.u1.wl.sendgrid.net" },
          dkim2: { valid: true, host: "s2._domainkey.clientforce.io", type: "cname", data: "s2.u1.wl.sendgrid.net" },
        },
      },
    ],
  })) as unknown as typeof fetch,
};

describe.skipIf(!hasDb)("Sender health API e2e (P5 W1)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let viewerToken: string;
  const transport = new CapturingSender();

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });
  const asViewer = () => ({ Authorization: `Bearer ${viewerToken}`, "x-workspace-id": ws });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    process.env.CHANNELS_ALLOWLIST = TEST_INBOX;
    owner = createPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `shs-${suffix}`, slug: `shs-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "SHS", slug: `shs-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: {
          workspaceId: ws,
          name: "Booker",
          goal: "book_appointments",
          guardrails: {
            sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
            dailyCap: { email: 100 },
            consent: null,
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: "42 Demo Street, Austin TX", citations: [], source: "typed" } },
      },
    });
    const u1 = await owner.user.create({
      data: { email: `shs-owner-${suffix}@t.test`, authProviderId: `auth|shs-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const viewer = await owner.user.create({
      data: { email: `shs-viewer-${suffix}@t.test`, authProviderId: `auth|shs-viewer-${suffix}` },
    });
    await owner.membership.create({ data: { userId: viewer.id, workspaceId: ws, role: "VIEWER" } });
    userIds = [u1.id, viewer.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|shs-owner-${suffix}`, email: u1.email });
    viewerToken = await signDevToken(SECRET, { sub: `auth|shs-viewer-${suffix}`, email: viewer.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(transport)
      .overrideProvider(DNS_CHECK_DEPS)
      .useValue(dnsDeps)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await owner.$disconnect();
  });

  it("POST /senders stamps the warmup ramp on a FRESH sender (day 1, current curve)", async () => {
    const res = await request(app.getHttpServer())
      .post("/senders")
      .set(asOwner())
      .send({ type: "CF_MANAGED", fromEmail: `fresh-${suffix}@send.clientforce.io`, fromName: "Fresh" });
    expect(res.status).toBe(201);
    expect(res.body.warmupState?.curve).toBe(WARMUP_CURVE_VERSION);
    expect(res.body.warmupState?.startedAt).toBeTruthy();
  });

  it("GET /senders carries the additive read-model: warmup projection + health (null until computed)", async () => {
    const res = await request(app.getHttpServer()).get("/senders").set(asOwner());
    expect(res.status).toBe(200);
    const fresh = res.body.find((s: { fromEmail: string }) => s.fromEmail.startsWith("fresh-"));
    expect(fresh.warmup).toMatchObject({ active: true, day: 1, days: 45 });
    expect(fresh.health).toBeNull(); // no sweep has run — never invented
    expect(typeof fresh.sentToday).toBe("number");
  });

  it("GET /senders/:id/health: below the sample floor → low_data, score null, honest sample", async () => {
    const senders = await request(app.getHttpServer()).get("/senders").set(asOwner());
    const id = senders.body[0].id;
    const res = await request(app.getHttpServer()).get(`/senders/${id}/health`).set(asOwner());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      senderId: id,
      score: null,
      state: "low_data",
      floor: "none",
      windowDays: 7,
      persisted: null,
    });
    expect(res.body.sample.sent).toBe(0);
  });

  it("DNS re-check: verified walk persists per-record status; a later failed lookup REPLACES it (never cached-as-verified); role-gated", async () => {
    const senders = await request(app.getHttpServer()).get("/senders").set(asOwner());
    const id = senders.body[0].id;

    const viewerTry = await request(app.getHttpServer()).post(`/senders/${id}/dns-check`).set(asViewer());
    expect(viewerTry.status).toBe(403);

    const verified = await request(app.getHttpServer()).post(`/senders/${id}/dns-check`).set(asOwner());
    expect(verified.status).toBe(201);
    expect(verified.body.domainAuthStatus.spf).toMatchObject({ status: "verified", pass: true });
    expect(verified.body.domainAuthStatus.dkim.status).toBe("verified");
    expect(verified.body.domainAuthStatus.dmarc).toMatchObject({ status: "verified", pass: true });

    // The world breaks: resolver now times out. The re-check must write
    // `unchecked` — it must NOT keep serving the stale "verified".
    dnsWorld.resolveTxt = async () => {
      const err = new Error("timeout") as NodeJS.ErrnoException;
      err.code = "ETIMEOUT";
      throw err;
    };
    const broken = await request(app.getHttpServer()).post(`/senders/${id}/dns-check`).set(asOwner());
    expect(broken.body.domainAuthStatus.dmarc).toMatchObject({ status: "unchecked", pass: false });
    const persisted = await owner.senderConnection.findUniqueOrThrow({ where: { id } });
    expect((persisted.domainAuthStatus as { dmarc?: { status?: string } }).dmarc?.status).toBe("unchecked");
    dnsWorld.resolveTxt = async () => [["v=DMARC1; p=none;"]];
  });

  it("webhook fast path: a bounce storm collapses the sender and the next send refuses SENDER_UNHEALTHY; recovery restores", async () => {
    // A sender past its ramp (no warmupState) with a 30-send day and 9 bounces
    // + 1 spam — bounce 30% / spam 3.3%, far past the 2×-breach zero points.
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "CF_MANAGED",
        fromEmail: `stormy-${suffix}@send.clientforce.io`,
        fromName: "Stormy",
        dailyLimit: 200,
      },
    });
    const contact = await owner.contact.create({
      data: { workspaceId: ws, source: "seed", optOut: {}, tags: [], email: `storm-lead-${suffix}@t.test` },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "storm", graphId: "g1" },
    });
    const yesterday = new Date(Date.now() - 3_600_000);
    const ids = Array.from({ length: 30 }, (_, i) => `storm-${i}-${suffix}`);
    await owner.message.createMany({
      data: ids.map((pid) => ({
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: contact.id,
        channel: "email",
        direction: "OUTBOUND" as const,
        body: "storm probe",
        providerMessageId: `<${pid}@send.clientforce.io>`,
        senderId: sender.id,
        sentAt: yesterday,
        meta: { senderId: sender.id },
      })),
    });

    const bounceBatch = [
      ...ids.slice(0, 9).map((pid) => ({
        event: "bounce",
        email: `storm-lead-${suffix}@t.test`,
        timestamp: 1720000000,
        reason: "550 mailbox unavailable",
        sg_message_id: `${pid}@send.clientforce.io.filter001`,
      })),
      {
        event: "spamreport",
        email: `storm-lead-${suffix}@t.test`,
        timestamp: 1720000001,
        sg_message_id: `${ids[9]}@send.clientforce.io.filter001`,
      },
    ];
    const hook = await request(app.getHttpServer()).post("/webhooks/sendgrid").send(bounceBatch);
    expect(hook.status).toBe(201);
    expect(hook.body.received).toBe(10);

    // The fast path recomputed and persisted the collapse…
    const collapsed = await owner.senderConnection.findUniqueOrThrow({ where: { id: sender.id } });
    expect((collapsed.healthState as { state?: string })?.state).toBe("unhealthy");
    // …its transition landed in the ledger…
    const events = await owner.event.findMany({
      where: { workspaceId: ws, type: "sender.health_collapsed.v1", senderId: sender.id },
    });
    expect(events).toHaveLength(1);
    // …and the boundary now refuses this sender, typed.
    const refused = await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asOwner())
      .send({ senderId: sender.id, agentId, to: TEST_INBOX });
    expect(refused.status).toBe(422);
    expect(refused.body.reason).toBe("SENDER_UNHEALTHY");

    // Recovery restores: a healthy snapshot (as the sweep would write after a
    // clean window) opens the gate again — the refusal is reversible.
    await owner.senderConnection.update({
      where: { id: sender.id },
      data: {
        healthState: {
          v: 1, score: 90, state: "healthy", floor: "ok", windowDays: 7,
          computedAt: new Date().toISOString(),
          sample: { sent: 60, delivered: 58, bounced: 0, spam: 0, replied: 2 },
          rates: { bounce: 0, spam: 0, delivery: 0.97, reply: 0.03 },
        },
      },
    });
    const restored = await request(app.getHttpServer())
      .post("/senders/test-send")
      .set(asOwner())
      .send({ senderId: sender.id, agentId, to: TEST_INBOX });
    expect(restored.status).toBe(201);
    expect(restored.body.providerMessageId).toBeTruthy();
  });

  it("SMS senders have no DNS posture: dns-check → 400, honest not fake", async () => {
    const sms = await owner.senderConnection.create({
      data: {
        workspaceId: ws,
        type: "TWILIO_SMS",
        fromEmail: "+15005550012",
        fromName: "SMS",
        dailyLimit: 50,
      },
    });
    const res = await request(app.getHttpServer()).post(`/senders/${sms.id}/dns-check`).set(asOwner());
    expect(res.status).toBe(400);
  });
});
