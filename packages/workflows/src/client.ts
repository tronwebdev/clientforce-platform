/**
 * Host-side client helpers (P1.6): start a CampaignWorkflow per enrollment
 * (dedupe by workflow id — double-enroll is a no-op) and send the reply
 * signal. Deliberately does NOT import ./workflows — workflow code only ever
 * loads inside the worker's isolate.
 */
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
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

export async function signalEnrollmentReply(
  client: Client,
  enrollmentId: string,
  intent: string,
): Promise<void> {
  await client.workflow.getHandle(workflowIdFor(enrollmentId)).signal(REPLY_SIGNAL, intent);
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
  try {
    await client.workflow.getHandle(workflowIdFor(enrollmentId)).cancel();
  } catch (err) {
    // Not-found / already-completed are fine — the suppression row is the hard stop.
    if (err instanceof Error && /not found|already completed/i.test(err.message)) return;
    throw err;
  }
}
