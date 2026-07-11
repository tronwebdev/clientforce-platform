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
 */
export const PLANNER_PROMPT_NAME = "planner.campaign";
export const PLANNER_PROMPT_VERSION = 3; // M1a (DEC-065): selling-craft playbook + STRATEGY block
// G1 (DEC-068): guided agents render v4 — v3 plus the GUIDED SMS BRIEFS rules.
// Scripted agents keep rendering v3 byte-identical (regression requirement).
export const PLANNER_PROMPT_VERSION_GUIDED = 4;

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
  "closure. Never ALL CAPS, never exclamation marks.";

/**
 * G1 (DEC-068): the guided addendum — appended to the system prompt ONLY for
 * guided agents; scripted planning keeps the exact system above.
 */
export const PLANNER_SYSTEM_GUIDED =
  PLANNER_SYSTEM +
  "\n" +
  "GUIDED SMS BRIEFS (this agent composes SMS per lead at send time):\n" +
  '- Every sms step is mode:"guided" and carries a "brief" INSTEAD of copy — never write sms body text.\n' +
  "- A brief = objective (what this step must achieve, following the step's ROLE above) + 3-6 talkingPoints " +
  "(concrete, grounded in the business context — facts the composed message may draw from, not sentences to " +
  "paste) + optional mustSay (ONLY compliance-critical strings that must appear verbatim, e.g. a real " +
  "deadline — at most 5) + optional neverSay (step-specific bans — at most 10).\n" +
  "- Talking points obey the same grounding rule as copy: facts from the business context only.\n" +
  "- Email steps in the same sequence stay fully scripted with subject and body as usual.";

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
  // v3 and v4 share head/tail so the two can never drift — v3's RENDERED bytes
  // are unchanged from M1a (the scripted regression pins this).
  const head = `Design an outbound campaign graph for this agent.

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
`;
  const tail = `- At least one "delay" node between sends (1-4 days).
- Exactly one "branch" node with on="reply": a case for {"intent":"interested"} routing to an "end" (or booking "action") path, and a "default" case continuing the follow-up sequence.
- Finish every path with an "end" node. Node ids are short slugs (e.g. "step-1", "delay-1", "branch-reply").
- Edges connect the flow; sequential nodes (step/delay/action) have exactly ONE outgoing edge; branch routing lives in the branch cases, not edges.
- Every factual claim in copy must trace to the business context above.`;
  registerPrompt({
    name: PLANNER_PROMPT_NAME,
    version: PLANNER_PROMPT_VERSION,
    template:
      head +
      `- {{stepCount}} "step" nodes; each content has "subject" and "body"; use {{tokens}} in the body (and subject where natural).\n` +
      tail,
  });
  // G1 (DEC-068): the guided variant — sms steps become briefs, email steps
  // stay scripted. Registered append-only beside v2/v3.
  registerPrompt({
    name: PLANNER_PROMPT_NAME,
    version: PLANNER_PROMPT_VERSION_GUIDED,
    template:
      head +
      `- {{stepCount}} "step" nodes. Email steps: content has "subject" and "body"; use {{tokens}} in the body (and subject where natural). Sms steps: mode "guided" with a "brief" (objective + 3-6 talkingPoints + optional mustSay/neverSay) and EMPTY content — no subject, no body, no merge tokens (the composer writes per-lead copy at send time).\n` +
      tail,
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
}, guided = false): string {
  ensureRegistered();
  // G1 (DEC-068): guided agents render v4; scripted agents keep v3 verbatim.
  return renderPrompt(
    PLANNER_PROMPT_NAME,
    guided ? PLANNER_PROMPT_VERSION_GUIDED : PLANNER_PROMPT_VERSION,
    vars,
  );
}
