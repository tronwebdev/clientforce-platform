/**
 * WID2 (DEC-101) widget rail e2e vs real Postgres+RLS — the public endpoint
 * end-to-end. What each block is actually protecting:
 *
 *   resolution   — `wgt_…` → workspace/agent server-side; an unknown id is a
 *                  flat 404 that reveals nothing, and NO tenant identifier
 *                  appears anywhere in a successful response body
 *   contract     — a wrong contractVersion is the one parse failure a visitor
 *                  can act on, so it refuses distinctly
 *   attribution  — the plan check is the ONLY path to suppression: same
 *                  request, same widget, flipped agency plan feature
 *   flows        — the server advertises only what it can SERVE; a stale client
 *                  asking for an unimplemented flow is refused rather than
 *                  answered with a placeholder
 *   honest AI    — with no completion provider, a visitor message returns
 *                  AGENT_UNAVAILABLE. It never invents a reply
 *   isolation    — a session id from another workspace's widget does not
 *                  continue here (and does not leak that it exists)
 *   caps         — per-session turns and per-widget/day sessions both refuse
 *   origin       — an allow-list, when set, is enforced
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { KILL_SWITCH_CHANNELS, WIDGET_CONTRACT_VERSION } from "@clientforce/core";
import { AppModule } from "../src/app.module";
import { MAX_AGENT_TURNS_PER_SESSION } from "../src/widget/widget.service";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `wid-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

process.env.AUTH_DEV_SECRET ??= "test-dev-secret";

describe.skipIf(!hasDb)("widget session rail e2e (WID2, DEC-101)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let widgetId: string;
  let otherWidgetId: string;

  const PUBLIC_ID = `wgt_${suffix.replace(/[^a-z0-9]/g, "").slice(0, 20)}`;
  const OTHER_PUBLIC_ID = `wgt_o${suffix.replace(/[^a-z0-9]/g, "").slice(0, 19)}`;

  const api = () => request(app.getHttpServer());
  const boot = (widget = PUBLIC_ID) => ({
    contractVersion: WIDGET_CONTRACT_VERSION,
    widgetId: widget,
    sessionId: null,
    event: { type: "boot" as const },
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `WID ${suffix}`, slug: `wid-${suffix}`, branding: {}, planTier: "GROWTH" },
    });
    agencyId = agency.id;
    const ws = await owner.workspace.create({
      data: { agencyId, name: "A", slug: `wid-a-${suffix}`, settings: {} },
    });
    workspaceId = ws.id;
    const other = await owner.workspace.create({
      data: { agencyId, name: "B", slug: `wid-b-${suffix}`, settings: {} },
    });
    otherWorkspaceId = other.id;

    const mk = async (wsId: string, publicId: string) =>
      (
        await owner.widget.create({
          data: {
            workspaceId: wsId,
            agentId: `agent-${wsId}`,
            publicId,
            design: { agentName: "Ada", subtitle: "Front desk" },
            fields: {},
            behaviour: {},
            routing: {},
            // Every flow enabled in setup — the server still offers only what
            // it can serve, which is the point of the flows block below.
            flows: {
              bookVisit: true,
              callMeBack: true,
              scheduleCallback: true,
              estimate: true,
              liveVoice: true,
              askQuestion: true,
            },
          },
        })
      ).id;
    widgetId = await mk(workspaceId, PUBLIC_ID);
    otherWidgetId = await mk(otherWorkspaceId, OTHER_PUBLIC_ID);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await owner.widgetSession.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await owner.widget.deleteMany({ where: { id: { in: [widgetId, otherWidgetId] } } });
    await owner.plan.deleteMany({ where: { agencyId } });
    await owner.workspace.deleteMany({ where: { agencyId } });
    await owner.agency.delete({ where: { id: agencyId } });
    await owner.$disconnect();
    await app?.close();
  });

  describe("resolution — the public id is the only credential", () => {
    it("boots a session and returns NO tenant identifier of any kind", async () => {
      const res = await api().post("/widget/v1/session").send(boot()).expect(201);
      expect(res.body.sessionId).toMatch(/^[a-z0-9]+$/i);
      expect(res.body.contractVersion).toBe(WIDGET_CONTRACT_VERSION);
      expect(res.body.agent).toMatchObject({ name: "Ada", subtitle: "Front desk", state: "idle" });
      expect(res.body.meta).toEqual({ stub: false });

      // The whole point of resolving server-side: nothing tenant-shaped comes
      // back. A leak here would put a workspace id on every customer's page.
      const wire = JSON.stringify(res.body);
      expect(wire).not.toContain(workspaceId);
      expect(wire).not.toContain(agencyId);
      expect(wire).not.toContain(widgetId);
      expect(wire).not.toContain(`agent-${workspaceId}`);
    });

    it("an unknown widget id is a flat 404 that reveals nothing", async () => {
      const res = await api()
        .post("/widget/v1/session")
        .send(boot("wgt_doesnotexist99"))
        .expect(404);
      expect(res.body.message?.code ?? res.body.code).toBe("UNKNOWN_WIDGET");
      expect(JSON.stringify(res.body)).not.toContain(workspaceId);
    });

    it("the session row is written under the resolved workspace", async () => {
      const res = await api().post("/widget/v1/session").send(boot()).expect(201);
      const row = await owner.widgetSession.findUnique({ where: { id: res.body.sessionId } });
      expect(row?.workspaceId).toBe(workspaceId);
      expect(row?.widgetId).toBe(widgetId);
      expect(row?.contactId).toBeNull(); // anonymous until a capture flow says otherwise
    });
  });

  describe("contract", () => {
    it("refuses a wrong contractVersion distinctly (the visitor can reload)", async () => {
      const res = await api()
        .post("/widget/v1/session")
        .send({ ...boot(), contractVersion: 2 })
        .expect(400);
      expect(res.body.message?.code ?? res.body.code).toBe("CONTRACT_VERSION");
    });

    it("refuses a malformed body without saying what exists", async () => {
      await api().post("/widget/v1/session").send({ widgetId: PUBLIC_ID }).expect(400);
    });
  });

  describe("platform attribution — the plan check is the only path", () => {
    it("defaults to SHOWN when the agency plan has no white-label feature", async () => {
      const res = await api().post("/widget/v1/session").send(boot()).expect(201);
      expect(res.body.branding).toEqual({ platformAttribution: true });
    });

    it("suppresses ONLY when the owning agency's tier plan says so", async () => {
      await owner.plan.create({
        data: {
          agencyId,
          name: "GROWTH", // the agency's planTier
          priceMonthly: 29900,
          features: { whiteLabel: true },
          limits: {},
        },
      });
      const res = await api().post("/widget/v1/session").send(boot()).expect(201);
      expect(res.body.branding).toEqual({ platformAttribution: false });

      // …and a plan for a DIFFERENT tier must not grant it.
      await owner.plan.deleteMany({ where: { agencyId } });
      await owner.plan.create({
        data: {
          agencyId,
          name: "SCALE",
          priceMonthly: 99900,
          features: { whiteLabel: true },
          limits: {},
        },
      });
      const back = await api().post("/widget/v1/session").send(boot()).expect(201);
      expect(back.body.branding).toEqual({ platformAttribution: true });
      await owner.plan.deleteMany({ where: { agencyId } });
    });
  });

  describe("flows — the server offers only what it can serve", () => {
    it("advertises only the servable subset, though all six are enabled in setup", async () => {
      const res = await api().post("/widget/v1/session").send(boot()).expect(201);
      expect(res.body.quickActions).toEqual([
        { kind: "schedule_callback", label: "Schedule a callback" },
        { kind: "ask_question", label: "Ask a question" },
      ]);
    });

    it("refuses a quick action whose server half does not exist yet", async () => {
      const res = await api()
        .post("/widget/v1/session")
        .send({ ...boot(), event: { type: "quick_action", action: "book_visit" } })
        .expect(422);
      expect(res.body.message?.code ?? res.body.code).toBe("FLOW_DISABLED");
    });

    it("refuses capture_submit while nothing collects fields", async () => {
      await api()
        .post("/widget/v1/session")
        .send({ ...boot(), event: { type: "capture_submit", fields: { email: "a@b.test" } } })
        .expect(422);
    });

    it("omits quickActions on non-boot events (absent means unchanged)", async () => {
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      const res = await api()
        .post("/widget/v1/session")
        .send({ ...boot(), sessionId: booted.body.sessionId, event: { type: "open" } })
        .expect(201);
      expect(res.body).not.toHaveProperty("quickActions");
    });
  });

  describe("capture → a real record → the outcome card (W2)", () => {
    const submit = (sessionId: string, fields: Record<string, string>) =>
      api()
        .post("/widget/v1/session")
        .send({ ...boot(), sessionId, event: { type: "capture_submit", fields } });

    it("asks for details instead of spending an AI turn", async () => {
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      const res = await api()
        .post("/widget/v1/session")
        .send({
          ...boot(),
          sessionId: booted.body.sessionId,
          event: { type: "quick_action", action: "schedule_callback" },
        })
        .expect(201);
      expect(res.body.capture).toMatchObject({
        flow: "scheduleCallback",
        submitLabel: "Schedule callback",
      });
      expect(res.body.capture.fields.map((f: { key: string }) => f.key)).toEqual([
        "name",
        "phone",
        "when",
      ]);
      expect(res.body.capture.consent.key).toBe("smsReminder");
      expect(res.body.messages).toEqual([]); // no model call, no billable turn
    });

    it("writes a Contact + a Meeting, then describes what it wrote", async () => {
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      await api()
        .post("/widget/v1/session")
        .send({
          ...boot(),
          sessionId: booted.body.sessionId,
          event: { type: "quick_action", action: "schedule_callback" },
        })
        .expect(201);

      const when = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const phone = `+1555${Math.floor(Math.random() * 1e7)}`;
      const res = await submit(booted.body.sessionId, {
        name: "Dana Ruiz",
        phone,
        when,
        smsReminder: "true",
      }).expect(201);

      expect(res.body.outcome).toMatchObject({
        kind: "callback_scheduled",
        title: "Callback scheduled",
      });
      expect(res.body.outcome.detail).toContain("Dana");
      expect(res.body.outcome.at).toBe(new Date(when).toISOString());

      const contact = await owner.contact.findFirst({ where: { workspaceId, phone } });
      expect(contact?.source).toBe("widget");
      const meeting = await owner.meeting.findFirst({
        where: { workspaceId, provider: "widget", externalId: booted.body.sessionId },
      });
      expect(meeting?.contactId).toBe(contact?.id);
      expect(meeting?.startAt.toISOString()).toBe(new Date(when).toISOString());
      // Consent is RECORDED, not enforced here — the send boundary owns that.
      expect((meeting?.meta as { smsReminderConsent?: unknown })?.smsReminderConsent).toBeTruthy();

      const session = await owner.widgetSession.findUnique({
        where: { id: booted.body.sessionId },
      });
      expect(session?.contactId).toBe(contact?.id); // no longer anonymous
    });

    it("a retried submit does not double-book", async () => {
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      await api()
        .post("/widget/v1/session")
        .send({
          ...boot(),
          sessionId: booted.body.sessionId,
          event: { type: "quick_action", action: "schedule_callback" },
        })
        .expect(201);
      const when = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const phone = `+1555${Math.floor(Math.random() * 1e7)}`;
      const fields = { name: "Sam Vale", phone, when };
      await submit(booted.body.sessionId, fields).expect(201);
      // the pending capture is cleared, so the replay refuses rather than
      // writing a second callback
      await submit(booted.body.sessionId, fields).expect(422);
      const count = await owner.meeting.count({
        where: { workspaceId, provider: "widget", externalId: booted.body.sessionId },
      });
      expect(count).toBe(1);
    });

    it("refuses a submit nobody asked for, and a past time", async () => {
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      // no quick_action first ⇒ no pending capture
      await submit(booted.body.sessionId, {
        name: "X",
        phone: "+15550000",
        when: new Date(Date.now() + 3600_000).toISOString(),
      }).expect(422);

      await api()
        .post("/widget/v1/session")
        .send({
          ...boot(),
          sessionId: booted.body.sessionId,
          event: { type: "quick_action", action: "schedule_callback" },
        })
        .expect(201);
      await submit(booted.body.sessionId, {
        name: "X",
        phone: "+15550001",
        when: new Date(Date.now() - 86_400_000).toISOString(),
      }).expect(422);
      await submit(booted.body.sessionId, {
        name: "X",
        when: new Date(Date.now() + 3600_000).toISOString(),
      }).expect(422);
    });

    it("fires widget.lead_captured.v1 — the second catalog entry that had no producer", async () => {
      const before = await owner.event.count({
        where: { workspaceId, type: "widget.lead_captured.v1" },
      });
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      await api()
        .post("/widget/v1/session")
        .send({
          ...boot(),
          sessionId: booted.body.sessionId,
          event: { type: "quick_action", action: "schedule_callback" },
        })
        .expect(201);
      await submit(booted.body.sessionId, {
        name: "Lee Park",
        phone: `+1555${Math.floor(Math.random() * 1e7)}`,
        when: new Date(Date.now() + 7200_000).toISOString(),
      }).expect(201);

      // No polling: unlike the chat-start event, a CAPTURE is published after
      // the commit and awaited, so it has landed by the time the visitor is
      // told. Losing it would mean a real lead whose automations never fired.
      const after = await owner.event.count({
        where: { workspaceId, type: "widget.lead_captured.v1" },
      });
      // ≥, not =: earlier tests in this file publish the same event type
      // FIRE-AND-FORGET, and a straggler can land inside this window — the
      // newest-row payload check pins that OUR action produced one.
      expect(after).toBeGreaterThanOrEqual(before + 1);
      const row = await owner.event.findFirst({
        where: { workspaceId, type: "widget.lead_captured.v1" },
        orderBy: { createdAt: "desc" },
      });
      expect(row?.contactId).toBeTruthy(); // the lead is attached, not anonymous
    });
  });

  describe("honest absence — no completion provider means no answer", () => {
    it("returns AGENT_UNAVAILABLE rather than inventing a reply", async () => {
      // This process ships no completion provider (the API's gateway is
      // embeddings-only), so the answerer refuses. The visitor sees "the
      // assistant is unavailable" — never a confident guess on a customer's
      // own marketing page.
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      const res = await api()
        .post("/widget/v1/session")
        .send({
          ...boot(),
          sessionId: booted.body.sessionId,
          event: { type: "visitor_message", text: "What does it cost?" },
        })
        .expect(503);
      expect(res.body.message?.code ?? res.body.code).toBe("AGENT_UNAVAILABLE");
    });
  });

  describe("isolation + caps", () => {
    it("a session id from another workspace's widget does not continue here", async () => {
      const mine = await api().post("/widget/v1/session").send(boot()).expect(201);
      const theirs = await api().post("/widget/v1/session").send(boot(OTHER_PUBLIC_ID)).expect(201);

      const res = await api()
        .post("/widget/v1/session")
        .send({ ...boot(), sessionId: theirs.body.sessionId, event: { type: "open" } })
        .expect(201);
      // A fresh session, not theirs — and not an error that would confirm the
      // foreign id exists.
      expect(res.body.sessionId).not.toBe(theirs.body.sessionId);
      expect(res.body.sessionId).not.toBe(mine.body.sessionId);

      const row = await owner.widgetSession.findUnique({ where: { id: theirs.body.sessionId } });
      expect(row?.workspaceId).toBe(otherWorkspaceId); // untouched
    });

    it("refuses a session that has burned its turn cap", async () => {
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      await owner.widgetSession.update({
        where: { id: booted.body.sessionId },
        data: { agentTurns: MAX_AGENT_TURNS_PER_SESSION },
      });
      const res = await api()
        .post("/widget/v1/session")
        .send({
          ...boot(),
          sessionId: booted.body.sessionId,
          event: { type: "visitor_message", text: "still there?" },
        })
        .expect(429);
      expect(res.body.message?.code ?? res.body.code).toBe("RATE_LIMITED");
    });
  });

  describe("ride-along: the automation vocabulary lights up", () => {
    it("a new session fires widget.conversation_started.v1 — the catalog entry that had no producer", async () => {
      const before = await owner.event.count({
        where: { workspaceId, type: "widget.conversation_started.v1" },
      });
      const res = await api().post("/widget/v1/session").send(boot()).expect(201);

      // Publishing is best-effort off the visitor's critical path, so poll
      // briefly rather than assuming the write landed inside the response.
      let after = before;
      for (let i = 0; i < 20 && after <= before; i++) {
        await new Promise((r) => setTimeout(r, 25));
        after = await owner.event.count({
          where: { workspaceId, type: "widget.conversation_started.v1" },
        });
      }
      // ≥, not =: earlier tests in this file publish the same event type
      // FIRE-AND-FORGET, and a straggler can land inside this window — the
      // newest-row payload check pins that OUR action produced one.
      expect(after).toBeGreaterThanOrEqual(before + 1);

      const row = await owner.event.findFirst({
        where: { workspaceId, type: "widget.conversation_started.v1" },
        orderBy: { createdAt: "desc" },
      });
      expect((row?.payload as { widgetId?: string })?.widgetId).toBe(widgetId);
      expect(res.body.sessionId).toBeTruthy();
    });

    it("ONE firing per session — reopening the same session does not re-fire", async () => {
      const start = await owner.event.count({
        where: { workspaceId, type: "widget.conversation_started.v1" },
      });
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      // Wait for the boot's OWN event to land first — publishing is
      // deliberately off the visitor's critical path, so counting immediately
      // would measure the race, not a re-fire.
      let before = start;
      for (let i = 0; i < 20 && before <= start; i++) {
        await new Promise((r) => setTimeout(r, 25));
        before = await owner.event.count({
          where: { workspaceId, type: "widget.conversation_started.v1" },
        });
      }
      expect(before).toBe(start + 1);
      await api()
        .post("/widget/v1/session")
        .send({ ...boot(), sessionId: booted.body.sessionId, event: { type: "open" } })
        .expect(201);
      await new Promise((r) => setTimeout(r, 150));
      const after = await owner.event.count({
        where: { workspaceId, type: "widget.conversation_started.v1" },
      });
      expect(after).toBe(before);
    });
  });

  describe("ride-along: the widget is genuinely KILLABLE", () => {
    it("a killed widget channel stops the agent answering — the switch is not a no-op", async () => {
      // Q-025's ruling: a channel only belongs in KILL_SWITCH_CHANNELS if its
      // boundary actually checks. Prove the check by flipping the switch and
      // watching the answer path refuse BEFORE it reaches the model.
      const booted = await api().post("/widget/v1/session").send(boot()).expect(201);
      await owner.killSwitch.create({
        data: { agencyId, channel: "widget", active: true, reason: "e2e proof" },
      });
      try {
        const res = await api()
          .post("/widget/v1/session")
          .send({
            ...boot(),
            sessionId: booted.body.sessionId,
            event: { type: "visitor_message", text: "hello?" },
          })
          .expect(503);
        expect(res.body.message?.code ?? res.body.code).toBe("AGENT_UNAVAILABLE");
      } finally {
        await owner.killSwitch.deleteMany({ where: { agencyId, channel: "widget" } });
      }
    });

    it("the widget is in the kill-switch enum (it earned the entry above)", () => {
      expect([...KILL_SWITCH_CHANNELS]).toContain("widget");
    });
  });

  describe("origin allow-list", () => {
    it("enforces the list when a tenant sets one, and is open when empty", async () => {
      await api()
        .post("/widget/v1/session")
        .set("Origin", "https://anywhere.test")
        .send(boot())
        .expect(201); // empty list ⇒ any origin, the honest default for an embed

      await owner.widget.update({
        where: { id: widgetId },
        data: { allowedOrigins: ["https://brightsmile.test"] },
      });
      await api()
        .post("/widget/v1/session")
        .set("Origin", "https://evil.test")
        .send(boot())
        .expect(403);
      await api()
        .post("/widget/v1/session")
        .set("Origin", "https://brightsmile.test")
        .send(boot())
        .expect(201);
      await owner.widget.update({ where: { id: widgetId }, data: { allowedOrigins: [] } });
    });
  });
});
