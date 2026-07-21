/**
 * INT W2 (DEC-094): booking ingest vs REAL Postgres + RLS — invitee.created →
 * Meeting row + `calendar.booked.v1` + the ported C2.4 stage change (goalKey
 * rider, NO manual flag), redelivery idempotency, utm→email correlation
 * fallback, unmatched-invitee ack, guarded reschedule/cancel transitions,
 * and the CRITICAL no-double-fire pin: one booking fires a meeting_booked
 * rule EXACTLY ONCE and posts Slack ONCE (`calendar.booked.v1` is a RECORD,
 * never a trigger carrier). Plus the W2 refresh spine: `withFreshCredentials`
 * re-encrypts, Slack stays no-refresh byte-identical, `invalid_grant` flips
 * the honest revoked state. Vendor mocked (CI rule); skips without infra.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  decryptField,
  type PrismaClient,
} from "@clientforce/db";
import { validateEvent, type BusEvent, type EventInput } from "@clientforce/events";
import { evaluateEventForRules, matchTrigger, type RuleEngineDeps } from "@clientforce/automations";
import {
  GoogleCalendarAdapter,
  SlackAdapter,
  completeConnect,
  createIntegrationNotifier,
  encryptCredentials,
  ingestBooking,
  ingestCancellation,
  matchNotificationKind,
  withFreshCredentials,
  type BookingDeps,
  type IntegrationsDeps,
} from "../src";

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `intw2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasInfra)("booking ingest (INT W2)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let enrollmentId: string;

  const published: EventInput[] = [];
  let eventSeq = 0;
  const deps = (): BookingDeps => ({
    prisma: app,
    publish: async (e) => {
      validateEvent(e); // every emission stays catalog-valid
      published.push(e);
    },
    log: () => undefined,
  });

  const asBusEvent = (input: EventInput): BusEvent => ({
    id: `evt-${suffix}-${++eventSeq}`,
    workspaceId: input.workspaceId,
    type: input.type,
    contactId: input.contactId ?? null,
    enrollmentId: input.enrollmentId ?? null,
    campaignId: input.campaignId ?? null,
    senderId: input.senderId ?? null,
    payload: input.payload,
    occurredAt: new Date().toISOString(),
  });

  const bookingInput = (over: Record<string, unknown> = {}) => ({
    workspaceId: ws,
    provider: "calendly",
    externalId: `inv-${suffix}-1`,
    startAt: new Date("2026-07-28T15:00:00Z"),
    endAt: new Date("2026-07-28T15:30:00Z"),
    title: "Intro call",
    timezone: "America/Chicago",
    inviteeEmail: `lead-${suffix}@t.test`,
    utmContent: contactId,
    ...over,
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "w2", slug: suffix, settings: {} } })).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({ data: { workspaceId: ws, agentId, name: "primary", graphId: "" } })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "test",
          optOut: {},
          tags: [],
          email: `Lead-${suffix}@T.test`, // mixed case — the email fallback must match case-insensitively
          firstName: "Ada",
        },
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
  });

  beforeEach(async () => {
    published.length = 0;
    await owner.campaignRuleRun.deleteMany({ where: { workspaceId: ws } });
    await owner.campaignRule.deleteMany({ where: { workspaceId: ws } });
    await owner.integrationDelivery.deleteMany({ where: { workspaceId: ws } });
    await owner.integration.deleteMany({ where: { workspaceId: ws } });
    await owner.meeting.deleteMany({ where: { workspaceId: ws } });
    await owner.enrollment.update({
      where: { id: enrollmentId },
      data: { status: "ACTIVE", pipelineStage: "new", meta: {} },
    });
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("invitee.created → Meeting + calendar.booked.v1 + the C2.4 stage change with the goal rider, NO manual flag", async () => {
    const result = await ingestBooking(deps(), bookingInput());
    expect(result).toMatchObject({ outcome: "booked", matchedBy: "utm", stageChanged: true });

    const meeting = await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } });
    expect(meeting).toMatchObject({
      provider: "calendly",
      status: "booked",
      contactId,
      enrollmentId,
      campaignId,
      title: "Intro call",
    });

    expect(published.map((e) => e.type)).toEqual(["calendar.booked.v1", "lead.stage_changed.v1"]);
    expect(published[0]).toMatchObject({
      contactId,
      enrollmentId,
      campaignId,
      payload: { provider: "calendly", meetingId: meeting.id, matchedBy: "utm" },
    });
    const stage = published[1]!;
    expect(stage).toMatchObject({
      contactId,
      enrollmentId,
      campaignId,
      payload: { fromStage: "new", toStage: "booked", goalKey: "book_appointments" },
    });
    expect((stage.payload as { label?: string }).label).toBeTruthy();
    // The C2.4 port drops the human-move marker — this is a MACHINE move.
    expect((stage.payload as { manual?: boolean }).manual).toBeUndefined();

    expect(
      (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).pipelineStage,
    ).toBe("booked");
  });

  it("REGRESSION PIN: one booking fires a meeting_booked rule EXACTLY ONCE and posts Slack ONCE", async () => {
    // The rule that must not double-fire.
    const rule = await owner.campaignRule.create({
      data: {
        workspaceId: ws,
        campaignId,
        order: 0,
        trigger: { kind: "meeting_booked" } as never,
        actions: [{ kind: "add_tag", tag: "meeting-booked" }] as never,
      },
    });
    // A connected Slack integration with a picked channel (scripted vendor).
    const slack = new SlackAdapter({
      clientId: "cid",
      clientSecret: "csec",
      baseUrl: "https://slack.test/api",
      fetchImpl: async (url) => {
        const respond = (body: unknown) =>
          new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        if (String(url).endsWith("oauth.v2.access"))
          return respond({ ok: true, access_token: "stubtok-x", scope: "chat:write", team: { id: "T1", name: "Bright" } });
        if (String(url).endsWith("auth.test")) return respond({ ok: true, team: "Bright" });
        return respond({ ok: true });
      },
    });
    const integrationsDeps: IntegrationsDeps = {
      prisma: app,
      adapters: { slack },
      publish: async (e) => {
        validateEvent(e);
        published.push(e);
      },
      log: () => undefined,
    };
    const row = await completeConnect(integrationsDeps, {
      workspaceId: ws,
      provider: "slack",
      code: "c",
      redirectUri: "https://app/cb",
    });
    await owner.integration.update({
      where: { id: row.id },
      data: { config: { channel: { id: "C1", name: "alerts" } } },
    });
    published.length = 0;

    // The full fan-out simulation: every published event flows through BOTH
    // consumers exactly once, and anything THEY publish fans out too.
    const ruleDeps: RuleEngineDeps = {
      prisma: app,
      publish: async (e) => {
        validateEvent(e);
        published.push(e);
      },
      log: () => undefined,
    };
    const notifier = createIntegrationNotifier(integrationsDeps);

    await ingestBooking(deps(), bookingInput({ externalId: `inv-${suffix}-pin` }));
    let cursor = 0;
    while (cursor < published.length) {
      const busEvent = asBusEvent(published[cursor]!);
      cursor += 1;
      await evaluateEventForRules(ruleDeps, busEvent);
      await notifier.handle(busEvent);
    }

    // Pure pins: the record event maps to NOTHING.
    expect(matchTrigger({ kind: "meeting_booked" }, { type: "calendar.booked.v1", payload: {} })).toBe(false);
    expect(
      matchNotificationKind(asBusEvent({ workspaceId: ws, type: "calendar.booked.v1", payload: { provider: "calendly", meetingId: "m", startAt: "x" } })),
    ).toBeNull();

    // EXACTLY ONE rule run (the stage-change event; calendar.booked.v1 fired nothing).
    const runs = await owner.campaignRuleRun.findMany({ where: { ruleId: rule.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "fired" });
    // EXACTLY ONE Slack delivery, kind meeting_booked.
    const deliveries = await owner.integrationDelivery.findMany({ where: { workspaceId: ws } });
    expect(deliveries.map((d) => d.kind)).toEqual(["meeting_booked"]);
    expect(deliveries[0]).toMatchObject({ status: "delivered" });
  });

  it("redelivery of the same externalId is a guarded duplicate — no second row, no second event", async () => {
    await ingestBooking(deps(), bookingInput({ externalId: `inv-${suffix}-dup` }));
    const eventsAfterFirst = published.length;
    const again = await ingestBooking(deps(), bookingInput({ externalId: `inv-${suffix}-dup` }));
    expect(again.outcome).toBe("duplicate");
    expect(published).toHaveLength(eventsAfterFirst);
    expect(await owner.meeting.count({ where: { workspaceId: ws } })).toBe(1);
  });

  it("correlation falls back to the lowercase email match when utm is absent", async () => {
    const result = await ingestBooking(
      deps(),
      bookingInput({ externalId: `inv-${suffix}-email`, utmContent: undefined, inviteeEmail: `lead-${suffix}@t.TEST` }),
    );
    expect(result.matchedBy).toBe("email");
    const meeting = await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } });
    expect(meeting.contactId).toBe(contactId);
  });

  it("an unmatched invitee persists a contact-less Meeting row and acks WITHOUT events", async () => {
    const result = await ingestBooking(
      deps(),
      bookingInput({ externalId: `inv-${suffix}-stranger`, utmContent: undefined, inviteeEmail: "nobody@else.test" }),
    );
    expect(result).toMatchObject({ outcome: "unmatched", matchedBy: "none", stageChanged: false });
    const meeting = await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } });
    expect(meeting.contactId).toBeNull();
    expect(published).toHaveLength(0);
  });

  it("an already-booked enrollment gets NO second stage event (guarded transition)", async () => {
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { pipelineStage: "booked" } });
    const result = await ingestBooking(deps(), bookingInput({ externalId: `inv-${suffix}-again` }));
    expect(result.stageChanged).toBe(false);
    expect(published.map((e) => e.type)).toEqual(["calendar.booked.v1"]);
  });

  it("reschedule: moves startAt under the NEW external id + ONE calendar.rescheduled.v1; no stage event", async () => {
    await ingestBooking(deps(), bookingInput({ externalId: `inv-${suffix}-r1` }));
    published.length = 0;
    const result = await ingestBooking(
      deps(),
      bookingInput({
        externalId: `inv-${suffix}-r2`,
        previousExternalId: `inv-${suffix}-r1`,
        startAt: new Date("2026-07-30T16:00:00Z"),
      }),
    );
    expect(result.outcome).toBe("rescheduled");
    const meeting = await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } });
    expect(meeting.externalId).toBe(`inv-${suffix}-r2`);
    expect(meeting.startAt.toISOString()).toBe("2026-07-30T16:00:00.000Z");
    expect(meeting.status).toBe("booked");
    expect(published.map((e) => e.type)).toEqual(["calendar.rescheduled.v1"]);
    expect(published[0]?.payload).toMatchObject({
      fromStartAt: "2026-07-28T15:00:00.000Z",
      toStartAt: "2026-07-30T16:00:00.000Z",
    });
  });

  it("cancel + no-show: guarded flips, one event each, unknown ids ack as ignored, NO stage change", async () => {
    await ingestBooking(deps(), bookingInput({ externalId: `inv-${suffix}-c1` }));
    const stageBefore = (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).pipelineStage;
    published.length = 0;

    const canceled = await ingestCancellation(deps(), {
      workspaceId: ws,
      provider: "calendly",
      externalId: `inv-${suffix}-c1`,
      reason: "canceled",
    });
    expect(canceled.outcome).toBe("canceled");
    expect(published.map((e) => e.type)).toEqual(["calendar.canceled.v1"]);
    expect(published[0]?.payload).toMatchObject({ reason: "canceled" });
    expect((await owner.meeting.findFirstOrThrow({ where: { workspaceId: ws } })).status).toBe("canceled");
    // NO stage change on cancel.
    expect(
      (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).pipelineStage,
    ).toBe(stageBefore);

    // Redelivery converges without a second event.
    const again = await ingestCancellation(deps(), {
      workspaceId: ws,
      provider: "calendly",
      externalId: `inv-${suffix}-c1`,
      reason: "canceled",
    });
    expect(again.outcome).toBe("duplicate");
    expect(published).toHaveLength(1);

    const unknown = await ingestCancellation(deps(), {
      workspaceId: ws,
      provider: "calendly",
      externalId: "never-seen",
      reason: "no_show",
    });
    expect(unknown.outcome).toBe("ignored");
  });

  it("a booking for a contact with NO enrollment records + announces but moves nothing", async () => {
    const loneContact = await owner.contact.create({
      data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `lone-${suffix}@t.test` },
    });
    const result = await ingestBooking(
      deps(),
      bookingInput({ externalId: `inv-${suffix}-lone`, utmContent: loneContact.id, inviteeEmail: `lone-${suffix}@t.test` }),
    );
    expect(result).toMatchObject({ outcome: "booked", stageChanged: false });
    expect(published.map((e) => e.type)).toEqual(["calendar.booked.v1"]);
  });

  describe("withFreshCredentials (the W2 refresh spine)", () => {
    const gcalWith = (script: { refresh?: () => unknown; api?: () => unknown }) =>
      new GoogleCalendarAdapter({
        clientId: "gcid",
        clientSecret: "gsecret",
        baseUrl: "https://gcal.test/v3",
        tokenUrl: "https://gcal.test/oauth2/token",
        fetchImpl: async (url) => {
          const respond = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
          if (String(url).endsWith("/oauth2/token"))
            return respond(script.refresh?.() ?? { access_token: "stubtok-fresh", expires_in: 3600 });
          return respond(script.api?.() ?? { items: [] });
        },
      });

    const seedGcalRow = async (expiresAt: string, accessToken = "stubtok-stale") =>
      owner.integration.create({
        data: {
          workspaceId: ws,
          provider: "gcal",
          status: "connected",
          config: {},
          scopes: [],
          credentialsEnc: encryptCredentials({ accessToken, refreshToken: "stubtok-refresh", expiresAt }),
        },
      });

    it("refreshes an expired token, RE-ENCRYPTS + persists, then runs the call on the fresh token", async () => {
      const row = await seedGcalRow(new Date(Date.now() - 1000).toISOString());
      const idps: IntegrationsDeps = { prisma: app, adapters: { gcal: gcalWith({}) }, log: () => undefined };
      const seen: string[] = [];
      await withFreshCredentials(idps, row, async (creds) => {
        seen.push(String(creds.accessToken));
      });
      expect(seen).toEqual(["stubtok-fresh"]);
      const raw = await owner.integration.findUniqueOrThrow({ where: { id: row.id } });
      const enc = Buffer.from(raw.credentialsEnc as Uint8Array);
      expect(enc.toString("utf8")).not.toContain("stubtok"); // still ciphertext at rest
      const stored = JSON.parse(decryptField(enc)) as Record<string, unknown>;
      expect(stored.accessToken).toBe("stubtok-fresh");
      expect(stored.refreshToken).toBe("stubtok-refresh");
    });

    it("a still-fresh token skips the refresh entirely", async () => {
      const row = await seedGcalRow(new Date(Date.now() + 3600_000).toISOString(), "stubtok-good");
      let refreshed = 0;
      const idps: IntegrationsDeps = {
        prisma: app,
        adapters: {
          gcal: gcalWith({
            refresh: () => {
              refreshed += 1;
              return { access_token: "should-not-happen", expires_in: 3600 };
            },
          }),
        },
        log: () => undefined,
      };
      await withFreshCredentials(idps, row, async (creds) => {
        expect(creds.accessToken).toBe("stubtok-good");
      });
      expect(refreshed).toBe(0);
    });

    it("refresh invalid_grant flips the honest revoked state and rethrows PROVIDER_AUTH", async () => {
      const row = await seedGcalRow(new Date(Date.now() - 1000).toISOString());
      const events: EventInput[] = [];
      // Google answers invalid_grant as HTTP 400 + {error: "invalid_grant"}.
      const authAdapter = new GoogleCalendarAdapter({
        clientId: "gcid",
        clientSecret: "gsecret",
        tokenUrl: "https://gcal.test/oauth2/token",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "Content-Type": "application/json" } }),
      });
      const idps: IntegrationsDeps = {
        prisma: app,
        adapters: { gcal: authAdapter },
        publish: async (e) => {
          validateEvent(e);
          events.push(e);
        },
        log: () => undefined,
      };
      await expect(withFreshCredentials(idps, row, async () => "unreached")).rejects.toMatchObject({
        code: "PROVIDER_AUTH",
      });
      expect((await owner.integration.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("revoked");
      expect(events.map((e) => e.type)).toEqual(["integration.status_changed.v1"]);
    });

    it("REGRESSION PIN: Slack (no refresh method) passes through byte-identical — credentialsEnc untouched", async () => {
      const slack = new SlackAdapter({ clientId: "cid", clientSecret: "csec", fetchImpl: async () => new Response("{}") });
      const row = await owner.integration.create({
        data: {
          workspaceId: ws,
          provider: "slack",
          status: "connected",
          config: {},
          scopes: [],
          credentialsEnc: encryptCredentials({ accessToken: "stubtok-slack" }),
        },
      });
      const before = Buffer.from(
        (await owner.integration.findUniqueOrThrow({ where: { id: row.id } })).credentialsEnc as Uint8Array,
      );
      const idps: IntegrationsDeps = { prisma: app, adapters: { slack }, log: () => undefined };
      await withFreshCredentials(idps, row, async (creds) => {
        expect(creds.accessToken).toBe("stubtok-slack");
      });
      const after = Buffer.from(
        (await owner.integration.findUniqueOrThrow({ where: { id: row.id } })).credentialsEnc as Uint8Array,
      );
      expect(after.equals(before)).toBe(true);
    });
  });
});
