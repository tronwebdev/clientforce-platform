import { randomUUID } from "node:crypto";
import type { AiGateway } from "@clientforce/ai";
import { loadMergedContextText } from "@clientforce/context";
import {
  campaignGraphSchema,
  execute,
  GraphValidationError,
  parseGuardrails,
  selectStrategy,
  validateGraph,
  type CampaignGraph,
  type IntendedAction,
  type StepNode,
  type StrategyBlock,
} from "@clientforce/core";
import {
  withTenant,
  type Campaign,
  type CampaignGraph as CampaignGraphRow,
  type PrismaClient,
} from "@clientforce/db";
import { PLANNER_SYSTEM, PLANNER_SYSTEM_GUIDED, renderPlannerPrompt } from "./prompts";

export interface PlanDeps {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  gateway: AiGateway;
}

export interface PlanTarget {
  workspaceId: string;
  agentId: string;
}

export interface PlanResult {
  campaign: Campaign;
  graphRow: CampaignGraphRow;
  graph: CampaignGraph;
  /** Executor dry-run trace (reply branch resolved as "interested"). */
  dryRun: IntendedAction[];
}

/** Terminal planning failure — nothing was persisted. */
export class PlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerError";
  }
}

const REQUIRED_TOKENS = ["{{firstName}}", "{{company}}"];

/**
 * The planner (P1.4): goal + merged BusinessContext (DEC-025) + guardrails →
 * a valid, runnable email CampaignGraph, persisted as the next version
 * (`source: AI`) on the agent's primary campaign (A5). Invalid model output
 * gets ONE semantic-repair round-trip; still invalid → throws, never persists
 * (shape validation + its own repair already happen inside
 * `completeStructured`). The executor dry-run proves the round-trip before
 * anything is written.
 */
export async function planCampaign(deps: PlanDeps, target: PlanTarget): Promise<PlanResult> {
  const { prisma, gateway } = deps;
  const { workspaceId, agentId } = target;

  const agent = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.agent.findUnique({ where: { id: agentId } }),
  );
  if (!agent) throw new PlannerError(`Agent ${agentId} not found in workspace ${workspaceId}`);

  // P2.1 (DEC-061): sms steps are only plannable when the workspace has an
  // ACTIVE Twilio sender — no sender, no sms nodes (honest absence).
  const smsSender = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.senderConnection.findFirst({ where: { type: "TWILIO_SMS", status: "ACTIVE" } }),
  );
  const allowedChannels = smsSender ? ["email", "sms"] : ["email"];

  // G1 (DEC-068): the ONE shared renderer — the composer reads the same text.
  const contextText = await loadMergedContextText(prisma, { workspaceId, agentId });
  if (!contextText) {
    throw new PlannerError(
      "BusinessContext is empty — run the distiller (and resolve gaps) before planning (DEC-015: copy must be grounded)",
    );
  }

  // M1a (DEC-065): arc + tone derive from (goal, category) — both fixed at
  // creation; the strategy block rides guardrails Json (absent = defaults).
  const strategy = selectStrategy(agent.goal, agent.category);
  const rider = guardrailsRiderOf(agent.guardrails);
  const neverSay = rider.strategy?.neverSay ?? [];
  // G1 (DEC-068): guided briefs need a live sms channel to compose into —
  // a guided agent without an ACTIVE Twilio sender plans scripted (honest
  // absence, the DEC-061 pattern).
  const guided = rider.composeMode === "guided" && Boolean(smsSender);

  const prompt = renderPlannerPrompt(
    {
      goal: agent.goal + (agent.instructions ? ` — ${agent.instructions}` : ""),
      context: contextText,
      guardrails: renderGuardrails(agent.guardrails),
      stepCount: "3-4",
      tokens: REQUIRED_TOKENS.join(" and "),
      channels: smsSender
        ? '"email" or "sms" — mix channels where the sequence benefits; sms steps have NO subject, body ≤ 300 characters, one clear ask.'
        : '"email" ONLY.',
      arcLabel: strategy.arc.label,
      arcDescription: strategy.arc.description,
      arcRoles: strategy.arc.roles.map((r, i) => `  ${i + 1}. ${r}`).join("\n"),
      toneHints: strategy.toneHints,
      strategyNotes: rider.strategy?.strategyNotes?.trim() || "(none)",
      neverSay: neverSay.length ? neverSay.map((t) => `"${t}"`).join(", ") : "(none)",
    },
    guided,
  );
  const system = guided ? PLANNER_SYSTEM_GUIDED : PLANNER_SYSTEM;

  // Attempt 1 (shape is enforced + repaired inside completeStructured) …
  let candidate = await gateway.completeStructured(
    "planner",
    { system, prompt },
    campaignGraphSchema,
  );
  let graph: CampaignGraph;
  try {
    graph = validateAll(candidate, allowedChannels, neverSay, guided);
  } catch (err) {
    // … one bounded SEMANTIC repair: the model sees its graph + the error.
    const message = err instanceof Error ? err.message : String(err);
    candidate = await gateway.completeStructured(
      "planner",
      {
        system,
        prompt:
          `${prompt}\n\n---\nYour previous graph FAILED validation.\n` +
          `Previous graph (JSON):\n${JSON.stringify(candidate)}\n` +
          `Validation error:\n${message}\nReturn a corrected graph.`,
      },
      campaignGraphSchema,
    );
    try {
      graph = validateAll(candidate, allowedChannels, neverSay, guided);
    } catch (second) {
      throw new PlannerError(
        `Planner produced an invalid graph after one repair: ${second instanceof Error ? second.message : String(second)}`,
      );
    }
  }

  // Dry-run BEFORE persisting: resolve the reply branch as "interested".
  const branchEvents = Object.fromEntries(
    graph.nodes.filter((n) => n.type === "branch").map((n) => [n.id, { intent: "interested" }]),
  );
  const dryRun = execute(graph, { events: branchEvents });

  const { campaign, graphRow } = await withTenant(prisma, { workspaceId }, async (tx) => {
    const graphRowId = randomUUID();
    let campaignRow = await tx.campaign.findFirst({
      where: { agentId },
      orderBy: { createdAt: "asc" },
    });
    if (!campaignRow) {
      // A5: one agent = one auto-created primary campaign.
      campaignRow = await tx.campaign.create({
        data: { workspaceId, agentId, name: `${agent.name} — primary`, graphId: graphRowId },
      });
    } else {
      campaignRow = await tx.campaign.update({
        where: { id: campaignRow.id },
        data: { graphId: graphRowId },
      });
    }
    const latest = await tx.campaignGraph.aggregate({
      where: { campaignId: campaignRow.id },
      _max: { version: true },
    });
    const row = await tx.campaignGraph.create({
      data: {
        id: graphRowId,
        workspaceId,
        campaignId: campaignRow.id,
        version: (latest._max.version ?? 0) + 1,
        graph: graph as object,
        source: "AI",
      },
    });
    return { campaign: campaignRow, graphRow: row };
  });

  return { campaign, graphRow, graph, dryRun };
}

/** Shape + T4 semantics + P1.4 slice requirements, as one gate.
 *  P2.1 (DEC-061): `allowedChannels` widens per workspace capability — sms
 *  joins ONLY when an active Twilio sender exists (default stays email-only).
 *  M1a (DEC-065): `neverSay` is the deterministic half of the double rail —
 *  the prompt bans the strings, this gate PROVES they're absent (violation →
 *  the caller's bounded repair round-trip → typed failure). Manual edits via
 *  PUT /planner/graph are deliberately NOT checked — those are the owner's
 *  own typed words; this guards generation.
 *  G1 (DEC-068): `allowGuided` gates guided steps to guided agents — a
 *  scripted agent's model emitting mode:"guided" is a validation failure
 *  (regression protection); the merge-token rule applies to SCRIPTED copy
 *  only (guided briefs carry no copy — the composer personalizes from real
 *  lead fields at send time), and the neverSay scan covers brief text too (a
 *  brief that INSTRUCTS a banned phrase fails generation). */
export function validateAll(
  input: unknown,
  allowedChannels: string[] = ["email"],
  neverSay: string[] = [],
  allowGuided = false,
): CampaignGraph {
  const graph = validateGraph(input);

  const steps = graph.nodes.filter((n): n is StepNode => n.type === "step");
  if (steps.length === 0) throw new GraphValidationError("Graph has no step nodes");
  const disallowed = steps.filter((s) => !allowedChannels.includes(s.channel));
  if (disallowed.length > 0) {
    throw new GraphValidationError(
      allowedChannels.length === 1
        ? `Phase 1 is email-only; steps ${disallowed.map((s) => s.id).join(", ")} use other channels`
        : `Steps ${disallowed.map((s) => s.id).join(", ")} use channels outside [${allowedChannels.join(", ")}]`,
    );
  }
  const guided = steps.filter((s) => s.mode === "guided");
  if (!allowGuided && guided.length > 0) {
    throw new GraphValidationError(
      `Steps ${guided.map((s) => s.id).join(", ")} are mode:"guided" but this agent composes scripted — emit scripted steps with full copy`,
    );
  }
  if (!graph.nodes.some((n) => n.type === "delay")) {
    throw new GraphValidationError("Graph must contain at least one delay node");
  }
  const replyBranch = graph.nodes.find((n) => n.type === "branch" && n.on === "reply");
  if (!replyBranch) {
    throw new GraphValidationError('Graph must contain a branch node with on="reply"');
  }
  // Merge tokens live in SCRIPTED copy; an all-guided graph has none at plan
  // time by design (documented default, DEC-068).
  const scripted = steps.filter((s) => s.mode !== "guided");
  if (scripted.length > 0) {
    const copy = scripted
      .map((s) => `${s.content.subject ?? ""}\n${s.content.body ?? ""}`)
      .join("\n");
    for (const token of REQUIRED_TOKENS) {
      if (!copy.includes(token)) {
        throw new GraphValidationError(`Step copy must use the merge token ${token}`);
      }
    }
  }
  // M1a: case-insensitive substring scan per step — names every hit so the
  // repair round-trip knows exactly what to remove. G1: a guided step's
  // BRIEF text is scanned too (objective + talking points + mustSay).
  const hits: string[] = [];
  for (const step of steps) {
    const brief = step.brief
      ? `${step.brief.objective}\n${step.brief.talkingPoints.join("\n")}\n${(step.brief.mustSay ?? []).join("\n")}`
      : "";
    const text = `${step.content.subject ?? ""}\n${step.content.body ?? ""}\n${brief}`.toLowerCase();
    for (const term of neverSay) {
      if (term.trim() && text.includes(term.trim().toLowerCase())) {
        hits.push(`"${term}" in ${step.id}`);
      }
    }
  }
  if (hits.length > 0) {
    throw new GraphValidationError(
      `Step copy contains banned phrases (agent strategy neverSay): ${hits.join(", ")} — rewrite those steps without the banned strings`,
    );
  }
  return graph;
}

/** The guardrails riders (M1a strategy + G1 composeMode), leniently: an
 *  unparsable row plans as legacy (no notes, no bans, scripted) rather than
 *  blocking the run — the send boundary is where strict guardrails parsing
 *  already lives. */
function guardrailsRiderOf(guardrails: unknown): {
  strategy?: StrategyBlock;
  composeMode?: "scripted" | "guided";
} {
  try {
    const parsed = parseGuardrails(guardrails);
    return { strategy: parsed.strategy, composeMode: parsed.composeMode };
  } catch {
    return {};
  }
}

function renderGuardrails(guardrails: unknown): string {
  if (guardrails && typeof guardrails === "object" && Object.keys(guardrails).length > 0) {
    return JSON.stringify(guardrails);
  }
  return "(none set yet — assume conservative defaults)";
}
