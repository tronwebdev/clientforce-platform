/**
 * B3c-1 (DEC-113/119): the best-time call queue. "Ada picks the best time"
 * is a deterministic claim — the dial endpoint computes the next moment the
 * contact-local window opens (`nextWindowOpenAt`, the SAME resolver the rail
 * checks against) and delays a BullMQ job until then. The worker consumer
 * re-runs the FULL dial rail at fire time — consent may have flipped, a
 * suppression may have landed, the campaign may have paused — a queued call
 * never bypasses a gate that would refuse a fresh one. Refusals mark the
 * Call row canceled with the typed reason and publish `call.refused.v1`
 * exactly like the synchronous path.
 */
import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { BULL_PREFIX, bullConnectionFromUrl } from "@clientforce/events";
import { withTenant, type PrismaClient } from "@clientforce/db";
import { assertDialAllowed, nextWindowOpenAt, resolveCallWindow } from "./dial-voice";
import { parseGuardrails } from "@clientforce/core";
import { deriveVoiceMediaToken, type VoiceDialer } from "./twilio-voice";
import { SendBlockedError } from "./types";

export const CALL_DIAL_QUEUE = "voice-call-dial";

export interface CallDialJobData {
  workspaceId: string;
  callId: string;
}

export function createCallDialQueue(connection?: ConnectionOptions): Queue<CallDialJobData> {
  return new Queue<CallDialJobData>(CALL_DIAL_QUEUE, {
    connection:
      connection ?? bullConnectionFromUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
    prefix: BULL_PREFIX,
  });
}

export interface FireQueuedCallDeps {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  dialer: VoiceDialer;
  /** Refusals surface as call.refused.v1 (the caller's publisher). */
  publish: (event: {
    type: string;
    workspaceId: string;
    campaignId?: string;
    contactId?: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  /** Re-arm a delayed job for this call (late fires reschedule, never
   *  cancel — a timing miss is the queue's own failure, not the call's). */
  requeue?: (data: CallDialJobData, delayMs: number) => Promise<void>;
}

export type FireQueuedCallResult =
  | { kind: "placed"; providerCallSid: string; sandbox: boolean }
  | { kind: "refused"; reason: string; detail: string }
  | { kind: "rescheduled"; scheduledAt: string }
  | { kind: "skipped"; why: string };

/**
 * Fire one queued Call: rails re-checked fresh, then the dial — the exact
 * sequence the synchronous endpoint runs, minus row creation (the row
 * already exists with the schedule on it).
 */
export async function fireQueuedCall(
  deps: FireQueuedCallDeps,
  data: CallDialJobData,
): Promise<FireQueuedCallResult> {
  const { prisma, dialer } = deps;
  const ctx = { workspaceId: data.workspaceId };
  const call = await withTenant(prisma, ctx, (tx) => tx.call.findUnique({ where: { id: data.callId } }));
  if (!call) return { kind: "skipped", why: "call row gone" };
  if (call.status !== "QUEUED" || call.providerCallSid) {
    return { kind: "skipped", why: `already ${call.status.toLowerCase()}` };
  }
  try {
    const clearance = await assertDialAllowed(
      { prisma },
      {
        workspaceId: data.workspaceId,
        campaignId: call.campaignId,
        agentId: call.agentId,
        contactId: call.contactId,
        caller: (call.caller as "ada" | "human") ?? "ada",
      },
    );
    const voiceServiceUrl = (process.env.VOICE_SERVICE_URL ?? "").replace(/\/$/, "");
    const apiPublicUrl = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
    const gateToken = process.env.TWILIO_AUTH_TOKEN
      ? `&t=${deriveVoiceMediaToken(process.env.TWILIO_AUTH_TOKEN)}`
      : "";
    const result = await dialer.placeCall({
      to: clearance.phone,
      twimlUrl: `${voiceServiceUrl}/twiml?callId=${call.id}&workspaceId=${data.workspaceId}${gateToken}`,
      ...(apiPublicUrl ? { statusCallbackUrl: `${apiPublicUrl}/webhooks/twilio-voice-status` } : {}),
    });
    await withTenant(prisma, ctx, (tx) =>
      tx.call.update({
        where: { id: call.id },
        data: {
          providerCallSid: result.providerCallSid,
          meta: { ...((call.meta ?? {}) as object), sandbox: result.sandbox, firedAt: new Date().toISOString() },
        },
      }),
    );
    return { kind: "placed", providerCallSid: result.providerCallSid, sandbox: result.sandbox };
  } catch (err) {
    if (err instanceof SendBlockedError) {
      // A TIMING refusal at fire is the queue's own lateness (a worker
      // outage, a backlog) — reschedule to the next opening instead of
      // canceling a call every gate had cleared. Every other refusal is a
      // real gate change since queueing: cancel with the typed reason.
      if (
        (err.reason === "OUTSIDE_SENDING_WINDOW" || err.reason === "OUTSIDE_QUIET_HOURS") &&
        deps.requeue
      ) {
        const [contact, agent] = await withTenant(prisma, ctx, (tx) =>
          Promise.all([
            tx.contact.findUnique({ where: { id: call.contactId } }),
            tx.agent.findUnique({ where: { id: call.agentId } }),
          ]),
        );
        if (contact && agent) {
          const window = await resolveCallWindow(prisma, data.workspaceId, contact, parseGuardrails(agent.guardrails));
          const openAt = nextWindowOpenAt(window, new Date());
          if (openAt) {
            await withTenant(prisma, ctx, (tx) =>
              tx.call.update({
                where: { id: call.id },
                data: { meta: { ...((call.meta ?? {}) as object), scheduledAt: openAt.toISOString() } },
              }),
            );
            await deps.requeue(data, Math.max(0, openAt.getTime() - Date.now()));
            return { kind: "rescheduled", scheduledAt: openAt.toISOString() };
          }
        }
      }
      await withTenant(prisma, ctx, (tx) =>
        tx.call.update({
          where: { id: call.id },
          data: {
            status: "FAILED",
            outcome: "canceled",
            meta: { ...((call.meta ?? {}) as object), refusal: { reason: err.reason, detail: err.message } },
          },
        }),
      );
      await deps.publish({
        type: "call.refused.v1",
        workspaceId: data.workspaceId,
        campaignId: call.campaignId,
        contactId: call.contactId,
        payload: { reason: err.reason, detail: err.message, contactId: call.contactId },
      });
      return { kind: "refused", reason: err.reason, detail: err.message };
    }
    throw err;
  }
}

/** The worker-side consumer — one delayed job per queued best-time call. */
export function createCallDialWorker(
  deps: FireQueuedCallDeps,
  connection?: ConnectionOptions,
): Worker<CallDialJobData> {
  return new Worker<CallDialJobData>(
    CALL_DIAL_QUEUE,
    async (job: Job<CallDialJobData>) => fireQueuedCall(deps, job.data),
    {
      connection:
        connection ?? bullConnectionFromUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
      prefix: BULL_PREFIX,
    },
  );
}
