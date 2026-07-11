/**
 * P1.7 integration against Postgres (hermetic skip without infra): thread
 * resolution precedence (wire RFC id → provider id → sender-address
 * fallback), INBOUND Message persistence, classification side effects
 * (intent write + email.replied.v1 publish + unsubscribe suppression/opt-out/
 * workflow stop) with a capturing fake bus and a prompt-parsing fake gateway.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import type { EventBus } from "@clientforce/events";
import { applyUnsubscribeReply, classifyReply } from "../src/classify";
import { REPLY_INTENT_FIXTURES } from "../src/classify-fixtures";
import { ingestInboundEmail, normalizeInboundParse, resolveInboundThread } from "../src/inbound";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `inb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const LEAD = `lead-${suffix}@acme.test`;

/** Prompt-parsing fake: the reply text drives the label, like the real model.
 *  M1b: the PINNED fixtures resolve first (each fixture's verbatim reply maps
 *  to its pinned label — the same contract the live proof asserts against the
 *  REAL model), then the legacy regex heuristics. */
const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string }) => ({
      input: {
        intent:
          REPLY_INTENT_FIXTURES.find((f) => params.prompt.includes(f.reply))?.intent ??
          (/remove me|stop emailing/i.test(params.prompt)
            ? "unsubscribe"
            : /book a call|interested/i.test(params.prompt)
              ? "interested"
              : "replied"),
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  },
  embeddings: {
    embed: async (texts: string[]) => ({
      vectors: texts.map(() => [0]),
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  },
  config: { maxRetries: 0 },
});

class FakeBus {
  published: Array<{ type: string; payload: unknown }> = [];
  async publish(input: { type: string; payload: unknown }) {
    this.published.push(input);
    return input as never;
  }
}

describe.skipIf(!hasInfra)("inbound thread resolution + side effects", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let campaignId: string;
  let contactId: string;
  let enrollmentId: string;
  let outboundId: string;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: suffix, slug: suffix, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "INB", slug: suffix, settings: {} },
      })
    ).id;
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Booker", goal: "book_appointments", guardrails: {} },
    });
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId: agent.id, name: "primary", graphId: "" },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "import",
          optOut: {},
          tags: [],
          email: LEAD,
          firstName: "Dara",
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
          pipelineStage: "contacted",
          meta: {},
        },
      })
    ).id;
    outboundId = (
      await owner.message.create({
        data: {
          workspaceId: ws,
          campaignId,
          enrollmentId,
          contactId,
          channel: "email",
          direction: "OUTBOUND",
          subject: "A quick idea for Acme",
          body: "hello",
          providerMessageId: `SGX-${suffix}`,
          stepNodeId: "s1",
          sentAt: new Date(),
          meta: { rfcMessageId: `<rfc-${suffix}@send.clientforce.io>` },
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.event.deleteMany({ where: { workspaceId: ws } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await app?.$disconnect();
  });

  it("resolves by the wire RFC Message-ID (meta.rfcMessageId)", async () => {
    const resolution = await resolveInboundThread(owner, {
      fromEmail: LEAD,
      to: "reply@reply.clientforce.io",
      subject: "Re: A quick idea for Acme",
      text: "ok",
      referencedIds: [`<rfc-${suffix}@send.clientforce.io>`],
    });
    expect(resolution).toMatchObject({ workspaceId: ws, campaignId, contactId, enrollmentId });
    expect(resolution?.outbound?.id).toBe(outboundId);
  });

  it("falls back to the sender's latest OUTBOUND when headers carry no known id", async () => {
    const resolution = await resolveInboundThread(owner, {
      fromEmail: LEAD,
      to: "reply@reply.clientforce.io",
      subject: "hello again",
      text: "ok",
      referencedIds: [],
    });
    expect(resolution?.outbound?.id).toBe(outboundId);
  });

  it("returns null for mail that matches nothing (never an error a sender can probe)", async () => {
    const resolution = await resolveInboundThread(owner, {
      fromEmail: `stranger-${suffix}@nowhere.test`,
      to: "reply@reply.clientforce.io",
      subject: "spam",
      text: "hi",
      referencedIds: ["<unknown@elsewhere>"],
    });
    expect(resolution).toBeNull();
  });

  it("ingests the reply as an INBOUND Message anchored to the outbound (A6)", async () => {
    const inbound = normalizeInboundParse({
      from: `Dara <${LEAD}>`,
      to: "agent@reply.clientforce.io",
      subject: "Re: A quick idea for Acme",
      text: "Sounds interesting — how do we book a call?",
      headers: `In-Reply-To: <rfc-${suffix}@send.clientforce.io>`,
    });
    const result = await ingestInboundEmail({ owner, app }, inbound);
    expect(result).not.toBeNull();
    expect(result!.message).toMatchObject({
      direction: "INBOUND",
      workspaceId: ws,
      contactId,
      enrollmentId,
      inReplyToId: outboundId,
    });
  });

  it("classifies with the prompt-parsing gateway (engagement context included)", async () => {
    const intent = await classifyReply(gateway, {
      goal: "book_appointments",
      replyText: "Sounds interesting — how do we book a call?",
      engagement: ["email.opened.v1 at 2026-07-04T12:00:00Z"],
    });
    expect(intent).toBe("interested");
  });

  // M1b (DEC-068): the pinned fixture matrix — every emission label's fixture
  // classifies to its pin through the full classifyReply path (deterministic
  // fake here; the live proof runs the SAME fixtures against the real model).
  it("classifies every pinned fixture to its pinned intent (one per emission label)", async () => {
    for (const fixture of REPLY_INTENT_FIXTURES) {
      const intent = await classifyReply(gateway, {
        goal: "book_appointments",
        replyText: fixture.reply,
        engagement: [],
      });
      expect(intent, fixture.reply).toBe(fixture.intent);
    }
  });

  it("unsubscribe side effects: Suppression + optOut + enrollment UNSUBSCRIBED + event + workflow stop", async () => {
    const bus = new FakeBus();
    const stopped: string[] = [];
    await applyUnsubscribeReply(
      {
        prisma: app,
        bus: bus as unknown as EventBus,
        stopWorkflow: async (id) => {
          stopped.push(id);
        },
      },
      ws,
      contactId,
      enrollmentId,
    );

    const suppression = await owner.suppression.findFirst({
      where: { workspaceId: ws, address: LEAD },
    });
    expect(suppression?.reason).toBe("UNSUBSCRIBED");
    const contact = await owner.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect((contact.optOut as { email?: boolean }).email).toBe(true);
    const enrollment = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(enrollment.status).toBe("UNSUBSCRIBED");
    expect(bus.published).toEqual([
      expect.objectContaining({ type: "lead.unsubscribed.v1", payload: { channel: "email" } }),
    ]);
    expect(stopped).toEqual([enrollmentId]);
  });
});
