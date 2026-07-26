/**
 * On-call contact recall — the shared vocabulary (SPEC A, DEC-094).
 *
 * The voice brain does NOT get the contact's whole history stuffed into its
 * prompt. It gets ONE tool, `lookup_contact_context`, and calls it per
 * question: question → scoped lookup → grounded answer. This file is the
 * contract both sides agree on — the facet union the tool schema enumerates,
 * the bounded result shape, and the receipt DTO the call record renders.
 *
 * Three rules are structural, not stylistic:
 *
 * 1 · HONEST ABSENCE. A lookup that finds nothing returns `found: false` with
 *     a plain note. There is no "empty means improvise" path: the composer
 *     prompt (composer.voice@v2) turns an empty result into "I don't have that
 *     on record", and the receipt proves what the agent was actually holding
 *     when it spoke.
 * 2 · BOUNDED. Items, item length, lookups-per-turn and lookups-per-call all
 *     have hard caps. A live call cannot afford an unbounded fetch, and an
 *     unbounded result would recreate the prompt-stuffing this replaces.
 * 3 · SPOKEN-REGISTER SAFE. Retrieved text is sanitized HERE, before it ever
 *     reaches the model. Stored history is full of URLs, markdown and emoji;
 *     the per-sentence voice checks would refuse a turn that read one aloud,
 *     so the agent would be punished for quoting its own record faithfully.
 *     Stripping at the boundary keeps the refusal rail for real violations.
 */
import { z } from "zod";

// ── The facet union ──────────────────────────────────────────────────────────
/**
 * What a question can be scoped to. Deliberately five: each maps to a distinct
 * store and a distinct question a caller actually asks. Adding a sixth is a
 * vocabulary decision (new store, new fetcher, new prompt line) — never a
 * silent widening.
 *
 * - `history`   "have we spoken before?" / "what did I say last time?"
 * - `pipeline`  "where am I in your system?" / campaign membership + stage
 * - `bookings`  "when was that call?" / reschedules → the prior booking
 * - `profile`   the contact record itself: tags, notes, custom fields, company
 * - `knowledge` "what does it cost?" → the business-knowledge chunk (P1.2 RAG)
 */
export const RECALL_FACETS = [
  "history",
  "pipeline",
  "bookings",
  "profile",
  "knowledge",
] as const;

export type RecallFacet = (typeof RECALL_FACETS)[number];

export const recallFacetSchema = z.enum(RECALL_FACETS);

/** Owner-readable facet labels — receipts UI and the tool description share
 *  these, so the picker and the engine can never drift. */
export const RECALL_FACET_META: Record<RecallFacet, { label: string; describes: string }> = {
  history: {
    label: "Past conversation",
    describes:
      "previous emails, texts and calls with this contact — what was said, when, and how they replied",
  },
  pipeline: {
    label: "Pipeline & campaigns",
    describes:
      "which campaigns this contact is in, their current pipeline stage, and whether they are active or stopped",
  },
  bookings: {
    label: "Bookings & call outcomes",
    describes:
      "meetings or calls already booked or completed with this contact, and how those calls ended",
  },
  profile: {
    label: "Contact record",
    describes:
      "the saved record for this contact — company, role, tags, and any notes or custom fields on file",
  },
  knowledge: {
    label: "Business knowledge",
    describes:
      "the business's own knowledge base — offer, pricing, process and policy answers drawn from ingested sources",
  },
};

// ── Bounds (hard caps — a live call cannot afford an unbounded fetch) ────────
/** Items returned per lookup. Five is what a person holds in their head. */
export const RECALL_MAX_ITEMS = 5;
/** Per-item character cap — retrieved text is spoken material, not a document. */
export const RECALL_ITEM_MAX_CHARS = 240;
/** Lookups the brain may run for ONE caller question. */
export const RECALL_MAX_LOOKUPS_PER_TURN = 2;
/** Lookups across the whole call — the runaway-loop backstop. */
export const RECALL_MAX_LOOKUPS_PER_CALL = 12;
/**
 * Wall-clock budget for one lookup. Past this the tool returns a typed
 * timeout result rather than holding the caller in silence — the call always
 * continues, degraded and honest, never hung.
 */
export const RECALL_TIMEOUT_MS = 1500;

// ── Tool contract (the schema the model sees) ───────────────────────────────
export const RECALL_TOOL_NAME = "lookup_contact_context";

/**
 * One lookup. `facet` scopes the store; `query` is the caller's question in
 * the model's own words — it drives ranking within `knowledge` and `history`
 * and is recorded verbatim on the receipt so a reviewer can see what the agent
 * believed it was asked.
 */
export const recallLookupSchema = z.object({
  facet: recallFacetSchema,
  query: z.string().trim().min(1).max(300),
});
export type RecallLookup = z.infer<typeof recallLookupSchema>;

// ── Result shape (bounded, sanitized, honest) ───────────────────────────────
export interface RecallItem {
  /** Short label — "Reply · email" / "Stage" / "Booked call". */
  label: string;
  /** The fact itself, sanitized + capped at RECALL_ITEM_MAX_CHARS. */
  detail: string;
  /**
   * When it happened, phrased for SPEECH ("yesterday", "3 days ago") rather
   * than as an ISO date. The model reads this string out; it has no reliable
   * notion of today's date, so handing it `2026-07-12` invites either an
   * awkward recital or a silent miscalculation into "last week".
   */
  at?: string;
}

/**
 * `found: false` is a FIRST-CLASS result, never an error. The note explains
 * the absence in words the model can speak ("no prior messages on record"),
 * because the alternative — a silent empty array — is exactly what invites a
 * model to fill the gap itself.
 */
export interface RecallResult {
  facet: RecallFacet;
  found: boolean;
  items: RecallItem[];
  /** Honest note: why empty, what was truncated, or which rail refused. */
  note?: string;
  /** Set when the lookup could not complete (timeout, store error, budget). */
  refusalReason?: RecallRefusalReason;
}

/**
 * Typed refusals. Every one keeps the call alive: the model is told plainly
 * that the lookup did not happen, so it says so rather than inventing.
 */
export const RECALL_REFUSAL_REASONS = [
  "BUDGET_EXHAUSTED",
  "LOOKUP_TIMEOUT",
  "STORE_UNAVAILABLE",
  "UNKNOWN_FACET",
] as const;
export type RecallRefusalReason = (typeof RECALL_REFUSAL_REASONS)[number];

export const RECALL_REFUSAL_NOTE: Record<RecallRefusalReason, string> = {
  BUDGET_EXHAUSTED:
    "Lookup limit for this call reached — no record was read for this question.",
  LOOKUP_TIMEOUT: "The record lookup did not come back in time — nothing was read.",
  STORE_UNAVAILABLE: "The record store could not be reached — nothing was read.",
  UNKNOWN_FACET: "That is not a facet this agent can look up — nothing was read.",
};

// ── Receipts (the per-lookup audit row on the call record) ──────────────────
/**
 * One receipt per lookup, rendered on the Calls surface. Mirrors the
 * `CallRetrieval` row; `query` is verbatim and `itemCount`/`found` are what
 * the agent actually held when it spoke the next turn.
 */
export const callRetrievalDtoSchema = z.object({
  id: z.string(),
  callId: z.string(),
  /** 1-based caller turn this lookup served; 0 = pre-turn (never today). */
  turn: z.number().int().nonnegative(),
  /** Order within the call — the receipts render in this order. */
  seq: z.number().int().nonnegative(),
  facet: recallFacetSchema,
  query: z.string(),
  found: z.boolean(),
  itemCount: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  refusalReason: z.enum(RECALL_REFUSAL_REASONS).nullable(),
  /** Provenance of what was read — ids/labels, never the retrieved bodies. */
  sources: z.array(z.string()),
  createdAt: z.string(),
});
export type CallRetrievalDto = z.infer<typeof callRetrievalDtoSchema>;

export const callRetrievalListSchema = z.object({
  retrievals: z.array(callRetrievalDtoSchema),
});
export type CallRetrievalList = z.infer<typeof callRetrievalListSchema>;

// ── Spoken-register sanitization (rule 3 — applied at the boundary) ─────────
const RECALL_URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const RECALL_EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;

/**
 * Make one stored string safe to hand a model that will SPEAK it.
 *
 * URLs and email addresses become spoken placeholders rather than
 * disappearing: "(a link)" is a fact the agent can honestly offer to text
 * over, whereas a silent deletion would let it claim the message contained
 * nothing. Markdown, list bullets and emoji are stripped outright — they are
 * formatting noise that TTS reads as garbage.
 *
 * Pure and total: same input, same output; never throws.
 */
export function sanitizeForSpeech(raw: string): string {
  return raw
    .replace(RECALL_URL_RE, "(a link)")
    .replace(RECALL_EMAIL_RE, "(an email address)")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_`~#]+/g, "")
    .replace(/^\s*([-*•]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sanitize + cap one retrieved detail string. Ellipsis marks the truncation
 *  so the model can hear that it is holding a fragment, not the whole record. */
export function toRecallDetail(raw: string): string {
  const clean = sanitizeForSpeech(raw);
  return clean.length > RECALL_ITEM_MAX_CHARS
    ? `${clean.slice(0, RECALL_ITEM_MAX_CHARS - 1)}…`
    : clean;
}

/**
 * Render a result for the model. Deliberately terse, labeled lines — not JSON:
 * the brain is mid-call and every token is latency, and a labeled line is
 * harder to misread as an instruction than a nested object.
 */
export function renderRecallResult(result: RecallResult): string {
  const head = `${RECALL_FACET_META[result.facet].label} lookup`;
  if (result.refusalReason) {
    return `${head}: NOT AVAILABLE. ${RECALL_REFUSAL_NOTE[result.refusalReason]} Tell the caller you cannot check that right now — do not guess.`;
  }
  if (!result.found || result.items.length === 0) {
    return `${head}: NOTHING ON RECORD. ${result.note ?? "The record has no entry matching this question."} Say you do not have that on record — do not guess.`;
  }
  const lines = result.items.map((i) =>
    `- ${i.label}${i.at ? ` (${i.at})` : ""}: ${i.detail}`,
  );
  return `${head}: ${result.items.length} on record.\n${lines.join("\n")}${
    result.note ? `\n(${result.note})` : ""
  }`;
}
