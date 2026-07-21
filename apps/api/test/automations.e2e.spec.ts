/**
 * R1-UI (DEC-091) account-rules API e2e — W1 read · enable/disable · delete
 * (+ the ledger-backed run history) vs real Postgres+RLS. Same harness as
 * api.e2e.spec.ts — skips without a DB.
 *
 *   list      — rows parsed through the CORE unions; invalid rows render the
 *               honest error state (invalid: true), run counts + lastRun real
 *   runs      — LEDGER-sourced (`automation.rule.run.v1` Event rows), newest
 *               first, contact joined; raw rows, no invented aggregate
 *   toggle    — one `automation.status_changed.v1` per ACTUAL flip; a
 *               same-state PATCH is a no-op with no audit noise
 *   delete    — refusal walk: live `run_automation` referrers (enabled
 *               campaign rule OR enabled automation) → typed 422 naming
 *               them; unreferenced → atomic cascade + `automation.deleted.v1`
 *   RBAC/RLS  — AGENT reads but can't manage; workspace B never sees A's rows
 *
 * W2 — create/edit through the ONE engine validation + the write guards:
 *   create    — `automationWriteSchema` at the boundary (conditions refine
 *               replies ONLY → 400); campaign-scoped `move_to_node` → 422
 *               ACCOUNT_ACTION_REFUSAL; dup trigger vs an ENABLED row → 422
 *               DUPLICATE_TRIGGER_REFUSAL naming it (intents compare as
 *               SETS); disabled rows never block; no catalog event
 *   enable    — the enabled-duplicate invariant guards PATCH too: a disabled
 *               twin creates fine but can't become the second ENABLED rule
 *   refs      — `run_automation` at a missing target refuses on create;
 *               self-reference refuses on edit (never dangling by CRUD)
 *   edit      — PUT full replace; dup check excludes self; an enabled flip
 *               emits the same ONE status_changed the PATCH path writes
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `r1ui-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("automations e2e (R1-UI W1, DEC-091)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let agentToken: string;
  let campaignId: string;
  let contactId: string;

  const api = () => request(app.getHttpServer());
  const asOwner = (r: request.Test) =>
    r.set("Authorization", `Bearer ${ownerToken}`).set("x-workspace-id", wsA);
  const asOwnerB = (r: request.Test) =>
    r.set("Authorization", `Bearer ${ownerToken}`).set("x-workspace-id", wsB);
  const asAgent = (r: request.Test) =>
    r.set("Authorization", `Bearer ${agentToken}`).set("x-workspace-id", wsA);

  const addAutomation = (over: Record<string, unknown> = {}) =>
    owner.automation.create({
      data: {
        workspaceId: wsA,
        name: "Flag hot replies",
        trigger: { kind: "reply_classified", intents: ["interested"] },
        conditions: [],
        actions: [{ kind: "add_tag", tag: "hot" }],
        ...over,
      } as never,
    });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
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
    userIds = [u1.id, u2.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|owner-${suffix}`, email: u1.email });
    agentToken = await signDevToken(SECRET, { sub: `auth|agent-${suffix}`, email: u2.email });

    const agentRow = await owner.agent.create({
      data: { workspaceId: wsA, name: "Rules agent", goal: "book_appointments", guardrails: {} },
    });
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: wsA, agentId: agentRow.id, name: "primary", graphId: "" },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: wsA,
          source: "test",
          optOut: {},
          tags: [],
          firstName: "Priya",
          lastName: "Sharma",
          email: `priya-${suffix}@t.test`,
        },
      })
    ).id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await owner.event.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
    await owner.automationRun.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
    await owner.automation.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
    await owner.campaignRule.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  it("GET /automations — rows parse through the core unions with real run counts; invalid rows carry the honest error state", async () => {
    const good = await addAutomation();
    const broken = await addAutomation({
      name: "unreadable",
      trigger: { bogus: true },
    });
    await owner.automationRun.create({
      data: {
        workspaceId: wsA,
        automationId: good.id,
        eventId: `evt-${suffix}-1`,
        status: "fired",
        detail: {},
      },
    });

    const res = await asOwner(api().get("/automations"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const goodRow = res.body.find((r: { id: string }) => r.id === good.id);
    expect(goodRow).toMatchObject({
      name: "Flag hot replies",
      enabled: true,
      invalid: false,
      runs: 1,
      trigger: { kind: "reply_classified", intents: ["interested"] },
      actions: [{ kind: "add_tag", tag: "hot" }],
    });
    expect(goodRow.lastRunAt).toBeTruthy();
    const brokenRow = res.body.find((r: { id: string }) => r.id === broken.id);
    expect(brokenRow).toMatchObject({ invalid: true, trigger: null, runs: 0 });
  });

  it("RLS: workspace B lists nothing of A's; a cross-workspace PATCH 404s", async () => {
    const row = await addAutomation();
    const listB = await asOwnerB(api().get("/automations"));
    expect(listB.status).toBe(200);
    expect(listB.body).toHaveLength(0);
    const patchB = await asOwnerB(api().patch(`/automations/${row.id}`)).send({ enabled: false });
    expect(patchB.status).toBe(404);
  });

  it("PATCH toggle — audited on ACTUAL change only (the sender.status_changed pattern); AGENT is refused", async () => {
    const row = await addAutomation();

    const off = await asOwner(api().patch(`/automations/${row.id}`)).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ enabled: false, changed: true });

    // Same-state PATCH: no-op, NO second audit row.
    const again = await asOwner(api().patch(`/automations/${row.id}`)).send({ enabled: false });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ enabled: false, changed: false });

    const audits = await owner.event.findMany({
      where: { workspaceId: wsA, type: "automation.status_changed.v1" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({
      automationId: row.id,
      from: "enabled",
      to: "disabled",
    });

    const agentTry = await asAgent(api().patch(`/automations/${row.id}`)).send({ enabled: true });
    expect(agentTry.status).toBe(403);
    // AGENT can still read the surface.
    expect((await asAgent(api().get("/automations"))).status).toBe(200);
  });

  it("DELETE refusal walk — a live run_automation referrer refuses 422 naming it; disabling the referrer clears the way; runs cascade; the deleted event outlives the row", async () => {
    const target = await addAutomation({ name: "Suppress + tag" });
    const referrerRule = await owner.campaignRule.create({
      data: {
        workspaceId: wsA,
        campaignId,
        order: 1,
        trigger: { kind: "opted_out" } as never,
        actions: [{ kind: "run_automation", automationId: target.id }] as never,
      },
    });
    const referrerAutomation = await addAutomation({
      name: "Chained caller",
      trigger: { kind: "meeting_booked" },
      actions: [{ kind: "run_automation", automationId: target.id }],
    });
    await owner.automationRun.create({
      data: {
        workspaceId: wsA,
        automationId: target.id,
        eventId: `evt-${suffix}-del`,
        status: "fired",
        detail: {},
      },
    });

    const refused = await asOwner(api().delete(`/automations/${target.id}`));
    expect(refused.status).toBe(422);
    expect(refused.body.message).toBe("Automation is still referenced");
    expect(refused.body.detail).toContain("campaign rule in");
    expect(refused.body.detail).toContain("Chained caller");
    expect(await owner.automation.count({ where: { id: target.id } })).toBe(1);

    // Disable both referrers — the refusal clears (disabled rows don't block).
    await owner.campaignRule.update({ where: { id: referrerRule.id }, data: { enabled: false } });
    await owner.automation.update({ where: { id: referrerAutomation.id }, data: { enabled: false } });

    const ok = await asOwner(api().delete(`/automations/${target.id}`));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ deleted: true });
    expect(await owner.automation.count({ where: { id: target.id } })).toBe(0);
    // Dependent state went atomically (runs cascade)…
    expect(await owner.automationRun.count({ where: { automationId: target.id } })).toBe(0);
    // …and the ledger row outlives the automation (the audit).
    const deletedEvents = await owner.event.findMany({
      where: { workspaceId: wsA, type: "automation.deleted.v1" },
    });
    expect(deletedEvents).toHaveLength(1);
    expect(deletedEvents[0]!.payload).toMatchObject({
      automationId: target.id,
      name: "Suppress + tag",
      trigger: "reply_classified",
    });
  });

  it("GET /automations/:id/runs — ledger-sourced rows, newest first, contact joined for 'on whom'", async () => {
    const row = await addAutomation();
    const mkEvent = (runId: string, status: string, at: Date) =>
      owner.event.create({
        data: {
          workspaceId: wsA,
          type: "automation.rule.run.v1",
          contactId,
          campaignId,
          payload: {
            ruleId: row.id,
            runId,
            status,
            trigger: "reply_classified",
            scope: "account",
            ...(status === "fired" ? {} : { detail: "add_tag=error" }),
          },
          occurredAt: at,
        },
      });
    await mkEvent("run-1", "fired", new Date(Date.now() - 60_000));
    await mkEvent("run-2", "error", new Date());
    // Noise the listing must skip: another automation's run event.
    const other = await addAutomation({ name: "other" });
    await owner.event.create({
      data: {
        workspaceId: wsA,
        type: "automation.rule.run.v1",
        payload: { ruleId: other.id, runId: "run-x", status: "fired", trigger: "opted_out", scope: "account" },
      },
    });

    const res = await asOwner(api().get(`/automations/${row.id}/runs`));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      runId: "run-2",
      status: "error",
      detail: "add_tag=error",
      contactLabel: "Priya Sharma",
    });
    expect(res.body[1]).toMatchObject({ runId: "run-1", status: "fired" });

    const missing = await asOwner(api().get(`/automations/nope/runs`));
    expect(missing.status).toBe(404);
  });

  // ── W2: create / edit ──────────────────────────────────────────────────────

  const writeBody = (over: Record<string, unknown> = {}) => ({
    name: "Stop on unsubscribe",
    trigger: { kind: "opted_out" },
    actions: [{ kind: "end_enrollment" }],
    ...over,
  });

  it("POST /automations — creates through the ONE engine validation; conditions on a non-reply trigger 400 at the boundary; no catalog event", async () => {
    const res = await asOwner(api().post("/automations")).send(writeBody());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Stop on unsubscribe",
      enabled: true,
      invalid: false,
      runs: 0,
      trigger: { kind: "opted_out" },
      actions: [{ kind: "end_enrollment" }],
    });
    expect(await owner.automation.count({ where: { id: res.body.id } })).toBe(1);
    // Creation isn't in the locked A9 catalog — the initial state is state,
    // not a change: zero events.
    expect(await owner.event.count({ where: { workspaceId: wsA } })).toBe(0);

    // A conditioned non-reply rule would never fire — refused loudly, never
    // created quietly (the automationWriteSchema boundary rule).
    const conditioned = await asOwner(api().post("/automations")).send(
      writeBody({
        name: "never fires",
        conditions: [{ kind: "keyword_contains", keywords: ["pricing"] }],
      }),
    );
    expect(conditioned.status).toBe(400);
    expect(conditioned.body.message).toBe("Validation failed");
  });

  it("POST refusals — campaign-scoped move_to_node 422s; an EQUAL trigger vs an ENABLED row 422s naming it (intents compare as SETS); disabled rows don't block", async () => {
    const scoped = await asOwner(api().post("/automations")).send(
      writeBody({ actions: [{ kind: "move_to_node", targetNodeId: "n1" }] }),
    );
    expect(scoped.status).toBe(422);
    expect(scoped.body.message).toContain("Campaign View");

    await addAutomation(); // enabled, reply_classified [interested]
    const dup = await asOwner(api().post("/automations")).send(
      writeBody({
        name: "the twin",
        trigger: { kind: "reply_classified", intents: ["interested"] },
        actions: [{ kind: "notify_team" }],
      }),
    );
    expect(dup.status).toBe(422);
    expect(dup.body.message).toContain("already fires on this exact trigger");
    expect(dup.body.detail).toContain("Flag hot replies");

    // Set equality: same intents, different order + duplicates = the SAME trigger.
    await addAutomation({
      name: "two intents",
      trigger: { kind: "reply_classified", intents: ["booked", "interested"] },
    });
    const setDup = await asOwner(api().post("/automations")).send(
      writeBody({
        name: "reordered twin",
        trigger: { kind: "reply_classified", intents: ["interested", "booked", "interested"] },
        actions: [{ kind: "notify_team" }],
      }),
    );
    expect(setDup.status).toBe(422);

    // Overlapping-but-different coexists (#90 semantics)…
    const overlap = await asOwner(api().post("/automations")).send(
      writeBody({
        name: "narrower",
        trigger: { kind: "reply_classified", intents: ["interested", "not_interested"] },
        actions: [{ kind: "notify_team" }],
      }),
    );
    expect(overlap.status).toBe(201);

    // …and a DISABLED row with the same trigger never blocks.
    await addAutomation({ name: "sleeping twin source", trigger: { kind: "meeting_booked" }, enabled: false });
    const vsDisabled = await asOwner(api().post("/automations")).send(
      writeBody({ name: "meeting rule", trigger: { kind: "meeting_booked" }, actions: [{ kind: "notify_team" }] }),
    );
    expect(vsDisabled.status).toBe(201);
  });

  it("the enabled-duplicate invariant guards the PATCH enable path — a disabled twin creates fine but can't become the second ENABLED rule", async () => {
    await addAutomation(); // enabled, reply_classified [interested]
    const sleeper = await asOwner(api().post("/automations")).send(
      writeBody({
        name: "disabled twin",
        enabled: false,
        trigger: { kind: "reply_classified", intents: ["interested"] },
        actions: [{ kind: "notify_team" }],
      }),
    );
    expect(sleeper.status).toBe(201); // a disabled write never conflicts

    const wake = await asOwner(api().patch(`/automations/${sleeper.body.id}`)).send({ enabled: true });
    expect(wake.status).toBe(422);
    expect(wake.body.message).toContain("already fires on this exact trigger");
    // The refused flip changed nothing — and no audit row was written.
    expect((await owner.automation.findUnique({ where: { id: sleeper.body.id } }))?.enabled).toBe(false);
    expect(
      await owner.event.count({ where: { workspaceId: wsA, type: "automation.status_changed.v1" } }),
    ).toBe(0);
  });

  it("run_automation refs — a missing target refuses on create; self-reference refuses on edit (the CRUD never creates dangling state)", async () => {
    const dangling = await asOwner(api().post("/automations")).send(
      writeBody({ actions: [{ kind: "run_automation", automationId: "gone" }] }),
    );
    expect(dangling.status).toBe(422);
    expect(dangling.body.message).toBe("Automation reference not found");

    const target = await addAutomation({ name: "chain target", trigger: { kind: "meeting_booked" } });
    const chained = await asOwner(api().post("/automations")).send(
      writeBody({ actions: [{ kind: "run_automation", automationId: target.id }] }),
    );
    expect(chained.status).toBe(201);

    const selfRef = await asOwner(api().put(`/automations/${chained.body.id}`)).send(
      writeBody({ actions: [{ kind: "run_automation", automationId: chained.body.id }] }),
    );
    expect(selfRef.status).toBe(422);
    expect(selfRef.body.message).toBe("An automation can't run itself");
  });

  it("PUT /automations/:id — full replace; the dup check excludes self; an enabled flip emits ONE automation.status_changed.v1, a same-state edit none", async () => {
    const row = await addAutomation(); // enabled, reply_classified [interested]

    // Same trigger, new name/actions — self never blocks itself.
    const kept = await asOwner(api().put(`/automations/${row.id}`)).send(
      writeBody({
        name: "renamed",
        trigger: { kind: "reply_classified", intents: ["interested"] },
        actions: [{ kind: "notify_team", note: "check this" }],
      }),
    );
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({
      id: row.id,
      name: "renamed",
      enabled: true,
      actions: [{ kind: "notify_team", note: "check this" }],
    });
    expect(await owner.event.count({ where: { workspaceId: wsA } })).toBe(0); // no flip → no audit

    // Editing INTO another enabled row's trigger refuses.
    await addAutomation({ name: "meeting rule", trigger: { kind: "meeting_booked" } });
    const collide = await asOwner(api().put(`/automations/${row.id}`)).send(
      writeBody({ name: "renamed", trigger: { kind: "meeting_booked" }, actions: [{ kind: "notify_team" }] }),
    );
    expect(collide.status).toBe(422);
    expect(collide.body.detail).toContain("meeting rule");

    // A flip riding the edit audits exactly once (the PATCH path's event).
    const flipped = await asOwner(api().put(`/automations/${row.id}`)).send(
      writeBody({
        name: "renamed",
        enabled: false,
        trigger: { kind: "reply_classified", intents: ["interested"] },
        actions: [{ kind: "notify_team" }],
      }),
    );
    expect(flipped.status).toBe(200);
    expect(flipped.body.enabled).toBe(false);
    const audits = await owner.event.findMany({
      where: { workspaceId: wsA, type: "automation.status_changed.v1" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ automationId: row.id, from: "enabled", to: "disabled" });

    const missing = await asOwner(api().put(`/automations/nope`)).send(writeBody());
    expect(missing.status).toBe(404);
  });

  it("W2 RBAC/RLS — AGENT can't create or edit; workspace B's writes never touch A's rows", async () => {
    const row = await addAutomation();
    expect((await asAgent(api().post("/automations")).send(writeBody())).status).toBe(403);
    expect((await asAgent(api().put(`/automations/${row.id}`)).send(writeBody())).status).toBe(403);
    // Cross-workspace edit 404s under RLS — B can't even see the row.
    expect((await asOwnerB(api().put(`/automations/${row.id}`)).send(writeBody())).status).toBe(404);
    // B's dup check is scoped to B: A's enabled trigger never blocks B.
    const inB = await asOwnerB(api().post("/automations")).send(
      writeBody({ trigger: { kind: "reply_classified", intents: ["interested"] }, actions: [{ kind: "notify_team" }] }),
    );
    expect(inB.status).toBe(201);
    expect((await owner.automation.findFirst({ where: { id: inB.body.id } }))?.workspaceId).toBe(wsB);
  });
});
