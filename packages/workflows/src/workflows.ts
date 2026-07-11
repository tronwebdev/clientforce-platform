/**
 * CampaignWorkflow (P1.6) — ONE durable run per Enrollment, walking the
 * planner's CampaignGraph with the T4 node semantics but real effects:
 * `step` → send activity (the P1.5 boundary runs inside the activity) ·
 * `delay` → Temporal timer · `branch on="reply"` → await the reply signal
 * (P1.7's classifier sends it) with a default-case timeout · `end` → done.
 *
 * This module runs in the workflow V8 isolate: deterministic imports only
 * (@temporalio/workflow + the pure ./shared helpers).
 */
import {
  ApplicationFailure,
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import { ActivityFailure } from "@temporalio/common";
import type { GraphNode, NodeId } from "@clientforce/core";
import type { createActivities } from "./activities";
import {
  delayToMs,
  nextAfter,
  resolveReplyBranch,
  REPLY_SIGNAL,
  type CampaignWorkflowInput,
  type CampaignWorkflowResult,
} from "./shared";

/** Reply signal: the classified intent of an inbound reply (opaque string). */
export const replySignal = defineSignal<[string]>(REPLY_SIGNAL);

const acts = proxyActivities<ReturnType<typeof createActivities>>({
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5s",
    backoffCoefficient: 2,
    maximumAttempts: 5,
    // A SendBlockedError refusal is a decision, not an outage — never retried
    // (a suppressed contact must never be retried into a send). G1: a
    // ComposeRefusedError already spent its bounded retry inside the composer.
    nonRetryableErrorTypes: ["SendBlockedError", "ComposeRefusedError"],
  },
});

function typedFailureOf(
  err: unknown,
  type: "SendBlockedError" | "ComposeRefusedError",
): { reason: string; detail: string } | undefined {
  if (!(err instanceof ActivityFailure)) return undefined;
  const cause = err.cause;
  if (!(cause instanceof ApplicationFailure) || cause.type !== type) return undefined;
  const first = cause.details?.[0] as { reason?: string; detail?: string } | undefined;
  return { reason: first?.reason ?? "UNKNOWN", detail: first?.detail ?? cause.message };
}

export async function campaignWorkflow(
  input: CampaignWorkflowInput,
): Promise<CampaignWorkflowResult> {
  const scale = input.delayScale ?? 1;
  const pendingIntents: string[] = [];
  setHandler(replySignal, (intent) => {
    pendingIntents.push(intent);
  });

  const nodesById = new Map<NodeId, GraphNode>(input.graph.nodes.map((n) => [n.id, n]));
  const base = {
    workspaceId: input.workspaceId,
    enrollmentId: input.enrollmentId,
  };

  let current: NodeId | undefined = input.graph.entry;
  let lastNode: NodeId = input.graph.entry;

  while (current !== undefined) {
    const node = nodesById.get(current);
    if (!node) {
      throw ApplicationFailure.create({
        type: "GraphIntegrityError",
        nonRetryable: true,
        message: `Reached unknown node "${current}" — graph should have been validated at persist time`,
      });
    }
    lastNode = node.id;

    switch (node.type) {
      case "step": {
        if (node.channel !== "email" && node.channel !== "sms") {
          // P2.1: email + sms are live; anything else records, doesn't send.
          await acts.recordIntendedAction({
            ...base,
            nodeId: node.id,
            kind: "send",
            detail: `channel ${node.channel} deferred`,
          });
          current = nextAfter(input.graph, node.id);
          break;
        }
        try {
          await acts.sendEnrollmentStep({
            ...base,
            campaignId: input.campaignId,
            agentId: input.agentId,
            contactId: input.contactId,
            senderId: input.senderId,
            stepNodeId: node.id,
            content: node.content,
            // P2.1 (DEC-061): ONE durable workflow drives both channels — the
            // activity routes by the step's channel.
            channel: node.channel,
            // G1 (DEC-070): guided steps compose per lead inside the activity,
            // before the unchanged boundary rails.
            mode: node.mode,
            brief: node.brief,
            graphVersion: input.graphVersion ?? null,
          });
        } catch (err) {
          // G1: composer refusal — pause THIS lead with the typed reason +
          // the sms.compose_refused.v1 Logs row; never a silent skip.
          const refused = typedFailureOf(err, "ComposeRefusedError");
          if (refused) {
            await acts.recordComposeRefused({
              ...base,
              contactId: input.contactId,
              campaignId: input.campaignId,
              nodeId: node.id,
              reason: refused.reason,
              detail: refused.detail,
            });
            return { status: "blocked", node: node.id, reason: refused.reason };
          }
          const blocked = typedFailureOf(err, "SendBlockedError");
          if (!blocked) throw err;
          // Owner Logs-tab rule: the refusal is user-visible data on the
          // enrollment (amber row), and this path of the run ends here.
          await acts.recordEnrollmentBlocked({
            ...base,
            nodeId: node.id,
            reason: blocked.reason,
            detail: blocked.detail,
          });
          return { status: "blocked", node: node.id, reason: blocked.reason };
        }
        await acts.updateEnrollmentProgress({
          ...base,
          currentNode: node.id,
          pipelineStage: node.pipelineOnSend,
        });
        current = nextAfter(input.graph, node.id);
        break;
      }
      case "delay": {
        await acts.updateEnrollmentProgress({ ...base, currentNode: node.id });
        await sleep(delayToMs(node.amount, node.unit, scale));
        current = nextAfter(input.graph, node.id);
        break;
      }
      case "branch": {
        await acts.updateEnrollmentProgress({ ...base, currentNode: node.id });
        let intent: string | undefined;
        if (node.on === "reply") {
          const hasDefault = node.cases.some((c) => c.when === "default");
          if (hasDefault) {
            const timeoutMs = delayToMs(input.branchDefaultTimeoutHours ?? 72, "hours", scale);
            const signalled = await condition(() => pendingIntents.length > 0, timeoutMs);
            intent = signalled ? pendingIntents.shift() : undefined;
          } else {
            await condition(() => pendingIntents.length > 0);
            intent = pendingIntents.shift();
          }
        }
        const resolved = resolveReplyBranch(node, intent);
        if (!resolved) {
          // No matching case and no default — validated graphs shouldn't get
          // here; stop cleanly rather than spin.
          return { status: "stopped", node: node.id, detail: `no case for "${intent}"` };
        }
        await acts.recordIntendedAction({
          ...base,
          nodeId: node.id,
          kind: "branch",
          detail: `${resolved.matched} → ${resolved.chosen.goto}`,
        });
        if (resolved.chosen.pipeline) {
          await acts.updateEnrollmentProgress({
            ...base,
            currentNode: node.id,
            pipelineStage: resolved.chosen.pipeline,
          });
        }
        current = resolved.chosen.goto;
        break;
      }
      case "action": {
        await acts.recordIntendedAction({
          ...base,
          nodeId: node.id,
          kind: "action",
          detail: node.action,
        });
        current = nextAfter(input.graph, node.id);
        break;
      }
      case "subcampaign": {
        await acts.recordIntendedAction({
          ...base,
          nodeId: node.id,
          kind: "subcampaign",
          detail: node.ref,
        });
        current = nextAfter(input.graph, node.id);
        break;
      }
      case "end": {
        await acts.completeEnrollment({ ...base, nodeId: node.id });
        return { status: "completed", endNode: node.id };
      }
    }
  }

  // Graph path ran off the edge list without an end node (subcampaign tails
  // may do this) — the enrollment is done as far as this run is concerned.
  await acts.completeEnrollment({ ...base, nodeId: lastNode });
  return { status: "completed", endNode: lastNode };
}
