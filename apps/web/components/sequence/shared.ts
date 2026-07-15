/**
 * Sequence-editor shared atoms (W3-4, DEC-076). Canonical home for the
 * pieces BOTH hosts (Create Agent wizard step 2 · agent-view Steps tab) use;
 * `app/agents/new/shared.tsx` re-exports them so every pre-W3-4 wizard import
 * keeps resolving. One definition, two hosts — never a fork.
 */
import { arcRoleAt, deriveBriefSeed, selectStrategy, type GraphNode, type StepBrief } from "@clientforce/core";

export const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

/**
 * W2 (#94): typed `cf` failure. The API's owner-readable `detail`/`message`
 * rides the error object (the sub-campaign creator renders a 422's detail
 * verbatim — the #88 error-handling precedent, never a stuck busy state);
 * `message` stays exactly `path: status` so every existing sink and matcher
 * (toasts, ensureImportList's 409 regex) is untouched. ONE class here — both
 * hosts' cf helpers throw it, so `instanceof` holds across the shared
 * components regardless of which host's cf a prop carries.
 */
export class CfError extends Error {
  constructor(
    path: string,
    readonly status: number,
    readonly detail: string | null,
  ) {
    super(`${path}: ${status}`);
    this.name = "CfError";
  }
}

/** G1/G2 brief-editor draft (channel-aware — email adds subjectHint). */
export type BriefDraft = {
  channel: "email" | "sms";
  objective: string;
  subjectHint: string;
  talkingPoints: string[];
  mustSay: string[];
  neverSay: string[];
};

/** G1/G2 sample-preview display states (refusal is a designed state). */
export type PreviewState =
  | { kind: "composed"; subject?: string; body: string; credits: number }
  | { kind: "refused"; reason: string; detail: string }
  | { kind: "error"; message: string };

/**
 * DEC-076 versioning notice — the one honest sentence every live-graph edit
 * surface renders (owner-locked copy, 2026-07-14).
 */
export const LIVE_GRAPH_NOTICE =
  "Changes apply to new contacts and upcoming steps — contacts mid-sequence finish on the current version.";

/**
 * DEC-086: the main-path card DISPLAY resolver — display keys off the
 * agent's `composeMode` rider, never off stored copy alone (the owner's
 * three live defects shared that one root cause). A card renders guided
 * treatment when its step is baked guided (the REAL brief), or — the
 * PENDING state — when the rider says guided and the whole plan predates
 * the flip (`pendingGuided`, the same planned-vs-selected mismatch the G3
 * banner keys on): its objective is the SAME deterministic seed the drawer
 * flip stages (`deriveBriefSeed` + the M1a arc slot — mechanical, never
 * fake AI). In a MIXED sequence a scripted step is a deliberate per-step
 * choice (W3-4 W2), so baked truth wins and no pending treatment renders.
 * Non-briefable channels under a pending rider keep their copy and tag
 * "✦ AI draft" (the canon gStep mapping — templates/scripts stay as
 * written). Strategy and sub-campaign steps never resolve here: the rider
 * drives the NEXT PLAN, and the plan owns only the main path. DEC-075
 * Regenerate-to-apply semantics are untouched — this is display only.
 */
export type GuidedCardDisplay =
  | { kind: "brief"; brief: StepBrief }
  | { kind: "pending"; objective: string }
  | { kind: "aidraft" };

export function guidedCardDisplay(
  node: Extract<GraphNode, { type: "step" }>,
  pendingGuided: boolean,
  position: { index: number; count: number },
  agent: { goal: string | null; category: string | null },
): GuidedCardDisplay | null {
  if (node.mode === "guided" && node.brief) return { kind: "brief", brief: node.brief };
  if (!pendingGuided) return null;
  if (node.channel !== "email" && node.channel !== "sms") return { kind: "aidraft" };
  const arc = selectStrategy(agent.goal, agent.category).arc;
  const seed = deriveBriefSeed(node, arcRoleAt(arc.roles, position.index, position.count));
  return { kind: "pending", objective: seed.objective };
}
