/**
 * LH1 W3 (DEC-087): the ONE enrollment gate + per-campaign daily enrollment
 * cap, vs real Postgres + RLS with a capturing engine. The two acceptance
 * walks ride here:
 *   1 · oversized import → cap holds overflow → next day drains → repeat to
 *       empty (health untouched — the cap bounds the QUEUE, sends unchanged).
 *   2 · import mid-validation → launch immediately → ZERO sends until the
 *       first verdicts land → valid contacts drain progressively → invalid
 *       refused typed with a cataloged Logs row → NO unverified send EVER.
 * Plus: risky policy (default hold, owner-flippable), suppressed-contact
 * pre-LH1 parity, and the validation-progress chip data.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTACT_INVALID_MESSAGE } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, withTenant, type Prisma, type PrismaClient } from "@clientforce/db";
import { validateEvent } from "@clientforce/events";
import {
  runValidationBatchToSettled,
  type EmailValidationProvider,
  type ProviderResult,
  type ValidationDeps,
} from "@clientforce/validation";
import { drainEnrollmentHolds, type CampaignWorkflowInput, type DrainDeps } from "@clientforce/workflows";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { VALIDATION_LIGHT_DEPS, VALIDATION_QUEUE } from "../src/contacts/validation.providers";
import { WORKFLOW_ENGINE, type WorkflowEngine } from "../src/enrollments/workflow-engine";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const DAY = 86_400_000;

const GRAPH = {
  entry: "s1",
  nodes: [
    { id: "s1", type: "step", channel: "email", content: { subject: "Hi {{firstName}}", body: "b" } },
    { id: "end", type: "end" },
  ],
  edges: [{ from: "s1", to: "end" }],
};

class FakeEngine implements WorkflowEngine {
  started: CampaignWorkflowInput[] = [];
  async start(input: CampaignWorkflowInput) {
    const deduped = this.started.some((s) => s.enrollmentId === input.enrollmentId);
    if (!deduped) this.started.push(input);
    return { workflowId: `enroll-${input.enrollmentId}`, deduped };
  }
  async signalReply() {}
}

class MockProvider implements EmailValidationProvider {
  readonly name = "zerobounce";
  async validateBatch(addresses: string[]): Promise<ProviderResult[]> {
    return addresses.map((address) => ({
      address,
      verdict: address.startsWith("bad")
        ? ("invalid" as const)
        : address.startsWith("risky")
          ? ("risky" as const)
          : ("valid" as const),
    }));
  }
  async preflight() {
    return { ok: true, detail: "mock" };
  }
}

describe.skipIf(!hasDb)("Enrollment gate + daily cap (LH1 W3)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let appDb: PrismaClient;
  let agencyId: string;
  let ws: string;
  let userId: string;
  let token: string;
  let capAgentId: string;
  let capCampaignId: string;
  let flowAgentId: string;
  let flowCampaignId: string;
  const engine = new FakeEngine();

  /** Inline event persist (the BusOrInlinePublisher stance) so refusal Logs
   *  rows land as REAL Event rows the Logs tab reads. */
  const persistEvent = async (e: { type: string; workspaceId: string; contactId?: string; campaignId?: string; payload: Record<string, unknown> }) => {
    const v = validateEvent(e as Parameters<typeof validateEvent>[0]);
    await withTenant(appDb, { workspaceId: v.workspaceId }, (tx) =>
      tx.event.create({
        data: {
          workspaceId: v.workspaceId,
          type: v.type,
          contactId: v.contactId,
          enrollmentId: v.enrollmentId,
          campaignId: v.campaignId,
          payload: v.payload as Prisma.InputJsonValue,
        },
      }),
    );
  };
  const drainDeps = (now?: () => Date): DrainDeps => ({
    prisma: appDb,
    engine,
    publish: persistEvent,
    ...(now ? { now } : {}),
  });
  const valDeps = (): ValidationDeps => ({
    prisma: appDb,
    ownerPrisma: owner,
    provider: new MockProvider(),
    publish: persistEvent,
    resolveMx: async (domain) => [{ exchange: `mx.${domain}`, priority: 10 }],
  });

  const seedAgent = async (name: string, cap?: number) => {
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name, goal: "book_appointments", guardrails: {} },
    });
    const campaign = await owner.campaign.create({
      data: {
        workspaceId: ws,
        agentId: agent.id,
        name: `${name} — primary`,
        graphId: "",
        ...(cap ? { enrollmentDailyCap: cap } : {}),
      },
    });
    await owner.campaignGraph.create({
      data: { workspaceId: ws, campaignId: campaign.id, version: 1, graph: GRAPH, source: "AI" },
    });
    return { agentId: agent.id, campaignId: campaign.id };
  };

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    appDb = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `gate-${suffix}`, slug: `gate-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "GATE", slug: `gate-${suffix}`, settings: {} },
      })
    ).id;
    await owner.senderConnection.create({
      data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: "gate@send.clientforce.io", fromName: "Gate" },
    });
    ({ agentId: capAgentId, campaignId: capCampaignId } = await seedAgent("CapWalk", 3));
    ({ agentId: flowAgentId, campaignId: flowCampaignId } = await seedAgent("FlowWalk"));
    const u = await owner.user.create({
      data: { email: `gate-${suffix}@t.test`, authProviderId: `auth|gate-${suffix}` },
    });
    userId = u.id;
    await owner.membership.create({ data: { userId: u.id, workspaceId: ws, role: "OWNER" } });
    token = await signDevToken(SECRET, { sub: `auth|gate-${suffix}`, email: u.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WORKFLOW_ENGINE)
      .useValue(engine)
      .overrideProvider(VALIDATION_QUEUE)
      .useValue(null)
      .overrideProvider(VALIDATION_LIGHT_DEPS)
      .useValue({ resolveMx: async (d: string) => [{ exchange: `mx.${d}`, priority: 10 }] })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await appDb?.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}`, "x-workspace-id": ws });
  const enroll = (agentId: string, contactId: string) =>
    request(app.getHttpServer())
      .post("/enrollments")
      .set(auth())
      .send({ agentId, contactId, origin: { kind: "csv" } });
  const mkContact = (email: string, verdict = "unverified") =>
    owner.contact.create({
      data: { workspaceId: ws, source: "csv_import", optOut: {}, tags: [], email, emailVerdict: verdict },
    });

  // ── Acceptance walk 1: oversized import vs the daily enrollment cap ───────
  it("cap holds overflow at launch; held contacts drain day by day; sends never exceed the queue bound", async () => {
    const contacts = await Promise.all(
      Array.from({ length: 8 }, (_, i) => mkContact(`cap-${i}-${suffix}@ok.test`, "valid")),
    );
    let enrolled = 0;
    let capHeld = 0;
    for (const c of contacts) {
      const res = await enroll(capAgentId, c.id);
      expect(res.status).toBe(201);
      if (res.body.held) {
        expect(res.body.reason).toBe("cap_overflow");
        capHeld += 1;
      } else enrolled += 1;
    }
    expect(enrolled).toBe(3); // the campaign's cap
    expect(capHeld).toBe(5);
    expect(engine.started.filter((s) => s.campaignId === capCampaignId)).toHaveLength(3);

    // The chip's data is honest about the queue.
    const progress = await request(app.getHttpServer())
      .get(`/agents/${capAgentId}/validation-progress`)
      .set(auth());
    expect(progress.body).toMatchObject({ heldCapOverflow: 5, heldUnverified: 0 });

    // Day 2: the drain releases exactly the cap's worth, oldest first.
    const day2 = await drainEnrollmentHolds(drainDeps(() => new Date(Date.now() + DAY)), {
      workspaceId: ws,
      campaignId: capCampaignId,
    });
    expect(day2.released).toBe(3);
    expect(day2.capHeld).toBe(2);
    expect(engine.started.filter((s) => s.campaignId === capCampaignId)).toHaveLength(6);

    // Day 3: the queue drains empty.
    const day3 = await drainEnrollmentHolds(drainDeps(() => new Date(Date.now() + 2 * DAY)), {
      workspaceId: ws,
      campaignId: capCampaignId,
    });
    expect(day3.released).toBe(2);
    expect(engine.started.filter((s) => s.campaignId === capCampaignId)).toHaveLength(8);
    expect(
      await owner.enrollmentHold.count({ where: { campaignId: capCampaignId, status: "pending" } }),
    ).toBe(0);
    // 8 enrollments, 8 distinct contacts — nothing double-started.
    const started = engine.started.filter((s) => s.campaignId === capCampaignId).map((s) => s.contactId);
    expect(new Set(started).size).toBe(8);
  });

  // ── Acceptance walk 2: import mid-validation → launch → progressive flow ──
  it("launch mid-validation holds everything; valid contacts flow in as verdicts land; invalid refuses typed; NO unverified send ever", async () => {
    const imported = await request(app.getHttpServer())
      .post("/contacts/import")
      .set(auth())
      .send({
        validationBatchKey: `flow-${suffix}`,
        rows: [
          ...Array.from({ length: 4 }, (_, i) => ({ email: `flow-${i}-${suffix}@ok.test`, firstName: `F${i}` })),
          { email: `risky-${suffix}@ok.test`, firstName: "R" },
          { email: `bad-${suffix}@ok.test`, firstName: "B" },
        ],
      });
    expect(imported.status).toBe(201);
    const batchId = imported.body.validationBatchId as string;
    const rows = await owner.contact.findMany({
      where: { workspaceId: ws, email: { contains: suffix }, source: "csv_import" },
      select: { id: true, email: true, emailVerdict: true },
    });
    const flowContacts = rows.filter((r) => /^(flow|risky|bad)-/.test(r.email ?? ""));
    expect(flowContacts).toHaveLength(6);
    expect(flowContacts.every((c) => c.emailVerdict === "unverified")).toBe(true);

    // Launch IMMEDIATELY — the launch completes, every contact holds.
    for (const c of flowContacts) {
      const res = await enroll(flowAgentId, c.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ held: true, reason: "unverified" });
    }
    // ZERO sends before the first verdict lands.
    expect(engine.started.filter((s) => s.campaignId === flowCampaignId)).toHaveLength(0);

    // Verdicts land (mock provider: 4 valid · 1 risky · 1 invalid)…
    const settled = await runValidationBatchToSettled(valDeps(), ws, batchId);
    expect(settled.status).toBe("completed");

    // …and the drain releases exactly the valid ones.
    const drained = await drainEnrollmentHolds(drainDeps(), { workspaceId: ws, campaignId: flowCampaignId });
    expect(drained).toMatchObject({ released: 4, refused: 1, stillHeld: 1 });
    const startedFlow = engine.started.filter((s) => s.campaignId === flowCampaignId);
    expect(startedFlow).toHaveLength(4);
    // The invariant: every started contact is VALID — no unverified send ever.
    const verdictById = new Map(flowContacts.map((c) => [c.id, c.email ?? ""]));
    for (const s of startedFlow) expect(verdictById.get(s.contactId)).toMatch(/^flow-/);

    // The typed refusal is a REAL Logs row (campaign-scoped Event).
    const refusalEvents = await owner.event.findMany({
      where: { workspaceId: ws, campaignId: flowCampaignId, type: "contact.enrollment_refused.v1" },
    });
    expect(refusalEvents).toHaveLength(1);
    expect(refusalEvents[0]?.payload).toMatchObject({ reason: "CONTACT_INVALID" });
    const badContact = flowContacts.find((c) => c.email?.startsWith("bad-"));
    expect(refusalEvents[0]?.contactId).toBe(badContact?.id);

    // Chip data after the drain: 1 risky held, 1 refused, none validating.
    const progress = await request(app.getHttpServer())
      .get(`/agents/${flowAgentId}/validation-progress`)
      .set(auth());
    expect(progress.body).toMatchObject({ heldUnverified: 0, heldRisky: 1, refusedInvalid: 1 });

    // Direct re-attempt on the invalid contact: typed 422, message pinned.
    const refusedAgain = await enroll(flowAgentId, badContact!.id);
    expect(refusedAgain.status).toBe(422);
    expect(refusedAgain.body).toMatchObject({ reason: "CONTACT_INVALID", message: CONTACT_INVALID_MESSAGE });
  });

  it("risky policy is owner-flippable: hold by default, enroll when settings.validation.riskyPolicy = enroll", async () => {
    await owner.workspace.update({
      where: { id: ws },
      data: { settings: { validation: { riskyPolicy: "enroll" } } },
    });
    const drained = await drainEnrollmentHolds(drainDeps(), { workspaceId: ws, campaignId: flowCampaignId });
    expect(drained.released).toBe(1); // the risky hold from the walk above
    const started = engine.started.filter((s) => s.campaignId === flowCampaignId);
    expect(started).toHaveLength(5);
    await owner.workspace.update({ where: { id: ws }, data: { settings: {} } });
  });

  it("suppressed contacts keep pre-LH1 parity: they enroll (the boundary's suppression rail owns the refusal)", async () => {
    const c = await mkContact(`supp-gate-${suffix}@ok.test`, "unverified");
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: `supp-gate-${suffix}@ok.test`, reason: "BOUNCED" },
    });
    const res = await enroll(flowAgentId, c.id);
    expect(res.status).toBe(201);
    expect(res.body.held).toBeUndefined();
    expect(res.body.workflowId).toContain("enroll-");
    // Suppression stays authoritative — the verdict column was never touched.
    expect((await owner.contact.findUniqueOrThrow({ where: { id: c.id } })).emailVerdict).toBe("unverified");
  });

  it("re-enrolling an EXISTING enrollment keeps its idempotent semantics (no gate re-entry)", async () => {
    const existing = engine.started.find((s) => s.campaignId === capCampaignId);
    const res = await enroll(capAgentId, existing!.contactId);
    expect(res.status).toBe(201);
    expect(res.body.workflowDeduped).toBe(true);
  });
});
