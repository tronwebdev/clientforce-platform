/**
 * Host-side client helpers (P1.6): start a CampaignWorkflow per enrollment
 * (dedupe by workflow id — double-enroll is a no-op) and send the reply
 * signal. Deliberately does NOT import ./workflows — workflow code only ever
 * loads inside the worker's isolate.
 */
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { validateGraph, type CampaignGraph } from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import {
  REPLY_SIGNAL,
  TASK_QUEUE,
  workflowIdFor,
  type CampaignWorkflowInput,
} from "./shared";

/**
 * Client from env: TEMPORAL_ADDRESS (+ optional TEMPORAL_NAMESPACE, and
 * TEMPORAL_API_KEY for Temporal Cloud — implies TLS). Returns null when no
 * address is configured (staging until the owner provisions an endpoint).
 */
export async function connectTemporalClient(): Promise<Client | null> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) return null;
  const apiKey = process.env.TEMPORAL_API_KEY;
  const connection = await Connection.connect({
    address,
    ...(apiKey ? { tls: true, apiKey } : {}),
  });
  return new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  });
}

export async function startCampaignWorkflow(
  client: Client,
  input: CampaignWorkflowInput,
): Promise<{ workflowId: string; deduped: boolean }> {
  const workflowId = workflowIdFor(input.enrollmentId);
  try {
    // String name (not a function import) keeps workflow code out of this process.
    await client.workflow.start("campaignWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
    });
    return { workflowId, deduped: false };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) return { workflowId, deduped: true };
    throw err;
  }
}

/**
 * R1 (DEC-074): a moved enrollment runs under a NEW workflow id (see
 * `moveEnrollmentToNode`), stored on `Enrollment.workflowId` — callers that
 * know the stored id pass it; the default stays the enroll-time id so every
 * pre-R1 call site behaves identically.
 */
export async function signalEnrollmentReply(
  client: Client,
  enrollmentId: string,
  intent: string,
  workflowId: string = workflowIdFor(enrollmentId),
): Promise<void> {
  await client.workflow.getHandle(workflowId).signal(REPLY_SIGNAL, intent);
}

/**
 * Stop an enrollment's durable run (P1.7: an unsubscribe reply ends it — no
 * timer may ever fire again for that lead). Cancellation is cooperative and
 * idempotent; an already-finished workflow is a no-op, not an error.
 */
export async function cancelEnrollmentWorkflow(
  client: Client,
  enrollmentId: string,
): Promise<void> {
  await cancelWorkflowById(client, workflowIdFor(enrollmentId));
}

/** Cancel by explicit workflow id (R1: moved enrollments carry a non-default id). */
export async function cancelWorkflowById(client: Client, workflowId: string): Promise<void> {
  try {
    await client.workflow.getHandle(workflowId).cancel();
  } catch (err) {
    // Not-found / already-completed are fine — the suppression row is the hard stop.
    if (err instanceof Error && /not found|already completed/i.test(err.message)) return;
    throw err;
  }
}

export interface MoveEnrollmentParams {
  workspaceId: string;
  enrollmentId: string;
  /** Graph node the new run starts at — validated against the LIVE graph (B6). */
  targetNodeId: string;
  /**
   * Idempotency key for the move (the triggering rule run's eventId): the new
   * workflow id derives from it, so a bus redelivery re-issues the SAME start
   * and dedupes on WorkflowExecutionAlreadyStartedError.
   */
  dedupeKey: string;
}

/**
 * R1 (DEC-074): the "move to sequence/branch" rule action — restart an
 * enrollment's durable run at a target graph node. Mirrors the enroll-time
 * input assembly (enrollments.controller): live campaign graph re-validated
 * on the way in, first ACTIVE sender. The old run is cancelled (cooperative;
 * a brief overlap can't double-send — sends are idempotent per
 * (enrollmentId, stepNodeId)); the new run starts under a DETERMINISTIC id
 * `enroll-<id>-m<dedupeKey>` recorded on `Enrollment.workflowId`, and the
 * enrollment returns to ACTIVE at the target node (a DONE enrollment may be
 * moved — that's the re-engagement path).
 *
 * Throws typed message codes for honest-absence recording upstream:
 * ENROLLMENT_NOT_FOUND · NO_GRAPH · TARGET_NODE_MISSING · NO_ACTIVE_SENDER.
 */
export async function moveEnrollmentToNode(
  client: Client,
  prisma: PrismaClient,
  params: MoveEnrollmentParams,
): Promise<{ workflowId: string; deduped: boolean }> {
  const { workspaceId, enrollmentId, targetNodeId } = params;
  const assembled = await withTenant(prisma, { workspaceId }, async (tx) => {
    const enrollment = await tx.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) throw new Error(`ENROLLMENT_NOT_FOUND: ${enrollmentId}`);
    const campaign = await tx.campaign.findUnique({ where: { id: enrollment.campaignId } });
    if (!campaign) throw new Error(`ENROLLMENT_NOT_FOUND: campaign ${enrollment.campaignId}`);
    const graphRow = await tx.campaignGraph.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { version: "desc" },
    });
    if (!graphRow) throw new Error(`NO_GRAPH: campaign ${campaign.id}`);
    // Re-validate on the way into the engine (the enroll-time rule) and
    // resolve the target LIVE — a stale node reference must fail typed,
    // never start a broken run.
    const graph = validateGraph(graphRow.graph) as CampaignGraph;
    if (!graph.nodes.some((n) => n.id === targetNodeId)) {
      throw new Error(`TARGET_NODE_MISSING: ${targetNodeId}`);
    }
    const sender = await tx.senderConnection.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    if (!sender) throw new Error("NO_ACTIVE_SENDER");
    return {
      previousWorkflowId: enrollment.workflowId,
      previousMeta: enrollment.meta,
      contactId: enrollment.contactId,
      campaignId: campaign.id,
      agentId: campaign.agentId,
      senderId: sender.id,
      graph,
      graphVersion: graphRow.version,
    };
  });

  const workflowId = `${workflowIdFor(enrollmentId)}-m${params.dedupeKey}`;
  await cancelWorkflowById(client, assembled.previousWorkflowId);

  const scale = Number(process.env.TEST_DELAY_SCALE);
  const input: CampaignWorkflowInput = {
    workspaceId,
    enrollmentId,
    campaignId: assembled.campaignId,
    agentId: assembled.agentId,
    contactId: assembled.contactId,
    senderId: assembled.senderId,
    graph: assembled.graph,
    graphVersion: assembled.graphVersion,
    startNodeId: targetNodeId,
    ...(Number.isFinite(scale) && scale > 0 ? { delayScale: scale } : {}),
  };
  let deduped = false;
  try {
    await client.workflow.start("campaignWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
    });
  } catch (err) {
    if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
    deduped = true;
  }

  await withTenant(prisma, { workspaceId }, (tx) =>
    tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        workflowId,
        status: "ACTIVE",
        currentNode: targetNodeId,
        // W3-4 (DEC-076): a move adopts the LATEST graph — restamp the
        // enrolled-version audit so surfaces stay honest about which version
        // this lead now runs on.
        meta: {
          ...(typeof assembled.previousMeta === "object" && assembled.previousMeta !== null
            ? (assembled.previousMeta as Record<string, unknown>)
            : {}),
          graphVersion: assembled.graphVersion,
        },
      },
    }),
  );
  return { workflowId, deduped };
}
