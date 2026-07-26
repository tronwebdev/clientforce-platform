/**
 * Booking-link plumbing (INT W2, DEC-094). The workspace's Calendly
 * `Integration` row config is the ONE source of the scheduling link; every
 * surface (compose-time brief augmentation, the `{{calendarLink}}` render
 * token, the send-boundary flag clear) resolves it here so the URL can never
 * fork. The per-lead link carries `utm_source=clientforce&utm_content=
 * <contactId>` — the correlation rider the Calendly webhook matches back to
 * the contact (grounded by construction: the FULL final URL is what compose
 * injects, and the ungrounded-URL check is substring, so a model that drops
 * the params still passes and detection degrades to the email match).
 *
 * No config → null. Callers degrade honestly: compose omits the talking
 * point; the render token throws MissingTokenError (the render.ts house
 * rule); the flag clear leaves the flag for a later configured send.
 */
import { calendlyConfigSchema, type StepBrief } from "@clientforce/core";
import { withTenant, type Prisma, type PrismaClient } from "@clientforce/db";

/**
 * The injectable slots seam (INT W2 documented design): freebusy-at-compose
 * would drag the gcal adapter + refresh spine into every composer, so the
 * slots line rides an OPTIONAL injected dep instead — the worker wires
 * `createBookingSlotsProvider` from `@clientforce/integrations`; tests inject
 * a stub; absent = no line (the least invasive honest design). Composers stay
 * pure: they append a deterministic string, nothing else.
 */
export type BookingSlotsLine = (params: { workspaceId: string }) => Promise<string | null>;

/** The workspace scheduling URL off the calendly Integration row (null = unconfigured/revoked). */
export async function loadSchedulingUrl(prisma: PrismaClient, workspaceId: string): Promise<string | null> {
  const row = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.integration.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: "calendly" } },
      select: { config: true, status: true },
    }),
  );
  if (!row || row.status === "revoked") return null;
  const config = calendlyConfigSchema.safeParse(row.config);
  if (!config.success || !config.data.schedulingUrl) return null;
  return config.data.schedulingUrl;
}

/** Append the per-lead correlation rider to the scheduling URL. */
export function withBookingUtm(schedulingUrl: string, contactId: string): string {
  const sep = schedulingUrl.includes("?") ? "&" : "?";
  return `${schedulingUrl}${sep}utm_source=clientforce&utm_content=${encodeURIComponent(contactId)}`;
}

/** The full per-lead booking link, or null when no link is configured. */
export async function resolveBookingLink(
  prisma: PrismaClient,
  workspaceId: string,
  contactId: string,
): Promise<string | null> {
  const url = await loadSchedulingUrl(prisma, workspaceId);
  return url ? withBookingUtm(url, contactId) : null;
}

/** The deterministic compose-time talking point carrying the grounded link. */
export const bookingLinkTalkingPoint = (link: string): string =>
  `Booking link (offer it when inviting them to book a time): ${link}`;

/** `{{calendarLink}}` reference test — resolution is lazy, only on reference. */
export const CALENDAR_LINK_TOKEN_RE = /\{\{\s*calendarLink\s*\}\}/;

/** Enrollment.meta reader for the send_booking_link flag (R1 action, INT W2). */
export async function bookingLinkRequested(
  prisma: PrismaClient,
  workspaceId: string,
  enrollmentId: string,
): Promise<boolean> {
  const enrollment = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.enrollment.findUnique({ where: { id: enrollmentId }, select: { meta: true } }),
  );
  const meta = (enrollment?.meta ?? {}) as Record<string, unknown>;
  return meta.bookingLinkRequested === true;
}

/**
 * Compose-time brief augmentation (the chosen no-planner-prompt mechanism):
 * per-render, additive, deterministic —
 *  - a configured scheduling link appends the grounded booking-link talking
 *    point (flows through the EXISTING `{{talkingPoints}}` template var —
 *    zero prompt-template edits, zero planner changes; per-render so the
 *    agent-stable cached prefix never churns);
 *  - a wired slots seam appends the open-times line when it yields one
 *    (fresh gcal freebusy; stale/unavailable → omitted);
 *  - a pending `send_booking_link` flag adds the FULL per-lead link as a
 *    mustSay entry (verbatim inclusion, grounded by the same substring).
 * No config → the brief passes through untouched.
 */
export async function augmentBriefWithBooking(
  deps: { prisma: PrismaClient; bookingSlotsLine?: BookingSlotsLine },
  params: { workspaceId: string; contactId: string; enrollmentId?: string },
  brief: StepBrief,
): Promise<StepBrief> {
  const link = await resolveBookingLink(deps.prisma, params.workspaceId, params.contactId);
  let slotsLine: string | null = null;
  if (deps.bookingSlotsLine) {
    try {
      slotsLine = await deps.bookingSlotsLine({ workspaceId: params.workspaceId });
    } catch {
      slotsLine = null; // a slots outage must never block copy
    }
  }
  const mustSayLink =
    link && params.enrollmentId
      ? await bookingLinkRequested(deps.prisma, params.workspaceId, params.enrollmentId)
      : false;
  if (!link && !slotsLine) return brief;
  return {
    ...brief,
    talkingPoints: [
      ...brief.talkingPoints,
      ...(link ? [bookingLinkTalkingPoint(link)] : []),
      ...(slotsLine ? [slotsLine] : []),
    ],
    ...(mustSayLink ? { mustSay: [...(brief.mustSay ?? []), link!] } : {}),
  };
}

/**
 * Send-boundary flag clear: once a SENT message actually carried the
 * workspace booking link (guided mustSay injection or a scripted
 * {{calendarLink}}), the queued request is fulfilled. Substring on the BASE
 * scheduling URL (the per-lead params ride after it). Best-effort — the
 * Message is already persisted; a failure here logs and never unwinds a send.
 */
export async function clearBookingLinkFlagAfterSend(
  prisma: PrismaClient,
  params: { workspaceId: string; enrollmentId: string; sentBody: string },
): Promise<void> {
  try {
    if (!(await bookingLinkRequested(prisma, params.workspaceId, params.enrollmentId))) return;
    const schedulingUrl = await loadSchedulingUrl(prisma, params.workspaceId);
    if (!schedulingUrl) return; // nothing could have been injected — the flag stays honest
    if (!params.sentBody.toLowerCase().includes(schedulingUrl.toLowerCase())) return;
    await withTenant(prisma, { workspaceId: params.workspaceId }, async (tx) => {
      const enrollment = await tx.enrollment.findUnique({ where: { id: params.enrollmentId } });
      if (!enrollment) return;
      const meta = { ...((enrollment.meta ?? {}) as Record<string, unknown>) };
      if (meta.bookingLinkRequested !== true) return;
      delete meta.bookingLinkRequested;
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { meta: meta as Prisma.InputJsonValue },
      });
    });
  } catch (err) {
    console.warn(
      `[channels] booking-link flag clear failed for enrollment ${params.enrollmentId}: ` +
        `${err instanceof Error ? err.message : String(err)} — send already persisted`,
    );
  }
}
