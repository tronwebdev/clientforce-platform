/**
 * INT W1 (DEC-093): the integrations spine vs REAL Postgres + RLS — probe-
 * backed status transitions (never "connected" without a live probe), the
 * encrypt-at-rest rule (token bytes never in a readable column), disconnect
 * audit, the ONE delivery path (idempotency · allowance hold + cost alert ·
 * AUTH → honest revoked flip), the notifier consumer end-to-end, and the
 * notify_team transport dedupe. Vendor mocked (CI rule); skips without infra.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAppPrismaClient, createPrismaClient, decryptField, type PrismaClient } from "@clientforce/db";
import { validateEvent, type BusEvent, type EventInput } from "@clientforce/events";
import {
  IntegrationProviderError,
  SlackAdapter,
  completeConnect,
  createIntegrationNotifier,
  createNotifyTeamTransport,
  deliverSlack,
  disconnectIntegration,
  probeIntegration,
  type IntegrationsDeps,
} from "../src";

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `intw1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** A SlackAdapter whose fetch is a programmable script — no network ever. */
function scriptedSlack(script: {
  exchange?: () => unknown;
  authTest?: () => unknown;
  postMessage?: () => unknown;
}): SlackAdapter {
  return new SlackAdapter({
    clientId: "cid",
    clientSecret: "csec",
    baseUrl: "https://slack.test/api",
    fetchImpl: async (url) => {
      const path = String(url);
      const respond = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      if (path.endsWith("oauth.v2.access"))
        return respond(script.exchange?.() ?? { ok: true, access_token: "stubtok-scripted", scope: "chat:write,channels:read", team: { id: "T1", name: "Bright" } });
      if (path.endsWith("auth.test")) return respond(script.authTest?.() ?? { ok: true, team: "Bright" });
      if (path.endsWith("chat.postMessage")) return respond(script.postMessage?.() ?? { ok: true });
      if (path.endsWith("auth.revoke")) return respond({ ok: true });
      return respond({ ok: false, error: "unknown_method" });
    },
  });
}

describe.skipIf(!hasInfra)("integrations spine (INT W1)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;

  const newWorkspace = async (tag: string): Promise<string> => {
    const ws = await owner.workspace.create({
      data: { agencyId, name: tag, slug: `${suffix}-${tag}`, settings: {} },
    });
    return ws.id;
  };

  const makeDeps = (
    adapter: SlackAdapter,
    events: EventInput[],
    overrides: Partial<IntegrationsDeps> = {},
  ): IntegrationsDeps => ({
    prisma: app,
    adapters: { slack: adapter },
    publish: async (e) => {
      validateEvent(e); // every emission stays catalog-valid
      events.push(e);
    },
    ...overrides,
  });

  const busEvent = (workspaceId: string, type: string, payload: unknown, id: string, contactId: string | null = null): BusEvent => ({
    id,
    workspaceId,
    type: type as BusEvent["type"],
    contactId,
    enrollmentId: null,
    campaignId: null,
    senderId: null,
    payload,
    occurredAt: new Date().toISOString(),
  });

  const connect = async (deps: IntegrationsDeps, workspaceId: string) =>
    completeConnect(deps, { workspaceId, provider: "slack", code: "code", redirectUri: "https://app/cb" });

  const configure = async (workspaceId: string, id: string, config: unknown) =>
    owner.integration.update({ where: { id }, data: { config: config as object } });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
  });
  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("connect: exchanges + probes + encrypts — token bytes NEVER in a readable column", async () => {
    const ws = await newWorkspace("connect");
    const events: EventInput[] = [];
    const deps = makeDeps(scriptedSlack({}), events);
    const row = await connect(deps, ws);

    expect(row.status).toBe("connected");
    expect(row.accountLabel).toBe("Bright workspace");
    expect(row.scopes).toEqual(["chat:write", "channels:read"]);
    expect(row.lastProbeAt).not.toBeNull();

    const raw = await owner.integration.findUniqueOrThrow({ where: { id: row.id } });
    expect(JSON.stringify(raw.credentials)).not.toContain("stubtok"); // retired column stays empty
    expect(JSON.stringify(raw.config)).not.toContain("stubtok");
    expect(raw.credentialsEnc).not.toBeNull();
    const enc = Buffer.from(raw.credentialsEnc as Uint8Array);
    expect(enc.toString("utf8")).not.toContain("stubtok"); // ciphertext, not plaintext
    expect(JSON.parse(decryptField(enc)).accessToken).toBe("stubtok-scripted");

    expect(events.map((e) => e.type)).toEqual(["integration.connected.v1"]);
    expect(events[0]?.payload).toMatchObject({ provider: "slack", accountLabel: "Bright workspace" });
  });

  it("probe transitions are honest and published on ACTUAL change only", async () => {
    const ws = await newWorkspace("probe");
    const events: EventInput[] = [];
    const script: { authTest?: () => unknown } = {};
    const deps = makeDeps(scriptedSlack(script), events);
    await connect(deps, ws);
    events.length = 0;

    // healthy probe → still connected → NO transition event
    expect((await probeIntegration(deps, { workspaceId: ws, provider: "slack" })).status).toBe("connected");
    expect(events).toHaveLength(0);

    // vendor 200/ok:false invalid_auth → revoked + ONE transition event
    script.authTest = () => ({ ok: false, error: "invalid_auth" });
    expect((await probeIntegration(deps, { workspaceId: ws, provider: "slack" })).status).toBe("revoked");
    expect(events.map((e) => e.type)).toEqual(["integration.status_changed.v1"]);
    expect(events[0]?.payload).toMatchObject({ from: "connected", to: "revoked" });

    // repeat probe while revoked → no duplicate transition
    expect((await probeIntegration(deps, { workspaceId: ws, provider: "slack" })).status).toBe("revoked");
    expect(events).toHaveLength(1);

    // recovery → connected again, second transition
    delete script.authTest;
    expect((await probeIntegration(deps, { workspaceId: ws, provider: "slack" })).status).toBe("connected");
    expect(events.map((e) => e.type)).toEqual(["integration.status_changed.v1", "integration.status_changed.v1"]);
  });

  it("transient vendor failure probes to unhealthy, never revoked", async () => {
    const ws = await newWorkspace("unhealthy");
    const events: EventInput[] = [];
    const script: { authTest?: () => unknown } = {};
    const deps = makeDeps(scriptedSlack(script), events);
    await connect(deps, ws);
    script.authTest = () => ({ ok: false, error: "internal_error" });
    expect((await probeIntegration(deps, { workspaceId: ws, provider: "slack" })).status).toBe("unhealthy");
  });

  it("disconnect deletes the row and the ledger outlives it", async () => {
    const ws = await newWorkspace("disconnect");
    const events: EventInput[] = [];
    const deps = makeDeps(scriptedSlack({}), events);
    await connect(deps, ws);
    await disconnectIntegration(deps, { workspaceId: ws, provider: "slack" });
    expect(await owner.integration.findFirst({ where: { workspaceId: ws } })).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["integration.connected.v1", "integration.disconnected.v1"]);
    expect(events[1]?.payload).toMatchObject({ provider: "slack", reason: "user" });
  });

  it("deliverSlack: delivered → row + notified event + lastSyncAt; redelivery dedupes", async () => {
    const ws = await newWorkspace("deliver");
    const events: EventInput[] = [];
    const deps = makeDeps(scriptedSlack({}), events);
    const row = await connect(deps, ws);
    await configure(ws, row.id, { channel: { id: "C1", name: "alerts" } });
    events.length = 0;

    const first = await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "hi", sourceEventId: "evt-1" });
    expect(first).toMatchObject({ delivered: true, target: "#alerts" });
    const deliveries = await owner.integrationDelivery.findMany({ where: { workspaceId: ws } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ kind: "new_reply", status: "delivered", sourceEventId: "evt-1" });
    expect(events.map((e) => e.type)).toEqual(["integration.notified.v1"]);
    expect((await owner.integration.findUniqueOrThrow({ where: { id: row.id } })).lastSyncAt).not.toBeNull();

    // same source event again → duplicate skipped, no second row/event
    const dup = await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "hi", sourceEventId: "evt-1" });
    expect(dup.detail).toContain("duplicate");
    expect(await owner.integrationDelivery.count({ where: { workspaceId: ws } })).toBe(1);
    expect(events).toHaveLength(1);
  });

  it("delivery-time PROVIDER_AUTH flips the row to the honest revoked state", async () => {
    const ws = await newWorkspace("authfail");
    const events: EventInput[] = [];
    const script: { postMessage?: () => unknown } = {};
    const deps = makeDeps(scriptedSlack(script), events);
    const row = await connect(deps, ws);
    await configure(ws, row.id, { channel: { id: "C1", name: "alerts" } });
    events.length = 0;

    script.postMessage = () => ({ ok: false, error: "token_revoked" });
    const res = await deliverSlack(deps, { workspaceId: ws, kind: "meeting_booked", text: "x", sourceEventId: "evt-2" });
    expect(res.delivered).toBe(false);
    expect((await owner.integration.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("revoked");
    expect(events.map((e) => e.type)).toEqual(["integration.sync_failed.v1", "integration.status_changed.v1"]);
    const failedRow = await owner.integrationDelivery.findFirst({ where: { workspaceId: ws } });
    expect(failedRow).toMatchObject({ status: "failed" });

    // revoked connection: later deliveries skip without touching the vendor
    const after = await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "y", sourceEventId: "evt-3" });
    expect(after.delivered).toBe(false);
    expect(after.detail).toContain("revoked");
  });

  it("config refusals (channel_not_found) record a failed row but never touch status", async () => {
    const ws = await newWorkspace("chanfail");
    const events: EventInput[] = [];
    const script: { postMessage?: () => unknown } = {};
    const deps = makeDeps(scriptedSlack(script), events);
    const row = await connect(deps, ws);
    await configure(ws, row.id, { channel: { id: "GONE", name: "gone" } });
    script.postMessage = () => ({ ok: false, error: "channel_not_found" });
    const res = await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "x", sourceEventId: "evt-4" });
    expect(res.delivered).toBe(false);
    expect((await owner.integration.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("connected");
  });

  it("allowance trips hold deliveries with the rising-edge event + COST ALERT", async () => {
    const ws = await newWorkspace("allowance");
    const events: EventInput[] = [];
    const deps = makeDeps(scriptedSlack({}), events, { config: { dailyDeliveryAllowance: 2 } });
    const row = await connect(deps, ws);
    await configure(ws, row.id, { channel: { id: "C1", name: "alerts" } });
    events.length = 0;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "1", sourceEventId: "a-1" })).delivered).toBe(true);
      expect((await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "2", sourceEventId: "a-2" })).delivered).toBe(true);
      const held = await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "3", sourceEventId: "a-3" });
      expect(held.delivered).toBe(false);
      expect(held.detail).toContain("held");
      const held2 = await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "4", sourceEventId: "a-4" });
      expect(held2.delivered).toBe(false);

      const heldRows = await owner.integrationDelivery.findMany({ where: { workspaceId: ws, status: "held" } });
      expect(heldRows).toHaveLength(2);
      // rising edge: ONE delivery_held event + ONE cost-alert line for the episode
      expect(events.filter((e) => e.type === "integration.delivery_held.v1")).toHaveLength(1);
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0]?.[0])).toContain("COST ALERT");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("notifier consumer: replies/bookings/goals post per toggles; integration events never notify", async () => {
    const ws = await newWorkspace("consumer");
    const events: EventInput[] = [];
    const deps = makeDeps(scriptedSlack({}), events);
    const row = await connect(deps, ws);
    await configure(ws, row.id, {
      channel: { id: "C1", name: "alerts" },
      notifications: { goal_completed: false },
    });
    const contact = await owner.contact.create({
      data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: "ada@example.test", firstName: "Ada" },
    });
    const notifier = createIntegrationNotifier(deps);

    await notifier.handle(busEvent(ws, "email.replied.v1", { messageId: "m1", intent: "interested" }, "e-reply", contact.id));
    await notifier.handle(busEvent(ws, "lead.stage_changed.v1", { fromStage: "new", toStage: "booked" }, "e-booked", contact.id));
    // toggled OFF → no delivery
    await notifier.handle(busEvent(ws, "lead.stage_changed.v1", { fromStage: "a", toStage: "won", goalKey: "g", label: "Won" }, "e-goal", contact.id));
    // loop safety
    await notifier.handle(busEvent(ws, "integration.notified.v1", { provider: "slack", kind: "new_reply" }, "e-loop"));
    // redelivery of the same bus event → one row only
    await notifier.handle(busEvent(ws, "email.replied.v1", { messageId: "m1", intent: "interested" }, "e-reply", contact.id));

    const rows = await owner.integrationDelivery.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.kind).sort()).toEqual(["meeting_booked", "new_reply"]);
    expect(rows.every((r) => r.status === "delivered")).toBe(true);
  });

  it("notify_team transport: delivers with the rule-scoped dedupe key; absent connection skips honestly", async () => {
    const ws = await newWorkspace("transport");
    const events: EventInput[] = [];
    const deps = makeDeps(scriptedSlack({}), events);
    const row = await connect(deps, ws);
    await configure(ws, row.id, { channel: { id: "C1", name: "alerts" } });
    const transport = createNotifyTeamTransport(deps);

    const res = await transport({ workspaceId: ws, sourceKey: "evt-9#rule:r1", note: "Hot lead" });
    expect(res).toMatchObject({ delivered: true, target: "#alerts" });
    // a second rule on the same event delivers separately …
    expect((await transport({ workspaceId: ws, sourceKey: "evt-9#rule:r2", note: "Also fired" })).delivered).toBe(true);
    // … but the SAME rule+event redelivery dedupes
    const dup = await transport({ workspaceId: ws, sourceKey: "evt-9#rule:r1", note: "Hot lead" });
    expect(dup.detail).toContain("duplicate");
    expect(await owner.integrationDelivery.count({ where: { workspaceId: ws, kind: "notify_team" } })).toBe(2);

    const bare = await newWorkspace("transport-bare");
    expect((await transport({ workspaceId: bare, sourceKey: "evt-9#rule:r1" })).delivered).toBe(false);
  });

  it("RLS: integration + delivery rows are invisible cross-tenant on the app client", async () => {
    const wsA = await newWorkspace("rls-a");
    const wsB = await newWorkspace("rls-b");
    const events: EventInput[] = [];
    const deps = makeDeps(scriptedSlack({}), events);
    const row = await connect(deps, wsA);
    await configure(wsA, row.id, { channel: { id: "C1", name: "alerts" } });
    await deliverSlack(deps, { workspaceId: wsA, kind: "new_reply", text: "x", sourceEventId: "rls-1" });

    const { withTenant } = await import("@clientforce/db");
    const fromB = await withTenant(app, { workspaceId: wsB }, (tx) => tx.integration.findMany());
    expect(fromB).toHaveLength(0);
    const deliveriesFromB = await withTenant(app, { workspaceId: wsB }, (tx) => tx.integrationDelivery.findMany());
    expect(deliveriesFromB).toHaveLength(0);
  });

  it("adapter probe failure classes map to IntegrationProviderError (spine sanity)", async () => {
    const adapter = scriptedSlack({ authTest: () => ({ ok: false, error: "invalid_auth" }) });
    await expect(adapter.probe({ accessToken: "x" })).rejects.toBeInstanceOf(IntegrationProviderError);
  });

  it("reconnect after revoke: the upsert UPDATE branch resets status, swaps the token, preserves config", async () => {
    const ws = await newWorkspace("reconnect");
    const events: EventInput[] = [];
    const script: { exchange?: () => unknown; authTest?: () => unknown } = {};
    const deps = makeDeps(scriptedSlack(script), events);
    const row = await connect(deps, ws);
    await configure(ws, row.id, { channel: { id: "C1", name: "alerts" }, notifications: { goal_completed: false } });

    script.authTest = () => ({ ok: false, error: "invalid_auth" });
    await probeIntegration(deps, { workspaceId: ws, provider: "slack" }); // → revoked
    delete script.authTest;

    script.exchange = () => ({
      ok: true,
      access_token: "stubtok-second",
      scope: "chat:write",
      team: { id: "T1", name: "Bright" },
    });
    const again = await connect(deps, ws); // the Reconnect repair — UPDATE branch
    expect(again.id).toBe(row.id);
    expect(again.status).toBe("connected");
    expect(again.scopes).toEqual(["chat:write"]);
    const raw = await owner.integration.findUniqueOrThrow({ where: { id: row.id } });
    expect(JSON.parse(decryptField(Buffer.from(raw.credentialsEnc as Uint8Array))).accessToken).toBe("stubtok-second");
    // config survives the reconnect — the stored channel + toggle opt-outs
    // are the user's, never clobbered by the OAuth round-trip.
    expect(raw.config).toMatchObject({ channel: { id: "C1", name: "alerts" }, notifications: { goal_completed: false } });
  });

  it("bus outage: every operation still lands its row state; publish failures only log", async () => {
    const ws = await newWorkspace("busdown");
    const logs: string[] = [];
    const deps = makeDeps(scriptedSlack({}), [], {
      publish: async () => {
        throw new Error("bus down");
      },
      log: (m) => logs.push(m),
    });
    const row = await connect(deps, ws);
    expect(row.status).toBe("connected");
    await configure(ws, row.id, { channel: { id: "C1", name: "alerts" } });
    const res = await deliverSlack(deps, { workspaceId: ws, kind: "new_reply", text: "x", sourceEventId: "bd-1" });
    expect(res).toMatchObject({ delivered: true, target: "#alerts" });
    expect(await owner.integrationDelivery.count({ where: { workspaceId: ws, status: "delivered" } })).toBe(1);
    await probeIntegration(deps, { workspaceId: ws, provider: "slack" });
    await disconnectIntegration(deps, { workspaceId: ws, provider: "slack" });
    expect(await owner.integration.findFirst({ where: { workspaceId: ws } })).toBeNull();
    expect(logs.some((l) => l.includes("event publish failed"))).toBe(true);
  });

  it("a pending claim owns the key: the second deliverer skips the vendor call (at-most-once)", async () => {
    const ws = await newWorkspace("pending");
    const events: EventInput[] = [];
    const deps = makeDeps(scriptedSlack({}), events);
    const row = await connect(deps, ws);
    await configure(ws, row.id, { channel: { id: "C1", name: "alerts" } });
    // Simulate a crashed-mid-delivery claim: a pending row already holds the key.
    await owner.integrationDelivery.create({
      data: { workspaceId: ws, integrationId: row.id, sourceEventId: "pend-1", kind: "new_reply", status: "pending", detail: {} },
    });
    const posts: string[] = [];
    const spyAdapter = scriptedSlack({
      postMessage: () => {
        posts.push("posted");
        return { ok: true };
      },
    });
    const res = await deliverSlack(makeDeps(spyAdapter, events), {
      workspaceId: ws,
      kind: "new_reply",
      text: "x",
      sourceEventId: "pend-1",
    });
    expect(res.delivered).toBe(false);
    expect(res.detail).toContain("in flight");
    expect(posts).toHaveLength(0); // the vendor was never called
  });

  it("honest-absence pins: unknown provider refuses typed; unwired adapter skips without touching the DB", async () => {
    const { adapterFor, IntegrationRefusedError } = await import("../src/service");
    expect(() => adapterFor({ prisma: app, adapters: {} }, "slack")).toThrowError(IntegrationRefusedError);
    const ws = await newWorkspace("unwired");
    const res = await deliverSlack(
      { prisma: app, adapters: {} },
      { workspaceId: ws, kind: "new_reply", text: "x", sourceEventId: "uw-1" },
    );
    expect(res).toEqual({ delivered: false, detail: "slack adapter not wired" });
    expect(await owner.integrationDelivery.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it("notifier consumer NEVER dead-letters: a DB outage resolves with a loud log (review-round pin)", async () => {
    const logs: string[] = [];
    const broken = {
      prisma: { $transaction: async () => Promise.reject(new Error("db down")) } as never,
      adapters: { slack: scriptedSlack({}) },
      log: (m: string) => logs.push(m),
    };
    const notifier = createIntegrationNotifier(broken);
    await expect(
      notifier.handle(busEvent("ws-any", "email.replied.v1", { messageId: "m", intent: "interested" }, "e-db-down")),
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("notifier failed"))).toBe(true);
  });
});
