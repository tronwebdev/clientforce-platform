import { createVerify } from "node:crypto";
import { withTenant, type Message, type PrismaClient, type SuppressionReason } from "@clientforce/db";
import type { EventType } from "@clientforce/events";
import { z } from "zod";

/**
 * SendGrid event webhooks → normalized internal shapes (P1.5). P1.7 puts
 * these on the event bus; this layer parses, verifies, and applies the
 * suppression side-effects (A7: unsubscribe/bounce/spam write `Suppression`
 * AND `Contact.optOut`).
 */
export const normalizedEmailEventSchema = z.object({
  type: z.enum(["delivered", "open", "click", "bounce", "spam_report", "unsubscribe", "other"]),
  email: z.string(),
  providerMessageId: z.string().nullable(),
  occurredAt: z.coerce.date(),
  raw: z.record(z.unknown()),
});
export type NormalizedEmailEvent = z.infer<typeof normalizedEmailEventSchema>;

const sendgridEventSchema = z
  .object({
    event: z.string(),
    email: z.string(),
    timestamp: z.number(),
    sg_message_id: z.string().optional(),
  })
  .passthrough();

const EVENT_MAP: Record<string, NormalizedEmailEvent["type"]> = {
  delivered: "delivered",
  open: "open",
  click: "click",
  bounce: "bounce",
  dropped: "bounce",
  spamreport: "spam_report",
  unsubscribe: "unsubscribe",
  group_unsubscribe: "unsubscribe",
};

export function normalizeSendGridEvents(payload: unknown): NormalizedEmailEvent[] {
  const events = z.array(sendgridEventSchema).parse(payload);
  return events.map((e) => ({
    type: EVENT_MAP[e.event] ?? "other",
    email: e.email,
    // SendGrid appends ".filter…" to the original Message-ID — strip it.
    providerMessageId: e.sg_message_id ? e.sg_message_id.split(".filter")[0]! : null,
    occurredAt: new Date(e.timestamp * 1000),
    raw: e as Record<string, unknown>,
  }));
}

const SUPPRESSING: Partial<Record<NormalizedEmailEvent["type"], SuppressionReason>> = {
  bounce: "BOUNCED",
  spam_report: "SPAM_COMPLAINT",
  unsubscribe: "UNSUBSCRIBED",
};

/**
 * Apply one normalized event for a workspace: suppressing events upsert a
 * `Suppression` row and flip `Contact.optOut.email` (both — A7).
 */
export async function applyEmailEvent(
  prisma: PrismaClient,
  workspaceId: string,
  event: NormalizedEmailEvent,
): Promise<{ suppressed: boolean }> {
  const reason = SUPPRESSING[event.type];
  if (!reason) return { suppressed: false };
  await withTenant(prisma, { workspaceId }, async (tx) => {
    await tx.suppression.upsert({
      where: {
        // P5 W3 (DEC-085): suppression addresses are stored lowercase.
        workspaceId_channel_address: { workspaceId, channel: "email", address: event.email.toLowerCase() },
      },
      create: {
        workspaceId,
        channel: "email",
        address: event.email.toLowerCase(),
        reason,
        source: "webhook",
      },
      update: { reason },
    });
    const contacts = await tx.contact.findMany({ where: { workspaceId, email: event.email } });
    for (const c of contacts) {
      const optOut = { ...((c.optOut ?? {}) as Record<string, unknown>), email: true };
      await tx.contact.update({ where: { id: c.id }, data: { optOut } });
    }
  });
  return { suppressed: true };
}

/**
 * Resolve the workspace an event belongs to via the persisted `Message` row
 * (SendGrid events carry no tenant) — owner-client lookup by unique
 * providerMessageId, then all side-effects run tenant-scoped.
 */
export async function resolveEventWorkspace(
  ownerPrisma: PrismaClient,
  event: NormalizedEmailEvent,
): Promise<string | null> {
  return (await resolveEventMessage(ownerPrisma, event))?.workspaceId ?? null;
}

/** Like {@link resolveEventWorkspace} but returns the whole Message row (P1.7). */
export async function resolveEventMessage(
  ownerPrisma: PrismaClient,
  event: NormalizedEmailEvent,
): Promise<Message | null> {
  if (!event.providerMessageId) return null;
  const candidates = [event.providerMessageId, `<${event.providerMessageId}>`];
  return ownerPrisma.message.findFirst({
    where: { providerMessageId: { in: candidates } },
  });
}

/** Minimal publishable shape — satisfied by `EventBus.publish` inputs. */
export interface BusEventInput {
  type: EventType;
  workspaceId: string;
  contactId?: string;
  enrollmentId?: string;
  campaignId?: string;
  /** P5 W1 (DEC-083): sender attribution for per-sender health rollups. */
  senderId?: string;
  payload: Record<string, unknown>;
}

/** Sender attribution off a Message row — the column, meta for pre-backfill rows. */
export function messageSenderId(message: Message): string | null {
  if (message.senderId) return message.senderId;
  const meta = message.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const fromMeta = (meta as Record<string, unknown>).senderId;
    if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  }
  return null;
}

const TYPED_EVENT: Partial<Record<NormalizedEmailEvent["type"], EventType>> = {
  delivered: "email.delivered.v1",
  open: "email.opened.v1",
  click: "email.clicked.v1",
  bounce: "email.bounced.v1",
  spam_report: "email.spam.v1",
};

/**
 * P1.7 engagement awareness: a normalized provider event + its resolved
 * Message become typed bus events — persisted `Event` rows on the lead that
 * feed the Logs tab, the lead-drawer timeline, and the classifier's context.
 * Suppressing events additionally emit `lead.unsubscribed.v1`.
 */
export function toBusEvents(event: NormalizedEmailEvent, message: Message): BusEventInput[] {
  const senderId = messageSenderId(message);
  const base = {
    workspaceId: message.workspaceId,
    contactId: message.contactId,
    ...(message.enrollmentId ? { enrollmentId: message.enrollmentId } : {}),
    campaignId: message.campaignId,
    // P5 W1 (DEC-083): provider events inherit the message's sender, so the
    // health engine's per-sender rollup is one indexed Event scan.
    ...(senderId ? { senderId } : {}),
  };
  const out: BusEventInput[] = [];
  const typed = TYPED_EVENT[event.type];
  if (typed === "email.clicked.v1") {
    out.push({
      ...base,
      type: typed,
      payload: { messageId: message.id, link: String(event.raw.url ?? "") },
    });
  } else if (typed === "email.bounced.v1") {
    out.push({
      ...base,
      type: typed,
      payload: {
        messageId: message.id,
        ...(typeof event.raw.reason === "string" ? { reason: event.raw.reason } : {}),
      },
    });
  } else if (typed) {
    out.push({ ...base, type: typed, payload: { messageId: message.id } });
  }
  if (event.type === "unsubscribe" || event.type === "spam_report") {
    out.push({ ...base, type: "lead.unsubscribed.v1", payload: { channel: "email" } });
  }
  return out;
}

/**
 * SendGrid Signed Event Webhook verification (ECDSA P-256 / SHA-256). The
 * public key comes from Key Vault (`SENDGRID-WEBHOOK-PUBLIC-KEY`) once event
 * webhooks are enabled; with no key configured the caller decides whether to
 * accept (dev) or reject (deployed).
 */
export function verifySendGridSignature(
  publicKeyPem: string,
  payload: string,
  signature: string,
  timestamp: string,
): boolean {
  const verifier = createVerify("sha256");
  verifier.update(timestamp + payload);
  return verifier.verify(publicKeyPem, signature, "base64");
}
