import { registerPrompt, renderPrompt } from "@clientforce/ai";
import { BANNED_OPENERS, OPENER_WORD_CAP } from "@clientforce/core";

/**
 * Planner prompt (P1.4). Versioned in the P1.1 registry. Grounding rule
 * (DEC-015): step copy may only use facts present in the provided business
 * context — which is itself evidence-cited by P1.3 — never model priors.
 *
 * v3 (M1a, DEC-065): selling craft — step ROLES (opener earns the reply,
 * value/proof, objection-preempt, polite breakup last), one CTA per message,
 * decreasing length, per-role subject rules, banned-opener list, and the
 * per-agent STRATEGY block (arc + tone from the goal×category map, owner
 * strategyNotes, hard-banned neverSay strings). v2 stays registered.
 *
 * v4 (M1b, DEC-068): the REPLY PLAYBOOK — the reply branch carries one case
 * per strategy intent (interested · objection_price · objection_timing ·
 * wrong_person · info_request · not_interested) + default, each with its
 * planned path and pinned pipeline stage. v2/v3 stay registered.
 */
export const PLANNER_PROMPT_NAME = "planner.campaign";
export const PLANNER_PROMPT_VERSION = 4; // M1b (DEC-068): six-intent REPLY PLAYBOOK branch strategies

export const PLANNER_SYSTEM =
  "You are a campaign planner for an outbound email agent. You design a short, effective email sequence as a " +
  "directed graph of typed nodes. HARD RULES: (1) every factual claim in email copy must come from the " +
  "provided business context — never invent offers, prices, statistics, or links; (2) personalize with the " +
  "merge tokens {{firstName}} and {{company}}; (3) never write unsubscribe footers or physical addresses — " +
  "the sending layer appends compliant footers; (4) emails are concise (subject ≤60 chars, body 60–140 words), " +
  "specific, and end with one clear ask.\n" +
  "SELLING CRAFT (how a sequence earns replies — every step has a ROLE):\n" +
  `- OPENER (always the FIRST step): its only job is to earn a reply. At most ${OPENER_WORD_CAP} words. ` +
  "Open with a short, specific observation about the prospect's situation (grounded in the ideal-customer " +
  "profile and business context). Ask EXACTLY ONE question and END the body with that question. Zero " +
  "self-introduction filler. NEVER open with any of these phrases: " +
  BANNED_OPENERS.map((p) => `"${p}"`).join(", ") +
  ".\n" +
  "- VALUE/PROOF: one concrete proof point or outcome from the business context — show, don't claim.\n" +
  "- OBJECTION-PREEMPT: name the prospect's most likely hesitation and defuse it in one or two sentences.\n" +
  "- BREAKUP (always the LAST step before the sequence ends): the shortest message of the sequence; close " +
  "the loop politely, give an easy out, leave the door open. No guilt. If the sequence has only 3 steps, " +
  "fold OBJECTION-PREEMPT into the VALUE step — the BREAKUP is never dropped.\n" +
  "- ONE call-to-action per message — never two asks in one email.\n" +
  "- Each message is SHORTER than the previous one.\n" +
  "- Subject lines follow the step's role: opener = a specific fragment of the observation, at most 6 words, " +
  'never "quick question", never clickbait; value/proof = name the concrete outcome; breakup = signals ' +
  "closure. Never ALL CAPS, never exclamation marks.\n" +
  "REPLY CRAFT (how classified replies are handled — the reply-branch strategy steps):\n" +
  "- A strategy step answers the lead's actual situation first, stays under 80 words, keeps ONE " +
  "call-to-action, and continues the SAME email thread. It belongs to the branch, not the main sequence — " +
  "it is exempt from the decreasing-length ladder.\n" +
  "- Objections are never argued with: acknowledge in one clause, reframe with evidence from the business " +
  "context, ask one small question.\n" +
  "- A price objection is answered with VALUE, never money: no discount, no lower tier, no \"flexible " +
  "pricing\" — unless the business context itself contains such an offer, in which case cite it verbatim.\n" +
  "- A goodbye is graceful: accept the no, leave the door open, zero guilt, never mention unsubscribing.";

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  // v2 (P2.1) stays registered — prompts are append-only code (P1.1 registry);
  // the M1a before/after evidence renders it next to v3.
  registerPrompt({
    name: PLANNER_PROMPT_NAME,
    version: 2,
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
  // v3 (M1a) stays registered — append-only registry.
  registerPrompt({
    name: PLANNER_PROMPT_NAME,
    version: 3,
    template: `Design an outbound campaign graph for this agent.

GOAL: {{goal}}

BUSINESS CONTEXT (the ONLY permitted source of facts — cite-worthy values distilled from the company's own materials):
{{context}}

STRATEGY (the selling method for this agent — follow it):
- Arc: {{arcLabel}} — {{arcDescription}}
- Step roles in order:
{{arcRoles}}
- Tone: {{toneHints}}
- Owner strategy notes: {{strategyNotes}}
- NEVER SAY (hard ban — these strings must not appear anywhere in any subject or body, in any casing): {{neverSay}}

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
  // v4 (M1b, DEC-068): the REPLY PLAYBOOK — branch cases keyed by the six
  // strategy intents, each with its planned path + deterministic stage pin.
  registerPrompt({
    name: PLANNER_PROMPT_NAME,
    version: 4,
    template: `Design an outbound campaign graph for this agent.

GOAL: {{goal}}

BUSINESS CONTEXT (the ONLY permitted source of facts — cite-worthy values distilled from the company's own materials):
{{context}}

STRATEGY (the selling method for this agent — follow it):
- Arc: {{arcLabel}} — {{arcDescription}}
- Step roles in order:
{{arcRoles}}
- Tone: {{toneHints}}
- Owner strategy notes: {{strategyNotes}}
- NEVER SAY (hard ban — these strings must not appear anywhere in any subject or body, in any casing): {{neverSay}}

GUARDRAILS (constraints the plan must respect):
{{guardrails}}

GRAPH REQUIREMENTS:
- Channel: {{channels}}
- {{stepCount}} "step" nodes in the MAIN sequence; each content has "subject" and "body"; use {{tokens}} in the body (and subject where natural).
- At least one "delay" node between main-sequence sends (1-4 days).
- Exactly one "branch" node with on="reply" carrying the REPLY PLAYBOOK below, plus a "default" case that continues the follow-up sequence (which ends with the BREAKUP step).

REPLY PLAYBOOK (one case per classified intent — EXACTLY these six, each with "pipeline" set as stated):
- {"intent":"interested"}, "pipeline":"booked" → the close path: an "end" node (or a booking "action" node then "end").
- {"intent":"objection_price"}, "pipeline":"replied" → a VALUE-REFRAME "step": re-anchor on the outcome and proof from the business context. NEVER offer a discount, a lower price, or flexible pricing — unless the business context itself contains such an offer. Its edge goes BACK to the branch node (await the next reply).
- {"intent":"objection_timing"}, "pipeline":"replied" → an ACKNOWLEDGE "step" (respect their timeline, promise to circle back) → a "delay" node of 14-45 days → a short FOLLOW-UP "step" whose edge goes BACK to the branch node.
- {"intent":"wrong_person"}, "pipeline":"replied" → a REFERRAL-ASK "step" (thank them, ask to be pointed to the right person) whose edge goes to an "end" node.
- {"intent":"info_request"}, "pipeline":"replied" → an ANSWER "step" (answer from the business context ONLY, one clear CTA) whose edge goes BACK to the branch node.
- {"intent":"not_interested"}, "pipeline":"lost" → a GRACEFUL-CLOSE "step" (accept the no, door open, no guilt, never mention unsubscribing) whose edge goes to an "end" node.
Reply-strategy steps set "threaded": true (they continue the thread).

- Finish every non-rejoining path with an "end" node. Node ids are short slugs (e.g. "step-1", "branch-reply", "step-reframe-price").
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
  /** M1a (DEC-065): arc + tone from selectStrategy(goal, category). */
  arcLabel: string;
  arcDescription: string;
  /** Bulleted role ladder ("  1. OPENER — …"). */
  arcRoles: string;
  toneHints: string;
  /** Owner guidance from the guardrails strategy block; "(none)" default. */
  strategyNotes: string;
  /** Comma-joined quoted ban list; "(none)" default. */
  neverSay: string;
}): string {
  ensureRegistered();
  return renderPrompt(PLANNER_PROMPT_NAME, PLANNER_PROMPT_VERSION, vars);
}
