/**
 * Suggestions API e2e (B2.6, DEC-110): FORCE each of the three sweep signals
 * to fire once in a fresh workspace and assert the draft row lands through
 * the shared create shape — the demo seed only exercises the winback signal,
 * so without this a bad goal key in S2/S3 would hide behind a quiet seed and
 * first throw on a customer's data (owner ruling, B2.6 review). Also pins:
 * idempotency (second sweep fully suppressed), dismissal suppression, and
 * the OWNER/ADMIN gate (an AGENT member 403s — the shell's fire-and-forget
 * call swallows that silently). Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOAL_KEYS, agentSuggestionSchema } from "@clientforce/core";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Suggestions sweep e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let agentToken: string;

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `sg-${suffix}`, slug: `sg-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "S", slug: `sg-ws-${suffix}`, settings: {} },
      })
    ).id;

    // A host campaign for the fixture rows — goal `custom` so it never
    // suppresses any of the three signals under test.
    const host = await owner.agent.create({
      data: { workspaceId: ws, name: "Host", goal: "custom", guardrails: {} },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId: host.id, name: "host — primary", graphId: "" },
    });

    const mkContact = (tag: string) =>
      owner.contact.create({
        data: { workspaceId: ws, source: "t", optOut: {}, tags: [], email: `sg-${tag}-${suffix}@t.test` },
      });

    // S1 (winback_stalled ≥1): one contact whose inbound reply said not now.
    const c1 = await mkContact("notnow");
    await owner.message.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: c1.id,
        channel: "email",
        direction: "INBOUND",
        body: "not right now",
        intent: "objection_timing",
        sentAt: new Date(),
      },
    });

    // S2 (quiet_contacts ≥3): three contacts whose ONLY messages are 90 days
    // old — messaged once, silent past the 60-day window.
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    for (const tag of ["q1", "q2", "q3"]) {
      const c = await mkContact(tag);
      await owner.message.create({
        data: {
          workspaceId: ws,
          campaignId: campaign.id,
          contactId: c.id,
          channel: "email",
          direction: "OUTBOUND",
          body: "old touch",
          sentAt: old,
        },
      });
    }

    // S3 (collect_reviews ≥2): two booked outcomes.
    for (const tag of ["b1", "b2"]) {
      const c = await mkContact(tag);
      await owner.enrollment.create({
        data: {
          workspaceId: ws,
          campaignId: campaign.id,
          contactId: c.id,
          workflowId: `sg-wf-${tag}-${suffix}`,
          pipelineStage: "booked",
          meta: {},
        },
      });
    }

    const u1 = await owner.user.create({
      data: { email: `sg-owner-${suffix}@t.test`, authProviderId: `auth|sg-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const member = await owner.user.create({
      data: { email: `sg-agent-${suffix}@t.test`, authProviderId: `auth|sg-agent-${suffix}` },
    });
    await owner.membership.create({ data: { userId: member.id, workspaceId: ws, role: "AGENT" } });
    userIds = [u1.id, member.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|sg-owner-${suffix}`, email: u1.email });
    agentToken = await signDevToken(SECRET, { sub: `auth|sg-agent-${suffix}`, email: member.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  it("every signal fires once and lands a schema-valid draft through the one create path", async () => {
    const res = await request(app.getHttpServer()).post("/suggestions/sweep").set(asOwner());
    expect(res.status).toBe(201);
    const created = res.body.created as Array<{ id: string; name: string; signal: string }>;
    expect(created.map((c) => c.signal).sort()).toEqual([
      "collect_reviews",
      "quiet_contacts",
      "winback_stalled",
    ]);

    const expectedGoal: Record<string, string> = {
      winback_stalled: "winback_deals",
      quiet_contacts: "reactivate_leads",
      collect_reviews: "collect_reviews",
    };
    for (const c of created) {
      const row = await owner.agent.findUnique({ where: { id: c.id } });
      expect(row, c.signal).toBeTruthy();
      expect(row!.status).toBe("DRAFT");
      expect(row!.goal).toBe(expectedGoal[c.signal]);
      // The wrong-goal-key class this test exists for: every proposed goal is
      // a real GoalKey, and the marker parses against the core schema.
      expect(GOAL_KEYS as readonly string[]).toContain(row!.goal);
      const marker = agentSuggestionSchema.safeParse(row!.suggestion);
      expect(marker.success, `${c.signal} marker`).toBe(true);
      expect(marker.success && marker.data.signal).toBe(c.signal);
      expect(marker.success && marker.data.reason.length > 0).toBe(true);
      expect(row!.goalSummary).toBeTruthy();
    }
  });

  it("the second sweep is fully suppressed by the created rows", async () => {
    const res = await request(app.getHttpServer()).post("/suggestions/sweep").set(asOwner());
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(0);
    for (const e of res.body.evaluated as Array<{ fired: boolean; suppressedBy?: string }>) {
      expect(e.fired).toBe(false);
      expect(e.suppressedBy).toBeTruthy();
    }
  });

  it("dismissal keeps suppressing after the marker is stamped", async () => {
    const winback = await owner.agent.findFirst({ where: { workspaceId: ws, goal: "winback_deals" } });
    const patch = await request(app.getHttpServer())
      .patch(`/agents/${winback!.id}`)
      .set(asOwner())
      .send({ dismissSuggestion: true });
    expect(patch.status).toBe(200);
    const row = await owner.agent.findUnique({ where: { id: winback!.id } });
    expect((row!.suggestion as { dismissedAt?: string }).dismissedAt).toBeTruthy();

    const res = await request(app.getHttpServer()).post("/suggestions/sweep").set(asOwner());
    expect(res.body.created).toHaveLength(0);
  });

  it("an AGENT member gets 403 — the shell's fire-and-forget call stays silent", async () => {
    const res = await request(app.getHttpServer())
      .post("/suggestions/sweep")
      .set({ Authorization: `Bearer ${agentToken}`, "x-workspace-id": ws });
    expect(res.status).toBe(403);
  });
});
