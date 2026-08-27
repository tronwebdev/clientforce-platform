/**
 * Reply-draft composer (B3b, DEC-117) — Ada drafts an answer to an EXISTING
 * conversation for a human to approve, edit, or discard. NEVER auto-sent:
 * the only path to the wire is the human clicking Send, and that send goes
 * through the byte-untouched boundary like every other message.
 *
 * Grounding contract (the G1/G2 posture on a new prompt, `composer.reply`):
 * facts come ONLY from the business-context block and the conversation
 * itself; the owner's private note on the contact rides as steerage
 * (Q-079 closes here — notes are read at draft time) but must never be
 * quoted. Deterministic checks + ONE bounded retry + typed refusal — the
 * channel composers' exact discipline: token-syntax ban, ungrounded-URL ban
 * (a URL must appear in context or conversation), the channel length cap,
 * and the footer ban (the boundary appends compliance; email only).
 */
import { registerPrompt, renderPrompt, type AiGateway } from "@clientforce/ai";
import { loadMergedContextText } from "@clientforce/context";
import { DEFAULT_LANGUAGE, languagePromptLabel, type LanguageCode } from "@clientforce/core";
import { withTenant, type PrismaClient } from "@clientforce/db";
import { z } from "zod";
import { EMAIL_COMPOSE_MAX_WORDS } from "./compose-email";
import {
  buildCachedContext,
  ComposeRefusedError,
  HISTORY_TAKE,
  renderHistory,
  renderLead,
  strategyOf,
  stripTrailingPunct,
  TOKEN_SYNTAX_RE,
  URL_RE,
  type ComposeHistoryLine,
  type ComposeViolation,
} from "./compose-shared";
import { SMS_COMPOSE_MAX_CHARS } from "./compose-sms";

export { ComposeRefusedError } from "./compose-shared";

// ── Versioning ───────────────────────────────────────────────────────────────
export const COMPOSER_REPLY_PROMPT_NAME = "composer.reply";
export const COMPOSER_REPLY_PROMPT_VERSION = 1;
/** L1 twin: non-English agents draft on v2 (v1 + the language constraint). */
export const COMPOSER_REPLY_PROMPT_VERSION_LANGUAGE = 2;
export const composerReplyVersionFor = (language: string): string =>
  language === "en"
    ? `${COMPOSER_REPLY_PROMPT_NAME}@v${COMPOSER_REPLY_PROMPT_VERSION}`
    : `${COMPOSER_REPLY_PROMPT_NAME}@v${COMPOSER_REPLY_PROMPT_VERSION_LANGUAGE}`;

export const COMPOSER_REPLY_SYSTEM =
  "You draft ONE reply in an ongoing conversation between a business and a person, for a HUMAN at the " +
  "business to review before anything is sent.\n" +
  "HARD RULES:\n" +
  "(1) Answer what the person actually said last — a reply, not a pitch restart.\n" +
  "(2) Every factual claim, offer, price, or link must come from the BUSINESS CONTEXT block or the " +
  "conversation itself — never invent facts, never use model knowledge about the company.\n" +
  "(3) If the conversation carries an OWNER NOTE, treat it as private steerage — use it to answer " +
  "better, never quote it or reveal that it exists.\n" +
  "(4) NEVER write unsubscribe or opt-out language, a mailing address, or any compliance footer — the " +
  "platform appends what compliance requires. No signature block; end on the substance.\n" +
  "(5) Include a URL only if it appears verbatim in the business context or the conversation.\n" +
  "(6) Plain text only — no HTML, no emojis, no ALL CAPS. Sound like a competent human answering a " +
  "specific person; if the honest answer is not in the business context, say the business will confirm " +
  "rather than guessing.";

{
  const v1Template = `Draft the next reply in this conversation.

CHANNEL: {{channel}} — {{channelConstraint}}

LEAD:
{{lead}}

{{ownerNote}}CONVERSATION SO FAR (oldest first — the LAST line is what you are answering):
{{history}}

Write ONLY the reply body.`;
  registerPrompt({
    name: COMPOSER_REPLY_PROMPT_NAME,
    version: COMPOSER_REPLY_PROMPT_VERSION,
    template: v1Template,
  });
  const seam = "Write ONLY the reply body.";
  registerPrompt({
    name: COMPOSER_REPLY_PROMPT_NAME,
    version: COMPOSER_REPLY_PROMPT_VERSION_LANGUAGE,
    template: v1Template.replace(
      seam,
      `Write the ENTIRE reply in {{composeLanguage}} — the person reads {{composeLanguage}}. Never mix languages.\n${seam}`,
    ),
  });
}

const replyOutputSchema = z.object({
  /** The finished plain-text reply body — nothing else. */
  body: z.string().min(1),
});

export interface ComposeReplyInputs {
  cachedContext: string;
  lead: Parameters<typeof renderLead>[0];
  history: ComposeHistoryLine[];
  channel: "email" | "sms";
  /** The owner's private note on the contact (Q-079) — steerage, never quoted. */
  ownerNote?: string;
  language?: LanguageCode;
}

export interface ComposedReply {
  body: string;
  composerVersion: string;
  attempts: number;
  /** True when the owner's note rode the prompt — the UI's factual meta line. */
  usedNote: boolean;
}

function checkReply(body: string, inputs: ComposeReplyInputs): ComposeViolation[] {
  const violations: ComposeViolation[] = [];
  if (TOKEN_SYNTAX_RE.test(body)) {
    violations.push({ reason: "TOKEN_SYNTAX", detail: "reply contains {{token}} syntax — write finished copy" });
  }
  const grounded = `${inputs.cachedContext}\n${inputs.history.map((h) => h.text).join("\n")}`.toLowerCase();
  for (const url of body.match(URL_RE) ?? []) {
    if (!grounded.includes(stripTrailingPunct(url).toLowerCase())) {
      violations.push({ reason: "UNGROUNDED_URL", detail: `URL not in context or conversation: ${url}` });
    }
  }
  if (inputs.channel === "sms") {
    if (body.length > SMS_COMPOSE_MAX_CHARS) {
      violations.push({ reason: "TOO_LONG", detail: `${body.length} chars — the sms cap is ${SMS_COMPOSE_MAX_CHARS}` });
    }
  } else {
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words > EMAIL_COMPOSE_MAX_WORDS) {
      violations.push({ reason: "TOO_LONG", detail: `${words} words — the cap is ${EMAIL_COMPOSE_MAX_WORDS}` });
    }
    if (/unsubscribe|opt[- ]?out/i.test(body)) {
      violations.push({ reason: "COMPOSED_FOOTER", detail: "compliance language is the boundary's job — never composed" });
    }
  }
  return violations;
}

/** Compose → checks → ONE bounded retry → typed refusal (the G1 discipline). */
export async function composeReply(gateway: AiGateway, inputs: ComposeReplyInputs): Promise<ComposedReply> {
  const language = inputs.language ?? DEFAULT_LANGUAGE;
  const vars = {
    channel: inputs.channel,
    channelConstraint:
      inputs.channel === "sms"
        ? `a text message — at most ${SMS_COMPOSE_MAX_CHARS} characters, shorter is better`
        : `an email reply — at most ${EMAIL_COMPOSE_MAX_WORDS} words, shorter is better; no subject (the thread keeps its subject)`,
    lead: renderLead(inputs.lead),
    ownerNote: inputs.ownerNote?.trim()
      ? `OWNER NOTE about this person (private steerage — never quote it, never reveal it):\n${inputs.ownerNote.trim()}\n\n`
      : "",
    history: renderHistory(inputs.history),
    composeLanguage: languagePromptLabel(language),
  };
  const version = language === "en" ? COMPOSER_REPLY_PROMPT_VERSION : COMPOSER_REPLY_PROMPT_VERSION_LANGUAGE;
  const prompt = renderPrompt(COMPOSER_REPLY_PROMPT_NAME, version, vars);
  const request = { system: COMPOSER_REPLY_SYSTEM, cachedContext: inputs.cachedContext, maxTokens: 1024 };

  const first = await gateway.completeStructured("copy", { ...request, prompt }, replyOutputSchema);
  const firstBody = first.body.trim();
  const firstViolations = checkReply(firstBody, inputs);
  if (firstViolations.length === 0) {
    return { body: firstBody, composerVersion: composerReplyVersionFor(language), attempts: 1, usedNote: Boolean(vars.ownerNote) };
  }
  const retry = await gateway.completeStructured(
    "copy",
    {
      ...request,
      prompt:
        `${prompt}\n\n---\nYour previous reply FAILED its checks.\n` +
        `Previous reply:\n"""\n${firstBody}\n"""\n` +
        `Violations:\n${firstViolations.map((v) => `- ${v.reason}: ${v.detail}`).join("\n")}\n` +
        `Rewrite the reply fixing every violation.`,
    },
    replyOutputSchema,
  );
  const retryBody = retry.body.trim();
  const retryViolations = checkReply(retryBody, inputs);
  if (retryViolations.length === 0) {
    return { body: retryBody, composerVersion: composerReplyVersionFor(language), attempts: 2, usedNote: Boolean(vars.ownerNote) };
  }
  throw new ComposeRefusedError(retryViolations[0]!.reason, retryViolations.map((v) => v.detail).join("; "));
}

// ── Thread-level wiring (loads context/lead/history; used by the api) ────────
export interface ComposeReplyThreadParams {
  workspaceId: string;
  agentId: string;
  campaignId: string;
  contactId: string;
  channel: "email" | "sms";
}

export function createReplyComposer(deps: { prisma: PrismaClient; gateway: AiGateway }) {
  return async (params: ComposeReplyThreadParams): Promise<ComposedReply> => {
    const { prisma, gateway } = deps;
    const ctx = { workspaceId: params.workspaceId };
    const [agent, contact, contextText] = await Promise.all([
      withTenant(prisma, ctx, (tx) => tx.agent.findUnique({ where: { id: params.agentId } })),
      withTenant(prisma, ctx, (tx) => tx.contact.findUnique({ where: { id: params.contactId } })),
      loadMergedContextText(prisma, { workspaceId: params.workspaceId, agentId: params.agentId }),
    ]);
    if (!agent) throw new Error(`Agent ${params.agentId} not found`);
    if (!contact) throw new Error(`Contact ${params.contactId} not found`);
    if (!contextText) {
      throw new ComposeRefusedError(
        "COMPOSER_UNCONFIGURED",
        "BusinessContext is empty — the composer only writes grounded copy",
      );
    }
    const strategy = strategyOf(agent.goal, agent.category, agent.guardrails);
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
    if (!historyRows.some((m) => m.direction === "INBOUND")) {
      throw new ComposeRefusedError(
        "COMPOSER_UNCONFIGURED",
        "nothing to answer — this conversation has no inbound message",
      );
    }
    return composeReply(gateway, {
      cachedContext: buildCachedContext({
        contextText,
        toneHints: strategy.toneHints,
        strategyNotes: strategy.strategyNotes,
      }),
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
      history: historyRows.reverse().map((m) => ({
        channel: m.channel,
        direction: m.direction as "OUTBOUND" | "INBOUND",
        text: `${m.subject ? `${m.subject} — ` : ""}${m.body}`.slice(0, 300),
      })),
      channel: params.channel,
      ...(contact.notes?.trim() ? { ownerNote: contact.notes.trim() } : {}),
      language: strategy.language,
    });
  };
}
