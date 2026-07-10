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
import { registerPrompt, renderPrompt, type AiGateway } from "@clientforce/ai";
import { BULL_PREFIX, bullConnectionFromUrl } from "@clientforce/events";
import { withTenant, type PrismaClient } from "@clientforce/db";
import { type EventBus, type Intent } from "@clientforce/events";
import { z } from "zod";
import { INBOUND_CLASSIFY_QUEUE, type ClassifyJobData } from "./inbound";

/**
 * M1b (DEC-066): the labels the v2 classifier may EMIT — the six reply-strategy
 * intents + the untouched side labels (`ooo` auto-reply, `unsubscribe`
 * compliance) + `replied` as the none-fits fallback. The legacy `booked` /
 * `question` / `not` stay in `IntentSchema` (old rows/graphs/chips remain
 * valid) but are retired from emission. `satisfies readonly Intent[]` pins
 * every emission label to the shared enum — the sets can never fork.
 */
export const CLASSIFY_EMISSION_LABELS = [
  "interested",
  "objection_price",
  "objection_timing",
  "wrong_person",
  "info_request",
  "not_interested",
  "replied",
  "ooo",
  "unsubscribe",
] as const satisfies readonly Intent[];

export const CLASSIFY_PROMPT_NAME = "inbound.classify";
export const CLASSIFY_PROMPT_VERSION = 2; // M1b (DEC-066): six-intent reply taxonomy

let registered = false;
function classifySystem(): string {
  if (!registered) {
    registered = true;
    // v1 (P1.7) stays registered VERBATIM — prompts are append-only code.
    registerPrompt({
      name: CLASSIFY_PROMPT_NAME,
      version: 1,
      template: `You classify replies to B2B outreach emails for a sales inbox.
Choose EXACTLY ONE label:
- "interested": buying signal — wants to proceed, asks for a call/demo/pricing with intent.
- "booked": explicitly accepts or confirms a specific meeting/time.
- "question": asks for information before moving; genuine question without a clear buying signal.
- "not": declines / not interested (including "not now", "we use a competitor").
- "ooo": auto-reply, out-of-office, autoresponder.
- "unsubscribe": demands removal / stop emailing / legal-sounding opt-out.
- "replied": none of the above fits.
Judge ONLY from the reply text; the engagement history is context, not a label source.`,
    });
    registerPrompt({
      name: CLASSIFY_PROMPT_NAME,
      version: 2,
      template: `You classify replies to B2B outreach messages for a sales inbox.
Choose EXACTLY ONE label:
- "interested": buying signal — wants to proceed, asks for a call/demo/pricing with intent, or explicitly accepts a proposed time.
- "objection_price": pushes back on cost — too expensive, no budget, cheaper alternative. Engaged, but price is the stated blocker.
- "objection_timing": open in principle but not now — asks to reconnect later, names a future date/quarter, mid-project. Written by a human (an autoresponder is "ooo").
- "wrong_person": says they are not the right contact — doesn't own this decision, points to a colleague, role, or department.
- "info_request": asks for information before moving — features, integrations, process, logistics. A genuine question without a clear buying signal.
- "not_interested": clearly declines — not interested, happy with their current setup — WITHOUT demanding removal.
- "ooo": auto-reply, out-of-office, autoresponder.
- "unsubscribe": demands removal / stop emailing / legal-sounding opt-out.
- "replied": none of the above fits.
Boundaries: a decline that also demands removal is "unsubscribe", never "not_interested". "Too expensive" is "objection_price" even when phrased as a decline. A human asking to reconnect later is "objection_timing"; an automatic away-message is "ooo". A referral to a colleague is "wrong_person" even if polite about it.
Judge ONLY from the reply text; the engagement history is context, not a label source.`,
    });
  }
  return renderPrompt(CLASSIFY_PROMPT_NAME, CLASSIFY_PROMPT_VERSION, {});
}

const classifyOutputSchema = z.object({ intent: z.enum(CLASSIFY_EMISSION_LABELS) });

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
      system: classifySystem(),
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
    {
      connection:
        deps.connection ?? bullConnectionFromUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
      prefix: BULL_PREFIX,
    },
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
