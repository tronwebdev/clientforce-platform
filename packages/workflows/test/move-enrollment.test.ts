/**
 * R1 (DEC-073): `moveEnrollmentToNode` — the "move to sequence/branch" rule
 * action's host side, against real Postgres with a capturing fake Temporal
 * client (the engine's Temporal seam is what's under test; the workflow
 * walker's `startNodeId` behavior rides the Temporal time-skipping suite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { moveEnrollmentToNode } from "../src/client";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `r1-move-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const GRAPH = {
  entry: "s1",
  nodes: [
    { id: "s1", type: "step", channel: "email", content: { subject: "a", body: "b" } },
    { id: "s2", type: "step", channel: "email", content: { subject: "a", body: "c" } },
    { id: "end1", type: "end" },
  ],
  edges: [
    { from: "s1", to: "s2" },
    { from: "s2", to: "end1" },
  ],
};

interface StartCall {
  workflowId: string;
  args: unknown[];
}

function fakeTemporal(opts: { alreadyStarted?: boolean } = {}) {
  const started: StartCall[] = [];
  const cancelled: string[] = [];
  const client = {
    workflow: {
      start: async (_name: string, o: { workflowId: string; args: unknown[] }) => {
        if (opts.alreadyStarted) {
          throw new WorkflowExecutionAlreadyStartedError(
            "already started",
            o.workflowId,
            "campaignWorkflow",
          );
        }
        started.push({ workflowId: o.workflowId, args: o.args });
      },
      getHandle: (id: string) => ({
        cancel: async () => {
          cancelled.push(id);
        },
      }),
    },
  } as unknown as Client;
  return { client, started, cancelled };
}

describe.skipIf(!hasInfra)("moveEnrollmentToNode", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let campaignId: string;
  let contactId: string;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "mv", slug: suffix, settings: {} } })).id;
    const agentId = (
      await owner.agent.create({
        data: { workspaceId: ws, name: "Mover", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    campaignId = (
      await owner.campaign.create({ data: { workspaceId: ws, agentId, name: "primary", graphId: "" } })
    ).id;
    const graphRow = await owner.campaignGraph.create({
      data: { workspaceId: ws, campaignId, version: 1, graph: GRAPH },
    });
    await owner.campaign.update({ where: { id: campaignId }, data: { graphId: graphRow.id } });
    await owner.senderConnection.create({
      data: { workspaceId: ws, type: "CF_MANAGED", fromEmail: "agent@send.clientforce.io", fromName: "Sam" },
    });
    contactId = (
      await owner.contact.create({
        data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `l-${suffix}@allowed.test` },
      })
    ).id;
  });

  afterAll(async () => {
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await app?.$disconnect();
  });

  const seedEnrollment = async (tag: string) =>
    owner.enrollment.create({
      data: {
        workspaceId: ws,
        campaignId,
        contactId,
        workflowId: `enroll-old-${tag}-${suffix}`,
        pipelineStage: "contacted",
        status: "DONE",
        meta: {},
      },
    });

  it("cancels the stored run, starts a new one AT the target node, and re-points the enrollment", async () => {
    const enrollment = await seedEnrollment("happy");
    const t = fakeTemporal();
    const result = await moveEnrollmentToNode(t.client, app, {
      workspaceId: ws,
      enrollmentId: enrollment.id,
      targetNodeId: "s2",
      dedupeKey: "evt-1",
    });
    expect(result.deduped).toBe(false);
    expect(t.cancelled).toEqual([`enroll-old-happy-${suffix}`]);
    expect(t.started).toHaveLength(1);
    expect(t.started[0]!.workflowId).toBe(`enroll-${enrollment.id}-mevt-1`);
    const input = t.started[0]!.args[0] as { startNodeId?: string; graphVersion?: number };
    expect(input.startNodeId).toBe("s2");
    expect(input.graphVersion).toBe(1);

    const updated = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(updated.workflowId).toBe(`enroll-${enrollment.id}-mevt-1`);
    expect(updated.status).toBe("ACTIVE"); // a DONE enrollment moved = re-engagement
    expect(updated.currentNode).toBe("s2");
    await owner.enrollment.delete({ where: { id: enrollment.id } });
  });

  it("dedupes on WorkflowExecutionAlreadyStartedError — a redelivered move is a no-op start", async () => {
    const enrollment = await seedEnrollment("dedupe");
    const t = fakeTemporal({ alreadyStarted: true });
    const result = await moveEnrollmentToNode(t.client, app, {
      workspaceId: ws,
      enrollmentId: enrollment.id,
      targetNodeId: "s2",
      dedupeKey: "evt-2",
    });
    expect(result.deduped).toBe(true);
    // The enrollment still converges on the move's end state.
    const updated = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(updated.workflowId).toBe(`enroll-${enrollment.id}-mevt-2`);
    await owner.enrollment.delete({ where: { id: enrollment.id } });
  });

  it("refuses a target node missing from the LIVE graph — typed, nothing started (honest absence)", async () => {
    const enrollment = await seedEnrollment("missing");
    const t = fakeTemporal();
    await expect(
      moveEnrollmentToNode(t.client, app, {
        workspaceId: ws,
        enrollmentId: enrollment.id,
        targetNodeId: "node-deleted-by-regen",
        dedupeKey: "evt-3",
      }),
    ).rejects.toThrow(/TARGET_NODE_MISSING/);
    expect(t.started).toHaveLength(0);
    expect(t.cancelled).toHaveLength(0);
    const untouched = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(untouched.workflowId).toBe(`enroll-old-missing-${suffix}`);
    expect(untouched.status).toBe("DONE");
    await owner.enrollment.delete({ where: { id: enrollment.id } });
  });
});
