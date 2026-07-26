/**
 * Availability slots (INT W2, DEC-094). `deriveSlots`/`formatSlotsLine` are
 * PURE and deterministic — timezone-correct via Intl (DST-safe: every instant
 * is projected into the calendar's own timezone before the business-hours
 * test), unit-tested against DST edges. The provider factory at the bottom is
 * the injectable compose seam: composers stay pure and call an injected
 * `bookingSlotsLine(workspaceId)`; the worker wires it here (gcal freebusy
 * via `withFreshCredentials`, in-memory 15-minute cache, stale/unavailable →
 * null — the slots line is OMITTED, the booking link still grounds).
 *
 * HONEST STANCE (stated in UI copy): slots in composed copy are
 * informational; the LINK is the booking mechanism. Nobody in Clientforce
 * creates calendar events in W2.
 */
import { gcalConfigSchema } from "@clientforce/core";
import { withTenant } from "@clientforce/db";
import { SLOTS_CACHE_TTL_MS } from "./constants";
import { withFreshCredentials } from "./service";
import type { GoogleCalendarAdapter } from "./gcal";
import type { IntegrationsDeps } from "./types";

export interface BusyInterval {
  /** ISO-8601 or Date. */
  start: string | Date;
  end: string | Date;
}

export interface DeriveSlotsOptions {
  /** How many days ahead to scan (default 5 business-ish days → 7 calendar days). */
  windowDays?: number;
  /** Slot length in minutes (default 30). */
  slotMinutes?: number;
  /** Local business hours in the target timezone (defaults 9–17). */
  dayStartHour?: number;
  dayEndHour?: number;
  /** How many slots to offer (default 3) — at most one per local day. */
  maxSlots?: number;
  /** Lead time before the first offered slot (default 24h). */
  minLeadHours?: number;
}

const MIN_MS = 60_000;

const asMs = (v: string | Date): number => (v instanceof Date ? v.getTime() : Date.parse(v));

interface LocalParts {
  weekday: string;
  dayKey: string;
  hour: number;
  minute: number;
}

const localParts = (instant: Date, timeZone: string): LocalParts => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    dayKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number.parseInt(get("hour"), 10),
    minute: Number.parseInt(get("minute"), 10),
  };
};

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

/**
 * Deterministic open-slot derivation: scan slot-aligned instants from
 * `now + minLeadHours` across `windowDays`, keep instants that fall inside
 * Mon–Fri business hours IN THE TARGET TIMEZONE and overlap no busy range;
 * offer at most one slot per local day, up to `maxSlots`.
 */
export function deriveSlots(
  busy: readonly BusyInterval[],
  now: Date,
  timeZone: string,
  opts: DeriveSlotsOptions = {},
): Date[] {
  const windowDays = opts.windowDays ?? 7;
  const slotMinutes = opts.slotMinutes ?? 30;
  const dayStartHour = opts.dayStartHour ?? 9;
  const dayEndHour = opts.dayEndHour ?? 17;
  const maxSlots = opts.maxSlots ?? 3;
  const minLeadHours = opts.minLeadHours ?? 24;

  const busyRanges = busy
    .map((b) => ({ start: asMs(b.start), end: asMs(b.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);

  const slotMs = slotMinutes * MIN_MS;
  const from = Math.ceil((now.getTime() + minLeadHours * 3_600_000) / slotMs) * slotMs;
  const until = now.getTime() + windowDays * 86_400_000;

  const slots: Date[] = [];
  const usedDays = new Set<string>();
  for (let t = from; t < until && slots.length < maxSlots; t += slotMs) {
    const instant = new Date(t);
    const local = localParts(instant, timeZone);
    if (!WEEKDAYS.has(local.weekday)) continue;
    const startMinutes = local.hour * 60 + local.minute;
    // The whole slot must fit inside business hours.
    if (startMinutes < dayStartHour * 60 || startMinutes + slotMinutes > dayEndHour * 60) continue;
    if (usedDays.has(local.dayKey)) continue;
    const slotEnd = t + slotMs;
    const clash = busyRanges.some((b) => b.start < slotEnd && b.end > t);
    if (clash) continue;
    usedDays.add(local.dayKey);
    slots.push(instant);
  }
  return slots;
}

const formatSlot = (slot: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(slot);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`.trim();
};

/**
 * The deterministic composed-copy line, e.g.
 * "Open times (America/Chicago): Tue 10:00 AM · Wed 2:30 PM". Empty slot set
 * → null (the line is omitted, never fabricated).
 */
export function formatSlotsLine(slots: readonly Date[], timeZone: string): string | null {
  if (slots.length === 0) return null;
  return `Open times (${timeZone}): ${slots.map((s) => formatSlot(s, timeZone)).join(" · ")}`;
}

/**
 * The compose seam: `(workspaceId) → slots line | null`. Null on EVERY
 * degraded path (gcal not connected / revoked / no picked calendar /
 * offerSlots off / vendor failure) — composers omit the line and the send
 * proceeds; a slots outage must never block copy. Successful freebusy stamps
 * `lastSyncAt` (the drawer "Last sync") and caches 15 minutes in-process.
 */
export function createBookingSlotsProvider(
  deps: IntegrationsDeps,
  opts: DeriveSlotsOptions & { now?: () => Date } = {},
): (params: { workspaceId: string }) => Promise<string | null> {
  const cache = new Map<string, { at: number; line: string | null }>();
  const log = deps.log ?? console.warn;
  return async ({ workspaceId }) => {
    const now = (opts.now ?? deps.now ?? (() => new Date()))();
    const cached = cache.get(workspaceId);
    if (cached && now.getTime() - cached.at < SLOTS_CACHE_TTL_MS) return cached.line;
    try {
      const adapter = deps.adapters.gcal as GoogleCalendarAdapter | undefined;
      if (!adapter?.freeBusy) return null;
      const row = await withTenant(deps.prisma, { workspaceId }, (tx) =>
        tx.integration.findUnique({
          where: { workspaceId_provider: { workspaceId, provider: "gcal" } },
        }),
      );
      if (!row || row.status === "revoked") return null;
      const config = gcalConfigSchema.safeParse(row.config);
      const calendar = config.success ? config.data.calendar : undefined;
      if (!calendar || !(config.success && config.data.offerSlots)) return null;

      const windowDays = opts.windowDays ?? 7;
      const busy = await withFreshCredentials(deps, row, (creds) =>
        adapter.freeBusy(creds, {
          calendarId: calendar.id,
          timeMin: now,
          timeMax: new Date(now.getTime() + windowDays * 86_400_000),
        }),
      );
      await withTenant(deps.prisma, { workspaceId }, (tx) =>
        tx.integration.update({ where: { id: row.id }, data: { lastSyncAt: now } }),
      );
      const line = formatSlotsLine(deriveSlots(busy, now, calendar.timeZone, opts), calendar.timeZone);
      cache.set(workspaceId, { at: now.getTime(), line });
      return line;
    } catch (err) {
      // Omit-on-stale (documented default): the booking LINK still grounds.
      log(
        `[integrations] slots line unavailable for workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)} — omitted`,
      );
      return null;
    }
  };
}
