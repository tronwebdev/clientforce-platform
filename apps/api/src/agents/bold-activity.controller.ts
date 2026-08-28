import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import {
  BOLD_ACTIVITY_KINDS,
  goalTerminalLabel,
  parseGuardrails,
  type BoldActivityContact,
  type BoldActivityKind,
  type BoldActivityResponse,
  type BoldActivityRow,
  type BoldSendRecipient,
  type BoldSendRecipientsResponse,
} from "@clientforce/core";
import { Prisma } from "@clientforce/db";
import { TenantClient } from "../db/tenant-client";

/**
 * Bold campaign activity (B1, DEC-104) — the additive read behind the Bold
 * overview feed + the full activity page (ADDENDUM_4_BOLD §4.1/§4.2).
 *
 * Two truths from the execution model shape this endpoint:
 *  - SENDS are Message rows, not events (`email.sent.v1` is catalog-only) —
 *    so send activity is aggregated here per (stepNodeId × UTC day), and a
 *    count row drills into its recipients via /activity/recipients.
 *  - Everything else is per-contact Event rows already, so those drill for
 *    free (each row resolves to its contact).
 *
 * The response is DATA-shaped: kinds, counts, intents, amounts, labels. The
 * web client composes the sentence; the API never invents narrative.
 */

/** Event types per Bold kind (activity page filter vocabulary). */
const KIND_EVENT_TYPES: Record<Exclude<BoldActivityKind, "send">, string[]> = {
  goal: ["lead.stage_changed.v1", "calendar.booked.v1"],
  won: ["payment.received.v1", "proposal.paid.v1"],
  reply: ["email.replied.v1", "sms.replied.v1", "whatsapp.replied.v1"],
  proposal: ["proposal.sent.v1", "proposal.viewed.v1", "proposal.accepted.v1"],
  call: ["call.completed.v1", "call.booked.v1"],
  decision: [
    "email.compose_refused.v1",
    "sms.compose_refused.v1",
    "contact.enrollment_refused.v1",
    "lead.unsubscribed.v1",
    // B3d (DEC-122): autonomy + approvals are decisions by definition.
    "campaign.autonomy_changed.v1",
    "approval.created.v1",
    "approval.decided.v1",
  ],
};
const TYPE_TO_KIND = new Map<string, BoldActivityKind>(
  Object.entries(KIND_EVENT_TYPES).flatMap(([kind, types]) =>
    types.map((t) => [t, kind as BoldActivityKind]),
  ),
);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const utcDayKey = (d: Date) => d.toISOString().slice(0, 10);

interface SendAggRow {
  stepNodeId: string | null;
  channel: string;
  day: Date;
  count: bigint;
  last: Date;
}

@Controller("agents")
export class BoldActivityController {
  constructor(private readonly tenant: TenantClient) {}

  @Get(":id/activity")
  async activity(
    @Param("id") id: string,
    @Query("kind") kind?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ): Promise<BoldActivityResponse> {
    const kindFilter =
      kind && kind !== "all"
        ? (BOLD_ACTIVITY_KINDS as readonly string[]).includes(kind)
          ? (kind as BoldActivityKind)
          : null
        : undefined;
    if (kindFilter === null) throw new BadRequestException(`Unknown kind "${kind}"`);
    const before = cursor ? new Date(cursor) : null;
    if (before && Number.isNaN(before.getTime())) throw new BadRequestException("Bad cursor");
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 60));

    return this.tenant.run(async (tx) => {
      const agent = await tx.agent.findUnique({ where: { id } });
      if (!agent) throw new NotFoundException(`Agent ${id} not found`);
      const campaign = await tx.campaign.findFirst({
        where: { agentId: id },
        orderBy: { createdAt: "asc" },
      });
      if (!campaign) return { rows: [], nextCursor: null };

      let customGoalLabel: string | undefined;
      try {
        customGoalLabel = parseGuardrails(agent.guardrails).goalLabel;
      } catch {
        // Unparsable legacy guardrails — the generic label applies.
      }

      const types = !kindFilter
        ? Object.values(KIND_EVENT_TYPES).flat()
        : kindFilter === "send"
          ? []
          : KIND_EVENT_TYPES[kindFilter];
      const wantSends = !kindFilter || kindFilter === "send";

      // Goal rows: the terminal-only predicate must live IN the query — a
      // window of newest events can otherwise be all pipeline noise, and an
      // empty shaped page would claim exhaustion while real goal rows sit
      // below it (pagination starvation).
      const goalEventWhere = {
        OR: [
          { type: "calendar.booked.v1" },
          { type: "lead.stage_changed.v1", payload: { path: ["goalKey"], string_contains: "" } },
          { type: "lead.stage_changed.v1", payload: { path: ["toStage"], equals: "booked" } },
        ],
      };
      const [events, sendAgg] = await Promise.all([
        types.length
          ? tx.event.findMany({
              where: {
                campaignId: campaign.id,
                ...(kindFilter === "goal" ? goalEventWhere : { type: { in: types } }),
                ...(before ? { occurredAt: { lt: before } } : {}),
              },
              orderBy: { occurredAt: "desc" },
              take: limit + 1,
              include: {
                contact: { select: { id: true, firstName: true, lastName: true, email: true } },
              },
            })
          : Promise.resolve([]),
        wantSends
          ? tx.$queryRaw<SendAggRow[]>(Prisma.sql`
              SELECT "stepNodeId", "channel",
                     date_trunc('day', "sentAt" AT TIME ZONE 'UTC')::date AS day,
                     COUNT(*) AS count, MAX("sentAt") AS last
              FROM "Message"
              WHERE "campaignId" = ${campaign.id}
                AND "direction" = 'OUTBOUND'::"MessageDirection"
                ${before ? Prisma.sql`AND "sentAt" < ${before}` : Prisma.empty}
              GROUP BY 1, 2, 3
              ORDER BY last DESC
              LIMIT ${limit + 1}
            `)
          : Promise.resolve([] as SendAggRow[]),
      ]);

      const rows: BoldActivityRow[] = [];
      for (const e of events) {
        const rowKind = TYPE_TO_KIND.get(e.type);
        if (!rowKind) continue;
        const payload = (e.payload ?? {}) as Record<string, unknown>;
        // Goal rows: only terminal stage changes count (manual shuffles between
        // early stages are pipeline noise, not goal activity).
        if (e.type === "lead.stage_changed.v1") {
          const toStage = typeof payload.toStage === "string" ? payload.toStage : "";
          const hasGoalKey = typeof payload.goalKey === "string" && payload.goalKey.length > 0;
          if (toStage !== "booked" && !hasGoalKey) continue;
        }
        // B3d: the new decision types carry their factual sentence in
        // `reason` so the client never words them with the hold copy.
        let reason = typeof payload.reason === "string" ? payload.reason : null;
        if (e.type === "campaign.autonomy_changed.v1") {
          const word = (v: unknown) =>
            v === "ask" ? "ask first" : v === "full" ? "full autonomy" : "act inside limits";
          reason = `How much Ada decides changed — ${word(payload.from)} to ${word(payload.to)}.`;
        } else if (e.type === "approval.decided.v1") {
          reason = payload.decision === "approved" ? "Approved — it went ahead." : "Dismissed.";
        }
        rows.push({
          id: e.id,
          kind: rowKind,
          type: e.type,
          occurredAt: e.occurredAt.toISOString(),
          contact: (e.contact as BoldActivityContact | null) ?? null,
          intent: typeof payload.intent === "string" ? payload.intent : null,
          amountCents: typeof payload.amount === "number" ? payload.amount : null,
          goalLabel:
            rowKind === "goal"
              ? typeof payload.label === "string" && payload.label
                ? payload.label
                : goalTerminalLabel(agent.goal, customGoalLabel)
              : null,
          count: null,
          stepNodeId: typeof payload.stepNodeId === "string" ? payload.stepNodeId : null,
          channel: null,
          day: null,
          reason,
        });
      }
      for (const s of sendAgg) {
        const day = utcDayKey(new Date(s.day));
        rows.push({
          id: `send:${s.stepNodeId ?? "adhoc"}:${s.channel}:${day}`,
          kind: "send",
          occurredAt: s.last.toISOString(),
          contact: null,
          intent: null,
          amountCents: null,
          goalLabel: null,
          count: Number(s.count),
          stepNodeId: s.stepNodeId,
          channel: s.channel,
          day,
          reason: null,
        });
      }

      rows.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
      const page = rows.slice(0, limit);
      // Both source reads over-fetch by one: either overflowing means more
      // history exists below the last row we return.
      const exhausted = events.length <= limit && sendAgg.length <= limit;
      const last = page[page.length - 1];
      return {
        rows: page,
        nextCursor: exhausted || !last ? null : last.occurredAt,
      };
    });
  }

  /** The `sent to 22` drill — recipients of one aggregated send row, each with
   *  the furthest state they reached (geometry of ADDENDUM_4 §4.2's "a row
   *  with a count drills into the subset"). */
  @Get(":id/activity/recipients")
  async recipients(
    @Param("id") id: string,
    @Query("stepNodeId") stepNodeId?: string,
    @Query("day") day?: string,
  ): Promise<BoldSendRecipientsResponse> {
    if (!day || !DAY_RE.test(day)) throw new BadRequestException("day=YYYY-MM-DD required");
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    return this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { agentId: id },
        orderBy: { createdAt: "asc" },
      });
      if (!campaign) throw new NotFoundException(`Agent ${id} has no campaign`);

      const sent = await tx.message.findMany({
        where: {
          campaignId: campaign.id,
          direction: "OUTBOUND",
          sentAt: { gte: dayStart, lt: dayEnd },
          ...(stepNodeId ? { stepNodeId } : { stepNodeId: null }),
        },
        orderBy: { sentAt: "asc" },
        take: 200,
        select: { id: true, sentAt: true, contactId: true },
      });
      if (sent.length === 0) return { stepNodeId: stepNodeId ?? "", day, total: 0, recipients: [] };
      const contactIds = [...new Set(sent.map((m) => m.contactId))];
      const messageIds = new Set(sent.map((m) => m.id));
      // Message carries no contact relation — resolve names in one fetch.
      const contactRows = await tx.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      const contactById = new Map(contactRows.map((c) => [c.id, c]));

      const [inbound, engagement, bookedEnrollments] = await Promise.all([
        tx.message.findMany({
          where: {
            campaignId: campaign.id,
            direction: "INBOUND",
            contactId: { in: contactIds },
            sentAt: { gte: dayStart },
          },
          select: { contactId: true },
        }),
        tx.event.findMany({
          where: {
            campaignId: campaign.id,
            contactId: { in: contactIds },
            type: { in: ["email.opened.v1", "email.delivered.v1"] },
            occurredAt: { gte: dayStart },
          },
          select: { contactId: true, type: true, payload: true },
        }),
        tx.enrollment.findMany({
          where: { campaignId: campaign.id, contactId: { in: contactIds }, pipelineStage: "booked" },
          select: { contactId: true },
        }),
      ]);

      const replied = new Set(inbound.map((m) => m.contactId));
      const booked = new Set(bookedEnrollments.map((e) => e.contactId));
      const opened = new Set<string>();
      const delivered = new Set<string>();
      for (const e of engagement) {
        const messageId = ((e.payload ?? {}) as Record<string, unknown>).messageId;
        if (typeof messageId !== "string" || !messageIds.has(messageId) || !e.contactId) continue;
        (e.type === "email.opened.v1" ? opened : delivered).add(e.contactId);
      }

      const recipients: BoldSendRecipient[] = sent.map((m) => ({
        contact: contactById.get(m.contactId) ?? {
          id: m.contactId,
          firstName: null,
          lastName: null,
          email: null,
        },
        status: replied.has(m.contactId)
          ? "replied"
          : booked.has(m.contactId)
            ? "booked"
            : opened.has(m.contactId)
              ? "opened"
              : delivered.has(m.contactId)
                ? "delivered"
                : "sent",
        sentAt: m.sentAt.toISOString(),
      }));
      return { stepNodeId: stepNodeId ?? "", day, total: recipients.length, recipients };
    });
  }
}
