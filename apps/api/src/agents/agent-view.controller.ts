import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { goalTerminalLabel, goalTerminalPill, parseGuardrails, validateGraph, type CampaignGraph } from "@clientforce/core";
import { TenantClient } from "../db/tenant-client";

/**
 * Agent-view read surface (C2.4, checkpoints §4) — everything the five wired
 * tabs render, tenant-scoped through RLS. Writes stay on the existing
 * endpoints (PATCH /agents/:id, senders, planner).
 */
@Controller("agents")
export class AgentViewController {
  constructor(private readonly tenant: TenantClient) {}

  /** Record header + Steps tab: agent, primary campaign, latest graph, live counters. */
  @Get(":id/view")
  async view(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const agent = await tx.agent.findUnique({ where: { id } });
      if (!agent) throw new NotFoundException(`Agent ${id} not found`);
      const campaign = await tx.campaign.findFirst({
        where: { agentId: id },
        orderBy: { createdAt: "asc" },
      });
      const graphRow = campaign
        ? await tx.campaignGraph.findFirst({
            where: { campaignId: campaign.id },
            orderBy: { version: "desc" },
          })
        : null;
      let graph: CampaignGraph | null = null;
      try {
        graph = graphRow ? (validateGraph(graphRow.graph) as CampaignGraph) : null;
      } catch {
        graph = null; // malformed stored graph never breaks the view
      }

      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const [sentToday, stepAgg, guardrails] = await Promise.all([
        campaign
          ? tx.message.count({
              where: { campaignId: campaign.id, direction: "OUTBOUND", sentAt: { gte: dayStart } },
            })
          : Promise.resolve(0),
        campaign
          ? tx.message.groupBy({
              by: ["stepNodeId", "direction"],
              where: { campaignId: campaign.id },
              _count: { _all: true },
            })
          : Promise.resolve([] as Array<{ stepNodeId: string | null; direction: string; _count: { _all: number } }>),
        Promise.resolve(safeGuardrails(agent.guardrails)),
      ]);

      // Steps tab: sent counts per step node; opens/clicks come from Event rows.
      const events = campaign
        ? await tx.event.groupBy({
            by: ["type"],
            where: { campaignId: campaign.id },
            _count: { _all: true },
          })
        : [];

      const perStep: Record<string, { sent: number; replies: number }> = {};
      for (const row of stepAgg) {
        if (!row.stepNodeId) continue;
        const s = (perStep[row.stepNodeId] ??= { sent: 0, replies: 0 });
        if (row.direction === "OUTBOUND") s.sent += row._count._all;
        else s.replies += row._count._all;
      }

      return {
        agent: {
          id: agent.id,
          name: agent.name,
          goal: agent.goal,
          // C2.9 (DEC-059): resolved terminal wording — custom label from guardrails.
          goalLabel: goalTerminalLabel(agent.goal, guardrails?.goalLabel),
          goalPill: goalTerminalPill(agent.goal),
          // M1a (DEC-064): with the goal this derives the Settings tab's
          // selling-arc display (selectStrategy — never stored).
          category: agent.category,
          status: agent.status,
          createdAt: agent.createdAt.toISOString(),
        },
        campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
        graph,
        graphVersion: graphRow?.version ?? null,
        graphSource: graphRow?.source ?? null,
        sentToday,
        dailyCap: guardrails?.dailyCap.email ?? null,
        guardrails,
        perStep,
        eventCounts: Object.fromEntries(events.map((e) => [e.type, e._count._all])),
      };
    });
  }

  /**
   * Inbox tab: campaign-scoped Message rows grouped per contact into threads —
   * latest preview, unread (inbound newer than last outbound), intent of the
   * latest inbound, done flag (meta.done on the latest inbound).
   */
  @Get(":id/inbox")
  async inbox(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { agentId: id },
        orderBy: { createdAt: "asc" },
      });
      if (!campaign) return { threads: [] };
      const messages = await tx.message.findMany({
        where: { campaignId: campaign.id },
        orderBy: { sentAt: "asc" },
      });
      const contactIds = [...new Set(messages.map((m) => m.contactId))];
      const contacts = await tx.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, firstName: true, lastName: true, company: true, email: true },
      });
      const contactById = new Map(contacts.map((c) => [c.id, c]));
      const enrollments = await tx.enrollment.findMany({
        where: { campaignId: campaign.id, contactId: { in: contactIds } },
        select: { id: true, contactId: true, pipelineStage: true },
      });
      const enrollmentByContact = new Map(enrollments.map((e) => [e.contactId, e]));

      const threads = contactIds
        .map((contactId) => {
          const msgs = messages.filter((m) => m.contactId === contactId);
          const lastInbound = [...msgs].reverse().find((m) => m.direction === "INBOUND");
          if (!lastInbound) return null; // Inbox shows conversations with replies
          // DEC-034/owner 2026-07-05: unsubscribed threads LEAVE the Inbox —
          // their home is Contacts → Unsub and the lead timeline.
          if (lastInbound.intent === "unsubscribe") return null;
          const lastOutbound = [...msgs].reverse().find((m) => m.direction === "OUTBOUND");
          const last = msgs[msgs.length - 1]!;
          const meta = (lastInbound.meta ?? {}) as { done?: boolean };
          const enrollment = enrollmentByContact.get(contactId);
          return {
            contactId,
            contact: contactById.get(contactId) ?? null,
            enrollmentId: enrollment?.id ?? null,
            stage: enrollment?.pipelineStage ?? null,
            // P2.1 (DEC-061): channels present in the thread — the §4 channel
            // filter and per-thread chips are live once sms exists.
            channels: [...new Set(msgs.map((m) => m.channel))],
            intent: lastInbound.intent ?? null,
            unread: !lastOutbound || lastInbound.sentAt > lastOutbound.sentAt,
            done: meta.done === true,
            lastAt: last.sentAt.toISOString(),
            preview: (last.body ?? "").slice(0, 140),
            messageCount: msgs.length,
            messages: msgs.map((m) => ({
              id: m.id,
              direction: m.direction,
              channel: m.channel,
              subject: m.subject,
              body: m.body,
              intent: m.intent,
              sentAt: m.sentAt.toISOString(),
            })),
          };
        })
        .filter(Boolean);
      return { threads };
    });
  }

  /** Logs tab + lead-drawer timeline: typed, timestamped Event rows (newest first). */
  @Get(":id/events")
  async events(@Param("id") id: string, @Query("contactId") contactId?: string) {
    return this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { agentId: id },
        orderBy: { createdAt: "asc" },
      });
      if (!campaign) return { events: [] };
      const rows = await tx.event.findMany({
        where: { campaignId: campaign.id, ...(contactId ? { contactId } : {}) },
        orderBy: { occurredAt: "desc" },
        take: 200,
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
      return {
        events: rows.map((e) => ({
          id: e.id,
          type: e.type,
          contactId: e.contactId,
          contact: e.contact,
          enrollmentId: e.enrollmentId,
          payload: e.payload,
          occurredAt: e.occurredAt.toISOString(),
        })),
      };
    });
  }
}

function safeGuardrails(raw: unknown): ReturnType<typeof parseGuardrails> | null {
  try {
    return parseGuardrails(raw);
  } catch {
    return null;
  }
}
