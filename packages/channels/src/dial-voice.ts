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
import { assertChannelLive, assertTenantActive } from "./tenant-status";
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
  /** B3c-1 (DEC-113/118): who is placing the call. "ada" (default) runs the
   *  consent gate — unknown consent means Ada may NOT call; "human" is the
   *  B3c-2 browser-mic leg (DNC/opt-out still gate, consent does not). */
  caller?: "ada" | "human";
  /** Best-time queueing only: skip the two TIMING gates (window + quiet
   *  hours) so every OTHER gate — consent, attempts, caps, opt-out,
   *  suppression, allow-list — is enforced BEFORE a call may queue. The
   *  fire-time run never sets this. */
  skipTimingGates?: boolean;
}

/** Fallback per-campaign cap when guardrails carry no voice cap (conservative —
 *  a call is far more intrusive than an sms). */
export const DEFAULT_VOICE_DAILY_CAP = 20;

/** B3c-1 (DEC-113): lifetime Ada-call attempts per contact per campaign
 *  before the rail refuses (guardrails.voice.callMaxAttempts overrides). */
export const DEFAULT_CALL_MAX_ATTEMPTS = 3;
/** B3c-1: no_answer/busy/failed attempts before voicemail-only delivery —
 *  AMD is not shipped (Q-085), so the rail refuses further live attempts. */
export const DEFAULT_VOICEMAIL_AFTER = 2;
/** B3c-1: the hard contact-local quiet floor (F1-floor posture) — whatever
 *  the campaign window says, Ada never rings before/after these local hours
 *  when the contact's own timezone is known. NON-BLOCKING defaults. */
export const QUIET_FLOOR_START = "08:00";
export const QUIET_FLOOR_END = "21:00";

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
  /** B3c-1: the window the call was cleared against — the UI's checkable
   *  "Ada picks the best time" sub-line renders exactly this. */
  window: ResolvedCallWindow;
}

/** B3c-1 (DEC-113): the contact-local calling window, resolved from the
 *  contact's own timezone when known (their column, else their latest
 *  calendar booking), falling back to the campaign window's timezone — the
 *  source is named so the claim stays checkable. */
export interface ResolvedCallWindow {
  timezone: string;
  source: "contact" | "calendar" | "campaign";
  days: number[];
  start: string;
  end: string;
  /** The campaign window's own zone — the rail checks the window THERE
   *  unconditionally, so the schedule must intersect it too. */
  campaignTimezone: string;
  /** The hard local floor applied on top of the window (owner-safety). */
  floorStart: string;
  floorEnd: string;
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
  // B1 W4 (DEC-082) ride-along, per the Q-025 owner ruling: wiring this rail is
  // what re-enters "voice" in KILL_SWITCH_CHANNELS — never a switch that no-ops.
  await assertChannelLive(prisma, params.workspaceId, "voice");

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
  // bilingual-broken call. Q-027 tracks non-English voice.
  if (language !== DEFAULT_LANGUAGE) {
    throw new SendBlockedError("VOICE_LANGUAGE_UNSUPPORTED", language);
  }

  const window = await resolveCallWindow(prisma, params.workspaceId, contact, guardrails);
  if (!params.skipTimingGates) {
    assertInsideCallingWindow(guardrails, now);
    // B3c-1 (DEC-113/119): the contact-local quiet-hours gate. Resolve the
    // contact's own timezone (their column, else their latest calendar
    // booking); when known, the campaign window AND the hard 08:00–21:00
    // local floor are re-checked in THEIR clock — the agent-tz check above
    // stays as the fallback truth when no contact timezone exists.
    assertInsideContactQuietHours(window, now);
  }
  await assertUnderVoiceCaps(deps, params, guardrails, now);

  const caller = params.caller ?? "ada";
  if (caller === "ada") {
    // DEC-118(2): Ada automated calls require AFFIRMATIVE consent — the
    // column defaults "unknown", and unknown = Ada may not call. Consent
    // never overrides opt-out/suppression below (D5: doubt blocks).
    if ((contact as Contact & { callConsent?: string }).callConsent !== "granted") {
      throw new SendBlockedError(
        "CALL_CONSENT_REQUIRED",
        `call consent is ${(contact as Contact & { callConsent?: string }).callConsent ?? "unknown"} — Ada only calls people who said yes`,
      );
    }
    // DEC-113: max attempts per contact (lifetime, per campaign — ad-hoc and
    // step dials share the one Call spine so they share the counter).
    const voiceRider = (guardrails as Guardrails & {
      voice?: { callMaxAttempts?: number; voicemailAfter?: number };
    }).voice;
    const maxAttempts = voiceRider?.callMaxAttempts ?? DEFAULT_CALL_MAX_ATTEMPTS;
    const voicemailAfter = voiceRider?.voicemailAfter ?? DEFAULT_VOICEMAIL_AFTER;
    // An ATTEMPT is a call that was actually placed (providerCallSid set):
    // a queued row awaiting its window, or a fire-time refusal marked
    // canceled, never rang — it must not burn an attempt slot. This also
    // keeps the fire-time re-run from counting the queued row itself.
    const [attempts, failures] = await withTenant(prisma, ctx, (tx) =>
      Promise.all([
        tx.call.count({
          where: {
            campaignId: params.campaignId,
            contactId: params.contactId,
            direction: "OUTBOUND",
            caller: "ada",
            providerCallSid: { not: null },
          },
        }),
        tx.call.count({
          where: {
            campaignId: params.campaignId,
            contactId: params.contactId,
            direction: "OUTBOUND",
            caller: "ada",
            providerCallSid: { not: null },
            outcome: { in: ["no_answer", "busy", "failed"] },
          },
        }),
      ]),
    );
    if (attempts >= maxAttempts) {
      throw new SendBlockedError("CALL_MAX_ATTEMPTS", `${attempts} attempts — the cap is ${maxAttempts}`);
    }
    // DEC-113: voicemail-only after N failures. Answering-machine detection
    // is not shipped (Q-085), so past the threshold the rail refuses further
    // LIVE attempts instead of dropping to voicemail — never a silent retry.
    if (failures >= voicemailAfter) {
      throw new SendBlockedError(
        "CALL_RETRIES_EXHAUSTED",
        `${failures} unanswered attempts — voicemail-only delivery arrives with answering-machine detection`,
      );
    }
  }

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

  return { phone, agent, contact, guardrails, language, window };
}

/**
 * B3c-1: resolve the contact-local calling window — ONE truth shared by the
 * rail, the queue's next-open computation, and the UI's checkable sub-line.
 */
export async function resolveCallWindow(
  prisma: PrismaClient,
  workspaceId: string,
  contact: Contact & { timezone?: string | null },
  guardrails: Guardrails,
): Promise<ResolvedCallWindow> {
  const { days, start, end, timezone: campaignTz } = guardrails.sendingWindow;
  let timezone = campaignTz;
  let source: ResolvedCallWindow["source"] = "campaign";
  if (contact.timezone && isValidTimezone(contact.timezone)) {
    timezone = contact.timezone;
    source = "contact";
  } else {
    const booking = await withTenant(prisma, { workspaceId }, (tx) =>
      tx.meeting.findFirst({
        where: { contactId: contact.id, timezone: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { timezone: true },
      }),
    );
    if (booking?.timezone && isValidTimezone(booking.timezone)) {
      timezone = booking.timezone;
      source = "calendar";
    }
  }
  return {
    timezone,
    source,
    days,
    start,
    end,
    campaignTimezone: campaignTz,
    floorStart: QUIET_FLOOR_START,
    floorEnd: QUIET_FLOOR_END,
  };
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function localParts(timezone: string, now: Date): { isoDay: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const isoDay = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[get("weekday")] ?? 0;
  return { isoDay, hhmm: `${get("hour")}:${get("minute")}` };
}

/** B3c-1: the contact-local check — window (when their tz differs from the
 *  campaign's) plus the hard 08:00–21:00 local floor. */
export function assertInsideContactQuietHours(window: ResolvedCallWindow, now: Date): void {
  const { isoDay, hhmm } = localParts(window.timezone, now);
  if (hhmm < window.floorStart || hhmm >= window.floorEnd) {
    throw new SendBlockedError(
      "OUTSIDE_QUIET_HOURS",
      `${hhmm} in ${window.timezone} (${window.source} time) — Ada calls between ${window.floorStart} and ${window.floorEnd} local`,
    );
  }
  if (window.source !== "campaign") {
    if (!window.days.includes(isoDay) || hhmm < window.start || hhmm >= window.end) {
      throw new SendBlockedError(
        "OUTSIDE_QUIET_HOURS",
        `${hhmm} in ${window.timezone} (${window.source} time) — the calling window is ${window.start}–${window.end}`,
      );
    }
  }
}

/**
 * B3c-1: the next moment EVERY timing gate the rail enforces is open — the
 * best-time queue's deterministic schedule (minute resolution, ≤8-day scan).
 * Three checks intersect, exactly mirroring the fire-time rail: the campaign
 * window in the CAMPAIGN zone (assertInsideCallingWindow's clock — always),
 * the hard 08:00–21:00 floor in the contact clock, and the campaign window
 * re-read in the contact clock when their zone is known (the quiet-hours
 * gate). Disjoint clocks can genuinely have no overlap — null, and the
 * caller says so instead of queueing a call that must cancel.
 */
export function nextWindowOpenAt(window: ResolvedCallWindow, from: Date): Date | null {
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i += 5) {
    const t = new Date(cursor.getTime() + i * 60 * 1000);
    if (isTimingOpen(window, t)) return t;
  }
  return null;
}

/** The ONE timing truth — the scheduler scans it; `insideNow` reports it. */
export function isTimingOpen(window: ResolvedCallWindow, t: Date): boolean {
  const camp = localParts(window.campaignTimezone, t);
  const campaignOk =
    window.days.includes(camp.isoDay) && camp.hhmm >= window.start && camp.hhmm < window.end;
  if (!campaignOk) return false;
  const local = localParts(window.timezone, t);
  const insideFloor = local.hhmm >= window.floorStart && local.hhmm < window.floorEnd;
  if (!insideFloor) return false;
  if (window.source !== "campaign") {
    if (!window.days.includes(local.isoDay) || local.hhmm < window.start || local.hhmm >= window.end) {
      return false;
    }
  }
  return true;
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
    // B3c-1 review: a cap slot is a PLACED call — a queued best-time row
    // (no sid yet) must not consume today's cap, and the fire-time re-run
    // must not count the row it is about to place.
    providerCallSid: { not: null },
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
  const workspaceCap =
    Number(process.env.VOICE_WORKSPACE_DAILY_CAP ?? "") || DEFAULT_VOICE_WORKSPACE_DAILY_CAP;
  if (workspaceCount >= workspaceCap) {
    throw new SendBlockedError("DAILY_CAP_REACHED", `workspace voice cap ${workspaceCap}`);
  }
}
