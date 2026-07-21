/**
 * The guided VOICE composer (P3.1, DEC-078) — G1's brief contract carried to
 * the real-time call loop. Voice differs from sms/email structurally: there
 * is no one-shot compose. The BRIEF + business context + spoken-register
 * rules ride the call's SYSTEM prompt (`composer.voice@v1`, versioned in the
 * P1.1 registry), every turn streams through the gateway's `voice` route, and
 * the deterministic checks run PER SENTENCE before TTS — a tripped check
 * aborts the turn to the constant fallback line and emits
 * `voice.compose_refused.v1` (a live call can't pause like an enrollment).
 *
 * mustSay is call-level, not per-turn: a required string is woven in over the
 * conversation, so coverage is measured against the whole transcript and
 * recorded in `Call.meta` — never a mid-call refusal.
 */
import { registerPrompt, renderPrompt } from "@clientforce/ai";
import {
  BRIEF_TALKING_POINTS_MAX,
  BRIEF_TALKING_POINTS_MIN,
  type StepBrief,
} from "@clientforce/core";
import {
  renderLead,
  stripTrailingPunct,
  TOKEN_SYNTAX_RE,
  URL_RE,
  type ComposeLead,
  type ComposeViolation,
} from "./compose-shared";

// ── Versioning ───────────────────────────────────────────────────────────────
export const COMPOSER_VOICE_PROMPT_NAME = "composer.voice";
export const COMPOSER_VOICE_PROMPT_VERSION = 1;
/** Persisted into `Message.meta.composerVersion` on every outbound turn (A6). */
export const COMPOSER_VOICE_VERSION = `${COMPOSER_VOICE_PROMPT_NAME}@v${COMPOSER_VOICE_PROMPT_VERSION}`;

/** Spoken turns stay short — the prompt demands ≤2 short sentences; this is
 *  the deterministic backstop (~2 long sentences of speech). */
export const VOICE_TURN_MAX_CHARS = 400;

/**
 * The constant fallback line spoken when a composed turn trips its checks —
 * a CONSTANT, never composed (the same discipline as the disclosure).
 */
export const VOICE_FALLBACK_LINE =
  "Sorry, let me put that differently — what would be most useful for me to cover?";

/**
 * The constant goodbye when a provider fails mid-call (typed refusal — the
 * call ends gracefully, never a hung line).
 */
export const VOICE_FAILURE_GOODBYE =
  "I'm sorry, I'm having technical trouble on my end. I'll let you go — thanks for your time.";

// ── Inputs ───────────────────────────────────────────────────────────────────
export interface ComposeVoiceInputs {
  brief: StepBrief;
  /** Cache-stable per agent: business context + tone + owner strategy notes
   *  (`buildCachedContext`) — embedded in the system prompt for the call. */
  cachedContext: string;
  /** Deterministic ban list: agent `strategy.neverSay` ∪ `brief.neverSay`. */
  neverSay: string[];
  lead: ComposeLead;
  businessName: string;
  /** Resolved via the locked chain (agent → workspace → null). Deterministic
   *  input — the model never invents a name. */
  spokenName: string | null;
}

// ── Deterministic per-turn checks (pure — run per sentence, pre-TTS) ─────────
/**
 * Every check is a string operation — no model in the loop. Unlike sms/email
 * there is no bounded retry: the turn already streams to a live caller, so a
 * violation swaps in the constant fallback line instead.
 */
export function checkComposedVoiceTurn(
  text: string,
  inputs: Pick<ComposeVoiceInputs, "neverSay">,
): ComposeViolation[] {
  const violations: ComposeViolation[] = [];
  const lower = text.toLowerCase();

  // 1 · Ban lists (agent strategy ∪ brief) — compliance first.
  const banHits = inputs.neverSay
    .map((t) => t.trim())
    .filter((t) => t && lower.includes(t.toLowerCase()));
  if (banHits.length > 0) {
    violations.push({
      reason: "NEVER_SAY_VIOLATION",
      detail: `contains banned phrase(s): ${banHits.map((t) => `"${t}"`).join(", ")}`,
    });
  }

  // 2 · Merge-token integrity — spoken text is FINISHED speech.
  const token = text.match(TOKEN_SYNTAX_RE);
  if (token) {
    violations.push({
      reason: "TOKEN_SYNTAX",
      detail: `contains unresolved merge-token syntax ${token[0]}`,
    });
  }

  // 3 · Spoken register — URLs are NEVER read aloud (grounded or not), and
  // TTS must never receive markdown/list formatting or emoji.
  const urls = (text.match(URL_RE) ?? []).map(stripTrailingPunct);
  if (urls.length > 0) {
    violations.push({
      reason: "SPOKEN_REGISTER",
      detail: `URL(s) in a spoken turn: ${urls.join(", ")} — links are never read aloud`,
    });
  }
  if (/(^|\n)\s*([-*•]|\d+\.)\s+/m.test(text) || /[*_#`~]{2}|^#{1,6}\s/m.test(text)) {
    violations.push({
      reason: "SPOKEN_REGISTER",
      detail: "markdown/list formatting in a spoken turn",
    });
  }
  if (/\p{Extended_Pictographic}/u.test(text)) {
    violations.push({ reason: "SPOKEN_REGISTER", detail: "emoji in a spoken turn" });
  }

  // 4 · Length backstop — the prompt demands ≤2 short sentences.
  if (text.length > VOICE_TURN_MAX_CHARS) {
    violations.push({
      reason: "TOO_LONG",
      detail: `${text.length} chars — the spoken-turn backstop is ${VOICE_TURN_MAX_CHARS}`,
    });
  }

  return violations;
}

/**
 * Call-level mustSay coverage — measured against the WHOLE transcript's
 * outbound turns and recorded in `Call.meta.mustSay`; never a mid-call
 * refusal (a required string is woven in over the conversation).
 */
export function mustSayCoverage(
  outboundTurns: string[],
  brief: Pick<StepBrief, "mustSay">,
): { said: string[]; missing: string[] } {
  const all = outboundTurns.join("\n").toLowerCase();
  const said: string[] = [];
  const missing: string[] = [];
  for (const raw of brief.mustSay ?? []) {
    const t = raw.trim();
    if (!t) continue;
    (all.includes(t.toLowerCase()) ? said : missing).push(t);
  }
  return { said, missing };
}

// ── Prompt (versioned in the P1.1 registry — append-only) ────────────────────
/**
 * STATIC register rules — the first block of the system prompt, never
 * interpolated (G1 discipline).
 */
export const COMPOSER_VOICE_SYSTEM =
  "You are an AI assistant on a LIVE PHONE CALL — every reply is spoken aloud by TTS.\n" +
  "HARD RULES:\n" +
  "(1) At most TWO short sentences per reply — plain conversational words, like a competent human on the phone.\n" +
  "(2) No lists, no markdown, no emoji, no formatting of any kind — this is speech.\n" +
  "(3) NEVER read a URL, email address, or code aloud, and never spell things out unless asked — offer that the team can text or email details instead.\n" +
  "(4) Every factual claim, offer, or price must come from the BUSINESS CONTEXT block or the call brief — never invent facts, never use model knowledge about the company.\n" +
  "(5) You are an AI assistant and the call opened saying so — if asked, confirm it plainly and continue.\n" +
  "(6) Respect the call brief: work toward its objective, draw only from its talking points, weave every \"must say\" string in naturally over the call, and never use any \"never say\" string in any casing.\n" +
  "(7) If the caller asks you to stop calling, wants out, or says it's a bad time — acknowledge, thank them, and say goodbye. Never argue, never push past a no.";

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerPrompt({
    name: COMPOSER_VOICE_PROMPT_NAME,
    version: COMPOSER_VOICE_PROMPT_VERSION,
    template: `THIS CALL:
- You are speaking on behalf of {{businessName}}.
- {{identityLine}}
- The opening disclosure has ALREADY been spoken by the platform — do not repeat it; continue the conversation from the caller's answer.

CALL BRIEF (what this call must achieve):
- Objective: {{objective}}
- Talking points (facts to draw from — use what fits the conversation, never recite):
{{talkingPoints}}
- Must say naturally at some point during the call: {{mustSay}}
- Never say (hard ban, any casing): {{neverSay}}

WHO YOU ARE CALLING:
{{lead}}

{{businessContext}}`,
  });
}

/**
 * Build the per-call system prompt: static register rules + the rendered
 * `composer.voice@v1` call block. Deterministic — same inputs, same prompt.
 */
export function buildVoiceSystemPrompt(inputs: ComposeVoiceInputs): string {
  ensureRegistered();
  const rendered = renderPrompt(COMPOSER_VOICE_PROMPT_NAME, COMPOSER_VOICE_PROMPT_VERSION, {
    businessName: inputs.businessName,
    identityLine: inputs.spokenName
      ? `Your name on this call is ${inputs.spokenName}.`
      : "You have no personal name on this call — you are simply the AI assistant.",
    objective: inputs.brief.objective,
    talkingPoints: inputs.brief.talkingPoints.map((p) => `  - ${p}`).join("\n"),
    mustSay: (inputs.brief.mustSay ?? []).length
      ? inputs.brief.mustSay!.map((t) => `"${t}"`).join(", ")
      : "(none)",
    neverSay: inputs.neverSay.length
      ? inputs.neverSay.map((t) => `"${t}"`).join(", ")
      : "(none)",
    lead: renderLead(inputs.lead),
    businessContext: inputs.cachedContext,
  });
  return `${COMPOSER_VOICE_SYSTEM}\n\n${rendered}`;
}

// ── Call-brief derivation (until P3.2 puts voice nodes in graphs) ────────────
/**
 * Derive the call brief from the agent itself (goal + strategy + distilled
 * context facts) — the `deriveBriefSeed` precedent applied at agent level.
 * Deterministic: same agent state, same brief.
 */
export function deriveCallBrief(args: {
  goal: string;
  goalLabel?: string;
  strategyNotes?: string;
  /** Cite-worthy fact lines from the distilled BusinessContext. */
  contextFacts: string[];
  neverSay?: string[];
}): StepBrief {
  const objective = (args.goalLabel?.trim() || args.goal.trim() || "Move this lead one step closer to the goal").slice(0, 200);
  const points = args.contextFacts
    .map((f) => f.trim())
    .filter((f) => f.length >= 10)
    .map((f) => (f.length > 200 ? `${f.slice(0, 199)}…` : f));
  const talkingPoints = [...new Set(points)].slice(0, BRIEF_TALKING_POINTS_MAX);
  while (talkingPoints.length < BRIEF_TALKING_POINTS_MIN) {
    // Pad with strategy guidance so the zod minimum holds even on thin
    // context — honest generics, never invented facts.
    const pad = [
      "Ask what the caller is working on before pitching anything",
      "Gauge interest in a short follow-up conversation",
      args.strategyNotes?.trim() || "Offer to have the team send details afterwards",
    ][talkingPoints.length % 3]!;
    if (talkingPoints.includes(pad)) break;
    talkingPoints.push(pad);
  }
  return {
    objective,
    talkingPoints,
    ...(args.neverSay?.length ? { neverSay: args.neverSay.slice(0, 10) } : {}),
  };
}
