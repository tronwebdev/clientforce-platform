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
import { assertDialAllowed } from "./dial-voice";
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
}

export type FireQueuedCallResult =
  | { kind: "placed"; providerCallSid: string; sandbox: boolean }
  | { kind: "refused"; reason: string; detail: string }
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
