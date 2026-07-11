import { parseFields } from "@clientforce/context";
import {
  COMPLIANCE_STRINGS,
  parseGuardrails,
  resolveLanguage,
  type Guardrails,
  type StepContent,
} from "@clientforce/core";
import { withTenant, type Message, type PrismaClient } from "@clientforce/db";
import { hasThreadPrefix, renderTokens, stripThreadPrefix, withReplyPrefix } from "./render";
import { SendBlockedError, type EmailSender, type RenderedEmail } from "./types";

export interface SendDeps {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  transport: EmailSender;
  /** Injectable clock for sending-window tests. */
  now?: () => Date;
  /**
   * §G phase rule: allow-listed test sends only. Resolved from
   * CHANNELS_ALLOWLIST (comma-separated) when not passed; an EMPTY resolved
   * list means no restriction (post-P1.8).
   */
  allowlist?: string[];
}

export interface SendStepParams {
  workspaceId: string;
  campaignId: string;
  agentId: string;
  enrollmentId?: string;
  contactId: string;
  senderId: string;
  stepNodeId: string;
  content: StepContent;
  /**
   * G2 (DEC-071): provenance of guided copy, merged into `Message.meta` at
   * persist time. PASS-THROUGH ONLY — no rail reads it; the boundary neither
   * knows nor cares who wrote the copy. Absent on scripted sends (meta stays
   * byte-identical to pre-G2). The sms twin landed in G1 (DEC-070).
   */
  composed?: { mode: "guided"; briefVersion: number | null; composerVersion: string };
}

const UNSUB_BASE = (): string =>
  process.env.UNSUBSCRIBE_BASE_URL ?? "https://reply.clientforce.io/u";

/**
 * The send boundary (P1.5). Strict order — every refusal is a typed
 * `SendBlockedError`, and nothing is emitted unless every gate passes:
 * guardrails (A8) → suppression/opt-out → owner rule 1 (from-name) → tokens →
 * owner rule 3 (real threading / no faux-"Re:") → owner rule 2 (CAN-SPAM
 * footer = `company_address` verbatim) → transport → `Message` persisted as
 * rendered (A6).
 */
export async function sendStep(deps: SendDeps, params: SendStepParams): Promise<Message> {
  const { prisma, transport } = deps;
  const now = deps.now?.() ?? new Date();
  const ctx = { workspaceId: params.workspaceId };

  const [sender, contact, agent, workspaceContext] = await withTenant(prisma, ctx, (tx) =>
    Promise.all([
      tx.senderConnection.findUnique({ where: { id: params.senderId } }),
      tx.contact.findUnique({ where: { id: params.contactId } }),
      tx.agent.findUnique({ where: { id: params.agentId } }),
      tx.businessContext.findFirst({ where: { workspaceId: params.workspaceId, agentId: null } }),
    ]),
  );
  if (!sender) throw new Error(`SenderConnection ${params.senderId} not found`);
  if (!contact?.email) throw new Error(`Contact ${params.contactId} not found or has no email`);
  if (!agent) throw new Error(`Agent ${params.agentId} not found`);
  if (sender.status !== "ACTIVE") throw new SendBlockedError("SENDER_DISABLED", sender.status);

  const guardrails = parseGuardrails(agent.guardrails);
  // A8: literal-true flags are structurally guaranteed by the schema; the
  // checks below are the enforcement those flags promise.
  assertInsideWindow(guardrails, now);
  await assertUnderCaps(deps, params, guardrails, sender.dailyLimit, now);

  // suppressionCheck (A8, literal true): Contact.optOut AND Suppression rows.
  const optOut = (contact.optOut ?? {}) as { email?: boolean };
  if (optOut.email) throw new SendBlockedError("OPTED_OUT", contact.email);
  const suppressed = await withTenant(prisma, ctx, (tx) =>
    tx.suppression.findFirst({
      where: { workspaceId: params.workspaceId, channel: "email", address: contact.email! },
    }),
  );
  if (suppressed) throw new SendBlockedError("SUPPRESSED", suppressed.reason);

  // Owner rule 1: no from-name → FAIL (the signature token must never render blank).
  const fromName = sender.fromName?.trim();
  if (!fromName) throw new SendBlockedError("SENDER_NO_FROM_NAME", sender.fromEmail);

  // §G allow-list (test sends only this phase).
  const allowlist =
    deps.allowlist ??
    (process.env.CHANNELS_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(contact.email.toLowerCase())) {
    throw new SendBlockedError("RECIPIENT_NOT_ALLOWLISTED", contact.email);
  }

  let subject = renderTokens(params.content.subject ?? "", contact, fromName);
  const body = renderTokens(params.content.body ?? "", contact, fromName);

  // Owner rule 3: real threading or no thread markers at all.
  let inReplyTo: string | undefined;
  let references: string[] | undefined;
  let sanitized = false;
  const prior = params.content.threaded
    ? await withTenant(prisma, ctx, (tx) =>
        tx.message.findFirst({
          where: {
            workspaceId: params.workspaceId,
            campaignId: params.campaignId,
            contactId: params.contactId,
            channel: "email",
            direction: "OUTBOUND",
            providerMessageId: { not: null },
          },
          orderBy: { sentAt: "desc" },
        }),
      )
    : null;
  if (prior?.providerMessageId) {
    // Thread on the RFC Message-ID that was actually on the wire (persisted in
    // meta since the P1.6 proof caught the conflation); pre-fix rows fall back
    // to the provider id, which doubled as the RFC id in sandbox.
    const priorMeta = (prior.meta ?? {}) as { rfcMessageId?: string };
    const priorId = priorMeta.rfcMessageId ?? asMessageId(prior.providerMessageId);
    inReplyTo = priorId;
    references = [priorId];
    subject = withReplyPrefix(
      prior.subject ? stripThreadPrefix(prior.subject) : stripThreadPrefix(subject),
    );
  } else if (hasThreadPrefix(subject)) {
    // Faux-"Re:" on a fresh thread: strip + audit (DEC-030 default), never emit.
    subject = stripThreadPrefix(subject);
    sanitized = true;
  }

  // Owner rule 2: the CAN-SPAM footer consumes company_address VERBATIM —
  // no address, no send; never a placeholder.
  const companyAddress = parseFields(workspaceContext?.fields).company_address?.value?.trim();
  if (!companyAddress) {
    throw new SendBlockedError(
      "NO_COMPANY_ADDRESS",
      "resolve the workspace company_address gap before sending",
    );
  }
  const unsubscribeUrl = `${UNSUB_BASE()}/${params.workspaceId}/${params.contactId}`;
  // L1 (DEC-072): the footer label is a PRE-TRANSLATED constant picked by the
  // agent's language — deterministic, never AI-generated at send. English
  // agents (absent rider) render the pre-L1 literal byte-identical.
  const { unsubscribeLabel } = COMPLIANCE_STRINGS[resolveLanguage(guardrails)];
  const fullBody = `${body}\n\n--\n${companyAddress}\n${unsubscribeLabel}: ${unsubscribeUrl}`;

  const rendered: RenderedEmail = {
    to: contact.email,
    fromEmail: sender.fromEmail,
    fromName,
    replyTo: sender.replyTo ?? undefined,
    subject,
    body: fullBody,
    inReplyTo,
    references,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  const { providerMessageId, rfcMessageId } = await transport.send(rendered, sender);

  // A6: persist AS RENDERED at send time.
  return withTenant(prisma, ctx, (tx) =>
    tx.message.create({
      data: {
        workspaceId: params.workspaceId,
        campaignId: params.campaignId,
        enrollmentId: params.enrollmentId ?? null,
        contactId: params.contactId,
        channel: "email",
        direction: "OUTBOUND",
        subject,
        body: fullBody,
        providerMessageId,
        inReplyToId: prior?.id ?? null,
        stepNodeId: params.stepNodeId,
        sentAt: now,
        meta: {
          senderId: params.senderId,
          threaded: Boolean(prior),
          ...(rfcMessageId ? { rfcMessageId } : {}),
          ...(sanitized ? { sanitized: "stripped faux thread prefix (owner rule 3)" } : {}),
          // G2 (DEC-071): guided provenance, pass-through only — absent on
          // scripted sends, so their meta stays byte-identical.
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

async function assertUnderCaps(
  deps: SendDeps,
  params: SendStepParams,
  guardrails: Guardrails,
  senderDailyLimit: number,
  now: Date,
): Promise<void> {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const where = {
    workspaceId: params.workspaceId,
    channel: "email",
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
  if (campaignCount >= guardrails.dailyCap.email) {
    throw new SendBlockedError("DAILY_CAP_REACHED", `campaign cap ${guardrails.dailyCap.email}`);
  }
  if (workspaceCount >= senderDailyLimit) {
    throw new SendBlockedError("DAILY_CAP_REACHED", `sender limit ${senderDailyLimit}`);
  }
}

/** Ensure RFC 5322 angle-bracket form. */
const asMessageId = (id: string): string => (id.startsWith("<") ? id : `<${id}>`);
