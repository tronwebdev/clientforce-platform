import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import {
  goalTerminalLabel,
  goalTerminalPill,
  parseGuardrails,
  validateGraph,
  type CampaignGraph,
  type ValidationProgress,
} from "@clientforce/core";
import { TenantClient } from "../db/tenant-client";
import { assembleInboxThreads } from "./inbox-threads";

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
          : Promise.resolve(
              [] as Array<{
                stepNodeId: string | null;
                direction: string;
                _count: { _all: number };
              }>,
            ),
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
          // M1a (DEC-065): with the goal this derives the Settings tab's
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
   * Inbox tab: campaign-scoped Message rows grouped per contact into threads.
   * B3a (DEC-112): assembly lives in the shared `assembleInboxThreads` — the
   * workspace-wide `GET /inbox` uses the SAME builder, so the two scopes can
   * never drift. Shape unchanged from B2 plus the additive `campaign` ref.
   */
  @Get(":id/inbox")
  async inbox(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { agentId: id },
        orderBy: { createdAt: "asc" },
        include: { agent: { select: { name: true } } },
      });
      if (!campaign) return { threads: [] };
      const threads = await assembleInboxThreads(tx, [
        { id: campaign.id, name: campaign.name, agentId: campaign.agentId, agentName: campaign.agent.name },
      ]);
      return { threads };
    });
  }

  /**
   * LH1 W3 (DEC-087): the campaign-dashboard validation chip's data — held
   * counts by reason + typed refusals for the agent's primary campaign.
   * Honest progress, never a blocking state: "Validating N — sending starts
   * as they clear."
   */
  @Get(":id/validation-progress")
  async validationProgress(@Param("id") id: string): Promise<ValidationProgress> {
    return this.tenant.run(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { agentId: id },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      const empty: ValidationProgress = {
        heldUnverified: 0,
        heldRisky: 0,
        heldCapOverflow: 0,
        refusedInvalid: 0,
      };
      if (!campaign) return empty;
      const groups = await tx.enrollmentHold.groupBy({
        by: ["status", "reason"],
        where: { campaignId: campaign.id },
        _count: { _all: true },
      });
      const count = (status: string, reason?: string): number =>
        groups
          .filter((g) => g.status === status && (reason === undefined || g.reason === reason))
          .reduce((n, g) => n + g._count._all, 0);
      return {
        heldUnverified: count("pending", "unverified"),
        heldRisky: count("pending", "risky_held"),
        heldCapOverflow: count("pending", "cap_overflow"),
        refusedInvalid: count("refused"),
      };
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
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
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
