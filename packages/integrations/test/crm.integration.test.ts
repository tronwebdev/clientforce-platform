/**
 * INT W4 (DEC-096) vs REAL Postgres + RLS — the one-way CRM push:
 *   deliverCrm rails: claim-then-send (create returns + stores the deal id; a
 *   redelivery dedupes to the same id, no second create), update needs a stored
 *   deal (typed refusal otherwise), a delivery-time 401 flips the row revoked,
 *   the outcome-carrying detail. Plus the create→store→update roundtrip through
 *   the REAL engine (create_crm_deal writes Enrollment.meta.crmDealId; a later
 *   update_deal_stage finds it). HubSpot is a stateful in-memory script.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { evaluateEventForRules, type RuleEngineDeps } from "@clientforce/automations";
import { HubspotAdapter, deliverCrm, encryptCredentials, type IntegrationsDeps } from "../src";

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `intw4-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** A stateful HubSpot API: in-memory contacts + deals, create-returns-id. */
function statefulHub(opts?: { authFail?: boolean }) {
  let nextC = 1;
  let nextD = 1;
  const contacts = new Map<string, string>(); // email → id
  const deals: Array<{ id: string; stage?: string }> = [];
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  const adapter = new HubspotAdapter({
    baseUrl: "https://hub.test",
    fetchImpl: async (url, init) => {
      if (opts?.authFail) return json({ message: "expired" }, 401);
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/account-info/v3/details")) return json({ portalId: 777 });
      if (u.endsWith("/crm/v3/objects/contacts/search")) {
        const email = JSON.parse(String(init?.body)).filterGroups[0].filters[0].value as string;
        const id = contacts.get(email);
        return json({ results: id ? [{ id }] : [] });
      }
      if (u.endsWith("/crm/v3/objects/contacts") && method === "POST") {
        const email = JSON.parse(String(init?.body)).properties.email as string;
        const id = `c_${nextC++}`;
        contacts.set(email, id);
        return json({ id });
      }
      if (u.endsWith("/crm/v3/objects/deals") && method === "POST") {
        const props = JSON.parse(String(init?.body)).properties;
        const id = `d_${nextD++}`;
        deals.push({ id, stage: props.dealstage });
        return json({ id });
      }
      if (u.includes("/crm/v4/objects/deals/") && method === "PUT") return new Response(null, { status: 204 });
      if (u.includes("/crm/v3/objects/deals/") && method === "PATCH") {
        const id = u.split("/crm/v3/objects/deals/")[1]!;
        const d = deals.find((x) => x.id === id);
        if (d) d.stage = JSON.parse(String(init?.body)).properties.dealstage;
        return new Response(null, { status: 204 });
      }
      return json({ message: "unknown" }, 400);
    },
  });
  return { adapter, deals, createCount: () => nextD - 1 };
}

describe.skipIf(!hasInfra)("one-way CRM push (INT W4)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let campaignId: string;
  let contactId: string;
  let enrollmentId: string;

  const connectHub = async () =>
    owner.integration.create({
      data: {
        workspaceId: ws,
        provider: "hubspot",
        status: "connected",
        config: { portalId: "777", defaultPipeline: "default" },
        credentialsEnc: encryptCredentials({ apiToken: "pat-stub" }),
        scopes: [],
      },
    });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    agencyId = (await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } })).id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "w4", slug: suffix, settings: {} } })).id;
    const agentId = (await owner.agent.create({ data: { workspaceId: ws, name: "Closer", goal: "close_deals", guardrails: {} } })).id;
    campaignId = (await owner.campaign.create({ data: { workspaceId: ws, agentId, name: "primary", graphId: "" } })).id;
    contactId = (await owner.contact.create({ data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `ada-${suffix}@t.test`, firstName: "Ada" } })).id;
    enrollmentId = (await owner.enrollment.create({ data: { workspaceId: ws, campaignId, contactId, workflowId: `w4-${suffix}`, pipelineStage: "engaged", meta: {} } })).id;
  });
  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  const deps = (hub: ReturnType<typeof statefulHub>): IntegrationsDeps => ({
    prisma: app,
    adapters: { hubspot: hub.adapter },
    publish: async () => {},
  });

  it("create_deal: upsert + create + associate → delivered with the deal id; a redelivery dedupes (no second create)", async () => {
    await owner.integration.deleteMany({ where: { workspaceId: ws } });
    await connectHub();
    const hub = statefulHub();
    const res = await deliverCrm(deps(hub), {
      workspaceId: ws,
      op: "create_deal",
      sourceEventId: `evt-${suffix}-c#rule:r#a:0`,
      contact: { email: `ada-${suffix}@t.test`, firstName: "Ada" },
      dealname: "Ada — deal",
      stage: "qualifiedtobuy",
    });
    expect(res.delivered).toBe(true);
    expect(res.dealId).toBeTruthy();
    expect(hub.createCount()).toBe(1);

    const dup = await deliverCrm(deps(hub), {
      workspaceId: ws,
      op: "create_deal",
      sourceEventId: `evt-${suffix}-c#rule:r#a:0`,
      contact: { email: `ada-${suffix}@t.test` },
      dealname: "Ada — deal",
    });
    expect(dup.dealId).toBe(res.dealId); // same deal, no second create
    expect(hub.createCount()).toBe(1);
  });

  it("update_stage with NO stored deal refuses typed (never a silent no-op)", async () => {
    const hub = statefulHub();
    const res = await deliverCrm(deps(hub), { workspaceId: ws, op: "update_stage", sourceEventId: `evt-${suffix}-u0#rule:r#a:0`, stage: "closedwon" });
    expect(res.delivered).toBe(false);
    expect(res.detail).toContain("no HubSpot deal");
  });

  it("a delivery-time 401 flips the hubspot row to the honest revoked state", async () => {
    await owner.integration.updateMany({ where: { workspaceId: ws, provider: "hubspot" }, data: { status: "connected" } });
    const hub = statefulHub({ authFail: true });
    const res = await deliverCrm(deps(hub), {
      workspaceId: ws,
      op: "create_deal",
      sourceEventId: `evt-${suffix}-auth#rule:r#a:0`,
      contact: { email: `ada-${suffix}@t.test` },
      dealname: "x",
    });
    expect(res.delivered).toBe(false);
    const row = await owner.integration.findFirstOrThrow({ where: { workspaceId: ws, provider: "hubspot" } });
    expect(row.status).toBe("revoked");
  });

  it("the create→store→update roundtrip fires through the REAL engine (dealId rides Enrollment.meta)", async () => {
    await owner.integration.deleteMany({ where: { workspaceId: ws } });
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { meta: {} } });
    await connectHub();
    const hub = statefulHub();
    const engineDeps: RuleEngineDeps = {
      prisma: app,
      crmTransport: async (p) => deliverCrm(deps(hub), { workspaceId: p.workspaceId, sourceEventId: p.sourceKey, op: p.op, ...(p.contact ? { contact: p.contact } : {}), ...(p.dealname ? { dealname: p.dealname } : {}), ...(p.stage ? { stage: p.stage } : {}), ...(p.dealId ? { dealId: p.dealId } : {}) }),
    };
    const createRule = await owner.campaignRule.create({
      data: { workspaceId: ws, campaignId, order: 0, enabled: true, trigger: { kind: "payment_received" }, actions: [{ kind: "create_crm_deal", stage: "qualifiedtobuy" }] },
    });
    const event = {
      id: `evt-${suffix}-eng`,
      workspaceId: ws,
      type: "payment.received.v1" as const,
      contactId,
      enrollmentId,
      campaignId,
      senderId: null,
      payload: { amount: 50000, provider: "stripe" },
      occurredAt: new Date().toISOString(),
    };
    const created = await evaluateEventForRules(engineDeps, event);
    expect(created.matched).toBe(1);
    const enr = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    const storedDealId = (enr.meta as { crmDealId?: string }).crmDealId;
    expect(typeof storedDealId).toBe("string");

    // A later update_deal_stage rule finds the stored deal and moves it.
    await owner.campaignRule.update({ where: { id: createRule.id }, data: { actions: [{ kind: "update_deal_stage", stage: "closedwon" }] } });
    const moved = await evaluateEventForRules(engineDeps, { ...event, id: `evt-${suffix}-eng2` });
    expect(moved.matched).toBe(1);
    expect(hub.deals.find((d) => d.id === storedDealId)?.stage).toBe("closedwon");
    await owner.campaignRule.delete({ where: { id: createRule.id } });
  });
});
