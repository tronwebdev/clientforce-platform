import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  Post,
} from "@nestjs/common";
import {
  DEFAULT_AUTONOMY,
  agentSuggestionSchema,
  createAgentSchema,
  goalTerminalPill,
  parseGuardrailDefaults,
  parseGuardrails,
  updateAgentSchema,
  validateGraph,
  type AgentListItem,
  type AgentSuggestion,
} from "@clientforce/core";
import { Prisma, Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";
import { agentCreateData } from "./create-agent";

/**
 * Agents surface (C2.2). One row per agent (A5: one agent = one goal = one
 * primary campaign) with LIVE metrics for the Agents List — everything
 * tenant-scoped through RLS. Creation arrives with the wizard (C2.3).
 */
@Controller("agents")
export class AgentsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  async list(): Promise<AgentListItem[]> {
    return this.tenant.run(async (tx) => {
      const agents = await tx.agent.findMany({
        where: { status: { not: "ARCHIVED" } },
        orderBy: { createdAt: "desc" },
      });
      if (agents.length === 0) return [];
      const agentIds = agents.map((a) => a.id);

      const campaigns = await tx.campaign.findMany({
        where: { agentId: { in: agentIds } },
        select: { id: true, agentId: true },
      });
      const campaignIds = campaigns.map((c) => c.id);
      const agentByCampaign = new Map(campaigns.map((c) => [c.id, c.agentId]));

      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const [graphs, enrollments, inbound, sentToday, activeSenders] = await Promise.all([
        tx.campaignGraph.findMany({
          where: { campaignId: { in: campaignIds } },
          orderBy: { version: "desc" },
          select: { campaignId: true, graph: true, version: true },
        }),
        tx.enrollment.groupBy({
          by: ["campaignId", "pipelineStage"],
          where: { campaignId: { in: campaignIds } },
          _count: { _all: true },
        }),
        tx.message.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: campaignIds }, direction: "INBOUND" },
          _count: { _all: true },
        }),
        tx.message.groupBy({
          by: ["campaignId"],
          where: {
            campaignId: { in: campaignIds },
            direction: "OUTBOUND",
            sentAt: { gte: dayStart },
          },
          _count: { _all: true },
        }),
        tx.senderConnection.count({ where: { status: "ACTIVE" } }),
      ]);

      // Latest graph per campaign (rows arrive version-desc).
      const latestGraph = new Map<string, unknown>();
      for (const g of graphs) {
        if (!latestGraph.has(g.campaignId)) latestGraph.set(g.campaignId, g.graph);
      }

      const zero = () => ({
        contacts: 0,
        replies: 0,
        qualified: 0,
        booked: 0,
        sendsToday: 0,
        steps: 0,
        channels: new Set<string>(),
      });
      const byAgent = new Map(agentIds.map((id) => [id, zero()]));
      const acc = (campaignId: string) => byAgent.get(agentByCampaign.get(campaignId) ?? "");

      for (const row of enrollments) {
        const a = acc(row.campaignId);
        if (!a) continue;
        a.contacts += row._count._all;
        if (row.pipelineStage === "interested") a.qualified += row._count._all;
        if (row.pipelineStage === "booked") a.booked += row._count._all;
      }
      for (const row of inbound) {
        const a = acc(row.campaignId);
        if (a) a.replies += row._count._all;
      }
      for (const row of sentToday) {
        const a = acc(row.campaignId);
        if (a) a.sendsToday += row._count._all;
      }
      for (const [campaignId, raw] of latestGraph) {
        const a = acc(campaignId);
        if (!a) continue;
        try {
          const graph = validateGraph(raw);
          for (const node of graph.nodes) {
            if (node.type === "step") {
              a.steps += 1;
              a.channels.add(node.channel);
            }
          }
        } catch {
          // A malformed stored graph never breaks the list; it just shows 0 steps.
        }
      }

      return agents.map((agent) => {
        const m = byAgent.get(agent.id) ?? zero();
        return {
          id: agent.id,
          name: agent.name,
          goal: agent.goal,
          status: agent.status,
          channels: m.channels.size ? [...m.channels] : ["email"],
          contacts: m.contacts,
          replies: m.replies,
          qualified: m.qualified,
          steps: m.steps,
          sendsToday: m.sendsToday,
          bookings: m.booked,
          // DEC-037: the only derived field — Warn when the agent can't run.
          health: (m.steps > 0 && activeSenders > 0 ? "Good" : "Warn") as "Good" | "Warn",
          createdAt: agent.createdAt.toISOString(),
          // B1 (DEC-104): the BACKEND_TOUCH_MAP goal-met EXTEND — met at least
          // once (any enrollment reached the goal-terminal stage), plus the
          // C2.9 pill wording and the Addendum-2 §D value fields (null = unset).
          goalMet: m.booked > 0,
          goalPill: goalTerminalPill(agent.goal),
          goalSummary: agent.goalSummary,
          // B2.6 (DEC-110): the suggestion marker, parsed defensively — an
          // unreadable blob renders as no suggestion, never a crash.
          suggestion: parseSuggestion(agent.suggestion),
          valueEstCents: agent.valueEstCents,
          valueGoalUnits: agent.valueGoalUnits,
          valueSalesGoalCents: agent.valueSalesGoalCents,
        };
      });
    });
  }

  /** C2.3: wizard step-1 creates the DRAFT agent (A5 create path). */
  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async create(@Body() body: unknown) {
    const parsed = createAgentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const workspaceId = this.tenant.workspaceId;
    // B2.6 (DEC-110): the ONE create-data shape (the suggestion sweep shares it).
    // B7 (DEC-133): a new campaign starts from the workspace's guardrail defaults.
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
      const defaults = parseGuardrailDefaults(
        ((ws?.settings ?? {}) as { guardrailDefaults?: unknown }).guardrailDefaults,
      );
      return tx.agent.create({ data: agentCreateData(workspaceId, parsed.data, defaults) });
    });
  }

  /** B6: wizard hydration payload for "Continue setup" — DRAFT resume only. */
  @Get(":id/draft")
  async draft(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const agent = await tx.agent.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          goal: true,
          category: true,
          instructions: true,
          status: true,
          draftState: true,
          guardrails: true,
        },
      });
      if (!agent) throw new NotFoundException(`Agent ${id} not found`);
      // G3 (DEC-075): the wizard's step-2 mode control reads the SAME rider
      // the Settings toggle owns — resolved server-side (absent = scripted)
      // so the client never parses raw guardrails.
      const { guardrails, ...row } = agent;
      let composeMode: "scripted" | "guided" = "scripted";
      try {
        composeMode = parseGuardrails(guardrails).composeMode ?? "scripted";
      } catch {
        // Unparsable legacy row — the conservative default stands.
      }
      return { ...row, composeMode };
    });
  }

  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async update(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    const parsed = updateAgentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.tenant.run(async (tx) => {
      const agent = await tx.agent.findUnique({ where: { id } });
      if (!agent) throw new NotFoundException(`Agent ${id} not found`);
      // M1a (DEC-065): the arc derives at creation — category writes are
      // wizard-only, so they stop once the agent leaves DRAFT.
      if (parsed.data.category !== undefined && agent.status !== "DRAFT") {
        throw new BadRequestException(
          "Business category is set at creation and can't change after launch",
        );
      }
      const { guardrails, draftState, dismissSuggestion, ...rest } = parsed.data;
      // B2.6 (DEC-110): dismissal stamps dismissedAt INSIDE the marker — the
      // row stays (hidden) so the signal never re-suggests.
      let suggestionUpdate: Prisma.InputJsonValue | undefined;
      if (dismissSuggestion) {
        const existing = agent.suggestion as Record<string, unknown> | null;
        if (!existing) {
          throw new BadRequestException("This campaign carries no suggestion to dismiss");
        }
        suggestionUpdate = { ...existing, dismissedAt: new Date().toISOString() };
      }
      // C2.3: guardrails go through the A8 schema — a PRESENT-yet-invalid
      // shape is the caller's error (designed 400, never a raw 500).
      let parsedGuardrails: ReturnType<typeof parseGuardrails> | undefined;
      if (guardrails !== undefined) {
        try {
          parsedGuardrails = parseGuardrails(guardrails);
        } catch {
          throw new BadRequestException("Guardrails failed A8 schema validation");
        }
        // L1 (DEC-072): the language rider is SYSTEM-written too (the
        // distiller's detection runs while the wizard is open) — a caller
        // that OMITS it must not clobber it: the wizard's step-5 guardrails
        // rebuild and any stale-read compose would otherwise erase a
        // mid-wizard detection. A caller that SENDS language (the Settings
        // row) writes it as given.
        // G3 (DEC-075): composeMode gets the same rule — the wizard's step-2
        // mode control writes it mid-wizard, and the step-5 rebuild (which
        // omits it) must not reset the draft to scripted. The two mode
        // controls always SEND it explicitly.
        let existing: ReturnType<typeof parseGuardrails> | null = null;
        try {
          existing = parseGuardrails(agent.guardrails);
        } catch {
          // Unparsable legacy row — nothing to preserve.
        }
        if (parsedGuardrails.language === undefined && existing?.language !== undefined) {
          parsedGuardrails = {
            ...parsedGuardrails,
            language: existing.language,
            languageSource: existing.languageSource,
          };
        }
        if (parsedGuardrails.composeMode === undefined && existing?.composeMode !== undefined) {
          parsedGuardrails = { ...parsedGuardrails, composeMode: existing.composeMode };
        }
        // B3d (DEC-122): the autonomy rider gets the same omit-preserve rule
        // — the create flow's launch rebuild and the legacy Settings full-A8
        // compose must never silently reset "Ask me first" back to the
        // default. A caller that SENDS autonomy writes it as given.
        if (parsedGuardrails.autonomy === undefined && existing?.autonomy !== undefined) {
          parsedGuardrails = { ...parsedGuardrails, autonomy: existing.autonomy };
        }
        // A level CHANGE lands on the campaign timeline — who, old → new.
        const fromLevel = existing?.autonomy ?? DEFAULT_AUTONOMY;
        const toLevel = parsedGuardrails.autonomy ?? DEFAULT_AUTONOMY;
        if (fromLevel !== toLevel) {
          const campaign = await tx.campaign.findFirst({
            where: { agentId: id },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          await tx.event.create({
            data: {
              workspaceId: this.tenant.workspaceId,
              campaignId: campaign?.id ?? null,
              type: "campaign.autonomy_changed.v1",
              payload: { from: fromLevel, to: toLevel, byUserId: req.auth?.user.id },
            },
          });
        }
      }
      return tx.agent.update({
        where: { id },
        data: {
          ...rest,
          ...(suggestionUpdate !== undefined ? { suggestion: suggestionUpdate } : {}),
          ...(parsedGuardrails !== undefined
            ? { guardrails: parsedGuardrails as unknown as Prisma.InputJsonValue }
            : {}),
          // B6: draft-resume working set; null clears it (launch).
          ...(draftState !== undefined
            ? {
                draftState:
                  draftState === null
                    ? Prisma.DbNull
                    : (draftState as unknown as Prisma.InputJsonValue),
              }
            : {}),
        },
      });
    });
  }

  @Delete(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async remove(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const agent = await tx.agent.findUnique({ where: { id } });
      if (!agent) throw new NotFoundException(`Agent ${id} not found`);
      await tx.agent.delete({ where: { id } });
      return { deleted: true };
    });
  }
}

/** B2.6: defensive parse of the suggestion marker (core schema). */
function parseSuggestion(raw: unknown): AgentSuggestion | null {
  if (!raw) return null;
  const parsed = agentSuggestionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
