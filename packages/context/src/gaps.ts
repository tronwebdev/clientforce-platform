import {
  CONTEXT_FIELD_META,
  requiredFieldsFor,
  WORKSPACE_EMAIL_REQUIRED,
  type ContextFieldKey,
  type ContextFields,
  type GapItem,
  type GapReport,
  type GoalKey,
} from "@clientforce/core";
import type { ProposedAsk } from "./distill";

export interface GapInput {
  goal: GoalKey;
  /** The workspace layer's fields (Brand kit; agentId null row). */
  workspaceFields: ContextFields;
  /** The agent layer's fields (wizard answers + agent-source distills). */
  agentFields: ContextFields;
  /** Custom-goal distiller-proposed asks (agent layer row). */
  proposedAsks?: ProposedAsk[];
  /** Phase 1 is the email slice — company_address applies (owner edit 3). */
  email?: boolean;
}

/**
 * The gap checker (P1.3, DEC-024/025) — a pure function over BOTH layers
 * merged (agent wins). A required field is resolved when any layer carries a
 * typed answer, an ai_decides delegation, or a CITED distill; otherwise it is
 * an open gap ("Type it" / "✦ Let AI"). Fields satisfied by the workspace
 * layer report `covered`+`coveredBy: workspace` — the "✓ Found in your docs"
 * list, never re-asked. Launch (step 6) is gated on zero open items.
 */
export function checkGaps(input: GapInput): GapReport {
  const email = input.email ?? true;
  const required = requiredFieldsFor(input.goal, { email });

  const gaps: GapItem[] = required.map((key) => {
    const workspaceOnly = WORKSPACE_EMAIL_REQUIRED.includes(key);
    const agent = workspaceOnly ? undefined : input.agentFields[key];
    const workspace = input.workspaceFields[key];
    // Agent wins the merge (DEC-025); company_address lives only on the
    // workspace layer — asked once, never per agent (owner edit 3).
    const winner = agent ?? workspace;
    const layer: GapItem["layer"] = workspaceOnly ? "workspace" : "agent";

    if (!winner || (winner.source === "distilled" && winner.citations.length === 0)) {
      return { key, label: CONTEXT_FIELD_META[key].label, layer, status: "open" as const };
    }
    if (winner.source === "typed")
      return { key, label: CONTEXT_FIELD_META[key].label, layer, status: "typed" as const };
    if (winner.source === "ai_decides")
      return { key, label: CONTEXT_FIELD_META[key].label, layer, status: "ai_decides" as const };
    return {
      key,
      label: CONTEXT_FIELD_META[key].label,
      layer,
      status: "covered" as const,
      coveredBy: agent ? ("agent" as const) : ("workspace" as const),
    };
  });

  // Custom goal: non-dismissed proposed asks are gap rows too ("suggested for
  // your goal", removable); they gate launch while present (DEC-024).
  if (input.goal === "custom") {
    for (const ask of input.proposedAsks ?? []) {
      if (ask.dismissed) continue;
      const answered = input.agentFields[ask.key];
      gaps.push({
        key: ask.key,
        label: ask.ask,
        layer: "agent",
        status: answered ? (answered.source === "ai_decides" ? "ai_decides" : "typed") : "open",
        proposedAsk: ask.ask,
      });
    }
  }

  const resolved = gaps.filter((g) => g.status !== "open").length;
  return { gaps, resolved, total: gaps.length, launchReady: resolved === gaps.length };
}

/**
 * The planner's merged read (DEC-025): workspace + agent layers, agent wins.
 */
export function mergeLayers(
  workspaceFields: ContextFields,
  agentFields: ContextFields,
): ContextFields {
  return { ...workspaceFields, ...agentFields };
}

/** Registry keys the merged context satisfies with citations (for "Found in your docs"). */
export function coveredKeys(fields: ContextFields): ContextFieldKey[] {
  return Object.entries(fields)
    .filter(([, v]) => v.source !== "distilled" || v.citations.length > 0)
    .map(([k]) => k as ContextFieldKey);
}
