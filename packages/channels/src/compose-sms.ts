/**
 * Guided SMS composer (G1, DEC-070). A guided step carries a BRIEF (talking
 * points, never finished copy); this module renders the real message per lead
 * at send/reply/preview time on the `copy` route (Sonnet-class), then proves
 * the output with DETERMINISTIC checks — ban lists, mustSay, length, merge-
 * token integrity, URL grounding. One bounded retry carries the named
 * violations back to the model; still dirty → typed `ComposeRefusedError`.
 * Never a silent skip, never an unchecked send.
 *
 * Composition happens BEFORE the send boundary: `sendSmsStep`'s rails
 * (opt-out line, suppression, caps, windows, allow-list) neither know nor
 * care who wrote the copy.
 *
 * Grounding contract (the planner's DEC-015 rule, ported): every factual
 * claim comes from the provided business context or the brief — never model
 * priors; URLs outside that material refuse the send.
 */
import { registerPrompt, renderPrompt, type AiGateway } from "@clientforce/ai";
import { loadMergedContextText } from "@clientforce/context";
import { parseGuardrails, selectStrategy, type StepBrief } from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import { z } from "zod";

// ── Versioning ───────────────────────────────────────────────────────────────
export const COMPOSER_PROMPT_NAME = "composer.sms";
export const COMPOSER_PROMPT_VERSION = 1;
/** Persisted into `Message.meta.composerVersion` on every guided send (A6). */
export const COMPOSER_VERSION = `${COMPOSER_PROMPT_NAME}@v${COMPOSER_PROMPT_VERSION}`;

// ── Channel constraints (segment-aware: 1 GSM-7 segment = 160 chars) ─────────
export const SMS_COMPOSE_TARGET_CHARS = 160;
/** Hard cap — the planner's existing sms literal ("body ≤ 300 characters"). */
export const SMS_COMPOSE_MAX_CHARS = 300;

// ── Typed refusal ────────────────────────────────────────────────────────────
export type ComposeRefusalReason =
  | "COMPOSER_UNCONFIGURED"
  | "NEVER_SAY_VIOLATION"
  | "MUST_SAY_MISSING"
  | "TOO_LONG"
  | "TOKEN_SYNTAX"
  | "UNGROUNDED_URL";

/** Composition failed its deterministic checks after the bounded retry. */
export class ComposeRefusedError extends Error {
  constructor(
    readonly reason: ComposeRefusalReason,
    readonly detail: string,
  ) {
    super(`Compose refused (${reason}): ${detail}`);
    this.name = "ComposeRefusedError";
  }
}

// ── Inputs ───────────────────────────────────────────────────────────────────
export interface ComposeLead {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  /** C2.7 custom field values (string values only are rendered). */
  custom?: Record<string, unknown> | null;
}

export interface ComposeHistoryLine {
  channel: string;
  direction: "OUTBOUND" | "INBOUND";
  text: string;
}

export interface ComposeSmsInputs {
  brief: StepBrief;
  /**
   * Cache-stable per agent (business context + tone + owner strategy notes):
   * rides the gateway's `cachedContext` system block so a fan-out of leads
   * reuses the cached prefix — only the per-lead prompt is new tokens.
   */
  cachedContext: string;
  /** Deterministic ban list: agent `strategy.neverSay` ∪ `brief.neverSay`. */
  neverSay: string[];
  lead: ComposeLead;
  /** Oldest-first recent conversation (both directions, email + sms). */
  history: ComposeHistoryLine[];
  /** True when no outbound SMS exists yet for this enrollment — the boundary
   *  will append the opt-out line, so the prompt reserves room for it. */
  firstTouch: boolean;
}

export interface ComposedSms {
  body: string;
  composerVersion: string;
  /** 1 = clean first pass; 2 = the bounded retry produced the clean text. */
  attempts: number;
}

// ── Deterministic post-compose checks (pure — send path AND preview) ─────────
export interface ComposeViolation {
  reason: Exclude<ComposeRefusalReason, "COMPOSER_UNCONFIGURED">;
  detail: string;
}

const TOKEN_SYNTAX_RE = /\{\{[^}]*\}\}/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s"'<>()\]]+/gi;

const stripTrailingPunct = (u: string) => u.replace(/[.,;:!?]+$/, "");

/**
 * Every check is a string operation — no model in the loop. Violations come
 * back named so the retry prompt (and the refusal detail) can say exactly
 * what to fix.
 */
export function checkComposedSms(text: string, inputs: ComposeSmsInputs): ComposeViolation[] {
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

  // 2 · mustSay — each required string present verbatim (case-insensitive).
  const missing = (inputs.brief.mustSay ?? [])
    .map((t) => t.trim())
    .filter((t) => t && !lower.includes(t.toLowerCase()));
  if (missing.length > 0) {
    violations.push({
      reason: "MUST_SAY_MISSING",
      detail: `missing required string(s): ${missing.map((t) => `"${t}"`).join(", ")}`,
    });
  }

  // 3 · Length — hard cap (the boundary may still append the opt-out line).
  if (text.length > SMS_COMPOSE_MAX_CHARS) {
    violations.push({
      reason: "TOO_LONG",
      detail: `${text.length} chars — the hard cap is ${SMS_COMPOSE_MAX_CHARS}`,
    });
  }

  // 4 · Merge-token integrity — composed text is FINISHED copy: zero {{…}}
  // syntax, so a half-baked token can never render blank or leak downstream.
  const token = text.match(TOKEN_SYNTAX_RE);
  if (token) {
    violations.push({
      reason: "TOKEN_SYNTAX",
      detail: `contains unresolved merge-token syntax ${token[0]} — write the lead's real details instead`,
    });
  }

  // 5 · URL grounding — every URL must appear verbatim in the provided
  // context or the brief; anything else is an invented link.
  const allowedMaterial = `${inputs.cachedContext}\n${inputs.brief.objective}\n${inputs.brief.talkingPoints.join(
    "\n",
  )}\n${(inputs.brief.mustSay ?? []).join("\n")}`.toLowerCase();
  const urls = text.match(URL_RE) ?? [];
  const foreign = urls
    .map(stripTrailingPunct)
    .filter((u) => !allowedMaterial.includes(u.toLowerCase()));
  if (foreign.length > 0) {
    violations.push({
      reason: "UNGROUNDED_URL",
      detail: `URL(s) not present in the business context or brief: ${foreign.join(", ")}`,
    });
  }

  return violations;
}

// ── Prompt (versioned in the P1.1 registry — append-only) ────────────────────
/**
 * STATIC system prompt — never interpolate per-agent or per-lead material
 * here: it is the first block of the provider cache prefix.
 */
export const COMPOSER_SYSTEM =
  "You compose ONE outbound SMS for a sales agent, personalized to one specific lead.\n" +
  "HARD RULES:\n" +
  "(1) Every factual claim, offer, price, or link must come from the BUSINESS CONTEXT block or the step " +
  "brief — never invent facts, never use model knowledge about the company.\n" +
  "(2) Write FINISHED copy using the lead's real details — never merge tokens, placeholders, or brackets " +
  "to fill in later.\n" +
  "(3) Never write opt-out or unsubscribe language (STOP instructions) — the platform appends the " +
  "compliant line itself.\n" +
  "(4) Include a URL only if it appears verbatim in the business context or the brief.\n" +
  "(5) One clear ask per message. Plain text only — no emojis, no ALL CAPS, no exclamation marks.\n" +
  "(6) Sound like a competent human texting, not a template: specific, casual-professional, and different " +
  "for every lead — two leads must never receive the same sentence.\n" +
  "(7) Respect the step brief exactly: achieve its objective, draw only from its talking points, include " +
  'every "must say" string verbatim, and never use any "never say" string in any casing.';

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerPrompt({
    name: COMPOSER_PROMPT_NAME,
    version: COMPOSER_PROMPT_VERSION,
    template: `Compose the SMS for this lead now.

STEP BRIEF (what this message must achieve):
- Objective: {{objective}}
- Talking points (facts to draw from — pick what fits this lead, never paste as-is):
{{talkingPoints}}
- Must say verbatim: {{mustSay}}
- Never say (hard ban, any casing): {{neverSay}}

LEAD:
{{lead}}

CONVERSATION SO FAR (oldest first):
{{history}}

CONSTRAINTS:
- Aim for at most {{targetChars}} characters; NEVER exceed {{maxChars}}.
- {{firstTouchNote}}`,
  });
}

const composeOutputSchema = z.object({
  /** The finished SMS text — nothing else. */
  body: z.string().min(1),
});

function renderLead(lead: ComposeLead): string {
  const custom = Object.entries(lead.custom ?? {})
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "")
    .map(([k, v]) => `- ${k}: ${v}`);
  const lines = [
    `- First name: ${lead.firstName?.trim() || "(unknown)"}`,
    `- Last name: ${lead.lastName?.trim() || "(unknown)"}`,
    `- Company: ${lead.company?.trim() || "(unknown)"}`,
    ...(lead.title?.trim() ? [`- Title: ${lead.title.trim()}`] : []),
    ...custom,
  ];
  return lines.join("\n");
}

function renderHistory(history: ComposeHistoryLine[]): string {
  if (history.length === 0) {
    return "(first touch — no prior messages; identify the business naturally)";
  }
  return history
    .map((h) => `- [${h.channel} · ${h.direction === "OUTBOUND" ? "we sent" : "they replied"}] ${h.text}`)
    .join("\n");
}

function renderComposerPrompt(inputs: ComposeSmsInputs): string {
  ensureRegistered();
  return renderPrompt(COMPOSER_PROMPT_NAME, COMPOSER_PROMPT_VERSION, {
    objective: inputs.brief.objective,
    talkingPoints: inputs.brief.talkingPoints.map((p) => `  - ${p}`).join("\n"),
    mustSay: (inputs.brief.mustSay ?? []).length
      ? inputs.brief.mustSay!.map((t) => `"${t}"`).join(", ")
      : "(none)",
    neverSay: inputs.neverSay.length
      ? inputs.neverSay.map((t) => `"${t}"`).join(", ")
      : "(none)",
    lead: renderLead(inputs.lead),
    history: renderHistory(inputs.history),
    targetChars: SMS_COMPOSE_TARGET_CHARS,
    maxChars: SMS_COMPOSE_MAX_CHARS,
    firstTouchNote: inputs.firstTouch
      ? 'This is the enrollment\'s first SMS: the platform appends "Reply STOP to opt out." after your text — keep it short enough to leave room, and never write your own opt-out line.'
      : "This continues an existing thread — do not re-introduce the business.",
  });
}

// ── The composer ─────────────────────────────────────────────────────────────
/**
 * Compose → deterministic checks → ONE bounded retry (the model sees its own
 * text + the named violations) → typed refusal. The gateway's own schema
 * repair handles malformed tool output; this retry is for CONTENT violations.
 */
export async function composeSms(gateway: AiGateway, inputs: ComposeSmsInputs): Promise<ComposedSms> {
  const prompt = renderComposerPrompt(inputs);
  const request = { system: COMPOSER_SYSTEM, cachedContext: inputs.cachedContext, maxTokens: 512 };

  const first = await gateway.completeStructured(
    "copy",
    { ...request, prompt },
    composeOutputSchema,
  );
  const firstBody = first.body.trim();
  const firstViolations = checkComposedSms(firstBody, inputs);
  if (firstViolations.length === 0) {
    return { body: firstBody, composerVersion: COMPOSER_VERSION, attempts: 1 };
  }

  const retry = await gateway.completeStructured(
    "copy",
    {
      ...request,
      prompt:
        `${prompt}\n\n---\nYour previous SMS FAILED its checks.\n` +
        `Previous SMS:\n"""\n${firstBody}\n"""\n` +
        `Violations:\n${firstViolations.map((v) => `- ${v.reason}: ${v.detail}`).join("\n")}\n` +
        `Rewrite the SMS fixing every violation.`,
    },
    composeOutputSchema,
  );
  const retryBody = retry.body.trim();
  const retryViolations = checkComposedSms(retryBody, inputs);
  if (retryViolations.length === 0) {
    return { body: retryBody, composerVersion: COMPOSER_VERSION, attempts: 2 };
  }
  throw new ComposeRefusedError(
    retryViolations[0]!.reason,
    retryViolations.map((v) => v.detail).join("; "),
  );
}

// ── Step-level wiring (loads context/lead/history; used by worker + api) ─────
export interface ComposeStepParams {
  workspaceId: string;
  agentId: string;
  campaignId: string;
  contactId: string;
  enrollmentId?: string;
  stepNodeId: string;
  brief: StepBrief;
}

/** The seam the workflow activity injects — worker builds it with its real
 *  gateway; absent → the activity refuses typed (COMPOSER_UNCONFIGURED). */
export type SmsStepComposer = (params: ComposeStepParams) => Promise<ComposedSms>;

/** How much recent conversation the composer sees (the classifier's number). */
const HISTORY_TAKE = 10;

/**
 * Build the per-agent cacheable block: business context + derived tone +
 * owner strategy notes. Stable across every lead of one agent by
 * construction — the provider cache prefix depends on it.
 */
function buildCachedContext(args: {
  contextText: string;
  toneHints: string;
  strategyNotes?: string;
}): string {
  return [
    "BUSINESS CONTEXT (the ONLY permitted source of facts — cite-worthy values distilled from the company's own materials):",
    args.contextText,
    "",
    `TONE: ${args.toneHints}`,
    ...(args.strategyNotes?.trim() ? [`OWNER STRATEGY NOTES: ${args.strategyNotes.trim()}`] : []),
  ].join("\n");
}

export function createSmsStepComposer(deps: {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  gateway: AiGateway;
}): SmsStepComposer {
  return async (params) => {
    const { prisma, gateway } = deps;
    const ctx = { workspaceId: params.workspaceId };

    const [agent, contact, contextText] = await Promise.all([
      withTenant(prisma, ctx, (tx) => tx.agent.findUnique({ where: { id: params.agentId } })),
      withTenant(prisma, ctx, (tx) => tx.contact.findUnique({ where: { id: params.contactId } })),
      loadMergedContextText(prisma, { workspaceId: params.workspaceId, agentId: params.agentId }),
    ]);
    if (!agent) throw new Error(`Agent ${params.agentId} not found`);
    if (!contact) throw new Error(`Contact ${params.contactId} not found`);
    // DEC-015 ported: no context, no grounded copy — refuse, never wing it.
    if (!contextText) {
      throw new ComposeRefusedError(
        "COMPOSER_UNCONFIGURED",
        "BusinessContext is empty — the composer only writes grounded copy",
      );
    }

    const strategy = strategyOf(agent.goal, agent.category, agent.guardrails);
    const [historyRows, priorSms] = await withTenant(prisma, ctx, (tx) =>
      Promise.all([
        tx.message.findMany({
          where: {
            workspaceId: params.workspaceId,
            campaignId: params.campaignId,
            contactId: params.contactId,
            channel: { in: ["email", "sms"] },
          },
          orderBy: { sentAt: "desc" },
          take: HISTORY_TAKE,
        }),
        tx.message.findFirst({
          where: {
            workspaceId: params.workspaceId,
            campaignId: params.campaignId,
            contactId: params.contactId,
            ...(params.enrollmentId ? { enrollmentId: params.enrollmentId } : {}),
            channel: "sms",
            direction: "OUTBOUND",
          },
        }),
      ]),
    );

    const inputs: ComposeSmsInputs = {
      brief: params.brief,
      cachedContext: buildCachedContext({
        contextText,
        toneHints: strategy.toneHints,
        strategyNotes: strategy.strategyNotes,
      }),
      neverSay: [...strategy.neverSay, ...(params.brief.neverSay ?? [])],
      lead: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company,
        title: contact.title,
        custom:
          contact.custom && typeof contact.custom === "object" && !Array.isArray(contact.custom)
            ? (contact.custom as Record<string, unknown>)
            : null,
      },
      history: historyRows
        .reverse()
        .map((m) => ({
          channel: m.channel,
          direction: m.direction as "OUTBOUND" | "INBOUND",
          text: `${m.subject ? `${m.subject} — ` : ""}${m.body}`.slice(0, 300),
        })),
      firstTouch: !priorSms,
    };
    return composeSms(gateway, inputs);
  };
}

/**
 * Sample preview (G1 UI): compose a guided brief against the FIXED sample
 * lead through the REAL checks — no contact row, no consent implications,
 * empty history (first touch). Free at launch; metering is Q-020.
 */
export const SAMPLE_LEAD: ComposeLead = {
  firstName: "Jane",
  lastName: "Doe",
  company: "Acme Dental",
  title: "Practice manager",
};

export async function composeSampleSms(
  deps: { prisma: PrismaClient; gateway: AiGateway },
  params: { workspaceId: string; agentId: string; brief: StepBrief },
): Promise<ComposedSms> {
  const [agent, contextText] = await Promise.all([
    withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.agent.findUnique({ where: { id: params.agentId } }),
    ),
    loadMergedContextText(deps.prisma, {
      workspaceId: params.workspaceId,
      agentId: params.agentId,
    }),
  ]);
  if (!agent) throw new Error(`Agent ${params.agentId} not found`);
  if (!contextText) {
    throw new ComposeRefusedError(
      "COMPOSER_UNCONFIGURED",
      "BusinessContext is empty — the composer only writes grounded copy",
    );
  }
  const strategy = strategyOf(agent.goal, agent.category, agent.guardrails);
  return composeSms(deps.gateway, {
    brief: params.brief,
    cachedContext: buildCachedContext({
      contextText,
      toneHints: strategy.toneHints,
      strategyNotes: strategy.strategyNotes,
    }),
    neverSay: [...strategy.neverSay, ...(params.brief.neverSay ?? [])],
    lead: SAMPLE_LEAD,
    history: [],
    firstTouch: true,
  });
}

/** Agent-stable composer inputs from goal/category/guardrails — lenient like
 *  the planner's rider read: an unparsable row composes with defaults. */
function strategyOf(
  goal: string | null | undefined,
  category: string | null | undefined,
  guardrails: unknown,
): { toneHints: string; strategyNotes?: string; neverSay: string[] } {
  const { toneHints } = selectStrategy(goal, category);
  try {
    const block = parseGuardrails(guardrails).strategy;
    return { toneHints, strategyNotes: block?.strategyNotes, neverSay: block?.neverSay ?? [] };
  } catch {
    return { toneHints, neverSay: [] };
  }
}
