/**
 * Booking ingest (INT W2, DEC-094) — webhook payload → Meeting row (guarded
 * transitions, keyed `(workspaceId, provider, externalId)` for redelivery
 * idempotency) → contact correlation (`utm_content` → contactId, fallback
 * lowercase email) → `calendar.*` record events → the PORTED C2.4 stage
 * writer.
 *
 * Single-announcement principle (the no-double-fire pin): `calendar.booked.v1`
 * is the booking RECORD (timeline row, Meeting-row twin, sweep anchor) and is
 * DELIBERATELY absent from `matchTrigger`/`matchNotificationKind`. The ONE
 * `lead.stage_changed.v1` (toStage "booked" + the C2.9 goal rider, NO
 * `manual` flag — the enrollments.controller.ts C2.4 writer ported) is the
 * trigger carrier: it fires meeting_booked rules, the Slack notifier, and
 * the goal machinery with ZERO changes to match.ts / notify.ts.
 *
 * Unmatched invitees (no contact) persist a Meeting row with
 * `contactId: null` and are ACKNOWLEDGED WITHOUT EVENTS — honest "not our
 * lead". Cancellation NEVER changes the pipeline stage.
 */
import { goalTerminalLabel, parseGuardrails } from "@clientforce/core";
import { Prisma, withTenant } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import type { IntegrationsDeps } from "./types";

/** The ingest deps — the IntegrationsDeps spine minus adapters (none needed). */
export type BookingDeps = Pick<IntegrationsDeps, "prisma" | "publish" | "log" | "now">;

export interface BookingIngestInput {
  workspaceId: string;
  provider: string;
  /** The vendor's stable invitee/booking id — the idempotency key. */
  externalId: string;
  /** The vendor's PRIOR booking id on a reschedule (Calendly `old_invitee`). */
  previousExternalId?: string;
  startAt: Date;
  endAt?: Date;
  title?: string;
  timezone?: string;
  inviteeEmail?: string;
  /** The per-lead correlation rider (`utm_content=<contactId>`). */
  utmContent?: string;
  rescheduleUrl?: string;
  cancelUrl?: string;
}

export interface BookingIngestResult {
  outcome: "booked" | "rescheduled" | "duplicate" | "unmatched";
  meetingId: string | null;
  /** How the invitee correlated to a Contact. */
  matchedBy: "utm" | "email" | "none";
  stageChanged: boolean;
}

export interface CancellationIngestInput {
  workspaceId: string;
  provider: string;
  externalId: string;
  reason: "canceled" | "no_show";
}

export interface CancellationIngestResult {
  outcome: "canceled" | "duplicate" | "ignored";
  meetingId: string | null;
}

const logOf = (deps: BookingDeps) => deps.log ?? console.warn;

async function publishSafely(deps: BookingDeps, input: Parameters<NonNullable<BookingDeps["publish"]>>[0]): Promise<void> {
  if (!deps.publish) return;
  try {
    await deps.publish(input);
  } catch (err) {
    logOf(deps)(
      `[integrations] booking event publish failed (${input.type}): ${err instanceof Error ? err.message : String(err)} — Meeting row is authoritative`,
    );
  }
}

/** utm_content first (exact contact id, verified live), lowercase email second. */
async function correlateContact(
  deps: BookingDeps,
  workspaceId: string,
  input: Pick<BookingIngestInput, "utmContent" | "inviteeEmail">,
): Promise<{ contactId: string | null; matchedBy: "utm" | "email" | "none" }> {
  if (input.utmContent) {
    const byId = await withTenant(deps.prisma, { workspaceId }, (tx) =>
      tx.contact.findUnique({ where: { id: input.utmContent! }, select: { id: true } }),
    );
    if (byId) return { contactId: byId.id, matchedBy: "utm" };
  }
  const email = input.inviteeEmail?.trim().toLowerCase();
  if (email) {
    const byEmail = await withTenant(deps.prisma, { workspaceId }, (tx) =>
      tx.contact.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
    );
    if (byEmail) return { contactId: byEmail.id, matchedBy: "email" };
  }
  return { contactId: null, matchedBy: "none" };
}

/**
 * The PORTED C2.4 stage writer (enrollments.controller.ts move(), minus the
 * `manual` flag — this is a machine move): latest enrollment for the contact,
 * `pipelineStage → "booked"` on an ACTUAL change only, ONE
 * `lead.stage_changed.v1` with full envelope refs + the C2.9 goalMeta rider
 * (goalKey from the campaign's agent goal, label via `goalTerminalLabel`).
 */
async function writeBookedStage(
  deps: BookingDeps,
  params: { workspaceId: string; contactId: string },
): Promise<{ stageChanged: boolean; enrollmentId: string | null; campaignId: string | null }> {
  const moved = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, async (tx) => {
    const enrollment = await tx.enrollment.findFirst({
      where: { contactId: params.contactId },
      orderBy: { createdAt: "desc" },
      include: { campaign: { select: { agent: { select: { goal: true, guardrails: true } } } } },
    });
    if (!enrollment) return null;
    const { campaign, ...bare } = enrollment;
    if (bare.pipelineStage === "booked") {
      return { event: null, enrollmentId: bare.id, campaignId: bare.campaignId };
    }
    await tx.enrollment.update({ where: { id: bare.id }, data: { pipelineStage: "booked" } });
    // C2.9 (DEC-059): goal-completion moves carry the campaign goal + its
    // terminal label — timelines render the label verbatim.
    let customLabel: string | undefined;
    try {
      customLabel = parseGuardrails(campaign.agent.guardrails).goalLabel;
    } catch {
      customLabel = undefined; // legacy/invalid guardrails never block a stage move
    }
    return {
      event: {
        workspaceId: params.workspaceId,
        type: EVENT_TYPES.LEAD_STAGE_CHANGED,
        contactId: bare.contactId,
        enrollmentId: bare.id,
        campaignId: bare.campaignId,
        payload: {
          fromStage: bare.pipelineStage,
          toStage: "booked",
          goalKey: campaign.agent.goal,
          label: goalTerminalLabel(campaign.agent.goal, customLabel),
        },
      },
      enrollmentId: bare.id,
      campaignId: bare.campaignId,
    };
  });
  if (!moved) return { stageChanged: false, enrollmentId: null, campaignId: null };
  if (moved.event) await publishSafely(deps, moved.event);
  return { stageChanged: Boolean(moved.event), enrollmentId: moved.enrollmentId, campaignId: moved.campaignId };
}

/**
 * invitee.created (fresh OR reschedule): upsert the Meeting, correlate,
 * publish the record event, drive the stage machinery. Redelivery of the same
 * externalId is a guarded no-op (`duplicate`).
 */
export async function ingestBooking(deps: BookingDeps, input: BookingIngestInput): Promise<BookingIngestResult> {
  const ctx = { workspaceId: input.workspaceId };

  // ── Reschedule: the vendor's old booking id names the row to MOVE ─────────
  if (input.previousExternalId) {
    const prior = await withTenant(deps.prisma, ctx, (tx) =>
      tx.meeting.findUnique({
        where: {
          workspaceId_provider_externalId: {
            workspaceId: input.workspaceId,
            provider: input.provider,
            externalId: input.previousExternalId!,
          },
        },
      }),
    );
    if (prior) {
      const fromStartAt = prior.startAt;
      await withTenant(deps.prisma, ctx, (tx) =>
        tx.meeting.update({
          where: { id: prior.id },
          data: {
            externalId: input.externalId,
            status: "booked", // a rescheduled meeting is booked again, whatever it was
            startAt: input.startAt,
            endAt: input.endAt ?? null,
            title: input.title ?? prior.title,
            timezone: input.timezone ?? prior.timezone,
            rescheduleUrl: input.rescheduleUrl ?? prior.rescheduleUrl,
            cancelUrl: input.cancelUrl ?? prior.cancelUrl,
          },
        }),
      );
      if (prior.contactId) {
        await publishSafely(deps, {
          workspaceId: input.workspaceId,
          type: EVENT_TYPES.CALENDAR_RESCHEDULED,
          contactId: prior.contactId,
          enrollmentId: prior.enrollmentId,
          campaignId: prior.campaignId,
          payload: {
            provider: input.provider,
            meetingId: prior.id,
            fromStartAt: fromStartAt.toISOString(),
            toStartAt: input.startAt.toISOString(),
          },
        });
      }
      return {
        outcome: "rescheduled",
        meetingId: prior.id,
        matchedBy: prior.contactId ? "utm" : "none",
        stageChanged: false,
      };
    }
    // Prior row unknown (webhook arrived before we watched) → fresh booking.
  }

  // ── Fresh booking ──────────────────────────────────────────────────────────
  const existing = await withTenant(deps.prisma, ctx, (tx) =>
    tx.meeting.findUnique({
      where: {
        workspaceId_provider_externalId: {
          workspaceId: input.workspaceId,
          provider: input.provider,
          externalId: input.externalId,
        },
      },
      select: { id: true },
    }),
  );
  if (existing) return { outcome: "duplicate", meetingId: existing.id, matchedBy: "none", stageChanged: false };

  const { contactId, matchedBy } = await correlateContact(deps, input.workspaceId, input);
  const enrollment = contactId
    ? await withTenant(deps.prisma, ctx, (tx) =>
        tx.enrollment.findFirst({
          where: { contactId },
          orderBy: { createdAt: "desc" },
          select: { id: true, campaignId: true },
        }),
      )
    : null;

  let meetingId: string;
  try {
    const row = await withTenant(deps.prisma, ctx, (tx) =>
      tx.meeting.create({
        data: {
          workspaceId: input.workspaceId,
          contactId,
          enrollmentId: enrollment?.id ?? null,
          campaignId: enrollment?.campaignId ?? null,
          provider: input.provider,
          externalId: input.externalId,
          status: "booked",
          startAt: input.startAt,
          endAt: input.endAt ?? null,
          title: input.title ?? null,
          timezone: input.timezone ?? null,
          inviteeEmail: input.inviteeEmail ?? null,
          rescheduleUrl: input.rescheduleUrl ?? null,
          cancelUrl: input.cancelUrl ?? null,
        },
        select: { id: true },
      }),
    );
    meetingId = row.id;
  } catch (err) {
    // A concurrent redelivery raced us to the unique — its row is the record.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { outcome: "duplicate", meetingId: null, matchedBy, stageChanged: false };
    }
    throw err;
  }

  // Unmatched invitee: the Meeting row IS the record — no events, no stage
  // change, honest "not our lead" ack.
  if (!contactId) {
    return { outcome: "unmatched", meetingId, matchedBy: "none", stageChanged: false };
  }

  await publishSafely(deps, {
    workspaceId: input.workspaceId,
    type: EVENT_TYPES.CALENDAR_BOOKED,
    contactId,
    enrollmentId: enrollment?.id ?? null,
    campaignId: enrollment?.campaignId ?? null,
    payload: {
      provider: input.provider,
      meetingId,
      startAt: input.startAt.toISOString(),
      ...(input.endAt ? { endAt: input.endAt.toISOString() } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      matchedBy,
    },
  });

  // The stage machinery — nothing to move when the contact has no enrollment
  // (documented default: Meeting + record event + timeline only).
  const stage = await writeBookedStage(deps, { workspaceId: input.workspaceId, contactId });
  return { outcome: "booked", meetingId, matchedBy, stageChanged: stage.stageChanged };
}

/**
 * invitee.canceled / invitee_no_show.created: guarded status flip + ONE
 * `calendar.canceled.v1` (payload reason folds no-show in). NO stage change —
 * a canceled meeting says nothing certain about the pipeline; rules decide.
 */
export async function ingestCancellation(
  deps: BookingDeps,
  input: CancellationIngestInput,
): Promise<CancellationIngestResult> {
  const ctx = { workspaceId: input.workspaceId };
  const meeting = await withTenant(deps.prisma, ctx, (tx) =>
    tx.meeting.findUnique({
      where: {
        workspaceId_provider_externalId: {
          workspaceId: input.workspaceId,
          provider: input.provider,
          externalId: input.externalId,
        },
      },
    }),
  );
  if (!meeting) return { outcome: "ignored", meetingId: null };
  if (meeting.status !== "booked") return { outcome: "duplicate", meetingId: meeting.id };

  await withTenant(deps.prisma, ctx, (tx) =>
    tx.meeting.update({ where: { id: meeting.id }, data: { status: input.reason } }),
  );
  if (meeting.contactId) {
    await publishSafely(deps, {
      workspaceId: input.workspaceId,
      type: EVENT_TYPES.CALENDAR_CANCELED,
      contactId: meeting.contactId,
      enrollmentId: meeting.enrollmentId,
      campaignId: meeting.campaignId,
      payload: {
        provider: input.provider,
        meetingId: meeting.id,
        startAt: meeting.startAt.toISOString(),
        reason: input.reason,
      },
    });
  }
  return { outcome: "canceled", meetingId: meeting.id };
}
