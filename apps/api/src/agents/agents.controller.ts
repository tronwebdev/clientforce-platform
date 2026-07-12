import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  createAgentSchema,
  DEFAULT_GUARDRAILS,
  parseGuardrails,
  updateAgentSchema,
  validateGraph,
  type AgentListItem,
} from "@clientforce/core";
import { Prisma, Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

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
    return this.tenant.run((tx) =>
      tx.agent.create({
        data: {
          workspaceId,
          name: parsed.data.name,
          goal: parsed.data.goal,
          // M1a (DEC-065): the wizard's step-1 picker persisted — with the
          // goal it derives the selling arc (supersedes DEC-038(6)).
          category: parsed.data.category ?? null,
          instructions: parsed.data.instructions ?? null,
          status: "DRAFT",
          guardrails: DEFAULT_GUARDRAILS as unknown as Prisma.InputJsonValue,
        },
      }),
    );
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
  async update(@Param("id") id: string, @Body() body: unknown) {
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
      const { guardrails, draftState, ...rest } = parsed.data;
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
      }
      return tx.agent.update({
        where: { id },
        data: {
          ...rest,
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
