/**
 * BusinessContext field registry + DTOs (P1.3, DEC-024/025).
 *
 * The registry is the owner-approved goal→required-fields table
 * (approved 2026-07-03 with four edits — see PROGRESS.md "BusinessContext
 * field registry"). Field keys are stable identifiers shared by the
 * distiller, gap checker, planner, and Brand kit.
 *
 * Semantics: REQUIRED fields must be filled WITH CITATIONS from READY
 * sources (workspace or agent layer) — uncited → gap row, launch gated.
 * RECOMMENDED fields are distilled + cited when evidence exists; they never
 * gap and never block launch.
 */
import { z } from "zod";
import { knowledgeSourceKindSchema } from "./knowledge";

// ── Goal cards (wizard step 1) ───────────────────────────────────────────────
export const GOAL_KEYS = [
  "book_appointments",
  "generate_leads",
  "reactivate_leads",
  "drive_signups",
  "collect_reviews",
  // v2 wizard additions (DEC-042; prototype order — before custom)
  "promote_offer",
  "fill_event",
  "upsell_clients",
  "custom",
] as const;
export const goalKeySchema = z.enum(GOAL_KEYS);
export type GoalKey = z.infer<typeof goalKeySchema>;

// ── Field vocabulary ─────────────────────────────────────────────────────────
export const CONTEXT_FIELD_KEYS = [
  // core (required for every goal)
  "offer",
  "usp",
  "tone",
  // workspace-level (required for any email goal — CAN-SPAM footer address)
  "company_address",
  // goal-conditional
  "icp",
  "booking_link",
  "availability",
  "pricing",
  "proof_points",
  "objection_handling",
  "lead_magnet",
  "qualification_criteria",
  "services",
  "winback_offer",
  "relationship_context",
  "trial_details",
  "review_channel",
  "incentive_policy",
  // v2 goal-conditional additions (DEC-042)
  "offer_details",
  "purchase_link",
  "offer_deadline",
  "event_name",
  "event_date",
  "registration_link",
  "event_value",
  "upsell_pitch",
  "upsell_audience",
] as const;
export const contextFieldKeySchema = z.enum(CONTEXT_FIELD_KEYS);
export type ContextFieldKey = z.infer<typeof contextFieldKeySchema>;

/** Human labels + the distiller's evidence-retrieval hint per field. */
export const CONTEXT_FIELD_META: Record<ContextFieldKey, { label: string; hint: string }> = {
  offer: { label: "What you sell", hint: "the product or service offered, in one paragraph" },
  usp: { label: "What makes you different", hint: "unique selling proposition, differentiators" },
  tone: { label: "Writing voice", hint: "brand tone of voice, writing style rules" },
  company_address: {
    label: "Company postal address",
    hint: "physical postal/mailing address, usually on contact or footer pages",
  },
  icp: { label: "Who to target", hint: "ideal customer profile: industries, titles, geos, size" },
  booking_link: { label: "Booking link", hint: "calendar or appointment booking URL" },
  availability: { label: "Availability", hint: "when prospects can book or be served" },
  pricing: { label: "Pricing", hint: "prices, plans, fees, rates" },
  proof_points: { label: "Proof points", hint: "case studies, testimonials, stats, results" },
  objection_handling: { label: "Objection handling", hint: "common objections and rebuttals" },
  lead_magnet: { label: "Lead magnet", hint: "what is offered in exchange for contact info" },
  qualification_criteria: {
    label: "Qualification criteria",
    hint: "what makes a lead qualified or sales-ready",
  },
  services: { label: "Services", hint: "the list of services or product lines" },
  winback_offer: { label: "Win-back offer", hint: "the incentive for lapsed customers to return" },
  relationship_context: {
    label: "Relationship context",
    hint: "what past customers bought and why they lapsed",
  },
  trial_details: {
    label: "Trial / signup details",
    hint: "what the trial or signup includes, duration, link",
  },
  review_channel: { label: "Review platform", hint: "review platform and link (Google, Yelp, …)" },
  incentive_policy: {
    label: "Incentive policy",
    hint: "whether/what review incentives are allowed (compliance)",
  },
  offer_details: {
    label: "Offer details",
    hint: "what exactly is being promoted: the product, promo or launch",
  },
  purchase_link: { label: "Purchase link", hint: "URL where buyers purchase or claim the offer" },
  offer_deadline: { label: "Deadline", hint: "when the offer or promotion ends" },
  event_name: { label: "Event name", hint: "the event being promoted (webinar, open house, …)" },
  event_date: { label: "Date & time", hint: "when the event runs, including timezone" },
  registration_link: { label: "Registration link", hint: "URL where attendees sign up" },
  event_value: {
    label: "What attendees get",
    hint: "why attending is worth it; what attendees receive",
  },
  upsell_pitch: {
    label: "What to pitch",
    hint: "the upgrade or add-on being offered to existing clients",
  },
  upsell_audience: {
    label: "Who qualifies",
    hint: "which existing clients should hear the pitch",
  },
};

// ── The approved table (DEC-024 + four owner edits, 2026-07-03) ─────────────
/** Required for every goal. */
export const CORE_REQUIRED: readonly ContextFieldKey[] = ["offer", "usp", "tone"];

/**
 * Workspace-level required for any email goal (owner edit 3): the postal
 * address CAN-SPAM requires in every unsubscribe footer. Asked once per
 * workspace, never per agent. P1.5's footer consumes it — never a placeholder.
 */
export const WORKSPACE_EMAIL_REQUIRED: readonly ContextFieldKey[] = ["company_address"];

export interface GoalFieldSpec {
  /** Gaps when uncited — beyond core. */
  required: readonly ContextFieldKey[];
  /** Cited-if-found; never gaps, never blocks launch. */
  recommended: readonly ContextFieldKey[];
}

export const GOAL_FIELD_TABLE: Record<GoalKey, GoalFieldSpec> = {
  // Owner edit 1: availability is Recommended here (booking_link carries it);
  // it stays Required only on reactivate_leads.
  book_appointments: {
    required: ["icp", "booking_link"],
    recommended: ["availability", "pricing", "proof_points", "objection_handling"],
  },
  // Owner edit 4: lead_magnet must not gate launch (auto-prospecting can source
  // leads without a magnet) — Recommended, with qualification_criteria added.
  generate_leads: {
    required: ["icp"],
    recommended: ["lead_magnet", "qualification_criteria", "pricing", "proof_points", "services"],
  },
  reactivate_leads: {
    required: ["winback_offer", "pricing", "availability"],
    recommended: ["relationship_context", "proof_points"],
  },
  drive_signups: {
    required: ["icp", "trial_details", "pricing"],
    recommended: ["proof_points", "objection_handling"],
  },
  collect_reviews: {
    required: ["review_channel", "incentive_policy"],
    recommended: ["services", "tone"],
  },
  // v2 goals (DEC-042): required rows are the owner-specified per-goal gap
  // rows from the v2 prototype; recommended sets start empty pending owner
  // input (NON-BLOCKING default — nothing extra is distilled or gated).
  promote_offer: {
    required: ["offer_details", "pricing", "purchase_link", "offer_deadline"],
    recommended: [],
  },
  fill_event: {
    required: ["event_name", "event_date", "registration_link", "event_value"],
    recommended: [],
  },
  upsell_clients: {
    required: ["upsell_pitch", "upsell_audience", "pricing", "booking_link"],
    recommended: [],
  },
  // Core only; the distiller may propose up to MAX_CUSTOM_GOAL_ASKS extra asks
  // derived from the typed objective (labeled, auditable, removable).
  custom: { required: [], recommended: [] },
};

export const MAX_CUSTOM_GOAL_ASKS = 2;

/** All required field keys for a goal (core + goal table; workspace layer adds company_address for email goals). */
export function requiredFieldsFor(
  goal: GoalKey,
  opts: { email: boolean } = { email: true },
): ContextFieldKey[] {
  const keys = [...CORE_REQUIRED, ...GOAL_FIELD_TABLE[goal].required];
  if (opts.email) keys.push(...WORKSPACE_EMAIL_REQUIRED);
  return [...new Set(keys)];
}

export function recommendedFieldsFor(goal: GoalKey): ContextFieldKey[] {
  return [...new Set(GOAL_FIELD_TABLE[goal].recommended)].filter(
    (k) => !CORE_REQUIRED.includes(k) && !WORKSPACE_EMAIL_REQUIRED.includes(k),
  );
}

// ── BusinessContext.fields entry shape (DEC-024) ────────────────────────────
export const contextFieldSourceSchema = z.enum(["distilled", "typed", "ai_decides"]);
export type ContextFieldSource = z.infer<typeof contextFieldSourceSchema>;

/**
 * A citation is a SNAPSHOT taken at distill time (DEC-028): re-ingest replaces
 * chunks, so bare ids dangle — the snapshot stays renderable and records the
 * evidence as it was when distilled. UI contract:
 * `P1.8_UI_WIRING_NOTES.md → Citations`.
 */
export const contextCitationSchema = z.object({
  /** KnowledgeChunk id at distill time (audit key; may dangle after re-ingest). */
  chunkId: z.string(),
  sourceId: z.string(),
  /** e.g. "clientforce.io" · "pricing.pdf" · "pasted text". */
  sourceLabel: z.string(),
  sourceType: knowledgeSourceKindSchema,
  /** WEBSITE → page URL · DOCUMENT → file path · TEXT → label. */
  locator: z.string().nullable(),
  /** Verbatim excerpt of the cited chunk, taken server-side (≤280 chars). */
  quote: z.string(),
});
export type ContextCitation = z.infer<typeof contextCitationSchema>;

export const contextFieldValueSchema = z.object({
  value: z.string(),
  /** Citation snapshots supporting the fill; empty ONLY for typed/ai_decides. */
  citations: z.array(contextCitationSchema),
  source: contextFieldSourceSchema,
  /** Custom-goal distiller-proposed ask this answers ("suggested for your goal"). */
  proposedAsk: z.string().optional(),
});
export type ContextFieldValue = z.infer<typeof contextFieldValueSchema>;

export const contextFieldsSchema = z.record(z.string(), contextFieldValueSchema);
export type ContextFields = z.infer<typeof contextFieldsSchema>;

// ── Gap report (wizard step gaps UI + launch gate) ──────────────────────────
export const gapStatusSchema = z.enum(["open", "typed", "ai_decides", "covered"]);

export const gapItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Which layer the answer writes to (company_address → workspace). */
  layer: z.enum(["workspace", "agent"]),
  status: gapStatusSchema,
  /** For `covered`: which layer's citation satisfied it ("✓ Found in your docs"). */
  coveredBy: z.enum(["workspace", "agent"]).optional(),
  /** Custom-goal suggested ask text, when applicable. */
  proposedAsk: z.string().optional(),
});
export type GapItem = z.infer<typeof gapItemSchema>;

export const gapReportSchema = z.object({
  gaps: z.array(gapItemSchema),
  /** gapResolved/gapTotal drives the wizard counter (DEC-024). */
  resolved: z.number().int(),
  total: z.number().int(),
  /** Step-6 launch gate: every required gap typed, delegated, or covered. */
  launchReady: z.boolean(),
});
export type GapReport = z.infer<typeof gapReportSchema>;

// ── Endpoint DTOs ────────────────────────────────────────────────────────────
export const distillRequestSchema = z.object({
  /** Omit for the workspace layer (Brand kit). */
  agentId: z.string().min(1).optional(),
});
export type DistillRequestDto = z.infer<typeof distillRequestSchema>;

export const getContextQuerySchema = z.object({
  agentId: z.string().min(1).optional(),
});

export const gapsQuerySchema = z.object({
  agentId: z.string().min(1).optional(),
  goal: goalKeySchema,
});

/** Registry field keys plus custom-goal suggested-ask keys (custom_ask_1/2). */
export const gapKeySchema = z.union([contextFieldKeySchema, z.string().regex(/^custom_ask_[12]$/)]);

export const answerGapSchema = z.object({
  agentId: z.string().min(1).optional(),
  key: gapKeySchema,
  value: z.string().min(1).max(5_000),
});
export type AnswerGapDto = z.infer<typeof answerGapSchema>;

export const delegateGapSchema = z.object({
  agentId: z.string().min(1).optional(),
  key: gapKeySchema,
});
export type DelegateGapDto = z.infer<typeof delegateGapSchema>;

export const undoGapSchema = delegateGapSchema;
export type UndoGapDto = z.infer<typeof undoGapSchema>;

export const dismissAskSchema = z.object({
  agentId: z.string().min(1),
  key: z.string().regex(/^custom_ask_[12]$/),
});
export type DismissAskDto = z.infer<typeof dismissAskSchema>;
