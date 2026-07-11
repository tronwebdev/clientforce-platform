/**
 * The SMS send boundary (P2.1, DEC-061) — the P1.5 email rails ported to SMS,
 * same strict order, every refusal a typed `SendBlockedError`:
 * sender (TWILIO_SMS + ACTIVE) → guardrails window → per-channel caps →
 * opt-out/suppression (channel "sms") → allow-list (DEC-063 analog of
 * DEC-014) → tokens → OPT-OUT LANGUAGE on the first outbound per enrollment
 * (the sms analog of unsubscribeFooter — literal, not disableable) →
 * transport → `Message` persisted as rendered (A6, channel "sms",
 * segment count in meta).
 */
import {
  COMPLIANCE_STRINGS,
  parseGuardrails,
  resolveLanguage,
  type Guardrails,
  type StepContent,
} from "@clientforce/core";
import { withTenant, type Message, type PrismaClient } from "@clientforce/db";
import { renderTokens } from "./render";
import { SendBlockedError, type RenderedSms, type SmsSender } from "./types";

export interface SendSmsDeps {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  transport: SmsSender;
  now?: () => Date;
  /**
   * DEC-063 (the DEC-014 sms analog): allow-listed test numbers only until the
   * owner widens it in a logged DEC. Resolved from CHANNELS_SMS_ALLOWLIST
   * (comma-separated E.164) when not passed; empty = no restriction.
   */
  allowlist?: string[];
}

export interface SendSmsStepParams {
  workspaceId: string;
  campaignId: string;
  agentId: string;
  enrollmentId?: string;
  contactId: string;
  senderId: string;
  stepNodeId: string;
  content: StepContent;
  /**
   * G1 (DEC-070): provenance of guided copy, merged into `Message.meta` at
   * persist time. PASS-THROUGH ONLY — no rail reads it; the boundary neither
   * knows nor cares who wrote the copy. Absent on scripted sends (meta stays
   * byte-identical to pre-G1).
   */
  composed?: { mode: "guided"; briefVersion: number | null; composerVersion: string };
}

/**
 * The literal ENGLISH opt-out line — the sms `unsubscribeFooter`. Never
 * disableable. L1 (DEC-072): the boundary picks the agent language's
 * pre-translated line from `COMPLIANCE_STRINGS` (this constant IS the `en`
 * entry, re-exported for the tests/proofs that pin the English wire format);
 * every translation keeps the literal keyword STOP — the only keyword the
 * Twilio opt-out rail honors.
 */
export const SMS_OPT_OUT_LINE: string = COMPLIANCE_STRINGS.en.smsOptOut;

/** Fallback campaign cap when guardrails carry no sms cap yet (conservative). */
export const DEFAULT_SMS_DAILY_CAP = 50;

const normalizePhone = (raw: string): string => raw.replace(/[^\d+]/g, "");

export async function sendSmsStep(deps: SendSmsDeps, params: SendSmsStepParams): Promise<Message> {
  const { prisma, transport } = deps;
  const now = deps.now?.() ?? new Date();
  const ctx = { workspaceId: params.workspaceId };

  const [sender, contact, agent] = await withTenant(prisma, ctx, (tx) =>
    Promise.all([
      tx.senderConnection.findUnique({ where: { id: params.senderId } }),
      tx.contact.findUnique({ where: { id: params.contactId } }),
      tx.agent.findUnique({ where: { id: params.agentId } }),
    ]),
  );
  if (!sender) throw new Error(`SenderConnection ${params.senderId} not found`);
  if (!agent) throw new Error(`Agent ${params.agentId} not found`);
  if (sender.type !== "TWILIO_SMS") throw new SendBlockedError("SENDER_NOT_SMS", sender.type);
  if (sender.status !== "ACTIVE") throw new SendBlockedError("SENDER_DISABLED", sender.status);
  const phone = contact?.phone ? normalizePhone(contact.phone) : "";
  if (!contact || !phone) throw new SendBlockedError("CONTACT_NO_PHONE", params.contactId);

  const guardrails = parseGuardrails(agent.guardrails);
  assertInsideWindow(guardrails, now);
  await assertUnderSmsCaps(deps, params, guardrails, sender.dailyLimit, now);

  // suppressionCheck (A8, literal true): Contact.optOut.sms AND Suppression rows.
  const optOut = (contact.optOut ?? {}) as { sms?: boolean };
  if (optOut.sms) throw new SendBlockedError("OPTED_OUT", phone);
  const suppressed = await withTenant(prisma, ctx, (tx) =>
    tx.suppression.findFirst({
      where: { workspaceId: params.workspaceId, channel: "sms", address: phone },
    }),
  );
  if (suppressed) throw new SendBlockedError("SUPPRESSED", suppressed.reason);

  // DEC-063 allow-list (test numbers only until the owner widens it).
  const allowlist =
    deps.allowlist ??
    (process.env.CHANNELS_SMS_ALLOWLIST ?? "")
      .split(",")
      .map((s) => normalizePhone(s.trim()))
      .filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(phone)) {
    throw new SendBlockedError("RECIPIENT_NOT_ALLOWLISTED", phone);
  }

  const senderLabel = sender.fromName?.trim() || "your Clientforce agent";
  let body = renderTokens(params.content.body ?? "", contact, senderLabel);

  // The sms unsubscribeFooter: the FIRST outbound SMS of an enrollment carries
  // the opt-out line, literally and unconditionally (DEC-062).
  const priorSms = await withTenant(prisma, ctx, (tx) =>
    tx.message.findFirst({
      where: {
        workspaceId: params.workspaceId,
        campaignId: params.campaignId,
        contactId: params.contactId,
        ...(params.enrollmentId ? { enrollmentId: params.enrollmentId } : {}),
        channel: "sms",
        direction: "OUTBOUND",
      },
      orderBy: { sentAt: "desc" },
    }),
  );
  if (!priorSms) body = `${body}\n${COMPLIANCE_STRINGS[resolveLanguage(guardrails)].smsOptOut}`;

  const rendered: RenderedSms = { to: phone, body };
  const { providerMessageId, segments } = await transport.send(rendered, sender);

  // A6: persist AS RENDERED at send time — segment count in meta.
  return withTenant(prisma, ctx, (tx) =>
    tx.message.create({
      data: {
        workspaceId: params.workspaceId,
        campaignId: params.campaignId,
        enrollmentId: params.enrollmentId ?? null,
        contactId: params.contactId,
        channel: "sms",
        direction: "OUTBOUND",
        subject: null,
        body,
        providerMessageId,
        inReplyToId: priorSms?.id ?? null,
        stepNodeId: params.stepNodeId,
        sentAt: now,
        meta: {
          senderId: params.senderId,
          segments,
          optOutLine: !priorSms,
          ...(params.composed ?? {}),
        },
      },
    }),
  );
}

function assertInsideWindow(guardrails: Guardrails, now: Date): void {
  const { days, start, end, timezone } = guardrails.sendingWindow;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const isoDay = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[get("weekday")] ?? 0;
  const hhmm = `${get("hour")}:${get("minute")}`;
  if (!days.includes(isoDay) || hhmm < start || hhmm >= end) {
    throw new SendBlockedError("OUTSIDE_SENDING_WINDOW", `${get("weekday")} ${hhmm} ${timezone}`);
  }
}

async function assertUnderSmsCaps(
  deps: SendSmsDeps,
  params: SendSmsStepParams,
  guardrails: Guardrails,
  senderDailyLimit: number,
  now: Date,
): Promise<void> {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const where = {
    workspaceId: params.workspaceId,
    channel: "sms",
    direction: "OUTBOUND" as const,
    sentAt: { gte: dayStart },
  };
  const [campaignCount, workspaceCount] = await withTenant(
    deps.prisma,
    { workspaceId: params.workspaceId },
    (tx) =>
      Promise.all([
        tx.message.count({ where: { ...where, campaignId: params.campaignId } }),
        tx.message.count({ where }),
      ]),
  );
  const cap = guardrails.dailyCap.sms ?? DEFAULT_SMS_DAILY_CAP;
  if (campaignCount >= cap) {
    throw new SendBlockedError("DAILY_CAP_REACHED", `campaign sms cap ${cap}`);
  }
  if (workspaceCount >= senderDailyLimit) {
    throw new SendBlockedError("DAILY_CAP_REACHED", `sender limit ${senderDailyLimit}`);
  }
}
