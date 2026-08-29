import { Controller, Post } from "@nestjs/common";
import {
  createAgentSchema,
  parseGuardrailDefaults,
  type AgentSuggestion,
  type CreateAgentInput,
} from "@clientforce/core";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";
import { agentCreateData } from "../agents/create-agent";
import { HAPPY_STAGES, NOT_NOW_INTENTS, QUIET_DAYS, THRESHOLDS } from "./signals";

/**
 * B2.6 (DEC-110, closes Q-066): the suggestion sweep — Ada proposes work the
 * owner has not asked for, READ FROM THE WORKSPACE'S OWN DATA. Each signal is
 * a DETERMINISTIC query (counts, never a model call, never invented
 * narrative); a firing signal writes ONE draft campaign through the same
 * create path as `POST /agents` (`agentCreateData` — the ruled "no parallel
 * path"), carrying the `suggestion` marker whose `reason` line is the factual
 * count sentence the rail shows.
 *
 * Dedup/suppression is structural: a signal is skipped whenever ANY agent row
 * with its goal exists — owner-made campaigns suppress the suggestion, and a
 * dismissed suggestion (its row stays, `dismissedAt` stamped) never
 * re-suggests. Idempotent by construction; the Bold shell fires it
 * best-effort on load (a worker/cron cadence is Q-076's call).
 */


interface SignalResult {
  signal: AgentSuggestion["signal"];
  count: number;
  fired: boolean;
  suppressedBy?: string;
}

@Controller("suggestions")
export class SuggestionsController {
  constructor(private readonly tenant: TenantClient) {}

  @Post("sweep")
  @Roles(Role.OWNER, Role.ADMIN)
  async sweep() {
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const evaluated: SignalResult[] = [];
      const created: Array<{ id: string; name: string; signal: string }> = [];
      // B7 (DEC-133): sweep drafts start from the workspace guardrail
      // defaults too — the ONE create path keeps one starting point.
      const wsRow = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { settings: true },
      });
      const wsDefaults = parseGuardrailDefaults(
        ((wsRow?.settings ?? {}) as { guardrailDefaults?: unknown }).guardrailDefaults,
      );

      const goalTaken = async (goal: string) => {
        const row = await tx.agent.findFirst({ where: { goal }, select: { name: true } });
        return row?.name ?? null;
      };

      const propose = async (
        signal: AgentSuggestion["signal"],
        count: number,
        input: CreateAgentInput,
        reason: string,
      ) => {
        const threshold = THRESHOLDS[signal];
        if (count < threshold) {
          evaluated.push({ signal, count, fired: false });
          return;
        }
        const taken = await goalTaken(input.goal);
        if (taken) {
          evaluated.push({ signal, count, fired: false, suppressedBy: taken });
          return;
        }
        // The SAME validated create shape POST /agents uses — then the marker.
        const parsed = createAgentSchema.parse(input);
        const suggestion: AgentSuggestion = {
          v: 1,
          signal,
          reason,
          count,
          at: new Date().toISOString(),
        };
        const row = await tx.agent.create({
          data: { ...agentCreateData(workspaceId, parsed, wsDefaults), suggestion },
        });
        evaluated.push({ signal, count, fired: true });
        created.push({ id: row.id, name: row.name, signal });
      };

      // S1 — win-back: distinct contacts whose replies said no / not now.
      const notNow = await tx.message.groupBy({
        by: ["contactId"],
        where: { direction: "INBOUND", intent: { in: NOT_NOW_INTENTS } },
      });
      await propose(
        "winback_stalled",
        notNow.length,
        {
          name: "Win back the not-nows",
          goal: "winback_deals",
          goalSummary: "Win back the deals that said not now",
        },
        `${notNow.length} conversation${notNow.length === 1 ? "" : "s"} said not now or pushed back — worth an honest second try.`,
      );

      // S2 — reactivate: contacts messaged before, silent for QUIET_DAYS+.
      const cutoff = new Date(Date.now() - QUIET_DAYS * 24 * 60 * 60 * 1000);
      const touched = await tx.message.groupBy({
        by: ["contactId"],
        _max: { sentAt: true },
      });
      const quiet = touched.filter((t) => t._max.sentAt != null && t._max.sentAt < cutoff).length;
      await propose(
        "quiet_contacts",
        quiet,
        {
          name: "Bring the quiet ones back",
          goal: "reactivate_leads",
          goalSummary: "Re-open the contacts who went quiet",
        },
        `${quiet} contact${quiet === 1 ? "" : "s"} had a conversation once and ${quiet === 1 ? "has" : "have"} been silent for ${QUIET_DAYS}+ days.`,
      );

      // S3 — reviews: booked/won outcomes with no review campaign anywhere.
      const happy = await tx.enrollment.count({
        where: { pipelineStage: { in: HAPPY_STAGES } },
      });
      await propose(
        "collect_reviews",
        happy,
        {
          name: "Ask the happy ones for reviews",
          goal: "collect_reviews",
          goalSummary: "Ask for a review at the right moment",
        },
        `${happy} booked or won outcome${happy === 1 ? "" : "s"} — the right moment to ask for a review.`,
      );

      return { created, evaluated };
    });
  }
}
