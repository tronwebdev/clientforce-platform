import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { goalTerminalLabel, goalTerminalPill, parseGuardrails } from "@clientforce/core";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { HAPPY_STAGES, NOT_NOW_INTENTS, QUIET_DAYS } from "../suggestions/signals";

/**
 * Contacts screen surface (C2.5, checkpoints §5). The A10 segment chips are
 * QUERIES over these derived fields — never stored stage values:
 *   All = everything · New = stage `new` · Replied = any email.replied.v1 ·
 *   Qualified = stage ∈ {interested} · Booked = stage `booked` ·
 *   Unsub = optOut.email OR any Suppression row OR enrollment UNSUBSCRIBED.
 */
@Controller("contacts")
export class ContactsViewController {
  constructor(private readonly tenant: TenantClient) {}

  /**
   * Enriched rows the segment queries run over (workspace-scoped via RLS).
   * C2.8: `?listId=` scopes to explicit list membership (the rail IS the list
   * filter); each row carries `lists: [{id, name}]` (active lists only — an
   * archived list leaves every surface, membership preserved in the DB).
   */
  @Get("view")
  async view(@Query("listId") listId?: string) {
    return this.tenant.run(async (tx) => {
      const contacts = await tx.contact.findMany({
        orderBy: { createdAt: "asc" },
        ...(listId ? { where: { lists: { some: { listId } } } } : {}),
      });
      const ids = contacts.map((c) => c.id);
      const memberships = await tx.contactListMember.findMany({
        where: { contactId: { in: ids } },
        orderBy: { addedAt: "asc" },
        select: { contactId: true, list: { select: { id: true, name: true, archived: true } } },
      });
      const listsBy = new Map<string, { id: string; name: string }[]>();
      for (const m of memberships) {
        if (m.list.archived) continue;
        const arr = listsBy.get(m.contactId) ?? [];
        arr.push({ id: m.list.id, name: m.list.name });
        listsBy.set(m.contactId, arr);
      }
      // C2.9: distinct goals of ACTIVE agents drive the workspace-level label
      // (aggregation rule — shared pill iff one goal, else "Goal met").
      const activeAgents = await tx.agent.findMany({
        where: { status: "ACTIVE" },
        select: { goal: true },
      });
      const activeGoalKeys = [...new Set(activeAgents.map((a) => a.goal))];
      const [enrollments, replied, suppressions, lastEvents, lastInbounds] = await Promise.all([
        tx.enrollment.findMany({
          where: { contactId: { in: ids } },
          orderBy: { updatedAt: "desc" },
          select: {
            contactId: true,
            pipelineStage: true,
            status: true,
            updatedAt: true,
            campaignId: true,
            campaign: {
              select: { agent: { select: { name: true, goal: true, guardrails: true, valueEstCents: true } } },
            },
          },
        }),
        tx.event.groupBy({
          by: ["contactId"],
          where: { contactId: { in: ids }, type: "email.replied.v1" },
          _count: { _all: true },
        }),
        tx.suppression.findMany({ where: { channel: "email" }, select: { address: true } }),
        tx.event.groupBy({
          by: ["contactId"],
          where: { contactId: { in: ids } },
          _max: { occurredAt: true },
        }),
        // B3a review (DEC-112(7)): the newest INBOUND message per contact —
        // the "last asked about" human context the card sub-line prefers.
        tx.message.findMany({
          where: { contactId: { in: ids }, direction: "INBOUND" },
          orderBy: { sentAt: "desc" },
          distinct: ["contactId"],
          select: { contactId: true, body: true, intent: true, sentAt: true, channel: true },
        }),
      ]);

      const latestEnrollment = new Map<
        string,
        {
          pipelineStage: string;
          status: string;
          campaign?: {
            agent: { name: string; goal: string; guardrails: unknown; valueEstCents?: number | null } | null;
          } | null;
        }
      >();
      for (const e of enrollments) {
        if (e.contactId && !latestEnrollment.has(e.contactId)) latestEnrollment.set(e.contactId, e);
      }
      const repliedSet = new Set(replied.map((r) => r.contactId));
      const suppressed = new Set(suppressions.map((s) => s.address.toLowerCase()));
      const lastBy = new Map(lastEvents.map((e) => [e.contactId, e._max.occurredAt]));
      const lastInboundBy = new Map(lastInbounds.map((m) => [m.contactId, m]));

      const rows = contacts.map((c) => {
        const enr = latestEnrollment.get(c.id);
        const optOut = (c.optOut ?? {}) as { email?: boolean };
        const unsub =
          optOut.email === true ||
          (c.email ? suppressed.has(c.email.toLowerCase()) : false) ||
          enrollments.some((e) => e.contactId === c.id && e.status === "UNSUBSCRIBED");
        return {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          company: c.company,
          title: c.title,
          phone: c.phone,
          source: c.source,
          custom: c.custom ?? {},
          tags: c.tags,
          notes: c.notes,
          lists: listsBy.get(c.id) ?? [],
          // LH1 (DEC-087): the validation verdict chip (valid | risky |
          // invalid | unverified) — suppression/unsub stays its own signal.
          emailVerdict: c.emailVerdict,
          createdAt: c.createdAt.toISOString(),
          stage: enr?.pipelineStage ?? null,
          // C2.9: the completing campaign's terminal wording (per-row pills +
          // chips render THIS, never the workspace aggregate).
          goal: enr?.campaign?.agent ? rowGoal(enr.campaign.agent) : null,
          agentName: enr?.campaign?.agent?.name ?? null,
          // B3a (DEC-112, additive): the campaign's owner-entered per-unit
          // estimate — the ONLY value data (DEC-104/105); the Bold contacts
          // column renders it with the B1 potential vocabulary, never as
          // realized payment.
          valueEstCents: enr?.campaign?.agent?.valueEstCents ?? null,
          enrollmentStatus: enr?.status ?? null,
          replied: repliedSet.has(c.id),
          lastInbound: (() => {
            const m = lastInboundBy.get(c.id);
            return m
              ? { body: (m.body ?? "").slice(0, 140), intent: m.intent, channel: m.channel, sentAt: m.sentAt.toISOString() }
              : null;
          })(),
          unsub,
          lastActivity: (lastBy.get(c.id) ?? c.createdAt)?.toISOString() ?? null,
        };
      });
      return { rows, activeGoalKeys };
    });
  }

  /** Drawer timeline: every Event row for the contact, cross-campaign, newest
   *  first. B3a (DEC-112): the additive `enrollments` key rides along — the
   *  campaigns this contact is in, for the contact detail (§7). The review
   *  round (DEC-112(7)) adds `signalFacts`: which B2.6 sweep conditions THIS
   *  contact meets, from the shared signal vocabulary — the drawer's ✦ footer
   *  renders the factual sentence, or nothing when no condition holds. */
  @Get(":id/timeline")
  async timeline(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const rows = await tx.event.findMany({
        where: { contactId: id },
        orderBy: { occurredAt: "desc" },
        take: 100,
      });
      const enrollments = await tx.enrollment.findMany({
        where: { contactId: id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          pipelineStage: true,
          status: true,
          updatedAt: true,
          campaign: { select: { id: true, name: true, agent: { select: { id: true, name: true } } } },
        },
      });

      // The same per-contact conditions the sweep counts (signals.ts):
      // a not-now inbound · every message older than QUIET_DAYS · a happy
      // (booked/won) outcome. Facts only — dates and counts, no narrative.
      const msgs = await tx.message.findMany({
        where: { contactId: id },
        orderBy: { sentAt: "desc" },
        select: { direction: true, intent: true, sentAt: true },
        take: 200,
      });
      const signalFacts: Array<{ signal: string; at: string; days?: number }> = [];
      const notNow = msgs.find((m) => m.direction === "INBOUND" && m.intent != null && NOT_NOW_INTENTS.includes(m.intent));
      if (notNow) signalFacts.push({ signal: "winback_stalled", at: notNow.sentAt.toISOString() });
      const newest = msgs[0];
      const cutoff = Date.now() - QUIET_DAYS * 24 * 60 * 60 * 1000;
      if (newest && newest.sentAt.getTime() < cutoff) {
        signalFacts.push({
          signal: "quiet_contacts",
          at: newest.sentAt.toISOString(),
          days: Math.floor((Date.now() - newest.sentAt.getTime()) / (24 * 60 * 60 * 1000)),
        });
      }
      const happy = enrollments.find((e) => HAPPY_STAGES.includes(e.pipelineStage));
      if (happy) signalFacts.push({ signal: "collect_reviews", at: happy.updatedAt.toISOString() });

      // B3b (DEC-114 live): the next-best-action slot — EXACTLY five
      // deterministic rules, first match wins, provenance = the fact that
      // fired it. An action is LIVE only when it maps to a shipped write; a
      // fired-but-unshipped rule ships visibly deferred (DEC-115); no rule
      // fired -> null and the slot renders NOTHING (never a generic button).
      const shortDate = (iso: string) =>
        new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const nextStep = await (async (): Promise<Record<string, unknown> | null> => {
        const now = Date.now();
        // Rule 1 — booked + upcoming -> Send reminder (live via reply-send).
        const upcoming = await tx.event.findFirst({
          where: { contactId: id, type: "calendar.booked.v1" },
          orderBy: { occurredAt: "desc" },
        });
        const upStart = (upcoming?.payload as { startAt?: string } | null)?.startAt;
        const booked = enrollments.find((e) => e.pipelineStage === "booked");
        if (booked && upStart && new Date(upStart).getTime() > now) {
          return {
            key: "send_reminder",
            live: true,
            label: "Send reminder",
            provenance: `Booked for ${shortDate(upStart)}`,
            campaignId: booked.campaign?.id ?? null,
          };
        }
        // Rule 2 — no-show -> Rebook. Attendance is not recorded anywhere, so
        // this rule CANNOT fire yet — deterministic honesty, not an omission
        // (noted in PROGRESS; the datum lands with calendar attendance).
        // Rule 3 — replied not-now -> Add to win-back (live via the shipped
        // enrollment write, only when a win-back campaign exists to join).
        const notNowFact = signalFacts.find((f) => f.signal === "winback_stalled");
        if (notNowFact) {
          // The action must be REAL: the enroll write requires a campaign
          // with a persisted graph, so the rule only offers targets that can
          // actually take the contact (DEC-114's map-to-a-real-action bar).
          const winback = await tx.agent.findFirst({
            where: { goal: "winback_deals", campaigns: { some: { graphs: { some: {} } } } },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true },
          });
          const alreadyIn = winback
            ? await tx.enrollment.findFirst({
                where: { contactId: id, campaign: { agentId: winback.id } },
                select: { id: true },
              })
            : null;
          if (winback && !alreadyIn) {
            return {
              key: "add_winback",
              live: true,
              label: "Add to win-back",
              provenance: `Said not now ${shortDate(notNowFact.at)}`,
              agentId: winback.id,
              agentName: winback.name,
            };
          }
        }
        // Rule 4 — paid + no review ask -> Ask for a review (deferred: no
        // review-ask channel is shipped; the provenance still shows).
        const paid = await tx.event.findFirst({
          where: { contactId: id, type: "payment.received.v1" },
          orderBy: { occurredAt: "desc" },
        });
        if (paid) {
          const inReviewCampaign = await tx.enrollment.findFirst({
            where: { contactId: id, campaign: { agent: { goal: "collect_reviews" } } },
            select: { id: true },
          });
          if (!inReviewCampaign) {
            return {
              key: "ask_review",
              live: false,
              label: "Ask for a review",
              provenance: `Paid ${shortDate(paid.occurredAt.toISOString())}`,
            };
          }
        }
        // Rule 5 — quiet prospect -> Follow up (live via reply-send).
        const quietFact = signalFacts.find((f) => f.signal === "quiet_contacts");
        const isCustomer = enrollments.some((e) => e.pipelineStage === "won");
        if (quietFact && !isCustomer) {
          return {
            key: "follow_up",
            live: true,
            label: "Follow up",
            provenance: `Quiet for ${quietFact.days} days`,
            campaignId: enrollments[0]?.campaign?.id ?? null,
          };
        }
        return null;
      })();

      return {
        signalFacts,
        nextStep,
        enrollments: enrollments.map((e) => ({
          id: e.id,
          stage: e.pipelineStage,
          status: e.status,
          campaignId: e.campaign?.id ?? null,
          campaignName: e.campaign?.name ?? null,
          agentId: e.campaign?.agent?.id ?? null,
          agentName: e.campaign?.agent?.name ?? null,
        })),
        events: rows.map((e) => ({
          id: e.id,
          type: e.type,
          payload: e.payload,
          occurredAt: e.occurredAt.toISOString(),
        })),
      };
    });
  }

  /** Drawer "Move to" — stage move on the contact's latest enrollment. */
  @Post(":id/move")
  @Roles(Role.OWNER, Role.ADMIN)
  async move(@Param("id") id: string, @Body() body: { stage?: string }) {
    const stage = String(body?.stage ?? "").trim();
    if (!stage || stage.length > 40) throw new BadRequestException("stage required");
    return this.tenant.run(async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: { contactId: id },
        orderBy: { updatedAt: "desc" },
        include: { campaign: { select: { agent: { select: { goal: true, guardrails: true } } } } },
      });
      if (!enrollment) throw new BadRequestException("Contact has no enrollment to move");
      if (enrollment.pipelineStage === stage) return enrollment;
      const updated = await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { pipelineStage: stage },
      });
      // C2.9 (DEC-059): goal-completion moves carry the campaign goal + label.
      const goal =
        stage === "booked" && enrollment.campaign?.agent
          ? {
              goalKey: enrollment.campaign.agent.goal,
              label: rowGoal(enrollment.campaign.agent).label,
            }
          : null;
      await tx.event.create({
        data: {
          workspaceId: this.tenant.workspaceId,
          type: "lead.stage_changed.v1",
          contactId: id,
          enrollmentId: enrollment.id,
          campaignId: enrollment.campaignId,
          payload: {
            fromStage: enrollment.pipelineStage,
            toStage: stage,
            manual: true,
            ...(goal ?? {}),
          },
        },
      });
      return updated;
    });
  }

  /**
   * Bulk unsubscribe (§5 interaction script): per contact set `optOut.email`,
   * write the Suppression row, flip ACTIVE enrollments to UNSUBSCRIBED and
   * persist `lead.unsubscribed.v1` — the row pill flips on the next poll.
   */
  @Post("unsubscribe")
  @Roles(Role.OWNER, Role.ADMIN)
  async unsubscribe(@Body() body: { contactIds?: string[] }) {
    const contactIds = Array.isArray(body?.contactIds) ? body.contactIds.filter(Boolean) : [];
    if (contactIds.length === 0 || contactIds.length > 200) {
      throw new BadRequestException("contactIds required (1–200)");
    }
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      let updated = 0;
      for (const id of contactIds) {
        const contact = await tx.contact.findUnique({ where: { id } });
        if (!contact) continue;
        const optOut = { ...((contact.optOut ?? {}) as object), email: true };
        await tx.contact.update({ where: { id }, data: { optOut } });
        if (contact.email) {
          // P5 W3 (DEC-085): email suppression addresses are stored lowercase.
          await tx.suppression.upsert({
            where: {
              workspaceId_channel_address: {
                workspaceId,
                channel: "email",
                address: contact.email.toLowerCase(),
              },
            },
            create: {
              workspaceId,
              channel: "email",
              address: contact.email.toLowerCase(),
              reason: "MANUAL",
              source: "contacts-bulk",
            },
            update: {},
          });
        }
        const enrollments = await tx.enrollment.findMany({
          where: { contactId: id, status: { in: ["ACTIVE", "PAUSED"] } },
        });
        for (const e of enrollments) {
          await tx.enrollment.update({ where: { id: e.id }, data: { status: "UNSUBSCRIBED" } });
          await tx.event.create({
            data: {
              workspaceId,
              type: "lead.unsubscribed.v1",
              contactId: id,
              enrollmentId: e.id,
              campaignId: e.campaignId,
              payload: { source: "contacts-bulk" },
            },
          });
        }
        if (enrollments.length === 0) {
          await tx.event.create({
            data: {
              workspaceId,
              type: "lead.unsubscribed.v1",
              contactId: id,
              payload: { source: "contacts-bulk" },
            },
          });
        }
        updated += 1;
      }
      return { updated };
    });
  }
}

/** C2.9: a row's goal wording — custom label from guardrails when present. */
function rowGoal(agent: { goal: string; guardrails: unknown }): {
  key: string;
  label: string;
  pill: string;
} {
  let customLabel: string | undefined;
  try {
    customLabel = parseGuardrails(agent.guardrails).goalLabel;
  } catch {
    customLabel = undefined; // legacy/invalid guardrails never break the view
  }
  return {
    key: agent.goal,
    label: goalTerminalLabel(agent.goal, customLabel),
    pill: goalTerminalPill(agent.goal),
  };
}
