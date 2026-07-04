/**
 * Activity tests (P1.6) against real Postgres (hermetic skip without infra).
 * The transport is a capturing fake — proves the idempotency key, the
 * non-retryable SendBlockedError mapping, and the enrollment persistence
 * (progress, blocked amber-row meta, completion).
 */
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailSender, RenderedEmail } from "@clientforce/channels";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { createActivities, type CampaignActivities } from "../src/activities";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `wf-act-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const INBOX = `lead-${suffix}@allowed.test`;
const ADDRESS = "5 Durable Way, Lagos";

class CapturingSender implements EmailSender {
  sent: RenderedEmail[] = [];
  async send(email: RenderedEmail) {
    this.sent.push(email);
    return { providerMessageId: `<wf-${this.sent.length}-${suffix}@send.clientforce.io>` };
  }
}

describe.skipIf(!hasInfra)("workflow activities", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let acts: CampaignActivities;
  const transport = new CapturingSender();
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;
  let senderId: string;
  let noNameSenderId: string;
  let enrollmentId: string;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    acts = createActivities({ prisma: app, transport, allowlist: [INBOX] });

    const agency = await owner.agency.create({
      data: { name: suffix, slug: suffix, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "wf", slug: suffix, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: {
          workspaceId: ws,
          name: "Walker",
          goal: "book_appointments",
          guardrails: {
            sendingWindow: {
              days: [1, 2, 3, 4, 5, 6, 7],
              start: "00:00",
              end: "23:59",
              timezone: "UTC",
            },
            dailyCap: { email: 100 },
            consent: null,
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "primary", graphId: "" },
      })
    ).id;
    contactId = (
      await owner.contact.create({
        data: {
          workspaceId: ws,
          source: "test",
          optOut: {},
          tags: [],
          email: INBOX,
          firstName: "Dara",
          company: "Acme",
        },
      })
    ).id;
    senderId = (
      await owner.senderConnection.create({
        data: {
          workspaceId: ws,
          type: "CF_MANAGED",
          fromEmail: "agent@send.clientforce.io",
          fromName: "Sam Rivers",
        },
      })
    ).id;
    noNameSenderId = (
      await owner.senderConnection.create({
        data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: "x@send.clientforce.io" },
      })
    ).id;
    await owner.businessContext.create({
      data: {
        workspaceId: ws,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } },
      },
    });
    const enrollment = await owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        workflowId: `enroll-test-${suffix}`,
        pipelineStage: "new",
        meta: {},
      },
    });
    enrollmentId = enrollment.id;
  });

  afterAll(async () => {
    if (owner && agencyId) {
      await owner.message.deleteMany({ where: { workspaceId: ws } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await app?.$disconnect();
  });

  const stepParams = () => ({
    workspaceId: ws,
    enrollmentId,
    campaignId,
    agentId,
    contactId,
    senderId,
    stepNodeId: "step-1",
    content: { subject: "Hi {{firstName}}", body: "From {{senderName}}" },
  });

  it("sends through the P1.5 boundary and persists the Message with the enrollment id", async () => {
    const outcome = await acts.sendEnrollmentStep(stepParams());
    expect(outcome.kind).toBe("sent");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].body).toContain(ADDRESS);
    const message = await owner.message.findUniqueOrThrow({ where: { id: outcome.messageId } });
    expect(message.enrollmentId).toBe(enrollmentId);
    expect(message.stepNodeId).toBe("step-1");
  });

  it("is idempotent on (enrollmentId, stepNodeId): a retry NEVER double-sends", async () => {
    const outcome = await acts.sendEnrollmentStep(stepParams());
    expect(outcome.kind).toBe("duplicate");
    expect(transport.sent).toHaveLength(1); // still exactly one wire send
  });

  it("maps SendBlockedError to a NON-RETRYABLE ApplicationFailure with the typed reason", async () => {
    const err = await acts
      .sendEnrollmentStep({ ...stepParams(), senderId: noNameSenderId, stepNodeId: "step-2" })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    const failure = err as ApplicationFailure;
    expect(failure.type).toBe("SendBlockedError");
    expect(failure.nonRetryable).toBe(true);
    expect(failure.details?.[0]).toMatchObject({ reason: "SENDER_NO_FROM_NAME" });
  });

  it("updates progress + pipeline stage; records blocks as user-visible meta; completes", async () => {
    await acts.updateEnrollmentProgress({
      workspaceId: ws,
      enrollmentId,
      currentNode: "step-1",
      pipelineStage: "contacted",
    });
    let row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(row.currentNode).toBe("step-1");
    expect(row.pipelineStage).toBe("contacted");

    // Owner Logs-tab rule (2026-07-04): the refusal is DATA on the enrollment.
    await acts.recordEnrollmentBlocked({
      workspaceId: ws,
      enrollmentId,
      nodeId: "step-2",
      reason: "NO_COMPANY_ADDRESS",
      detail: "Send blocked (NO_COMPANY_ADDRESS)",
    });
    row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(row.status).toBe("PAUSED");
    expect(row.meta).toMatchObject({
      blocked: { nodeId: "step-2", reason: "NO_COMPANY_ADDRESS" },
    });

    // Suppression/opt-out refusals mark the enrollment UNSUBSCRIBED instead.
    await acts.recordEnrollmentBlocked({
      workspaceId: ws,
      enrollmentId,
      nodeId: "step-2",
      reason: "SUPPRESSED",
      detail: "Send blocked (SUPPRESSED)",
    });
    row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(row.status).toBe("UNSUBSCRIBED");

    await acts.recordIntendedAction({
      workspaceId: ws,
      enrollmentId,
      nodeId: "br-1",
      kind: "branch",
      detail: "intent:interested → book",
    });
    row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(row.meta).toMatchObject({
      events: [{ nodeId: "br-1", kind: "branch", detail: "intent:interested → book" }],
    });

    await acts.completeEnrollment({ workspaceId: ws, enrollmentId, nodeId: "end-1" });
    row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(row.status).toBe("DONE");
    expect(row.currentNode).toBe("end-1");
  });
});
