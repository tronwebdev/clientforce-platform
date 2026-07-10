import { registerPrompt, renderPrompt } from "@clientforce/ai";

/**
 * Planner prompt (P1.4). Versioned in the P1.1 registry. Grounding rule
 * (DEC-015): step copy may only use facts present in the provided business
 * context — which is itself evidence-cited by P1.3 — never model priors.
 */
export const PLANNER_PROMPT_NAME = "planner.campaign";
export const PLANNER_PROMPT_VERSION = 2; // P2.1 (DEC-061): channel line parameterized

export const PLANNER_SYSTEM =
  "You are a campaign planner for an outbound email agent. You design a short, effective email sequence as a " +
  "directed graph of typed nodes. HARD RULES: (1) every factual claim in email copy must come from the " +
  "provided business context — never invent offers, prices, statistics, or links; (2) personalize with the " +
  "merge tokens {{firstName}} and {{company}}; (3) never write unsubscribe footers or physical addresses — " +
  "the sending layer appends compliant footers; (4) emails are concise (subject ≤60 chars, body 60–140 words), " +
  "specific, and end with one clear ask.";

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerPrompt({
    name: PLANNER_PROMPT_NAME,
    version: PLANNER_PROMPT_VERSION,
    template: `Design an outbound campaign graph for this agent.

GOAL: {{goal}}

BUSINESS CONTEXT (the ONLY permitted source of facts — cite-worthy values distilled from the company's own materials):
{{context}}

GUARDRAILS (constraints the plan must respect):
{{guardrails}}

GRAPH REQUIREMENTS:
- Channel: {{channels}}
- {{stepCount}} "step" nodes; each content has "subject" and "body"; use {{tokens}} in the body (and subject where natural).
- At least one "delay" node between sends (1-4 days).
- Exactly one "branch" node with on="reply": a case for {"intent":"interested"} routing to an "end" (or booking "action") path, and a "default" case continuing the follow-up sequence.
- Finish every path with an "end" node. Node ids are short slugs (e.g. "step-1", "delay-1", "branch-reply").
- Edges connect the flow; sequential nodes (step/delay/action) have exactly ONE outgoing edge; branch routing lives in the branch cases, not edges.
- Every factual claim in copy must trace to the business context above.`,
  });
}

export function renderPlannerPrompt(vars: {
  goal: string;
  context: string;
  guardrails: string;
  stepCount: string;
  tokens: string;
  /** P2.1 (DEC-061): '"email" ONLY.' unless an active SMS sender widens it. */
  channels: string;
}): string {
  ensureRegistered();
  return renderPrompt(PLANNER_PROMPT_NAME, PLANNER_PROMPT_VERSION, vars);
}
