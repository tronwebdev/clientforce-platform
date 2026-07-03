import { z } from "zod";
import type { AiGateway } from "@clientforce/ai";
import {
  CONTEXT_FIELD_META,
  contextFieldsSchema,
  MAX_CUSTOM_GOAL_ASKS,
  recommendedFieldsFor,
  requiredFieldsFor,
  type ContextFieldKey,
  type ContextFields,
  type GoalKey,
} from "@clientforce/core";
import { withTenant, type BusinessContext, type PrismaClient } from "@clientforce/db";
import { retrieve, type RetrievedChunk } from "@clientforce/knowledge";
import { DISTILL_SYSTEM, renderDistillPrompt } from "./prompts";

export interface DistillDeps {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  gateway: AiGateway;
}

export interface DistillTarget {
  workspaceId: string;
  /** null/undefined = the workspace layer (Brand kit). */
  agentId?: string | null;
  /** Agent layer only; the workspace layer distills the full registry. */
  goal?: GoalKey | null;
  /** Custom-goal typed objective — drives the ≤2 proposed asks. */
  customObjective?: string;
}

export interface ProposedAsk {
  key: string;
  ask: string;
  dismissed?: boolean;
}

const EVIDENCE_PER_FIELD = 4;
const MAX_EVIDENCE_CHUNKS = 30;

const distillOutputSchema = z.object({
  fields: z
    .array(
      z.object({
        key: z.string(),
        value: z.string().min(1),
        citations: z.array(z.string()).min(1),
      }),
    )
    .default([]),
  rawSummary: z.string().default(""),
  proposedAsks: z.array(z.string()).default([]),
});

/**
 * The distiller (P1.3, DEC-024/025): gather per-field evidence via P1.2
 * retrieval, ask the model to fill ONLY what the evidence supports (with
 * chunk citations), then validate server-side — a fill whose citations are
 * not in the evidence pack is dropped. Typed and ai_decides entries are
 * never overwritten. Uncited required fields surface as gaps downstream.
 */
export async function distill(deps: DistillDeps, target: DistillTarget): Promise<BusinessContext> {
  const { prisma, gateway } = deps;
  const workspaceId = target.workspaceId;
  const agentId = target.agentId ?? null;
  const goal = agentId ? (target.goal ?? null) : null;

  const row = await upsertRow(prisma, workspaceId, agentId, goal, "DISTILLING");
  try {
    // Which fields this layer distills: workspace layer = the full registry;
    // agent layer = the goal's required + recommended set (agent-only evidence
    // so workspace-covered facts stay attributed to the workspace layer).
    const keys: ContextFieldKey[] = agentId
      ? goal
        ? [
            ...new Set([
              ...requiredFieldsFor(goal, { email: false }),
              ...recommendedFieldsFor(goal),
            ]),
          ]
        : []
      : [...(Object.keys(CONTEXT_FIELD_META) as ContextFieldKey[])];

    const evidence = await gatherEvidence(deps, workspaceId, agentId, keys);
    const existing = parseFields(row.fields);

    const distilled: ContextFields = {};
    let rawSummary = "";
    let proposedAsks: ProposedAsk[] = parseAsks(row.proposedAsks).filter((a) => a.dismissed);

    if (evidence.length > 0 && keys.length + (goal === "custom" ? 1 : 0) > 0) {
      const out = await gateway.completeStructured(
        "classify",
        {
          system: DISTILL_SYSTEM,
          prompt: renderDistillPrompt({
            goal: goalLine(goal, target.customObjective),
            fields: keys.map((k) => `- ${k} — ${CONTEXT_FIELD_META[k].hint}`).join("\n"),
            evidence: evidence.map((c) => `[${c.id}]\n${c.content}`).join("\n\n"),
            proposedAsksRule:
              goal === "custom"
                ? `- "proposedAsks": up to ${MAX_CUSTOM_GOAL_ASKS} short questions to ask the owner that the typed objective makes necessary and the evidence cannot answer. Otherwise return [].`
                : '- "proposedAsks": return [].',
          }),
        },
        distillOutputSchema,
      );

      const evidenceIds = new Set(evidence.map((c) => c.id));
      for (const f of out.fields) {
        // Server-side grounding checks — the model's claim to citation is not
        // trusted: unknown keys, unrequested keys, or citations outside the
        // evidence pack drop the fill (→ gap), never an error.
        if (!keys.includes(f.key as ContextFieldKey)) continue;
        const citations = [...new Set(f.citations)].filter((id) => evidenceIds.has(id));
        if (citations.length === 0) continue;
        distilled[f.key] = { value: f.value, citations, source: "distilled" };
      }
      rawSummary = out.rawSummary;

      if (goal === "custom") {
        const kept = parseAsks(row.proposedAsks).filter((a) => a.dismissed);
        const fresh = out.proposedAsks.slice(0, MAX_CUSTOM_GOAL_ASKS).map((ask, i) => ({
          key: `custom_ask_${i + 1}`,
          ask,
        }));
        // A dismissed ask stays dismissed across re-distills (owner removed it).
        proposedAsks = [...fresh.filter((f) => !kept.some((k) => k.ask === f.ask)), ...kept];
      }
    }

    // Merge: typed/ai_decides always win; stale distilled entries for this
    // layer's keys are replaced (or removed when no longer supported).
    const merged: ContextFields = {};
    for (const [key, value] of Object.entries(existing)) {
      if (value.source !== "distilled") merged[key] = value;
      else if (!keys.includes(key as ContextFieldKey)) merged[key] = value;
    }
    for (const [key, value] of Object.entries(distilled)) {
      if (!merged[key]) merged[key] = value;
    }

    return await withTenant(prisma, { workspaceId }, (tx) =>
      tx.businessContext.update({
        where: { id: row.id },
        data: {
          status: "READY",
          goal,
          fields: merged,
          proposedAsks: proposedAsks as object[],
          rawSummary,
          distilledAt: new Date(),
        },
      }),
    );
  } catch (err) {
    // Leave the previous fields intact; rethrow for the queue's retry policy.
    await withTenant(prisma, { workspaceId }, (tx) =>
      tx.businessContext.update({ where: { id: row.id }, data: { status: "READY" } }),
    ).catch(() => undefined);
    throw err;
  }
}

async function gatherEvidence(
  deps: DistillDeps,
  workspaceId: string,
  agentId: string | null,
  keys: ContextFieldKey[],
): Promise<RetrievedChunk[]> {
  const scope = agentId ? { agentId, includeWorkspace: false } : ("workspace" as const);
  const byId = new Map<string, RetrievedChunk>();
  for (const key of keys) {
    if (byId.size >= MAX_EVIDENCE_CHUNKS) break;
    const meta = CONTEXT_FIELD_META[key];
    const hits = await retrieve(
      deps.prisma,
      deps.gateway,
      workspaceId,
      `${meta.label}: ${meta.hint}`,
      {
        scope,
        k: EVIDENCE_PER_FIELD,
      },
    );
    for (const h of hits) byId.set(h.id, h);
  }
  return [...byId.values()].slice(0, MAX_EVIDENCE_CHUNKS);
}

async function upsertRow(
  prisma: PrismaClient,
  workspaceId: string,
  agentId: string | null,
  goal: string | null,
  status: "DISTILLING",
): Promise<BusinessContext> {
  return withTenant(prisma, { workspaceId }, async (tx) => {
    const existing = await tx.businessContext.findFirst({ where: { workspaceId, agentId } });
    if (existing) {
      return tx.businessContext.update({
        where: { id: existing.id },
        data: { status, ...(goal ? { goal } : {}) },
      });
    }
    return tx.businessContext.create({ data: { workspaceId, agentId, goal, status } });
  });
}

export const parseFields = (v: unknown): ContextFields => {
  const parsed = contextFieldsSchema.safeParse(v ?? {});
  return parsed.success ? parsed.data : {};
};

export const parseAsks = (v: unknown): ProposedAsk[] =>
  Array.isArray(v)
    ? (v as ProposedAsk[]).filter(
        (a) => a && typeof a.key === "string" && typeof a.ask === "string",
      )
    : [];

function goalLine(goal: GoalKey | null, customObjective?: string): string {
  if (!goal) return "(workspace-level brand/business profile — no specific campaign goal)";
  if (goal === "custom" && customObjective) return `custom — typed objective: ${customObjective}`;
  return goal;
}
