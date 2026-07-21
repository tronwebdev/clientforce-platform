/**
 * INT W1 (DEC-093) integrations API e2e vs real Postgres+RLS — the connect →
 * probe → configure → disconnect walk with the vendor mocked at its HTTP
 * boundary (CI rule):
 *
 *   connect    — authorize URL carries the signed workspace-scoped state;
 *                unknown provider + unconfigured platform app refuse typed
 *   complete   — bad state → 422 STATE_INVALID; good code → probe-backed
 *                "connected" row, tokens ENCRYPTED at rest (never in any
 *                response or readable column), `integration.connected.v1`
 *   probe      — vendor auth failure flips the honest `revoked` state and
 *                writes ONE `integration.status_changed.v1`
 *   config     — PATCH validates through the per-provider schema; unknown
 *                keys 400; channel + toggles round-trip
 *   options    — the Slack channel picker listing straight off the adapter
 *   disconnect — row deleted, `integration.disconnected.v1` outlives it
 *   activity   — deliveries + integration.* ledger rows for the drawer
 *   RBAC/RLS   — AGENT reads but can't manage; workspace B sees nothing
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppPrismaClient, createPrismaClient, decryptField, withTenant, type PrismaClient } from "@clientforce/db";
import { validateEvent } from "@clientforce/events";
import { SlackAdapter, type IntegrationsDeps } from "@clientforce/integrations";
import type { Prisma } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { INTEGRATIONS_DEPS } from "../src/integrations/integrations.providers";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `intw1e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");

/** The programmable vendor — flip `script` per test, no network ever. */
const script: { authTest?: () => unknown; exchange?: () => unknown } = {};
const scriptedAdapter = new SlackAdapter({
  clientId: "cid",
  clientSecret: "csec",
  baseUrl: "https://slack.test/api",
  fetchImpl: async (url) => {
    const path = String(url);
    const respond = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (path.endsWith("oauth.v2.access"))
      return respond(
        script.exchange?.() ?? {
          ok: true,
          access_token: "stubtok-e2e-token",
          scope: "chat:write,channels:read",
          team: { id: "T1", name: "BrightPath" },
        },
      );
    if (path.endsWith("auth.test")) return respond(script.authTest?.() ?? { ok: true, team: "BrightPath" });
    if (path.includes("conversations.list"))
      return respond({ ok: true, channels: [{ id: "C2", name: "general" }, { id: "C1", name: "alerts" }] });
    if (path.endsWith("auth.revoke")) return respond({ ok: true });
    return respond({ ok: false, error: "unknown_method" });
  },
});

describe.skipIf(!hasDb)("integrations e2e (INT W1, DEC-093)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let appClient: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let ownerToken: string;
  let agentToken: string;
  let deps: IntegrationsDeps;

  const api = () => request(app.getHttpServer());
  const asOwner = (r: request.Test) => r.set("Authorization", `Bearer ${ownerToken}`).set("x-workspace-id", wsA);
  const asOwnerB = (r: request.Test) => r.set("Authorization", `Bearer ${ownerToken}`).set("x-workspace-id", wsB);
  const asAgent = (r: request.Test) => r.set("Authorization", `Bearer ${agentToken}`).set("x-workspace-id", wsA);

  /** Walk the real OAuth loop: connect → pull state out of the URL → complete. */
  const connectSlack = async () => {
    const start = await asOwner(api().post("/integrations/slack/connect")).expect(201);
    const state = new URL(start.body.authorizeUrl).searchParams.get("state") as string;
    return asOwner(api().post("/integrations/slack/complete"))
      .send({ code: "e2e-code", state })
      .expect(201);
  };

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    appClient = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    wsA = (await owner.workspace.create({ data: { agencyId, name: "A", slug: `a-${suffix}`, settings: {} } })).id;
    wsB = (await owner.workspace.create({ data: { agencyId, name: "B", slug: `b-${suffix}`, settings: {} } })).id;

    const u1 = await owner.user.create({
      data: { email: `owner-${suffix}@t.test`, authProviderId: `auth|owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsA, role: "OWNER" } });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: wsB, role: "OWNER" } });
    const u2 = await owner.user.create({
      data: { email: `agent-${suffix}@t.test`, authProviderId: `auth|agent-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u2.id, workspaceId: wsA, role: "AGENT" } });
    ownerToken = await signDevToken(SECRET, { sub: `auth|owner-${suffix}`, email: u1.email });
    agentToken = await signDevToken(SECRET, { sub: `auth|agent-${suffix}`, email: u2.email });

    deps = {
      prisma: appClient,
      adapters: { slack: scriptedAdapter },
      publish: async (input) => {
        const validated = validateEvent(input);
        await withTenant(appClient, { workspaceId: validated.workspaceId }, (tx) =>
          tx.event.create({
            data: {
              workspaceId: validated.workspaceId,
              type: validated.type,
              contactId: validated.contactId,
              enrollmentId: validated.enrollmentId,
              campaignId: validated.campaignId,
              senderId: validated.senderId,
              payload: validated.payload as Prisma.InputJsonValue,
            },
          }),
        );
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(INTEGRATIONS_DEPS)
      .useValue(deps)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await appClient.$disconnect();
  });

  it("refuses an unknown provider typed on every route", async () => {
    const res = await asOwner(api().post("/integrations/notion/connect")).expect(422);
    expect(res.body.detail).toContain("Unknown integration provider");
    await asOwner(api().get("/integrations/notion")).expect(422);
  });

  it("refuses connect while the platform app is unconfigured — the honest owner-clock state", async () => {
    const unconfigured = new SlackAdapter({ clientId: undefined, clientSecret: undefined, fetchImpl: async () => new Response("{}") });
    const live = deps.adapters.slack;
    deps.adapters.slack = unconfigured;
    try {
      const res = await asOwner(api().post("/integrations/slack/connect")).expect(422);
      expect(res.body.detail).toContain("not configured");
    } finally {
      deps.adapters.slack = live;
    }
  });

  it("connect mints a state-carrying authorize URL (OWNER/ADMIN only)", async () => {
    await asAgent(api().post("/integrations/slack/connect")).expect(403);
    const res = await asOwner(api().post("/integrations/slack/connect")).expect(201);
    const url = new URL(res.body.authorizeUrl);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toContain("/integrations/callback/slack");
  });

  it("complete refuses a forged/expired/cross-workspace state typed", async () => {
    const bad = await asOwner(api().post("/integrations/slack/complete"))
      .send({ code: "c", state: "forged.state" })
      .expect(422);
    expect(bad.body.detail).toContain("state");

    // a state minted for workspace A must not complete against workspace B
    const start = await asOwner(api().post("/integrations/slack/connect")).expect(201);
    const stateA = new URL(start.body.authorizeUrl).searchParams.get("state") as string;
    await asOwnerB(api().post("/integrations/slack/complete")).send({ code: "c", state: stateA }).expect(422);
  });

  it("the full connect walk: probe-backed connected row, tokens encrypted, ledger audit", async () => {
    const res = await connectSlack();
    expect(res.body.integration).toMatchObject({
      provider: "slack",
      status: "connected",
      accountLabel: "BrightPath workspace",
      scopes: ["chat:write", "channels:read"],
    });
    // token material NEVER leaves the server or lands readable
    expect(JSON.stringify(res.body)).not.toContain("stubtok");
    const raw = await owner.integration.findUniqueOrThrow({
      where: { workspaceId_provider: { workspaceId: wsA, provider: "slack" } },
    });
    expect(JSON.stringify(raw.credentials)).not.toContain("stubtok");
    expect(Buffer.from(raw.credentialsEnc as Uint8Array).toString("utf8")).not.toContain("stubtok");
    expect(JSON.parse(decryptField(Buffer.from(raw.credentialsEnc as Uint8Array))).accessToken).toBe("stubtok-e2e-token");
    expect(raw.lastProbeAt).not.toBeNull();

    const events = await owner.event.findMany({ where: { workspaceId: wsA, type: "integration.connected.v1" } });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const list = await asOwner(api().get("/integrations")).expect(200);
    expect(list.body.integrations).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("stubtok");
  });

  it("AGENT can read but not manage; workspace B sees nothing (RLS)", async () => {
    await asAgent(api().get("/integrations")).expect(200);
    await asAgent(api().patch("/integrations/slack")).send({ config: {} }).expect(403);
    await asAgent(api().delete("/integrations/slack")).expect(403);
    const fromB = await asOwnerB(api().get("/integrations")).expect(200);
    expect(fromB.body.integrations).toHaveLength(0);
  });

  it("PATCH config validates through the per-provider schema and round-trips", async () => {
    const bad = await asOwner(api().patch("/integrations/slack"))
      .send({ config: { channel: { id: "C1" } } })
      .expect(400);
    expect(bad.body.message).toBe("Validation failed");
    const ok = await asOwner(api().patch("/integrations/slack"))
      .send({ config: { channel: { id: "C1", name: "alerts" }, notifications: { goal_completed: false } } })
      .expect(200);
    expect(ok.body.integration.config).toEqual({
      channel: { id: "C1", name: "alerts" },
      notifications: { goal_completed: false },
    });
  });

  it("options lists the Slack channels sorted for the picker", async () => {
    const res = await asOwner(api().get("/integrations/slack/options?kind=channels")).expect(200);
    expect(res.body.options).toEqual([
      { id: "C1", name: "alerts" },
      { id: "C2", name: "general" },
    ]);
    await asOwner(api().get("/integrations/slack/options?kind=teacups")).expect(422);
  });

  it("probe flips the honest revoked state on vendor auth failure — ONE transition event", async () => {
    script.authTest = () => ({ ok: false, error: "token_revoked" });
    try {
      const res = await asOwner(api().post("/integrations/slack/probe")).expect(201);
      expect(res.body.status).toBe("revoked");
      const detail = await asOwner(api().get("/integrations/slack")).expect(200);
      expect(detail.body.integration.status).toBe("revoked");
      const transitions = await owner.event.findMany({
        where: { workspaceId: wsA, type: "integration.status_changed.v1" },
      });
      expect(transitions).toHaveLength(1);
      expect(transitions[0]?.payload).toMatchObject({ from: "connected", to: "revoked" });
    } finally {
      delete script.authTest;
    }
    // recovery probe → connected again
    const back = await asOwner(api().post("/integrations/slack/probe")).expect(201);
    expect(back.body.status).toBe("connected");
  });

  it("activity returns deliveries + the integration.* ledger rows", async () => {
    const row = await owner.integration.findUniqueOrThrow({
      where: { workspaceId_provider: { workspaceId: wsA, provider: "slack" } },
    });
    await owner.integrationDelivery.create({
      data: {
        workspaceId: wsA,
        integrationId: row.id,
        sourceEventId: `seed-${suffix}`,
        kind: "new_reply",
        status: "delivered",
        detail: { channel: "alerts" },
      },
    });
    const res = await asOwner(api().get("/integrations/slack/activity")).expect(200);
    expect(res.body.deliveries.length).toBeGreaterThanOrEqual(1);
    expect(res.body.deliveries[0]).toMatchObject({ kind: "new_reply", status: "delivered" });
    expect(res.body.events.some((e: { type: string }) => e.type === "integration.connected.v1")).toBe(true);
  });

  it("disconnect deletes the row; the ledger outlives it", async () => {
    await asOwner(api().delete("/integrations/slack")).expect(200);
    const detail = await asOwner(api().get("/integrations/slack")).expect(200);
    expect(detail.body.integration).toBeNull();
    const gone = await owner.integration.findUnique({
      where: { workspaceId_provider: { workspaceId: wsA, provider: "slack" } },
    });
    expect(gone).toBeNull();
    const events = await owner.event.findMany({ where: { workspaceId: wsA, type: "integration.disconnected.v1" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ provider: "slack", reason: "user" });
    // second disconnect refuses honestly
    await asOwner(api().delete("/integrations/slack")).expect(422);
  });
});
