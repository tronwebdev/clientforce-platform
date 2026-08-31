/**
 * B7.5 — the settings WRITE layer, end to end (SURFACE_SPEC_SETTINGS §12).
 *
 * B7 shipped these surfaces read-only. Everything asserted here is a write a
 * user could not make before, plus the rules that keep those writes honest:
 *
 *  - teaching a fact reaches what Ada QUOTES, not just a row (the taught
 *    question survives into the rendered context text);
 *  - answering a gap closes that gap and raises the fact count in one write;
 *  - a source added here produces a real ingest job whose yield is readable;
 *  - invites send, appear pending, resend, revoke, and lapse honestly;
 *  - the last owner cannot be removed or demoted — server-side, not in the UI;
 *  - role changes and removals land with their actor and their consequence;
 *  - the credits read gates burn, allowance and per-kind usage on real sources.
 *
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderContextText } from "@clientforce/context";
import { contextFieldsSchema } from "@clientforce/core";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Settings write layer e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let secondOwnerId: string;
  let adminId: string;

  const api = () => request(app.getHttpServer());
  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `wl-${suffix}`, slug: `wl-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "WL", slug: `wl-ws-${suffix}`, creditBalance: 500, settings: {} },
      })
    ).id;
    const u1 = await owner.user.create({
      data: {
        email: `wl-owner-${suffix}@t.test`,
        name: "Owner One",
        authProviderId: `auth|wl-${suffix}`,
      },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    const u2 = await owner.user.create({
      data: { email: `wl-admin-${suffix}@t.test`, authProviderId: `auth|wl2-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u2.id, workspaceId: ws, role: "ADMIN" } });
    adminId = u2.id;
    const u3 = await owner.user.create({
      data: { email: `wl-owner2-${suffix}@t.test`, authProviderId: `auth|wl3-${suffix}` },
    });
    secondOwnerId = u3.id;
    userIds = [u1.id, u2.id, u3.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|wl-${suffix}`, email: u1.email });

    // The credits read partitions PRICED actions into metered and not-yet, so
    // the test owns its prices rather than leaning on the seed — CI migrates
    // but never seeds, and a fixture that depends on someone else's rows is a
    // test that passes for the wrong reason.
    await owner.creditPrice.createMany({
      data: [
        { agencyId, action: "lead_reveal", credits: 1 },
        { agencyId, action: "email_send", credits: 1 },
        { agencyId, action: "reply_draft", credits: 0 },
      ],
    });

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

  /* ------------------------------------------------------------ core facts */

  it("a taught fact reaches what Ada quotes — the question survives as the label", async () => {
    const res = await api()
      .post("/workspaces/facts")
      .set(asOwner())
      .send({ question: "Do you take my insurance?", answer: "Delta, Cigna and Aetna, in network." })
      .expect(201);
    expect(res.body.key).toBe("ask_do_you_take_my_insurance");

    const row = await owner.businessContext.findFirst({ where: { workspaceId: ws, agentId: null } });
    const fields = contextFieldsSchema.parse(row?.fields ?? {});
    expect(fields["ask_do_you_take_my_insurance"]?.label).toBe("Do you take my insurance?");

    // The point of the label: it is what the model's ONLY permitted fact
    // source renders, so "she knows it now" is true rather than a toast.
    const text = renderContextText(fields);
    expect(text).toContain("Do you take my insurance?");
    expect(text).toContain("Delta, Cigna and Aetna, in network.");
  });

  it("teaching the same question again edits the fact instead of growing a second one", async () => {
    await api()
      .post("/workspaces/facts")
      .set(asOwner())
      .send({ question: "Do you take my insurance?", answer: "Delta and Cigna only." })
      .expect(201);
    const row = await owner.businessContext.findFirst({ where: { workspaceId: ws, agentId: null } });
    const fields = contextFieldsSchema.parse(row?.fields ?? {});
    const taught = Object.keys(fields).filter((k) => k.startsWith("ask_"));
    expect(taught).toHaveLength(1);
    expect(fields["ask_do_you_take_my_insurance"]?.value).toBe("Delta and Cigna only.");
  });

  it("answering a gap writes the REGISTRY key, so the gap closes rather than sitting beside a near-duplicate", async () => {
    await api()
      .post("/workspaces/facts")
      .set(asOwner())
      .send({
        gapKey: "booking_link",
        question: "Booking link",
        answer: "https://brightsmile.test/book",
      })
      .expect(201);
    const row = await owner.businessContext.findFirst({ where: { workspaceId: ws, agentId: null } });
    const fields = contextFieldsSchema.parse(row?.fields ?? {});
    expect(fields["booking_link"]?.value).toBe("https://brightsmile.test/book");
    // A registry gap keeps the registry's own label — no shadow copy.
    expect(fields["booking_link"]?.label).toBeUndefined();
    expect(fields["ask_booking_link"]).toBeUndefined();

    const before = await api().get("/context/gaps?goal=generate_leads").set(asOwner()).expect(200);
    const openBefore = (before.body.gaps as Array<{ key: string; status: string }>).filter(
      (g) => g.status === "open",
    ).length;

    const gaps = await api().get("/context/gaps?goal=book_appointments").set(asOwner()).expect(200);
    const booking = (gaps.body.gaps as Array<{ key: string; status: string }>).find(
      (g) => g.key === "booking_link",
    );
    // The gap is closed by the answer, in one write, with no reload.
    expect(booking?.status).toBe("typed");
    expect(openBefore).toBeGreaterThan(0);
  });

  it("a named field lands on Who you are and carries its own name", async () => {
    const res = await api()
      .post("/workspaces/fields")
      .set(asOwner())
      .send({ name: "Parking", value: "Free lot behind the building, entrance on 5th." })
      .expect(201);
    expect(res.body.key).toBe("field_parking");
    const row = await owner.businessContext.findFirst({ where: { workspaceId: ws, agentId: null } });
    const fields = contextFieldsSchema.parse(row?.fields ?? {});
    expect(fields["field_parking"]?.label).toBe("Parking");
  });

  it("only facts this surface minted can be forgotten — a business-core field is not deletable here", async () => {
    await api().delete("/workspaces/facts/booking_link").set(asOwner()).expect(400);
    await api().delete("/workspaces/facts/field_parking").set(asOwner()).expect(200);
    const row = await owner.businessContext.findFirst({ where: { workspaceId: ws, agentId: null } });
    const fields = contextFieldsSchema.parse(row?.fields ?? {});
    expect(fields["field_parking"]).toBeUndefined();
    expect(fields["booking_link"]).toBeDefined();
  });

  it("every taught fact leaves a timeline row naming who taught it", async () => {
    const events = await owner.event.findMany({
      where: { workspaceId: ws, type: "workspace.fact_taught.v1" },
    });
    expect(events.length).toBeGreaterThanOrEqual(3);
    const payload = events[0]!.payload as { actorId?: string; label?: string };
    expect(payload.actorId).toBe(userIds[0]);
  });

  /* --------------------------------------------------------------- sources */

  it("a source added here produces a real ingest job, and its yield reads back on the row", async () => {
    const created = await api()
      .post("/knowledge/sources")
      .set(asOwner())
      .send({ kind: "TEXT", label: "Consult script", text: "We answer the phone within three rings." })
      .expect(201);
    const sourceId = created.body.id as string;

    const pending = await api().get("/workspaces/sources").set(asOwner()).expect(200);
    const beforeRow = (pending.body as Array<{ id: string; status: string; chunks: number | null }>).find(
      (r) => r.id === sourceId,
    );
    expect(beforeRow?.status).toBe("PENDING");
    // Still ingesting ⇒ no yield yet, and NOT a zero pretending to be one.
    expect(beforeRow?.chunks).toBeNull();

    // What the ingest worker does when it finishes, done here directly so the
    // yield read is exercised against real chunk rows.
    await owner.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" ("id","workspaceId","sourceId","content","embedding","tokens","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5::vector,$6,NOW(),NOW())`,
      `chunk-${suffix}`,
      ws,
      sourceId,
      "We answer the phone within three rings.",
      `[${new Array(1536).fill(0).join(",")}]`,
      9,
    );
    await owner.knowledgeSource.update({ where: { id: sourceId }, data: { status: "READY" } });

    const ready = await api().get("/workspaces/sources").set(asOwner()).expect(200);
    const afterRow = (ready.body as Array<{ id: string; chunks: number | null }>).find(
      (r) => r.id === sourceId,
    );
    expect(afterRow?.chunks).toBe(1);
  });

  /* --------------------------------------------------------------- invites */

  it("invite: sends, appears pending with its expiry, and reports honestly whether it was delivered", async () => {
    const res = await api()
      .post("/workspaces/invites")
      .set(asOwner())
      .send({ email: `NEW-${suffix}@t.test`, role: "AGENT" })
      .expect(201);
    expect(res.body.email).toBe(`new-${suffix}@t.test`);
    // No mailer is wired to this route: the invite exists and says it was NOT
    // delivered, rather than claiming a send that never happened.
    expect(res.body.delivered).toBe(false);

    const list = await api().get("/workspaces/invites").set(asOwner()).expect(200);
    const row = (list.body as Array<{ email: string; state: string; invitedBy: string | null }>)[0]!;
    expect(row.state).toBe("pending");
    expect(row.invitedBy).toBe("Owner One");
  });

  it("the token is never readable from the database — only its hash is stored", async () => {
    const stored = await owner.workspaceInvite.findFirst({ where: { workspaceId: ws } });
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(stored ?? {})).not.toContain("token");
  });

  it("a second invite to the same address is refused while one is waiting", async () => {
    await api()
      .post("/workspaces/invites")
      .set(asOwner())
      .send({ email: `new-${suffix}@t.test`, role: "VIEWER" })
      .expect(409);
  });

  it("resend mints a NEW token, extends the expiry and counts itself", async () => {
    const list = await api().get("/workspaces/invites").set(asOwner()).expect(200);
    const id = (list.body as Array<{ id: string }>)[0]!.id;
    const before = await owner.workspaceInvite.findUniqueOrThrow({ where: { id } });

    const res = await api().post(`/workspaces/invites/${id}/resend`).set(asOwner()).expect(201);
    expect(res.body.resendCount).toBe(1);

    const after = await owner.workspaceInvite.findUniqueOrThrow({ where: { id } });
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it("revoke stops the invite, and a revoked invite cannot be resent", async () => {
    const list = await api().get("/workspaces/invites").set(asOwner()).expect(200);
    const id = (list.body as Array<{ id: string }>)[0]!.id;
    await api().post(`/workspaces/invites/${id}/revoke`).set(asOwner()).expect(201);

    const after = await api().get("/workspaces/invites").set(asOwner()).expect(200);
    expect((after.body as Array<{ id: string; state: string }>).find((r) => r.id === id)?.state).toBe(
      "revoked",
    );
    await api().post(`/workspaces/invites/${id}/resend`).set(asOwner()).expect(400);
  });

  it("an invite past its expiry reads as expired — derived, so no sweeper can forget to run", async () => {
    const created = await api()
      .post("/workspaces/invites")
      .set(asOwner())
      .send({ email: `lapse-${suffix}@t.test`, role: "VIEWER" })
      .expect(201);
    await owner.workspaceInvite.update({
      where: { id: created.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const list = await api().get("/workspaces/invites").set(asOwner()).expect(200);
    const row = (list.body as Array<{ id: string; state: string }>).find(
      (r) => r.id === created.body.id,
    );
    expect(row?.state).toBe("expired");

    // A lapsed invite is REPLACED by a new one, never duplicated, so
    // "pending invites: 1" keeps meaning one.
    await api()
      .post("/workspaces/invites")
      .set(asOwner())
      .send({ email: `lapse-${suffix}@t.test`, role: "VIEWER" })
      .expect(201);
    const after = await api().get("/workspaces/invites").set(asOwner()).expect(200);
    const pendingForAddress = (after.body as Array<{ email: string; state: string }>).filter(
      (r) => r.email === `lapse-${suffix}@t.test` && r.state === "pending",
    );
    expect(pendingForAddress).toHaveLength(1);
  });

  it("someone already on the team cannot be invited again", async () => {
    await api()
      .post("/workspaces/invites")
      .set(asOwner())
      .send({ email: `wl-admin-${suffix}@t.test`, role: "AGENT" })
      .expect(409);
  });

  /* --------------------------------------------------------------- members */

  it("a role change lands on the timeline with its actor, the previous role and the new one", async () => {
    await api()
      .patch(`/workspaces/members/${adminId}`)
      .set(asOwner())
      .send({ role: "AGENT" })
      .expect(200);
    const event = await owner.event.findFirst({
      where: { workspaceId: ws, type: "workspace.member_role_changed.v1" },
      orderBy: { occurredAt: "desc" },
    });
    const payload = event?.payload as { from: string; to: string; actorId: string; userId: string };
    expect(payload.from).toBe("ADMIN");
    expect(payload.to).toBe("AGENT");
    expect(payload.actorId).toBe(userIds[0]);
    expect(payload.userId).toBe(adminId);
  });

  it("the last owner cannot be demoted", async () => {
    const res = await api()
      .patch(`/workspaces/members/${userIds[0]}`)
      .set(asOwner())
      .send({ role: "ADMIN" })
      .expect(403);
    expect(String(res.body.message)).toContain("only owner");
  });

  it("the last owner cannot be removed", async () => {
    await api().delete(`/workspaces/members/${userIds[0]}`).set(asOwner()).expect(400);
    await owner.membership.create({
      data: { userId: secondOwnerId, workspaceId: ws, role: "OWNER" },
    });
    // With a second owner in place the first may now step down.
    await api()
      .patch(`/workspaces/members/${userIds[0]}`)
      .set(asOwner())
      .send({ role: "ADMIN" })
      .expect(200);
    await api()
      .patch(`/workspaces/members/${userIds[0]}`)
      .set(asOwner())
      .send({ role: "OWNER" })
      .expect(403); // no longer an OWNER, so the route is closed to them
    await owner.membership.updateMany({
      where: { userId: userIds[0], workspaceId: ws },
      data: { role: "OWNER" },
    });
  });

  it("removing someone returns their claimed threads to the queue, and records how many", async () => {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Thread holder",
        goal: "book_appointments",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
          dailyCap: { email: 200 },
          consent: null,
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId: agent.id, name: "Thread holder — primary", graphId: "" },
    });
    const contact = await owner.contact.create({
      data: { workspaceId: ws, email: `thread-${suffix}@t.test`, source: "manual", optOut: {} },
    });
    await owner.threadState.create({
      data: {
        workspaceId: ws,
        campaignId: campaign.id,
        contactId: contact.id,
        assigneeUserId: adminId,
      },
    });

    const res = await api().delete(`/workspaces/members/${adminId}`).set(asOwner()).expect(200);
    expect(res.body.releasedThreads).toBe(1);

    const thread = await owner.threadState.findFirst({ where: { contactId: contact.id } });
    expect(thread?.assigneeUserId).toBeNull();

    const event = await owner.event.findFirst({
      where: { workspaceId: ws, type: "workspace.member_removed.v1" },
    });
    expect((event?.payload as { releasedThreads: number }).releasedThreads).toBe(1);
  });

  it("you cannot remove yourself", async () => {
    await api().delete(`/workspaces/members/${userIds[0]}`).set(asOwner()).expect(400);
  });

  /* --------------------------------------------------------------- numbers */

  it("a requested number records the real ask and its TRUE state — never an A2P badge nobody filed for", async () => {
    const res = await api()
      .post("/workspaces/numbers")
      .set(asOwner())
      .send({ areaCode: "512", carries: "sms_voice" })
      .expect(201);
    expect(res.body.status).toBe("REQUESTED");
    expect(res.body.a2pState).toBe("not_filed");

    const list = await api().get("/workspaces/numbers").set(asOwner()).expect(200);
    expect(list.body).toHaveLength(1);
    await api().post("/workspaces/numbers").set(asOwner()).send({ areaCode: "5", carries: "sms" }).expect(400);
  });

  /* --------------------------------------------------------------- credits */

  it("credits gates burn, allowance and per-kind usage on real sources", async () => {
    const empty = await api().get("/credits/summary").set(asOwner()).expect(200);
    // No ledger history at all ⇒ no burn, no runway, no "runs out".
    expect(empty.body.history.days).toBe(0);
    expect(empty.body.history.enough).toBe(false);
    // No plan carries a credit allowance ⇒ no denominator, so no % bar.
    expect(empty.body.allowance.includedMonthly).toBeNull();
    expect(String(empty.body.allowance.reason)).toContain("allowance");
    // Only reveals debit today; everything else priced is named as unmetered.
    expect(empty.body.metering.metered).toContain("lead_reveal");
    expect(empty.body.metering.unmetered).toContain("email_send");
    expect(empty.body.metering.metered).not.toContain("email_send");

    await owner.creditLedger.create({
      data: {
        workspaceId: ws,
        delta: -3,
        reason: "lead_reveal",
        balanceAfter: 497,
        createdAt: new Date(Date.now() - 30 * 86_400_000),
      },
    });
    const withHistory = await api().get("/credits/summary").set(asOwner()).expect(200);
    expect(withHistory.body.history.days).toBeGreaterThanOrEqual(29);
    expect(withHistory.body.history.enough).toBe(true);
    expect(withHistory.body.balance).toBe(500);
  });
});
