import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { POSITIVE_INTENTS, SIGNAL_MIN_SENDS, goalValueMeta } from "@clientforce/core";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

/**
 * B8 (DEC-135): the ONE analytics read — the campaign Stats tab and the
 * workspace Analytics surface both call this, so the two surfaces can never
 * disagree. Every number is server-derived from real rows; the source of
 * each is named here and echoed in the PR scope check:
 *
 *  - REACHED      — distinct contacts with an OUTBOUND `Message` in range.
 *  - OPENED       — distinct contacts with an `email.opened.v1` Event
 *                   (email only, and the surface says so).
 *  - REPLIED      — distinct contacts with an INBOUND `Message` in range.
 *  - INTERESTED   — distinct repliers whose reply intent is in the
 *                   POSITIVE_INTENTS set (the F1 constant, not a new list).
 *  - BOOKED / WON — distinct enrollments from `lead.stage_changed.v1`
 *                   Events (toStage booked / won) — the Event ledger is the
 *                   TIMESTAMPED stage history, so ranges are honest.
 *  - EST. VALUE   — the B1 value model: each agent's owner-typed
 *                   `valueEstCents` × its won-in-range count, summed.
 *                   Labeled an estimate, never "realized".
 *  - COLLECTED    — the sum of `payment.received.v1` Event amounts in
 *                   range (INT W3's ingest) — real money only; zero rows
 *                   render nothing rather than a fake figure.
 *  - BY CHANNEL   — sent per channel from `Message` rows + `Call` rows;
 *                   replies per channel from INBOUND rows; a booking
 *                   attributes to the channel of the LAST OUTBOUND message
 *                   in its enrollment before the stage event (the F1
 *                   last-sent rule). Cost columns have NO source until
 *                   metering (Q-108) — Q-114, never invented.
 *
 * Honesty floors: rates ride the F1 SIGNAL_MIN_SENDS gates — below the
 * floor the surface shows the count but calls the rate unreadable (§7).
 * The "reading" lines are DETERMINISTIC sentences computed from these same
 * aggregates — facts with receipts, never advice (acting on them is Q-116).
 */
const querySchema = z.object({
  agentId: z.string().min(1).optional(),
  range: z.enum(["7", "30", "all"]).default("30"),
});

const BOOKED_STAGES = new Set(["booked"]);
const WON_STAGES = new Set(["won"]);

@Controller("stats")
export class StatsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async stats(@Query() query: unknown) {
    const parsed = querySchema.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException("agentId?, range in 7|30|all");
    const { agentId, range } = parsed.data;
    const since = range === "all" ? null : new Date(Date.now() - Number(range) * 86_400_000);

    return this.tenant.run(async (tx) => {
      // Scope: one agent's campaigns, or every campaign in the workspace.
      const agents = await tx.agent.findMany({
        where: agentId ? { id: agentId } : { status: { not: "ARCHIVED" } },
        select: { id: true, name: true, goal: true, valueEstCents: true },
      });
      const campaigns = await tx.campaign.findMany({
        where: agentId ? { agentId } : {},
        select: { id: true, agentId: true },
      });
      const campaignIds = campaigns.map((c) => c.id);
      const inCampaigns = agentId ? { campaignId: { in: campaignIds } } : {};
      const sinceMsg = since ? { sentAt: { gte: since } } : {};
      const sinceEv = since ? { occurredAt: { gte: since } } : {};

      const [outboundByContact, inboundRows, openedByContact, stageEvents, calls, payments] =
        await Promise.all([
          tx.message.groupBy({
            by: ["contactId", "channel"],
            where: { direction: "OUTBOUND", ...inCampaigns, ...sinceMsg },
            _count: { _all: true },
          }),
          tx.message.findMany({
            where: { direction: "INBOUND", ...inCampaigns, ...sinceMsg },
            select: { contactId: true, channel: true, intent: true },
          }),
          tx.event.groupBy({
            by: ["contactId"],
            where: { type: "email.opened.v1", ...inCampaigns, ...sinceEv },
            _count: { _all: true },
          }),
          tx.event.findMany({
            where: { type: "lead.stage_changed.v1", ...inCampaigns, ...sinceEv },
            select: {
              enrollmentId: true,
              contactId: true,
              campaignId: true,
              payload: true,
              occurredAt: true,
            },
            orderBy: { occurredAt: "asc" },
          }),
          tx.call.count({ where: { direction: "OUTBOUND", ...inCampaigns, ...(since ? { createdAt: { gte: since } } : {}) } }),
          tx.event.findMany({
            where: { type: "payment.received.v1", ...inCampaigns, ...sinceEv },
            select: { payload: true },
          }),
        ]);

      const reachedSet = new Set(outboundByContact.map((r) => r.contactId).filter(Boolean));
      const openedSet = new Set(openedByContact.map((r) => r.contactId).filter(Boolean));
      const repliedSet = new Set(inboundRows.map((r) => r.contactId).filter(Boolean));
      const positive = new Set<string>(POSITIVE_INTENTS);
      const interestedSet = new Set(
        inboundRows.filter((r) => r.intent && positive.has(r.intent)).map((r) => r.contactId),
      );

      // Stage transitions: distinct enrollments per family, in range, plus
      // per-agent won counts for the value estimate.
      const bookedEnrollments = new Map<string, (typeof stageEvents)[number]>();
      const wonEnrollments = new Map<string, (typeof stageEvents)[number]>();
      for (const e of stageEvents) {
        const toStage = String((e.payload as { toStage?: string })?.toStage ?? "").toLowerCase();
        const key = e.enrollmentId ?? `${e.campaignId}:${e.contactId}`;
        if (BOOKED_STAGES.has(toStage) && !bookedEnrollments.has(key)) bookedEnrollments.set(key, e);
        if (WON_STAGES.has(toStage) && !wonEnrollments.has(key)) wonEnrollments.set(key, e);
      }

      // Estimated value: owner-typed per-goal-unit estimate × won-in-range,
      // summed per agent (goalValueMeta says whether the goal is monetary).
      const agentByCampaign = new Map(campaigns.map((c) => [c.id, c.agentId]));
      const wonByAgent = new Map<string, number>();
      for (const e of wonEnrollments.values()) {
        const aid = e.campaignId ? agentByCampaign.get(e.campaignId) : undefined;
        if (aid) wonByAgent.set(aid, (wonByAgent.get(aid) ?? 0) + 1);
      }
      let estValueCents = 0;
      for (const a of agents) {
        const won = wonByAgent.get(a.id) ?? 0;
        if (!won) continue;
        if (typeof a.valueEstCents === "number" && a.valueEstCents > 0 && goalValueMeta(a.goal).monetary) {
          estValueCents += a.valueEstCents * won;
        }
      }
      // `payment.received.v1` carries `amount` in cents (INT W3 catalog).
      const collectedCents = payments.reduce((n, p) => {
        const amt = (p.payload as { amount?: number })?.amount;
        return n + (typeof amt === "number" ? amt : 0);
      }, 0);

      // BY CHANNEL: sends + distinct repliers per channel; bookings attribute
      // to the last outbound before the stage event (bounded by bookings).
      const sentByChannel = new Map<string, number>();
      for (const r of outboundByContact) {
        sentByChannel.set(r.channel, (sentByChannel.get(r.channel) ?? 0) + r._count._all);
      }
      const repliersByChannel = new Map<string, Set<string>>();
      for (const r of inboundRows) {
        if (!r.contactId) continue;
        (repliersByChannel.get(r.channel) ?? repliersByChannel.set(r.channel, new Set()).get(r.channel)!).add(
          r.contactId,
        );
      }
      const bookedByChannel = new Map<string, number>();
      for (const e of bookedEnrollments.values()) {
        if (!e.enrollmentId) continue;
        const last = await tx.message.findFirst({
          where: { enrollmentId: e.enrollmentId, direction: "OUTBOUND", sentAt: { lte: e.occurredAt } },
          orderBy: { sentAt: "desc" },
          select: { channel: true },
        });
        const ch = last?.channel ?? "email";
        bookedByChannel.set(ch, (bookedByChannel.get(ch) ?? 0) + 1);
      }
      const channels = [
        { channel: "email", sent: sentByChannel.get("email") ?? 0 },
        { channel: "sms", sent: sentByChannel.get("sms") ?? 0 },
        { channel: "voice", sent: calls },
      ].map((c) => ({
        ...c,
        repliers: repliersByChannel.get(c.channel === "voice" ? "voice" : c.channel)?.size ?? 0,
        booked: bookedByChannel.get(c.channel) ?? 0,
      }));

      const totalSent = [...sentByChannel.values()].reduce((a, b) => a + b, 0) + calls;
      const reached = reachedSet.size;
      const replied = repliedSet.size;
      const booked = bookedEnrollments.size;
      const won = wonEnrollments.size;
      // Booked enrollments whose contact never replied — the receipt behind
      // the "funnel rose" note (a real count from the same rows).
      const bookedNoReply = [...bookedEnrollments.values()].filter(
        (e) => !e.contactId || !repliedSet.has(e.contactId),
      ).length;

      // The deterministic reading: facts with receipts from THESE aggregates
      // only — no advice, no prediction (acting on a reading is Q-116).
      const reading: string[] = [];
      const byBook = channels.filter((c) => c.booked > 0).sort((a, b) => b.booked - a.booked);
      if (byBook.length > 0 && booked > 0) {
        reading.push(
          `${byBook[0]!.channel === "sms" ? "SMS" : byBook[0]!.channel === "voice" ? "Calls" : "Email"} carried ${byBook[0]!.booked} of ${booked} booking${booked === 1 ? "" : "s"} in this window.`,
        );
      }
      if (reached > 0 && replied > 0) {
        const openPct = Math.round((openedSet.size / reached) * 100);
        const replyPct = Math.round((replied / reached) * 100);
        if (openedSet.size > 0 && openPct - replyPct >= 20) {
          reading.push(
            `The widest drop is between opening and replying — ${openPct}% open, ${replyPct}% reply.`,
          );
        }
      }
      if (totalSent > 0 && totalSent < SIGNAL_MIN_SENDS.low) {
        reading.push(`Under ${SIGNAL_MIN_SENDS.low} sends in this window — too few to read rates from.`);
      }

      return {
        scope: agentId ? "campaign" : "workspace",
        range,
        since: since?.toISOString() ?? null,
        floors: { low: SIGNAL_MIN_SENDS.low, ok: SIGNAL_MIN_SENDS.ok, totalSent },
        tiles: {
          reached,
          replied,
          repliedPct: reached > 0 && totalSent >= SIGNAL_MIN_SENDS.low ? Math.round((replied / reached) * 100) : null,
          booked,
          bookedPctOfRepliers: replied > 0 && totalSent >= SIGNAL_MIN_SENDS.low ? Math.round((booked / replied) * 100) : null,
          estValueCents: estValueCents || null,
          collectedCents: collectedCents || null,
        },
        funnel: [
          { key: "reached", label: "Reached", count: reached },
          { key: "opened", label: "Opened", count: openedSet.size, note: "email opens only" },
          { key: "replied", label: "Replied", count: replied },
          { key: "interested", label: "Interested", count: interestedSet.size },
          // B8 review fix: booked/won are OUTCOME rows, not drop stages — a
          // booking can arrive without any reply (inbound, the site agent),
          // so the funnel can legitimately "rise". The rows are marked
          // outcome for the surface's visual split, and when the count
          // exceeds an earlier stage the row carries a COMPUTED receipt in
          // the Opened-note pattern (real rows, never copy).
          {
            key: "booked",
            label: "Booked",
            count: booked,
            outcome: true,
            ...(bookedNoReply > 0 && booked > interestedSet.size
              ? { note: `bookings can arrive without a reply — ${bookedNoReply} of ${booked} came without one` }
              : {}),
          },
          { key: "won", label: "Won", count: won, outcome: true },
        ],
        channels,
        reading,
      };
    });
  }
}
