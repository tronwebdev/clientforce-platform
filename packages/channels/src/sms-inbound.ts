/**
 * Inbound SMS ingestion (P2.1, DEC-061/062): normalize a Twilio inbound
 * webhook POST (signature validated by the API caller via
 * `validateTwilioSignature`), resolve the thread by phone, persist as an
 * INBOUND `Message` (channel "sms"), and either:
 *   - STOP-family body → the opt-out DOUBLE RAIL's second half (Twilio
 *     Advanced Opt-Out is the first): Suppression(channel "sms") +
 *     `Contact.optOut.sms` + enrollments UNSUBSCRIBED + `lead.unsubscribed.v1`
 *     — the same provable ledger as email (A7);
 *   - anything else → the SAME P1.7 classify queue the email loop uses
 *     (the loop is channel-agnostic by construction).
 */
import { withTenant, type Message, type PrismaClient } from "@clientforce/db";

/** Twilio's Advanced Opt-Out keywords (their default English set). */
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

export interface InboundSms {
  from: string;
  to: string;
  body: string;
  providerMessageId?: string;
}

export function normalizeTwilioInbound(form: Record<string, unknown>): InboundSms {
  const str = (key: string): string => (typeof form[key] === "string" ? (form[key] as string) : "");
  return {
    from: str("From").replace(/[^\d+]/g, ""),
    to: str("To").replace(/[^\d+]/g, ""),
    body: str("Body"),
    providerMessageId: str("MessageSid") || undefined,
  };
}

export const isStopMessage = (body: string): boolean => STOP_WORDS.has(body.trim().toUpperCase());

export interface SmsThreadResolution {
  workspaceId: string;
  campaignId: string;
  contactId: string;
  enrollmentId: string | null;
  outbound: Message | null;
}

/**
 * Resolve the thread by the sender's phone: the most recent OUTBOUND sms to a
 * contact with that number. Owner client — events carry no tenant; everything
 * downstream is tenant-scoped with the resolved workspaceId (P1.7 pattern).
 */
export async function resolveInboundSmsThread(
  owner: PrismaClient,
  inbound: InboundSms,
): Promise<SmsThreadResolution | null> {
  const contacts = await owner.contact.findMany({
    where: { phone: { contains: inbound.from.replace(/^\+/, "") } },
    select: { id: true },
  });
  if (contacts.length === 0) return null;
  const outbound = await owner.message.findFirst({
    where: { direction: "OUTBOUND", channel: "sms", contactId: { in: contacts.map((c) => c.id) } },
    orderBy: { sentAt: "desc" },
  });
  if (!outbound) return null;
  return {
    workspaceId: outbound.workspaceId,
    campaignId: outbound.campaignId,
    contactId: outbound.contactId,
    enrollmentId: outbound.enrollmentId,
    outbound,
  };
}

export interface IngestInboundSmsDeps {
  owner: PrismaClient;
  app: PrismaClient;
  now?: () => Date;
}

/** Persist the inbound as an INBOUND sms `Message` on the resolved thread. */
export async function ingestInboundSms(
  deps: IngestInboundSmsDeps,
  inbound: InboundSms,
): Promise<{ message: Message; resolution: SmsThreadResolution; stop: boolean } | null> {
  const resolution = await resolveInboundSmsThread(deps.owner, inbound);
  if (!resolution) return null;
  const message = await withTenant(deps.app, { workspaceId: resolution.workspaceId }, (tx) =>
    tx.message.create({
      data: {
        workspaceId: resolution.workspaceId,
        campaignId: resolution.campaignId,
        enrollmentId: resolution.enrollmentId,
        contactId: resolution.contactId,
        channel: "sms",
        direction: "INBOUND",
        subject: null,
        body: inbound.body,
        providerMessageId: inbound.providerMessageId ?? null,
        inReplyToId: resolution.outbound?.id ?? null,
        sentAt: deps.now?.() ?? new Date(),
        meta: { from: inbound.from, to: inbound.to },
      },
    }),
  );
  return { message, resolution, stop: isStopMessage(inbound.body) };
}

/**
 * The STOP rail (DEC-062): Suppression(channel "sms", address = the phone) +
 * `Contact.optOut.sms` + active enrollments UNSUBSCRIBED. The caller emits
 * `lead.unsubscribed.v1` + `sms.opted_out.v1` and stops the durable run —
 * mirrors `applyUnsubscribeReply`'s email semantics on the sms channel.
 */
export async function applySmsStop(
  app: PrismaClient,
  workspaceId: string,
  contactId: string,
  phone: string,
  enrollmentId: string | null,
): Promise<void> {
  await withTenant(app, { workspaceId }, async (tx) => {
    const existing = await tx.suppression.findFirst({
      where: { workspaceId, channel: "sms", address: phone },
    });
    if (!existing) {
      await tx.suppression.create({
        data: { workspaceId, channel: "sms", address: phone, reason: "UNSUBSCRIBED", source: "sms-stop" },
      });
    }
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    const optOut = (contact?.optOut ?? {}) as Record<string, unknown>;
    await tx.contact.update({ where: { id: contactId }, data: { optOut: { ...optOut, sms: true } } });
    const enrollments = await tx.enrollment.findMany({
      where: {
        contactId,
        status: { in: ["ACTIVE", "PAUSED"] },
        ...(enrollmentId ? {} : {}),
      },
    });
    for (const e of enrollments) {
      await tx.enrollment.update({ where: { id: e.id }, data: { status: "UNSUBSCRIBED" } });
    }
  });
}
