/**
 * Guided EMAIL composer (G2, DEC-071) — G1's brief contract ported to email.
 * A guided step carries a BRIEF (objective + talking points + optional
 * subjectHint, never finished copy); this module renders a real subject +
 * body per lead at send/preview time on the `copy` route (Sonnet-class),
 * then proves the output with DETERMINISTIC checks — the full G1 set plus
 * the email-specific rails: subject rules (length · playbook banned
 * patterns · ALL-CAPS · exclamation · faux thread prefix) and the footer
 * ban (the boundary appends the CAN-SPAM footer; a composed unsubscribe
 * line is itself a check failure). One bounded retry carries the named
 * violations back to the model; still dirty → typed `ComposeRefusedError`.
 * Never a silent skip, never an unchecked send.
 *
 * Arc-role aware (M1a): the step's main-sequence position maps onto the
 * agent's strategy arc ladder — opener/value/breakup rules ride the prompt,
 * so composed output plays the same role scripted copy would.
 *
 * Composition happens BEFORE the send boundary: `sendStep`'s rails
 * (guardrails, suppression, from-name, tokens, REAL threading, the
 * company_address + unsubscribe footer) neither know nor care who wrote
 * the copy.
 */
import { registerPrompt, renderPrompt, type AiGateway } from "@clientforce/ai";
import { loadMergedContextText } from "@clientforce/context";
import {
  BANNED_OPENERS,
  BANNED_SUBJECT_PATTERNS,
  DEFAULT_LANGUAGE,
  languagePromptLabel,
  OPENER_WORD_CAP,
  selectStrategy,
  type LanguageCode,
  type StepBrief,
} from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import { z } from "zod";
import { augmentBriefWithBooking, type BookingSlotsLine } from "./booking-link";
import {
  buildCachedContext,
  ComposeRefusedError,
  HISTORY_TAKE,
  renderHistory,
  renderLead,
  SAMPLE_LEAD,
  strategyOf,
  stripTrailingPunct,
  TOKEN_SYNTAX_RE,
  URL_RE,
  type ComposeHistoryLine,
  type ComposeLead,
  type ComposeViolation,
} from "./compose-shared";
import { hasThreadPrefix } from "./render";

// The module's error contract lives in ./compose-shared (one class for both
// channel composers) — re-exported so call sites can import it from here.
export { ComposeRefusedError } from "./compose-shared";

// ── Versioning ───────────────────────────────────────────────────────────────
export const COMPOSER_EMAIL_PROMPT_NAME = "composer.email";
export const COMPOSER_EMAIL_PROMPT_VERSION = 1;
// L1 (DEC-072): non-English agents compose on v2 — v1 plus the language
// constraint (the composer.sms@v2 treatment mirrored). English agents keep
// rendering v1 byte-identical.
export const COMPOSER_EMAIL_PROMPT_VERSION_LANGUAGE = 2;
/** Persisted into `Message.meta.composerVersion` on every guided send (A6). */
export const COMPOSER_EMAIL_VERSION = `${COMPOSER_EMAIL_PROMPT_NAME}@v${COMPOSER_EMAIL_PROMPT_VERSION}`;
/** The honest per-language provenance stamp — @v1 for English, @v2 otherwise. */
export const composerEmailVersionFor = (language: LanguageCode): string =>
  language === "en"
    ? COMPOSER_EMAIL_VERSION
    : `${COMPOSER_EMAIL_PROMPT_NAME}@v${COMPOSER_EMAIL_PROMPT_VERSION_LANGUAGE}`;

// ── Channel constraints (the planner's own email literals, DEC-071) ─────────
/** The planner's scripted rule is "subject ≤60 chars" — composed output too. */
export const EMAIL_SUBJECT_MAX_CHARS = 60;
/** The planner's scripted rule is "body 60–140 words" — 140 is the hard cap. */
export const EMAIL_COMPOSE_MAX_WORDS = 140;
export const EMAIL_COMPOSE_TARGET_WORDS = 120;

/**
 * Footer/unsubscribe language a composed email may NEVER carry — the boundary
 * appends the compliant CAN-SPAM footer (company_address + unsubscribe link)
 * itself, exactly once; composed copy that writes its own would double it.
 */
export const COMPOSED_FOOTER_PATTERNS: readonly RegExp[] = [
  /unsubscribe/i,
  /opt[\s-]?out/i,
  /stop receiving/i,
  /remove (?:me|yourself) from/i,
];

// ── The step's arc role (M1a ladder, positional) ─────────────────────────────
export interface ComposeArcRole {
  /** 1-based position among MAIN-sequence steps. */
  index: number;
  count: number;
  /** The resolved role line from the agent's strategy arc ladder. */
  role: string;
}

/**
 * Position → role line, the planner's fold rule: first = OPENER, last =
 * BREAKUP (never dropped), middle steps walk the ladder's middle (a 3-step
 * sequence folds OBJECTION-PREEMPT into VALUE exactly like planned copy).
 */
export function arcRoleFor(
  roles: readonly string[],
  position: { index: number; count: number },
): string {
  if (position.index <= 1) return roles[0]!;
  if (position.index >= position.count) return roles[roles.length - 1]!;
  return roles[Math.min(position.index - 1, roles.length - 2)]!;
}

// ── Inputs / outputs ─────────────────────────────────────────────────────────
export interface ComposeEmailInputs {
  brief: StepBrief;
  /** Cache-stable per agent — rides the gateway's `cachedContext` block. */
  cachedContext: string;
  /** Deterministic ban list: agent `strategy.neverSay` ∪ `brief.neverSay`. */
  neverSay: string[];
  lead: ComposeLead;
  /** Oldest-first recent conversation (both directions, email + sms). */
  history: ComposeHistoryLine[];
  /** The step's M1a playbook role (main-sequence steps; undefined = role-free). */
  arcRole?: ComposeArcRole;
  /** The step continues the thread — the boundary threads it onto the real
   *  prior message (owner rule 3); the prompt adjusts tone accordingly. */
  threaded?: boolean;
  /** L1 (DEC-072): the agent's output language — absent = English (v1 prompt,
   *  byte-identical). Non-English selects the v2 prompt: subject AND body in
   *  the agent's language; the boundary appends its own in-language footer. */
  language?: LanguageCode;
}

export interface ComposedEmail {
  subject: string;
  body: string;
  composerVersion: string;
  /** 1 = clean first pass; 2 = the bounded retry produced the clean text. */
  attempts: number;
}

// ── Deterministic post-compose checks (pure — send path AND preview) ─────────
const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The G1 check set on subject+body, plus the email rails. Every check is a
 * string operation — no model in the loop; violations come back named so the
 * retry prompt (and the refusal detail) can say exactly what to fix.
 */
export function checkComposedEmail(
  subject: string,
  body: string,
  inputs: ComposeEmailInputs,
): ComposeViolation[] {
  const violations: ComposeViolation[] = [];
  const combined = `${subject}\n${body}`;
  const lower = combined.toLowerCase();

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

  // 3 · Length — the planner's email literal is the hard cap.
  const words = countWords(body);
  if (words > EMAIL_COMPOSE_MAX_WORDS) {
    violations.push({
      reason: "TOO_LONG",
      detail: `body is ${words} words — the hard cap is ${EMAIL_COMPOSE_MAX_WORDS}`,
    });
  }

  // 4 · Merge-token integrity — composed text is FINISHED copy: zero {{…}}.
  const token = combined.match(TOKEN_SYNTAX_RE);
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
  )}\n${(inputs.brief.mustSay ?? []).join("\n")}\n${inputs.brief.subjectHint ?? ""}`.toLowerCase();
  const urls = combined.match(URL_RE) ?? [];
  const foreign = urls
    .map(stripTrailingPunct)
    .filter((u) => !allowedMaterial.includes(u.toLowerCase()));
  if (foreign.length > 0) {
    violations.push({
      reason: "UNGROUNDED_URL",
      detail: `URL(s) not present in the business context or brief: ${foreign.join(", ")}`,
    });
  }

  // 6 · Subject rules (G2) — the playbook's subject discipline, deterministic:
  // present · ≤60 chars · no exclamation · not ALL-CAPS · no faux "Re:"/"Fwd:"
  // (real threading is the boundary's job, owner rule 3) · no banned pattern.
  const subjectProblems: string[] = [];
  if (!subject.trim()) subjectProblems.push("subject is empty");
  if (subject.length > EMAIL_SUBJECT_MAX_CHARS) {
    subjectProblems.push(`${subject.length} chars — the cap is ${EMAIL_SUBJECT_MAX_CHARS}`);
  }
  if (subject.includes("!")) subjectProblems.push("contains an exclamation mark");
  if (/[A-Z]/.test(subject) && !/[a-z]/.test(subject) && subject.trim().length > 3) {
    subjectProblems.push("is ALL CAPS");
  }
  if (hasThreadPrefix(subject)) {
    subjectProblems.push('carries a "Re:"/"Fwd:" prefix — threading is the platform\'s job');
  }
  const subjectLower = subject.toLowerCase();
  const bannedHits = BANNED_SUBJECT_PATTERNS.filter((p) => subjectLower.includes(p.toLowerCase()));
  if (bannedHits.length > 0) {
    subjectProblems.push(`contains banned pattern(s): ${bannedHits.map((p) => `"${p}"`).join(", ")}`);
  }
  if (subjectProblems.length > 0) {
    violations.push({ reason: "SUBJECT_RULE", detail: subjectProblems.join("; ") });
  }

  // 7 · Footer ban (G2) — the footer is the boundary's job, forever. A
  // composed unsubscribe/opt-out line would render it twice.
  const footerHit = COMPOSED_FOOTER_PATTERNS.find((re) => re.test(combined));
  if (footerHit) {
    violations.push({
      reason: "COMPOSED_FOOTER",
      detail: `contains footer/opt-out language (${String(footerHit)}) — the platform appends the compliant unsubscribe footer itself`,
    });
  }

  return violations;
}

// ── Prompt (versioned in the P1.1 registry — append-only) ────────────────────
/**
 * STATIC system prompt — never interpolate per-agent or per-lead material
 * here: it is the first block of the provider cache prefix.
 */
export const COMPOSER_EMAIL_SYSTEM =
  "You compose ONE outbound sales email (a subject and a plain-text body) for a sales agent, personalized " +
  "to one specific lead.\n" +
  "HARD RULES:\n" +
  "(1) Every factual claim, offer, price, or link must come from the BUSINESS CONTEXT block or the step " +
  "brief — never invent facts, never use model knowledge about the company.\n" +
  "(2) Write FINISHED copy using the lead's real details — never merge tokens, placeholders, or brackets " +
  "to fill in later.\n" +
  "(3) NEVER write unsubscribe or opt-out language, a physical mailing address, or any compliance footer — " +
  "the platform appends the compliant footer itself after your text. No signature block either: end on " +
  "the ask; the sender identity and footer are added at send time.\n" +
  "(4) Include a URL only if it appears verbatim in the business context or the brief.\n" +
  "(5) One clear ask per message. Plain text only — no HTML, no emojis, no ALL CAPS, no exclamation marks.\n" +
  "(6) Sound like a competent human writing a short, specific email, not a template — two leads must " +
  "never receive the same sentence.\n" +
  '(7) Respect the step brief exactly: achieve its objective, draw only from its talking points, include ' +
  'every "must say" string verbatim, and never use any "never say" string in any casing.\n' +
  "(8) Play the STEP ROLE you are given (the sequence's selling arc): an OPENER's only job is to earn a " +
  `reply — at most ${OPENER_WORD_CAP} words, exactly one question, END the body with that question, zero ` +
  "self-introduction filler, and never open with any of: " +
  BANNED_OPENERS.map((p) => `"${p}"`).join(", ") +
  ". A VALUE/PROOF step shows ONE concrete proof point from the business context. An OBJECTION-PREEMPT " +
  "names the likely hesitation and defuses it in one or two sentences. A BREAKUP is the shortest message " +
  "— close the loop politely, give an easy out, no guilt.\n" +
  "(9) Subject line: a specific fragment tied to the step's role, at most " +
  `${EMAIL_SUBJECT_MAX_CHARS} characters — never "quick question", never clickbait, no ALL CAPS, no ` +
  'exclamation marks, and never a "Re:"/"Fwd:" prefix (the platform threads real replies itself).';

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  const v1Template = `Compose the email for this lead now.

STEP BRIEF (what this message must achieve):
- Objective: {{objective}}
- Subject direction (adapt to this lead — never paste as-is): {{subjectHint}}
- Talking points (facts to draw from — pick what fits this lead, never paste as-is):
{{talkingPoints}}
- Must say verbatim: {{mustSay}}
- Never say (hard ban, any casing): {{neverSay}}

STEP ROLE (this step's job in the selling arc): {{arcRole}}

LEAD:
{{lead}}

CONVERSATION SO FAR (oldest first):
{{history}}

CONSTRAINTS:
- Subject: at most {{subjectMaxChars}} characters.
- Body: aim for at most {{targetWords}} words; NEVER exceed {{maxWords}}.
- {{threadNote}}`;
  registerPrompt({
    name: COMPOSER_EMAIL_PROMPT_NAME,
    version: COMPOSER_EMAIL_PROMPT_VERSION,
    template: v1Template,
  });

  // v2 (L1, DEC-072) = v1 VERBATIM plus the language constraint — the
  // composer.sms@v2 treatment mirrored, derived from the same literal so the
  // two can never drift. Selected ONLY for non-English agents; English
  // composes on v1 byte-identical. Without this, a German GUIDED agent would
  // compose English email bodies over a German footer.
  const constraintsSeam = "CONSTRAINTS:";
  if (!v1Template.includes(constraintsSeam)) {
    throw new Error(
      "composer.email prompt v2 derivation: v1 CONSTRAINTS seam not found — realign the language variant",
    );
  }
  registerPrompt({
    name: COMPOSER_EMAIL_PROMPT_NAME,
    version: COMPOSER_EMAIL_PROMPT_VERSION_LANGUAGE,
    template: v1Template.replace(
      constraintsSeam,
      constraintsSeam +
        '\n- Write the ENTIRE email — subject AND body — in {{composeLanguage}}; the lead reads {{composeLanguage}}. Never mix languages; "must say" strings stay verbatim exactly as given.',
    ),
  });
}

const composeEmailOutputSchema = z.object({
  /** The finished subject line — nothing else. */
  subject: z.string().min(1),
  /** The finished plain-text body — no footer, no signature. */
  body: z.string().min(1),
});

function renderComposerEmailPrompt(inputs: ComposeEmailInputs): string {
  ensureRegistered();
  const language = inputs.language ?? DEFAULT_LANGUAGE;
  const vars = {
    objective: inputs.brief.objective,
    subjectHint: inputs.brief.subjectHint?.trim() || "(none — derive it from the objective)",
    talkingPoints: inputs.brief.talkingPoints.map((p) => `  - ${p}`).join("\n"),
    mustSay: (inputs.brief.mustSay ?? []).length
      ? inputs.brief.mustSay!.map((t) => `"${t}"`).join(", ")
      : "(none)",
    neverSay: inputs.neverSay.length
      ? inputs.neverSay.map((t) => `"${t}"`).join(", ")
      : "(none)",
    arcRole: inputs.arcRole
      ? `step ${inputs.arcRole.index} of ${inputs.arcRole.count} — ${inputs.arcRole.role}`
      : "(unspecified — write one focused, specific touch)",
    lead: renderLead(inputs.lead),
    history: renderHistory(inputs.history),
    subjectMaxChars: EMAIL_SUBJECT_MAX_CHARS,
    targetWords: EMAIL_COMPOSE_TARGET_WORDS,
    maxWords: EMAIL_COMPOSE_MAX_WORDS,
    threadNote: inputs.threaded
      ? "This continues an existing email thread — do not re-introduce the business; the platform threads it onto the real prior message."
      : "This starts a fresh email thread.",
  };
  if (language === "en") {
    return renderPrompt(COMPOSER_EMAIL_PROMPT_NAME, COMPOSER_EMAIL_PROMPT_VERSION, vars);
  }
  return renderPrompt(COMPOSER_EMAIL_PROMPT_NAME, COMPOSER_EMAIL_PROMPT_VERSION_LANGUAGE, {
    ...vars,
    composeLanguage: languagePromptLabel(language),
  });
}

// ── The composer ─────────────────────────────────────────────────────────────
/**
 * Compose → deterministic checks → ONE bounded retry (the model sees its own
 * text + the named violations) → typed refusal. The gateway's own schema
 * repair handles malformed tool output; this retry is for CONTENT violations.
 */
export async function composeEmail(
  gateway: AiGateway,
  inputs: ComposeEmailInputs,
): Promise<ComposedEmail> {
  const prompt = renderComposerEmailPrompt(inputs);
  const request = { system: COMPOSER_EMAIL_SYSTEM, cachedContext: inputs.cachedContext, maxTokens: 1024 };

  const first = await gateway.completeStructured(
    "copy",
    { ...request, prompt },
    composeEmailOutputSchema,
  );
  const firstSubject = first.subject.trim();
  const firstBody = first.body.trim();
  const firstViolations = checkComposedEmail(firstSubject, firstBody, inputs);
  if (firstViolations.length === 0) {
    return {
      subject: firstSubject,
      body: firstBody,
      composerVersion: composerEmailVersionFor(inputs.language ?? DEFAULT_LANGUAGE),
      attempts: 1,
    };
  }

  const retry = await gateway.completeStructured(
    "copy",
    {
      ...request,
      prompt:
        `${prompt}\n\n---\nYour previous email FAILED its checks.\n` +
        `Previous subject:\n"""\n${firstSubject}\n"""\n` +
        `Previous body:\n"""\n${firstBody}\n"""\n` +
        `Violations:\n${firstViolations.map((v) => `- ${v.reason}: ${v.detail}`).join("\n")}\n` +
        `Rewrite the email fixing every violation.`,
    },
    composeEmailOutputSchema,
  );
  const retrySubject = retry.subject.trim();
  const retryBody = retry.body.trim();
  const retryViolations = checkComposedEmail(retrySubject, retryBody, inputs);
  if (retryViolations.length === 0) {
    return {
      subject: retrySubject,
      body: retryBody,
      composerVersion: composerEmailVersionFor(inputs.language ?? DEFAULT_LANGUAGE),
      attempts: 2,
    };
  }
  throw new ComposeRefusedError(
    retryViolations[0]!.reason,
    retryViolations.map((v) => v.detail).join("; "),
  );
}

// ── Step-level wiring (loads context/lead/history; used by worker + api) ─────
export interface ComposeEmailStepParams {
  workspaceId: string;
  agentId: string;
  campaignId: string;
  contactId: string;
  enrollmentId?: string;
  stepNodeId: string;
  brief: StepBrief;
  /** Main-sequence position (workflow-computed) — feeds the arc role. */
  position?: { index: number; count: number };
  /** The step's `content.threaded` flag (the boundary does the real threading). */
  threaded?: boolean;
}

/** The seam the workflow activity injects — worker builds it with its real
 *  gateway; absent → the activity refuses typed (COMPOSER_UNCONFIGURED). */
export type EmailStepComposer = (params: ComposeEmailStepParams) => Promise<ComposedEmail>;

export function createEmailStepComposer(deps: {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  gateway: AiGateway;
  /** INT W2 (DEC-094): the injectable open-slots seam — see booking-link.ts. */
  bookingSlotsLine?: BookingSlotsLine;
}): EmailStepComposer {
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
    const arc = selectStrategy(agent.goal, agent.category).arc;
    const historyRows = await withTenant(prisma, ctx, (tx) =>
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
    );

    // INT W2 (DEC-094): per-render booking augmentation — the grounded
    // per-lead booking link (+ slots line, + the queued-flag mustSay) rides
    // the brief, NEVER the agent-stable cached prefix.
    const brief = await augmentBriefWithBooking(
      { prisma, ...(deps.bookingSlotsLine ? { bookingSlotsLine: deps.bookingSlotsLine } : {}) },
      {
        workspaceId: params.workspaceId,
        contactId: params.contactId,
        ...(params.enrollmentId ? { enrollmentId: params.enrollmentId } : {}),
      },
      params.brief,
    );

    const inputs: ComposeEmailInputs = {
      brief,
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
      ...(params.position
        ? { arcRole: { ...params.position, role: arcRoleFor(arc.roles, params.position) } }
        : {}),
      threaded: params.threaded ?? false,
      language: strategy.language,
    };
    return composeEmail(gateway, inputs);
  };
}

/**
 * Sample preview (G2 UI): compose a guided email brief against the FIXED
 * sample lead through the REAL checks — no contact row, no consent
 * implications, empty history. Free at launch; metering is Q-020.
 */
export async function composeSampleEmail(
  deps: { prisma: PrismaClient; gateway: AiGateway },
  params: {
    workspaceId: string;
    agentId: string;
    brief: StepBrief;
    position?: { index: number; count: number };
  },
): Promise<ComposedEmail> {
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
  const arc = selectStrategy(agent.goal, agent.category).arc;
  return composeEmail(deps.gateway, {
    brief: params.brief,
    cachedContext: buildCachedContext({
      contextText,
      toneHints: strategy.toneHints,
      strategyNotes: strategy.strategyNotes,
    }),
    neverSay: [...strategy.neverSay, ...(params.brief.neverSay ?? [])],
    lead: SAMPLE_LEAD,
    history: [],
    ...(params.position
      ? { arcRole: { ...params.position, role: arcRoleFor(arc.roles, params.position) } }
      : {}),
    language: strategy.language,
  });
}
