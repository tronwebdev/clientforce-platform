/**
 * INT W2 (DEC-094): compose-time booking injection vs real Postgres — the
 * step composers load the workspace's calendly config and augment the BRIEF
 * (never the cached prefix, never a prompt template):
 *
 *   - configured link → the deterministic talking point carries the FULL
 *     per-lead URL (utm_source + utm_content=<contactId>) — grounded by
 *     construction: composed copy with the full OR base URL passes the
 *     ungrounded-URL check (substring);
 *   - no config → no line, and an invented booking link still refuses;
 *   - Enrollment.meta.bookingLinkRequested → the link joins mustSay
 *     (verbatim-forced) and the flag SURVIVES compose (the send boundary
 *     clears it — see send.integration);
 *   - the slots line rides the injectable seam: yields → appended,
 *     null/throw → omitted, compose proceeds.
 *
 * Prompt-driven fake gateway (the M1a fixture pattern) — no network, ever.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { ComposeRefusedError } from "../src/compose-shared";
import { createEmailStepComposer } from "../src/compose-email";
import { createSmsStepComposer } from "../src/compose-sms";
import { bookingLinkTalkingPoint, withBookingUtm } from "../src/booking-link";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `cb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const SCHEDULING_URL = "https://calendly.com/ada-demo";

/** Prompt-driven fake: emits the queued outputs; records every call. */
function fakeGateway(outputs: unknown[]) {
  const calls: Array<{ prompt: string; cachedContext?: string }> = [];
  const gateway = new AiGateway({
    provider: {
      completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
      completeTool: async (params: { prompt: string; cachedContext?: string }) => {
        calls.push({ prompt: params.prompt, cachedContext: params.cachedContext });
        return {
          input: outputs[Math.min(calls.length - 1, outputs.length - 1)],
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    },
    config: { maxRetries: 0 },
  });
  return { gateway, calls };
}

describe.skipIf(!hasInfra)("compose-time booking injection (INT W2)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let enrollmentId: string;
  let fullLink: string;

  const stepParams = (over: Record<string, unknown> = {}) => ({
    workspaceId: ws,
    agentId,
    campaignId,
    contactId,
    enrollmentId,
    stepNodeId: "step-1",
    brief: {
      objective: "Invite them to book an intro call",
      talkingPoints: ["we book dental appointments end to end", "setup takes one afternoon"],
    },
    ...over,
  });

  const connectCalendly = () =>
    owner.integration.create({
      data: {
        workspaceId: ws,
        provider: "calendly",
        status: "connected",
        config: { schedulingUrl: SCHEDULING_URL },
        scopes: [],
      },
    });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "cb", slug: suffix, settings: {} } })).id;
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
          email: `ada-${suffix}@t.test`,
          firstName: "Ada",
          company: "Acme Dental",
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
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        status: "READY",
        fields: {
          offer: { value: "We book dental appointments with a free growth audit.", citations: [], source: "typed" },
        },
      },
    });
    fullLink = withBookingUtm(SCHEDULING_URL, contactId);
  });

  beforeEach(async () => {
    await owner.integration.deleteMany({ where: { workspaceId: ws } });
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { meta: {} } });
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("email: the FULL per-lead link rides the brief's talking points and grounds composed copy", async () => {
    await connectCalendly();
    const { gateway, calls } = fakeGateway([
      { subject: "A time that fits Acme Dental", body: `Ada, grab a time that works: ${SCHEDULING_URL}?utm_source=clientforce&utm_content=${contactId}. Worth a look?` },
    ]);
    const compose = createEmailStepComposer({ prisma: app, gateway });
    const out = await compose(stepParams());
    // The injected line carries the FULL final URL — verbatim, deterministic.
    expect(calls[0]!.prompt).toContain(bookingLinkTalkingPoint(fullLink));
    // …and NEVER the agent-stable cached prefix (per-render material).
    expect(calls[0]!.cachedContext).not.toContain(SCHEDULING_URL);
    // The composed body carrying the full URL passed the ungrounded-URL check.
    expect(out.body).toContain(`utm_content=${contactId}`);
  });

  it("email: a model that drops the params still grounds (substring) — detection degrades to email match", async () => {
    await connectCalendly();
    const { gateway } = fakeGateway([
      { subject: "A time that fits Acme Dental", body: `Ada, grab a time that works: ${SCHEDULING_URL}. Worth a look?` },
    ]);
    const compose = createEmailStepComposer({ prisma: app, gateway });
    const out = await compose(stepParams());
    expect(out.body).toContain(SCHEDULING_URL);
  });

  it("email: NO config → no injected line, and an invented booking link still refuses UNGROUNDED_URL", async () => {
    const dirty = { subject: "A time that fits Acme Dental", body: `Ada, book here: ${SCHEDULING_URL}. Worth a look?` };
    const { gateway, calls } = fakeGateway([dirty, dirty]); // first pass + bounded retry, both dirty
    const compose = createEmailStepComposer({ prisma: app, gateway });
    await expect(compose(stepParams())).rejects.toMatchObject({
      name: "ComposeRefusedError",
      reason: "UNGROUNDED_URL",
    });
    expect(calls[0]!.prompt).not.toContain("Booking link (offer it");
  });

  it("email: bookingLinkRequested joins mustSay (verbatim-forced) and SURVIVES compose", async () => {
    await connectCalendly();
    await owner.enrollment.update({
      where: { id: enrollmentId },
      data: { meta: { bookingLinkRequested: true } },
    });
    const clean = {
      subject: "A time that fits Acme Dental",
      body: `Ada, grab a time that works: ${fullLink}. Worth a look?`,
    };
    const noLink = { subject: "A time that fits Acme Dental", body: "Ada, shall we talk sometime? Worth a look?" };
    // First pass omits the link → MUST_SAY_MISSING → the bounded retry heals.
    const { gateway, calls } = fakeGateway([noLink, clean]);
    const compose = createEmailStepComposer({ prisma: app, gateway });
    const out = await compose(stepParams());
    expect(calls[0]!.prompt).toContain(`Must say verbatim: "${fullLink}"`);
    expect(calls[1]!.prompt).toContain("MUST_SAY_MISSING");
    expect(out.attempts).toBe(2);
    expect(out.body).toContain(fullLink);
    // The flag is cleared by the SEND boundary, never at compose.
    const meta = (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } }))
      .meta as Record<string, unknown>;
    expect(meta.bookingLinkRequested).toBe(true);
  });

  it("email: the slots seam appends when it yields, and degrades silently on null/throw", async () => {
    await connectCalendly();
    const line = "Open times (America/Chicago): Tue 10:00 AM · Wed 2:30 PM";
    const clean = {
      subject: "A time that fits Acme Dental",
      body: `Ada, grab a time that works: ${fullLink}. Worth a look?`,
    };

    const withSlots = fakeGateway([clean]);
    await createEmailStepComposer({
      prisma: app,
      gateway: withSlots.gateway,
      bookingSlotsLine: async () => line,
    })(stepParams());
    expect(withSlots.calls[0]!.prompt).toContain(line);

    const nullSlots = fakeGateway([clean]);
    await createEmailStepComposer({
      prisma: app,
      gateway: nullSlots.gateway,
      bookingSlotsLine: async () => null,
    })(stepParams());
    expect(nullSlots.calls[0]!.prompt).not.toContain("Open times");

    const throwing = fakeGateway([clean]);
    const out = await createEmailStepComposer({
      prisma: app,
      gateway: throwing.gateway,
      bookingSlotsLine: async () => {
        throw new Error("freebusy down");
      },
    })(stepParams());
    expect(out.body).toContain(fullLink); // compose proceeded, line omitted
    expect(throwing.calls[0]!.prompt).not.toContain("Open times");
  });

  it("sms: the same injection twins — grounded link in the prompt AND in the composed body", async () => {
    await connectCalendly();
    const { gateway, calls } = fakeGateway([{ body: `Ada — grab a time: ${fullLink}` }]);
    const compose = createSmsStepComposer({ prisma: app, gateway });
    const out = await compose(stepParams());
    expect(calls[0]!.prompt).toContain(bookingLinkTalkingPoint(fullLink));
    expect(out.body).toContain(fullLink);
  });

  it("sms: an invented link with no config refuses typed (the composer twin check)", async () => {
    const dirty = { body: `Ada — book: ${SCHEDULING_URL}` };
    const { gateway } = fakeGateway([dirty, dirty]);
    const compose = createSmsStepComposer({ prisma: app, gateway });
    await expect(compose(stepParams())).rejects.toBeInstanceOf(ComposeRefusedError);
  });

  it("a revoked calendly connection injects nothing (honest degrade)", async () => {
    await owner.integration.create({
      data: {
        workspaceId: ws,
        provider: "calendly",
        status: "revoked",
        config: { schedulingUrl: SCHEDULING_URL },
        scopes: [],
      },
    });
    const clean = { subject: "A time that fits Acme Dental", body: "Ada — worth a quick chat sometime?" };
    const { gateway, calls } = fakeGateway([clean]);
    await createEmailStepComposer({ prisma: app, gateway })(stepParams());
    expect(calls[0]!.prompt).not.toContain("Booking link (offer it");
  });
});
