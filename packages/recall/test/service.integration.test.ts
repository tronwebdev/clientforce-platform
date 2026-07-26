/**
 * SPEC A (DEC-099): the recall service vs REAL Postgres + RLS.
 *
 * What these pin, in order of how badly the unit fails without them:
 * - every facet is CONTACT-scoped and TENANT-scoped (a caller cannot be told
 *   about another contact's record, or another workspace's);
 * - honest absence is a real result, not an empty array (`found:false` + note);
 * - the budget and timeout rails refuse in a typed way and never throw;
 * - a receipt exists for EVERY lookup — found, empty and refused alike — and
 *   the flush is idempotent.
 * Skips without infra (house convention).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  withTenant,
  type PrismaClient,
} from "@clientforce/db";
import { RECALL_MAX_LOOKUPS_PER_CALL, RECALL_MAX_LOOKUPS_PER_TURN } from "@clientforce/core";
import { RecallService } from "../src/service";
import type { RecallTarget } from "../src/types";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `reca-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasInfra)("recall service (SPEC A / DEC-099)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let contactA: string;
  let otherContact: string;
  let campaignA: string;
  let agentA: string;
  let callA: string;

  const newWorkspace = async (tag: string): Promise<string> => {
    const ws = await owner.workspace.create({
      data: { agencyId, name: tag, slug: `${suffix}-${tag}`, settings: {} },
    });
    return ws.id;
  };

  const target = (): RecallTarget => ({
    workspaceId: wsA,
    contactId: contactA,
    agentId: agentA,
    campaignId: campaignA,
    callId: callA,
  });

  const service = (overrides: Partial<RecallTarget> = {}, timeoutMs?: number) =>
    new RecallService({ prisma: app }, { ...target(), ...overrides }, timeoutMs);

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: suffix, slug: suffix, branding: {} },
    });
    agencyId = agency.id;
    wsA = await newWorkspace("a");
    wsB = await newWorkspace("b");

    const agent = await owner.agent.create({
      data: {
        workspaceId: wsA,
        name: "Recall agent",
        goal: "book_appointments",
        category: "sales",
        status: "ACTIVE",
        guardrails: {},
      },
    });
    agentA = agent.id;
    const campaign = await owner.campaign.create({
      data: {
        workspaceId: wsA,
        agentId: agentA,
        name: "Q3 outreach",
        graphId: `graph-${suffix}`,
        status: "ACTIVE",
      },
    });
    campaignA = campaign.id;

    const c = await owner.contact.create({
      data: {
        workspaceId: wsA,
        source: "test",
        optOut: {},
        tags: ["warm-lead", "webinar"],
        custom: { budget_band: "10-25k" },
        email: `sam-${suffix}@acme.test`,
        firstName: "Sam",
        company: "Acme",
        title: "Head of Ops",
      },
    });
    contactA = c.id;
    const other = await owner.contact.create({
      data: { workspaceId: wsA, source: "test", optOut: {}, tags: [], email: `other-${suffix}@x.test` },
    });
    otherContact = other.id;

    const call = await owner.call.create({
      data: {
        workspaceId: wsA,
        campaignId: campaignA,
        agentId: agentA,
        contactId: contactA,
        direction: "OUTBOUND",
        status: "IN_PROGRESS",
      },
    });
    callA = call.id;
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  // ── honest absence ────────────────────────────────────────────────────────
  it("an empty record returns found:false WITH a speakable note — never a bare empty array", async () => {
    const svc = service();
    const result = await svc.lookup("history", "have we spoken before", 1);
    expect(result.found).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.note).toMatch(/no earlier messages/i);
    expect(result.refusalReason).toBeUndefined();
  });

  it("records a receipt for the EMPTY lookup too — honest absence has to be auditable", async () => {
    const svc = service();
    await svc.lookup("history", "have we spoken before", 1);
    const [receipt] = svc.ledger();
    expect(receipt).toMatchObject({ facet: "history", found: false, itemCount: 0, turn: 1 });
    expect(receipt!.query).toBe("have we spoken before");
  });

  // ── history ───────────────────────────────────────────────────────────────
  it("history reads prior messages, newest-first, and excludes THIS call's own turns", async () => {
    const day = 86_400_000;
    await owner.message.createMany({
      data: [
        {
          workspaceId: wsA,
          campaignId: campaignA,
          contactId: contactA,
          channel: "email",
          direction: "OUTBOUND",
          subject: "Quick question",
          body: "Would a short demo help?",
          sentAt: new Date(Date.now() - 5 * day),
          providerMessageId: `m1-${suffix}`,
        },
        {
          workspaceId: wsA,
          campaignId: campaignA,
          contactId: contactA,
          channel: "email",
          direction: "INBOUND",
          body: "Interested, but what does the pricing look like?",
          intent: "objection_price",
          sentAt: new Date(Date.now() - 4 * day),
          providerMessageId: `m2-${suffix}`,
        },
        // A turn from the CURRENT call — must never come back as "history".
        {
          workspaceId: wsA,
          campaignId: campaignA,
          contactId: contactA,
          channel: "voice",
          direction: "OUTBOUND",
          body: "Hi Sam, do you have a moment?",
          sentAt: new Date(),
          providerMessageId: `m3-${suffix}`,
          meta: { callId: callA },
        },
      ],
    });

    const result = await service().lookup("history", "have we spoken before", 1);
    expect(result.found).toBe(true);
    const bodies = result.items.map((i) => i.detail);
    expect(bodies.some((b) => b.includes("Would a short demo help"))).toBe(true);
    expect(bodies.some((b) => b.includes("do you have a moment"))).toBe(false);
    // Speech-shaped dates, never ISO.
    expect(result.items[0]!.at).toMatch(/ago|today|yesterday|last week/);
  });

  it("history ranks by the question — a pricing question pulls the pricing reply up", async () => {
    const result = await service().lookup("history", "what did you say about pricing", 1);
    expect(result.items[0]!.detail).toContain("pricing");
    expect(result.items[0]!.label).toContain("They said");
  });

  it("history never crosses to another contact's messages", async () => {
    const result = await service({ contactId: otherContact }).lookup("history", "anything", 1);
    expect(result.found).toBe(false);
  });

  // ── pipeline ──────────────────────────────────────────────────────────────
  it("pipeline reports stage + campaign membership, marking the campaign of THIS call", async () => {
    await owner.enrollment.create({
      data: {
        workspaceId: wsA,
        campaignId: campaignA,
        contactId: contactA,
        workflowId: `wf-${suffix}`,
        pipelineStage: "engaged",
        status: "ACTIVE",
      },
    });
    const result = await service().lookup("pipeline", "where am I in your system", 1);
    expect(result.found).toBe(true);
    expect(result.items[0]!.label).toBe("This campaign");
    expect(result.items[0]!.detail).toContain("Q3 outreach");
    expect(result.items[0]!.detail).toContain("engaged");
  });

  // ── bookings ──────────────────────────────────────────────────────────────
  it("bookings surfaces prior calls and booked-stage moves, and is honest that no calendar exists", async () => {
    await owner.call.create({
      data: {
        workspaceId: wsA,
        campaignId: campaignA,
        agentId: agentA,
        contactId: contactA,
        direction: "OUTBOUND",
        status: "COMPLETED",
        outcome: "completed",
        durationSec: 240,
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    await owner.event.create({
      data: {
        workspaceId: wsA,
        type: "lead.stage_changed.v1",
        contactId: contactA,
        campaignId: campaignA,
        payload: { fromStage: "engaged", toStage: "booked" },
      },
    });

    const result = await service().lookup("bookings", "when did we speak, I need to reschedule", 1);
    expect(result.found).toBe(true);
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("Previous call");
    expect(labels).toContain("Marked booked");
    // No calendar integration exists on main (Q-033) — say so, don't invent a time.
    expect(result.note).toMatch(/no calendar/i);
  });

  it("bookings excludes the call currently in progress", async () => {
    // The agent must not offer the call it is ON as a prior booking.
    const svc = service();
    await svc.lookup("bookings", "previous calls", 1);
    expect(svc.ledger()[0]!.sources).not.toContain(callA);
  });

  // ── profile ───────────────────────────────────────────────────────────────
  it("profile reads the saved record — role, tags, custom fields under their OWNER-FACING label", async () => {
    await owner.contactFieldDef.create({
      data: {
        workspaceId: wsA,
        key: "budget_band",
        label: "Budget band",
        type: "TEXT",
        options: [],
        origin: "manual",
      },
    });
    const result = await service().lookup("profile", "what do you have on me", 1);
    expect(result.found).toBe(true);
    const labels = result.items.map((i) => i.label);
    expect(labels).toContain("Role");
    expect(labels).toContain("Tags");
    // The label the owner typed, not the storage key.
    expect(labels).toContain("Budget band");
    expect(labels).not.toContain("budget_band");
  });

  // ── rails ─────────────────────────────────────────────────────────────────
  it("an unknown facet refuses in a typed way instead of throwing into the call", async () => {
    const result = await service().lookup("horoscope", "what's my sign", 1);
    expect(result.refusalReason).toBe("UNKNOWN_FACET");
    expect(result.found).toBe(false);
  });

  it("the per-turn budget refuses the third lookup on one turn", async () => {
    const svc = service();
    for (let i = 0; i < RECALL_MAX_LOOKUPS_PER_TURN; i++) {
      const ok = await svc.lookup("profile", `q${i}`, 4);
      expect(ok.refusalReason).toBeUndefined();
    }
    const refused = await svc.lookup("profile", "one too many", 4);
    expect(refused.refusalReason).toBe("BUDGET_EXHAUSTED");
  });

  it("a NEW turn resets the per-turn budget", async () => {
    const svc = service();
    for (let i = 0; i < RECALL_MAX_LOOKUPS_PER_TURN; i++) await svc.lookup("profile", `q${i}`, 5);
    expect((await svc.lookup("profile", "next turn", 6)).refusalReason).toBeUndefined();
  });

  it("the per-CALL budget is the runaway backstop across turns", async () => {
    const svc = service();
    for (let turn = 0; turn < RECALL_MAX_LOOKUPS_PER_CALL; turn++) {
      await svc.lookup("profile", "q", turn);
    }
    expect((await svc.lookup("profile", "over", 99)).refusalReason).toBe("BUDGET_EXHAUSTED");
  });

  it("a lookup slower than its budget refuses as a TIMEOUT — the caller is never held", async () => {
    // 0ms budget: the race resolves to the timeout before any query returns.
    const result = await service({}, 0).lookup("history", "anything", 1);
    expect(result.refusalReason).toBe("LOOKUP_TIMEOUT");
    expect(result.found).toBe(false);
  });

  it("a refusal is still a receipt — a reviewer can see the agent looked and was denied", async () => {
    const svc = service({}, 0);
    await svc.lookup("history", "anything", 1);
    expect(svc.ledger()[0]).toMatchObject({ refusalReason: "LOOKUP_TIMEOUT", found: false });
  });

  // ── receipts ──────────────────────────────────────────────────────────────
  it("flush persists every receipt and is idempotent on (callId, seq)", async () => {
    const svc = service();
    await svc.lookup("profile", "who am I", 1);
    await svc.lookup("pipeline", "where am I", 2);

    expect(await svc.flush()).toBe(2);
    // A retried finalize must not double-write.
    expect(await svc.flush()).toBe(0);

    const rows = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.callRetrieval.findMany({ where: { callId: callA }, orderBy: { seq: "asc" } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ facet: "profile", query: "who am I", turn: 1, seq: 0 });
    expect(rows[1]).toMatchObject({ facet: "pipeline", seq: 1 });
    expect(rows[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("RLS: receipts are invisible cross-tenant on the app client", async () => {
    const fromB = await withTenant(app, { workspaceId: wsB }, (tx) =>
      tx.callRetrieval.findMany({ where: { callId: callA } }),
    );
    expect(fromB).toHaveLength(0);
  });

  it("RLS: a lookup scoped to another workspace sees nothing of this one", async () => {
    const result = await service({ workspaceId: wsB }).lookup("history", "anything", 1);
    expect(result.found).toBe(false);
  });
});
