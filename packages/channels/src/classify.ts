/**
 * Reply classification (P1.7): Sonnet-class structured output → one intent
 * from the shared label set (DEC-034 — the prototype's Inbox chips), written
 * onto the INBOUND Message, published as `email.replied.v1`, with unsubscribe
 * side effects applied here (suppression + opt-out + workflow stop).
 *
 * Engagement awareness: the prompt carries the lead's recent Event rows —
 * "opened twice, clicked, went cold" is visible at classification time.
 */
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { BULL_PREFIX } from "@clientforce/events";
import type { AiGateway } from "@clientforce/ai";
import { withTenant, type PrismaClient } from "@clientforce/db";
import { IntentSchema, type EventBus, type Intent } from "@clientforce/events";
import { z } from "zod";
import { INBOUND_CLASSIFY_QUEUE, type ClassifyJobData } from "./inbound";

const CLASSIFY_SYSTEM = `You classify replies to B2B outreach emails for a sales inbox.
Choose EXACTLY ONE label:
- "interested": buying signal — wants to proceed, asks for a call/demo/pricing with intent.
- "booked": explicitly accepts or confirms a specific meeting/time.
- "question": asks for information before moving; genuine question without a clear buying signal.
- "not": declines / not interested (including "not now", "we use a competitor").
- "ooo": auto-reply, out-of-office, autoresponder.
- "unsubscribe": demands removal / stop emailing / legal-sounding opt-out.
- "replied": none of the above fits.
Judge ONLY from the reply text; the engagement history is context, not a label source.`;

const classifyOutputSchema = z.object({ intent: IntentSchema });

export interface ClassifyContext {
  goal: string;
  replyText: string;
  /** Recent engagement lines, e.g. "email.opened.v1 at 2026-07-04T12:00Z". */
  engagement: string[];
}

export async function classifyReply(gateway: AiGateway, ctx: ClassifyContext): Promise<Intent> {
  const out = await gateway.completeStructured(
    "classify",
    {
      system: CLASSIFY_SYSTEM,
      maxTokens: 256,
      prompt: [
        `Campaign goal: ${ctx.goal}`,
        ctx.engagement.length
          ? `Recent engagement:\n${ctx.engagement.map((e) => `- ${e}`).join("\n")}`
          : "Recent engagement: none recorded",
        `Reply:\n"""\n${ctx.replyText.slice(0, 4000)}\n"""`,
      ].join("\n\n"),
    },
    classifyOutputSchema,
  );
  return out.intent;
}

export interface ClassifyWorkerDeps {
  /** RLS-subject client. */
  prisma: PrismaClient;
  gateway: AiGateway;
  bus: EventBus;
  /**
   * Stops the enrollment's workflow on an unsubscribe reply (Temporal cancel).
   * Optional — environments without Temporal still get suppression + opt-out;
   * the send boundary blocks any further step regardless (defense in depth).
   */
  stopWorkflow?: (enrollmentId: string) => Promise<void>;
  connection?: ConnectionOptions;
}

/**
 * BullMQ worker: classify one INBOUND Message, persist the intent (A6),
 * publish `email.replied.v1` (bus persists the Event row and fans out — the
 * temporal-signal consumer routes the workflow branch), and apply unsubscribe
 * side effects.
 */
export function createClassifyWorker(deps: ClassifyWorkerDeps): Worker<ClassifyJobData> {
  return new Worker<ClassifyJobData>(
    INBOUND_CLASSIFY_QUEUE,
    async (job: Job<ClassifyJobData>) => {
      const { workspaceId, messageId } = job.data;
      const ctx = { workspaceId };

      const message = await withTenant(deps.prisma, ctx, (tx) =>
        tx.message.findUnique({ where: { id: messageId } }),
      );
      if (!message || message.direction !== "INBOUND") {
        throw new Error(`Message ${messageId} not found or not INBOUND`);
      }

      const [campaign, events] = await withTenant(deps.prisma, ctx, (tx) =>
        Promise.all([
          tx.campaign.findUnique({
            where: { id: message.campaignId },
            include: { agent: { select: { goal: true } } },
          }),
          tx.event.findMany({
            where: { workspaceId, contactId: message.contactId },
            orderBy: { occurredAt: "desc" },
            take: 10,
          }),
        ]),
      );

      const intent = await classifyReply(deps.gateway, {
        goal: campaign?.agent.goal ?? "unknown",
        replyText: message.body,
        engagement: events.map((e) => `${e.type} at ${e.occurredAt.toISOString()}`),
      });

      await withTenant(deps.prisma, ctx, (tx) =>
        tx.message.update({ where: { id: messageId }, data: { intent } }),
      );

      await deps.bus.publish({
        type: "email.replied.v1",
        workspaceId,
        contactId: message.contactId,
        ...(message.enrollmentId ? { enrollmentId: message.enrollmentId } : {}),
        campaignId: message.campaignId,
        payload: { messageId, intent },
      });

      if (intent === "unsubscribe") {
        await applyUnsubscribeReply(deps, workspaceId, message.contactId, message.enrollmentId);
      }

      return { intent };
    },
    { connection: deps.connection ?? { url: process.env.REDIS_URL }, prefix: BULL_PREFIX },
  );
}

/**
 * An unsubscribe REPLY is an opt-out demand: Suppression row + Contact.optOut
 * (both checked at the P1.5 send boundary), `lead.unsubscribed.v1`, enrollment
 * → UNSUBSCRIBED, and the durable run is cancelled so no timer ever fires
 * again for this lead.
 */
export async function applyUnsubscribeReply(
  deps: Pick<ClassifyWorkerDeps, "prisma" | "bus" | "stopWorkflow">,
  workspaceId: string,
  contactId: string,
  enrollmentId: string | null,
): Promise<void> {
  await withTenant(deps.prisma, { workspaceId }, async (tx) => {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (contact?.email) {
      const existing = await tx.suppression.findFirst({
        where: { workspaceId, channel: "email", address: contact.email },
      });
      if (!existing) {
        await tx.suppression.create({
          data: { workspaceId, channel: "email", address: contact.email, reason: "UNSUBSCRIBED" },
        });
      }
      const optOut = (contact.optOut ?? {}) as Record<string, unknown>;
      await tx.contact.update({
        where: { id: contactId },
        data: { optOut: { ...optOut, email: true } },
      });
    }
    if (enrollmentId) {
      await tx.enrollment.update({
        where: { id: enrollmentId },
        data: { status: "UNSUBSCRIBED" },
      });
    }
  });

  await deps.bus.publish({
    type: "lead.unsubscribed.v1",
    workspaceId,
    contactId,
    ...(enrollmentId ? { enrollmentId } : {}),
    payload: { channel: "email" },
  });

  if (enrollmentId && deps.stopWorkflow) {
    await deps.stopWorkflow(enrollmentId).catch((err: unknown) => {
      console.warn(
        `[classify] could not stop workflow for enrollment ${enrollmentId}: ` +
          `${err instanceof Error ? err.message : String(err)} — suppression holds either way`,
      );
    });
  }
}
