/**
 * The voice DIAL boundary (P3.1, DEC-078) — the P1.5/P2.1 rails ported to
 * outbound calls, same strict order, every refusal a typed `SendBlockedError`:
 * contact has a phone → language gate (English-only this unit, D8) →
 * guardrails calling window (tz-aware, the sms/email helper's literal logic) →
 * daily caps (per-campaign guardrails cap + a platform workspace cap) →
 * opt-out/suppression → allow-list (DEC-063 analog).
 *
 * Two deliberate differences from the message boundaries:
 * - No SenderConnection rail: the from-number is the platform `VOICE-FROM-
 *   NUMBER` Key Vault secret this unit (per-tenant voice numbers are future).
 * - Suppression fails TOWARD suppression (DEC-067 stance, D5): a number with
 *   ANY matching opt-out or Suppression row — voice OR sms channel — is never
 *   dialed. Calls and texts share the phone number; consent doubt blocks.
 *
 * Refusals surface as `call.refused.v1` Event rows (Logs) — the caller
 * (apps/api voice module) records them; this module only throws typed.
 */
import {
  DEFAULT_LANGUAGE,
  parseGuardrails,
  resolveLanguage,
  type Guardrails,
  type LanguageCode,
} from "@clientforce/core";
import { withTenant, type Agent, type Contact, type PrismaClient } from "@clientforce/db";
import { assertTenantActive } from "./tenant-status";
import { SendBlockedError } from "./types";

export interface DialVoiceDeps {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  now?: () => Date;
  /**
   * DEC-063 analog: allow-listed test numbers only until the owner widens it
   * in a logged DEC. Resolved from CHANNELS_VOICE_ALLOWLIST (comma-separated
   * E.164) when not passed; empty = no restriction (VOICE_SANDBOX default-ON
   * is the standing guard, exactly like SMS_SANDBOX).
   */
  allowlist?: string[];
}

export interface DialVoiceParams {
  workspaceId: string;
  campaignId: string;
  agentId: string;
  contactId: string;
  enrollmentId?: string;
}

/** Fallback per-campaign cap when guardrails carry no voice cap (conservative —
 *  a call is far more intrusive than an sms). */
export const DEFAULT_VOICE_DAILY_CAP = 20;

/** Platform-level workspace ceiling (env-overridable) — there is no per-tenant
 *  voice SenderConnection yet to carry a dailyLimit, so the platform holds one. */
export const DEFAULT_VOICE_WORKSPACE_DAILY_CAP = 100;

const normalizePhone = (raw: string): string => raw.replace(/[^\d+]/g, "");

/** Everything the dial service needs once the rails have cleared. */
export interface DialClearance {
  phone: string;
  agent: Agent;
  contact: Contact;
  guardrails: Guardrails;
  language: LanguageCode;
}

/**
 * Run every rail; throw the FIRST violation as a typed `SendBlockedError`,
 * else return the clearance. Rail order is the send-sms order — tested
 * against the same matrix.
 */
export async function assertDialAllowed(
  deps: DialVoiceDeps,
  params: DialVoiceParams,
): Promise<DialClearance> {
  const { prisma } = deps;
  const now = deps.now?.() ?? new Date();
  const ctx = { workspaceId: params.workspaceId };

  // B1 W1 (DEC-079): platform suspension is the first gate — a call IS a send,
  // so the dial boundary refuses a suspended workspace/agency like sms/email.
  await assertTenantActive(prisma, params.workspaceId);

  const [contact, agent] = await withTenant(prisma, ctx, (tx) =>
    Promise.all([
      tx.contact.findUnique({ where: { id: params.contactId } }),
      tx.agent.findUnique({ where: { id: params.agentId } }),
    ]),
  );
  if (!agent) throw new Error(`Agent ${params.agentId} not found`);
  const phone = contact?.phone ? normalizePhone(contact.phone) : "";
  if (!contact || !phone) throw new SendBlockedError("CONTACT_NO_PHONE", params.contactId);

  const guardrails = parseGuardrails(agent.guardrails);
  const language = resolveLanguage(guardrails);
  // D8: Aura-2 voices are English-only — refuse honestly rather than run a
  // bilingual-broken call. Q-026 tracks non-English voice.
  if (language !== DEFAULT_LANGUAGE) {
    throw new SendBlockedError("VOICE_LANGUAGE_UNSUPPORTED", language);
  }

  assertInsideCallingWindow(guardrails, now);
  await assertUnderVoiceCaps(deps, params, guardrails, now);

  // suppressionCheck (A8, literal true) — fails TOWARD suppression (D5):
  // voice AND sms consent both gate the dial; the phone number is shared.
  const optOut = (contact.optOut ?? {}) as { sms?: boolean; voice?: boolean };
  if (optOut.voice || optOut.sms) throw new SendBlockedError("OPTED_OUT", phone);
  const suppressed = await withTenant(prisma, ctx, (tx) =>
    tx.suppression.findFirst({
      where: {
        workspaceId: params.workspaceId,
        channel: { in: ["voice", "sms"] },
        address: phone,
      },
    }),
  );
  if (suppressed) throw new SendBlockedError("SUPPRESSED", suppressed.reason);

  const allowlist =
    deps.allowlist ??
    (process.env.CHANNELS_VOICE_ALLOWLIST ?? "")
      .split(",")
      .map((s) => normalizePhone(s.trim()))
      .filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(phone)) {
    throw new SendBlockedError("RECIPIENT_NOT_ALLOWLISTED", phone);
  }

  return { phone, agent, contact, guardrails, language };
}

/**
 * The calling window — the guardrails sendingWindow read in ITS timezone
 * (sms/email parity, D6: the agent's configured tz; per-contact tz is future
 * work). Same literal logic as the send boundaries' private helpers — kept
 * local so those files stay byte-untouched (the G1/G2 discipline).
 */
export function assertInsideCallingWindow(guardrails: Guardrails, now: Date): void {
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

async function assertUnderVoiceCaps(
  deps: DialVoiceDeps,
  params: DialVoiceParams,
  guardrails: Guardrails,
  now: Date,
): Promise<void> {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const where = {
    workspaceId: params.workspaceId,
    direction: "OUTBOUND" as const,
    createdAt: { gte: dayStart },
  };
  const [campaignCount, workspaceCount] = await withTenant(
    deps.prisma,
    { workspaceId: params.workspaceId },
    (tx) =>
      Promise.all([
        tx.call.count({ where: { ...where, campaignId: params.campaignId } }),
        tx.call.count({ where }),
      ]),
  );
  const cap = guardrails.dailyCap.voice ?? DEFAULT_VOICE_DAILY_CAP;
  if (campaignCount >= cap) {
    throw new SendBlockedError("DAILY_CAP_REACHED", `campaign voice cap ${cap}`);
  }
  const workspaceCap = Number(process.env.VOICE_WORKSPACE_DAILY_CAP ?? "") ||
    DEFAULT_VOICE_WORKSPACE_DAILY_CAP;
  if (workspaceCount >= workspaceCap) {
    throw new SendBlockedError("DAILY_CAP_REACHED", `workspace voice cap ${workspaceCap}`);
  }
}
