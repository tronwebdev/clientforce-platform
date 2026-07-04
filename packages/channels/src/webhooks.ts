import { createVerify } from "node:crypto";
import { withTenant, type PrismaClient, type SuppressionReason } from "@clientforce/db";
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
        workspaceId_channel_address: { workspaceId, channel: "email", address: event.email },
      },
      create: {
        workspaceId,
        channel: "email",
        address: event.email,
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
  if (!event.providerMessageId) return null;
  const candidates = [event.providerMessageId, `<${event.providerMessageId}>`];
  const message = await ownerPrisma.message.findFirst({
    where: { providerMessageId: { in: candidates } },
  });
  return message?.workspaceId ?? null;
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
