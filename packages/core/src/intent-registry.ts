import { type GoalKey } from "./context";
import { type IcpShape } from "./icp";

/**
 * B6 (DEC-131, ruling 3): intent is multi-industry BY CONSTRUCTION — the
 * signal taxonomy, source eligibility, Direct-mode filter sets and
 * watch-topic suggestions are REGISTRY DATA keyed by shape (+ vertical),
 * never code paths. Adding an industry = rows here, not new code.
 *
 * B6.5 (DEC-150/151/152) deepens and widens it, on the owner's amendment +
 * correction of 2026-08-31:
 *
 *  - DEPTH. A definition carried enough to sort a list, not enough to decide
 *    anything. It now declares its `subject` (person/organization — the
 *    org-first→person-second loop needs it), its `supplier` and `basis`
 *    (split out of the old single `source`), its `tier`, its `confidence`
 *    (an inferred signal must never score like a witnessed one), an
 *    `actionableForDays` window DISTINCT from decay (a mover is worth
 *    contacting for ~90 days after the weight has faded), `receiptSlots`
 *    (the data contract behind the sentence — a receipt with no slots is a
 *    template, not evidence), `impliesGoal`/`impliesOffer` so intent feeds
 *    the DEC-114 next-best-action rules instead of only reordering, and a
 *    `valueHint` so ranking can be revenue-weighted rather than
 *    engagement-weighted (ADDENDUM_2 §D).
 *  - WIDTH. The canon prototype's six signal names are ONE demo workspace's
 *    examples, not the list. This table is the canon and is meant to be
 *    vast: broad per shape and per vertical, so any business we onboard has
 *    something worth watching on day one. A vertical with no rows here is a
 *    REGISTRY GAP to fill, not a UI state to design.
 *
 * NOT here, deliberately (owner correction, 2026-08-31 — the repo is truth):
 *  - No negative-signal table. Suppression already ships in three layers and
 *    is kept as-is: write-time in `intent-consumer.ts` (opt-out ⇒ no signal;
 *    an active enrollment ⇒ no signal except reply/pricing, because a
 *    customer mid-campaign is not "in the market"), read-time in the leads
 *    controller's suppression pass (already-yours, mid-campaign,
 *    do-not-contact, recently happy, not-now replies), and `LeadExclusion`
 *    for per-provider hidden profiles. Whether an explicit "not now" should
 *    LOWER a score as well as gate a write is Q-142, to be decided inside
 *    that pass — never as a parallel structure.
 *  - No provenance field. `IntentSignal.meta` already carries
 *    `{ eventId, eventType }`, so every receipt is auditable to the event.
 *  - No schema change for subject. `IntentSignal` already has `contactId`
 *    and `companyKey`; only the DEFINITION lacked `subject`.
 *  - No cross-supplier identity dedupe — withdrawn as premature with one
 *    supplier live; it returns when a second lands.
 */

/* ── vocabularies ───────────────────────────────────────────────────── */

/** Who pays. `core` = first-party + own-book, free, always on. `bp` = the
 *  BuyerPing tier's licensed/collected supply. A `bp` type produces NO ROWS
 *  AT ALL until the tier is on — absent from the response, not hidden in
 *  the UI (SURFACE_SPEC §12.1). */
export const SIGNAL_TIERS = ["core", "bp"] as const;
export type SignalTier = (typeof SIGNAL_TIERS)[number];

/** Where the row came from. Ranking never reads this (ADDENDUM_5 §3). */
export const SIGNAL_SUPPLIERS = ["first_party", "provider", "collector"] as const;
export type SignalSupplier = (typeof SIGNAL_SUPPLIERS)[number];

/** Lawful basis + provenance. Binds CHANNELS, never the signal itself
 *  (ADDENDUM_5 §4): holding a mover signal is legitimate; what may be done
 *  with it is constrained per channel and per region. */
export const SIGNAL_BASES = ["first_party", "public_record", "licensed", "inferred"] as const;
export type SignalBasis = (typeof SIGNAL_BASES)[number];

/** What the signal is about. Hiring is an organization signal; moving is a
 *  person signal. The discovery loop cannot resolve org→person without it. */
export const SIGNAL_SUBJECTS = ["person", "organization"] as const;
export type SignalSubject = (typeof SIGNAL_SUBJECTS)[number];

/** How well we know it. `observed` = we watched it happen on our own
 *  property; `reported` = a source states it; `inferred` = we concluded it. */
export const SIGNAL_CONFIDENCE = ["observed", "reported", "inferred"] as const;
export type SignalConfidence = (typeof SIGNAL_CONFIDENCE)[number];

/** An inferred signal must never score like a witnessed one. */
export const CONFIDENCE_MULTIPLIER: Record<SignalConfidence, number> = {
  observed: 1,
  reported: 0.75,
  inferred: 0.5,
};

/** Expected value band, so ranking can be revenue-weighted rather than
 *  engagement-weighted (ADDENDUM_2 §D). Proposals, owner-tunable. */
export const VALUE_BANDS = ["low", "medium", "high"] as const;
export type ValueBand = (typeof VALUE_BANDS)[number];
export const VALUE_MULTIPLIER: Record<ValueBand, number> = { low: 0.8, medium: 1, high: 1.25 };

/** The data contract behind a receipt sentence. A receipt with no slots is a
 *  template, not evidence — `{n}` interpolates a count, `{role}` a job
 *  title, `{area}` a place, `{when}` a plain-English age, `{competitor}` a
 *  named rival, `{topic}` the thing they asked about. */
export const RECEIPT_SLOTS = ["n", "role", "area", "when", "competitor", "topic"] as const;
export type ReceiptSlot = (typeof RECEIPT_SLOTS)[number];

/**
 * Below this decayed weight a signal stops being SHOWN at all rather than
 * lingering as noise (owner amendment: "a decay floor"). It still exists as
 * a row and still explains history — it simply no longer surfaces.
 */
export const DECAY_FLOOR = 0.5;

/* ── user-facing grouping ───────────────────────────────────────────── */

/**
 * The watch panel lists what a person recognises ("Reading your pages"),
 * not our event keys. A GROUP is that user-facing row; many typed signals
 * roll up into one. This is why the canon prototype shows six rows while
 * the taxonomy below has many — the six were groups all along.
 */
export const SIGNAL_GROUPS = [
  "site",
  "asked",
  "onbook",
  "quiet",
  "engaged",
  "moved",
  "life",
  "unhappy",
  "growing",
  "money",
  "tooling",
  "market",
] as const;
export type SignalGroup = (typeof SIGNAL_GROUPS)[number];

export interface SignalGroupDef {
  /** User-facing name. Vertical overrides live in `byVertical`. */
  label: string;
  /** One line, user-facing: why this is worth watching. */
  why: string;
  shapes: IcpShape[];
  byVertical?: Record<string, { label?: string; why?: string }>;
}

export const SIGNAL_GROUP_META: Record<SignalGroup, SignalGroupDef> = {
  site: {
    label: "Reading your pages",
    why: "Your own visitors, forms and chats — always on, free",
    shapes: ["company", "local_business", "consumer"],
  },
  asked: {
    label: "Asked and never booked",
    why: "They asked about it once and went cold",
    shapes: ["company", "local_business", "consumer"],
    byVertical: {
      saas: { label: "Asked and never signed up" },
      ecommerce: { label: "Asked and never ordered" },
      education: { label: "Enquired and never enrolled" },
    },
  },
  /**
   * Split out of `asked` deliberately. A contact reaches your book by import,
   * by a form, or by hand, so a group whose label and description both assert
   * an enquiry cannot hold them — the same overclaim the `never_worked`
   * receipt was corrected for. `asked` now holds only types that mean they
   * really did ask.
   */
  onbook: {
    label: "In your records, nothing yet",
    why: "People you already hold that nothing has happened with",
    shapes: ["company", "local_business", "consumer"],
    byVertical: {
      dental: { label: "Patients on file, never booked in" },
      salon: { label: "Clients on file, never booked in" },
      saas: { label: "Accounts on file, never started" },
    },
  },
  quiet: {
    label: "Customers who went quiet",
    why: "Already yours, already trust you — the cheapest revenue there is",
    shapes: ["company", "local_business", "consumer"],
    byVertical: {
      dental: { label: "Patients who went quiet" },
      clinic: { label: "Patients who went quiet" },
      salon: { label: "Clients who went quiet" },
      saas: { label: "Accounts that went quiet" },
      agency: { label: "Clients who went quiet" },
    },
  },
  engaged: {
    label: "Talking to you right now",
    why: "Replies, calls and bookings in flight — the warmest thing you have",
    shapes: ["company", "local_business", "consumer"],
  },
  moved: {
    label: "Just moved into your area",
    why: "New arrivals need what you sell within weeks",
    shapes: ["local_business", "consumer"],
  },
  life: {
    label: "Life events you serve",
    why: "Weddings, new babies, retirement — each maps to something you offer",
    shapes: ["consumer", "local_business"],
  },
  unhappy: {
    label: "Unhappy with who they use now",
    why: "Public complaints about the people near you",
    shapes: ["company", "local_business", "consumer"],
  },
  growing: {
    label: "Growing right now",
    why: "Hiring and opening — the moment budgets get signed",
    shapes: ["company", "local_business"],
  },
  money: {
    label: "New money to spend",
    why: "Funding and grants land, then buying starts",
    shapes: ["company"],
  },
  tooling: {
    label: "Changing what they use",
    why: "A tool swap is an open door",
    shapes: ["company"],
  },
  market: {
    label: "Visible in the market",
    why: "Advertising, reviews and news — signs of a business in motion",
    shapes: ["company", "local_business"],
  },
};

/* ── the taxonomy ───────────────────────────────────────────────────── */

export interface IntentSignalDef {
  /** User-facing name for this exact type (the group carries the row label;
   *  this is what a drawer or an audit line shows). */
  label: string;
  group: SignalGroup;
  /** Which ICP shapes this signal applies to. */
  shapes: IcpShape[];
  /** Absent = every vertical of those shapes. Present = only these. */
  verticals?: string[];
  subject: SignalSubject;
  supplier: SignalSupplier;
  basis: SignalBasis;
  tier: SignalTier;
  confidence: SignalConfidence;
  weight: number;
  halfLifeDays: number;
  /**
   * How long the signal JUSTIFIES OUTREACH, distinct from decay. Outside the
   * window it still explains why a row is here; it no longer makes the case
   * for contacting them.
   */
  actionableForDays: number;
  /** Mono row tag — where the evidence came from, in the user's words. */
  sourceTag: string;
  /** Template; slots interpolate from the event payload at write time. */
  receipt: string;
  receiptSlots?: ReceiptSlot[];
  /**
   * What a slot reads as when the event cannot fill it. A slot that simply
   * vanishes can leave a sentence limping ("asked what would cost today"),
   * so every slot that carries grammatical weight declares a true generic
   * word to fall back on. Never a guess about the person — only a word for
   * the thing.
   */
  slotDefaults?: Partial<Record<ReceiptSlot, string>>;
  /** Which goal this points at, so intent becomes a decision (DEC-114). */
  impliesGoal?: GoalKey;
  /** Which offer it points at, in the workspace's own words where known. */
  impliesOffer?: string;
  valueHint?: ValueBand;
  byVertical?: Record<
    string,
    {
      receipt?: string;
      label?: string;
      impliesOffer?: string;
      slotDefaults?: Partial<Record<ReceiptSlot, string>>;
    }
  >;
}

/**
 * `source` is GONE, replaced by `supplier` + `basis` (owner amendment). The
 * keys are unchanged for every type that already existed: rows are stored by
 * key and renaming one would orphan real data.
 */
export const INTENT_SIGNALS: Record<string, IntentSignalDef> = {
  /* ── first-party · your own property · always core ─────────────────── */
  chat_started: {
    label: "Started a chat on your site",
    group: "site",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 4,
    halfLifeDays: 7,
    actionableForDays: 30,
    sourceTag: "YOUR SITE",
    receipt: "started a chat on your site {when}",
    receiptSlots: ["when"],
    impliesGoal: "nurture_leads",
    valueHint: "low",
  },
  lead_captured: {
    label: "Left their details",
    group: "site",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 8,
    halfLifeDays: 14,
    actionableForDays: 60,
    sourceTag: "YOUR SITE",
    receipt: "left their details through your site {when}",
    receiptSlots: ["when"],
    impliesGoal: "generate_leads",
    valueHint: "medium",
  },
  form_submitted: {
    label: "Filled in a form",
    group: "site",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 8,
    halfLifeDays: 14,
    actionableForDays: 60,
    sourceTag: "YOUR FORM",
    receipt: "filled in one of your forms {when}",
    receiptSlots: ["when"],
    impliesGoal: "generate_leads",
    valueHint: "medium",
  },
  reply_interested: {
    label: "Replied and sounded interested",
    group: "engaged",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 10,
    halfLifeDays: 10,
    actionableForDays: 30,
    sourceTag: "YOUR INBOX",
    receipt: "replied and sounded interested {when}",
    receiptSlots: ["when"],
    impliesGoal: "book_appointments",
    valueHint: "high",
  },
  pricing_asked: {
    label: "Asked what it costs",
    group: "asked",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 9,
    halfLifeDays: 10,
    actionableForDays: 45,
    sourceTag: "YOUR INBOX",
    receipt: "asked about {topic} pricing {when}",
    receiptSlots: ["topic", "when"],
    slotDefaults: { topic: "your" },
    impliesGoal: "accept_quotes",
    valueHint: "high",
    byVertical: {
      dental: {
        receipt: "asked what {topic} would cost {when}",
        impliesOffer: "treatment",
        slotDefaults: { topic: "treatment" },
      },
      clinic: { receipt: "asked what {topic} would cost {when}", slotDefaults: { topic: "treatment" } },
      saas: { receipt: "asked about your pricing {when}", impliesOffer: "a plan" },
      trades: {
        receipt: "asked for a price on {topic} {when}",
        impliesOffer: "a quote",
        slotDefaults: { topic: "the work" },
      },
      legal: { receipt: "asked what {topic} would cost {when}", slotDefaults: { topic: "the matter" } },
    },
  },
  link_clicked: {
    label: "Opened a link you sent",
    group: "engaged",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 3,
    halfLifeDays: 5,
    actionableForDays: 21,
    sourceTag: "YOUR EMAIL",
    receipt: "opened a link you sent {when}",
    receiptSlots: ["when"],
    valueHint: "low",
  },
  call_finished: {
    label: "Was on a call with you",
    group: "engaged",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 6,
    halfLifeDays: 10,
    actionableForDays: 30,
    sourceTag: "YOUR LINE",
    receipt: "was on a call with you {when}",
    receiptSlots: ["when"],
    impliesGoal: "book_appointments",
    valueHint: "medium",
  },
  meeting_booked: {
    label: "Booked time with you",
    group: "engaged",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 12,
    halfLifeDays: 21,
    actionableForDays: 60,
    sourceTag: "YOUR DIARY",
    receipt: "booked time with you {when}",
    receiptSlots: ["when"],
    impliesGoal: "book_appointments",
    valueHint: "high",
  },

  /* ── own-book · derived at read from your own records · core ───────── */
  went_quiet: {
    label: "Went quiet on you",
    group: "quiet",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 6,
    halfLifeDays: 120,
    actionableForDays: 365,
    sourceTag: "YOUR RECORDS",
    receipt: "last heard from you {when}",
    receiptSlots: ["when"],
    impliesGoal: "reactivate_leads",
    valueHint: "medium",
    byVertical: {
      dental: { receipt: "last visit {when} — their recall is overdue" },
      clinic: { receipt: "last seen {when} — their review is overdue" },
      salon: { receipt: "last appointment {when}" },
      saas: { receipt: "last active {when}" },
    },
  },
  said_not_now: {
    label: "Said not now",
    group: "quiet",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 5,
    halfLifeDays: 90,
    actionableForDays: 365,
    sourceTag: "YOUR INBOX",
    receipt: "said not now {when} — worth a fresh angle",
    receiptSlots: ["when"],
    impliesGoal: "winback_deals",
    valueHint: "medium",
  },
  never_worked: {
    label: "In your book, never worked",
    group: "onbook",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "first_party",
    basis: "first_party",
    tier: "core",
    confidence: "observed",
    weight: 4,
    halfLifeDays: 180,
    actionableForDays: 365,
    sourceTag: "YOUR RECORDS",
    receipt: "in your records, never worked",
    impliesGoal: "nurture_leads",
    valueHint: "low",
    // These must not ASSERT an enquiry: a contact can reach your book by
    // import, by a form, or by hand, and "enquired once" would be a fact we
    // do not have. `pricing_asked` is the type that means they asked.
    byVertical: {
      dental: { receipt: "in your records, never booked in" },
      clinic: { receipt: "in your records, never seen" },
      salon: { receipt: "in your records, never booked in" },
      trades: { receipt: "in your records, never went ahead" },
      saas: { receipt: "in your records, never started" },
      ecommerce: { receipt: "in your records, never ordered" },
      education: { receipt: "in your records, never enrolled" },
    },
  },

  /* ── licensed / collected · the BuyerPing tier · NO rows until it is on ─ */
  moved_in: {
    label: "Just moved into your area",
    group: "moved",
    shapes: ["consumer", "local_business"],
    subject: "person",
    supplier: "provider",
    basis: "licensed",
    tier: "bp",
    confidence: "reported",
    weight: 9,
    halfLifeDays: 30,
    actionableForDays: 90,
    sourceTag: "MOVER LIST",
    receipt: "moved into {area} {when}",
    receiptSlots: ["area", "when"],
    slotDefaults: { area: "your area" },
    impliesGoal: "generate_leads",
    valueHint: "high",
    byVertical: {
      dental: { receipt: "moved into {area} {when} — no dentist on record" },
      salon: { receipt: "moved into {area} {when}" },
      fitness: { receipt: "moved into {area} {when} — new routines get set early" },
    },
  },
  home_purchase: {
    label: "Just bought a home",
    group: "moved",
    shapes: ["consumer", "local_business"],
    subject: "person",
    supplier: "provider",
    basis: "public_record",
    tier: "bp",
    confidence: "reported",
    weight: 8,
    halfLifeDays: 45,
    actionableForDays: 120,
    sourceTag: "PUBLIC RECORD",
    receipt: "bought a home in {area} {when}",
    receiptSlots: ["area", "when"],
    slotDefaults: { area: "your area" },
    impliesGoal: "generate_leads",
    valueHint: "high",
    byVertical: {
      trades: { receipt: "bought a home in {area} {when} — first jobs get booked early" },
      real_estate: { receipt: "completed on a home in {area} {when}" },
    },
  },
  life_event: {
    label: "A life event you serve",
    group: "life",
    shapes: ["consumer", "local_business"],
    subject: "person",
    supplier: "provider",
    basis: "licensed",
    tier: "bp",
    confidence: "reported",
    weight: 8,
    halfLifeDays: 60,
    actionableForDays: 180,
    sourceTag: "LIFE EVENT",
    receipt: "{topic} {when}",
    receiptSlots: ["topic", "when"],
    slotDefaults: { topic: "A life event you serve" },
    impliesGoal: "promote_offer",
    valueHint: "high",
    byVertical: {
      dental: { receipt: "{topic} {when} — whitening season" },
      salon: { receipt: "{topic} {when}" },
      fitness: { receipt: "{topic} {when}" },
      education: { receipt: "{topic} {when}" },
    },
  },
  insurance_change: {
    label: "Changed cover",
    group: "life",
    shapes: ["consumer"],
    verticals: ["dental", "clinic", "legal"],
    subject: "person",
    supplier: "provider",
    basis: "licensed",
    tier: "bp",
    confidence: "inferred",
    weight: 6,
    halfLifeDays: 60,
    actionableForDays: 120,
    sourceTag: "LIFE EVENT",
    receipt: "changed cover {when}",
    receiptSlots: ["when"],
    impliesGoal: "generate_leads",
    valueHint: "medium",
  },
  review_complaint: {
    label: "Complained about who they use now",
    group: "unhappy",
    shapes: ["company", "local_business", "consumer"],
    subject: "person",
    supplier: "collector",
    basis: "public_record",
    tier: "bp",
    confidence: "observed",
    weight: 9,
    halfLifeDays: 21,
    actionableForDays: 60,
    sourceTag: "PUBLIC REVIEW",
    receipt: "left a {n} star review for {competitor} {when}",
    receiptSlots: ["n", "competitor", "when"],
    slotDefaults: { n: "low", competitor: "someone nearby" },
    impliesGoal: "generate_leads",
    valueHint: "high",
    byVertical: {
      dental: { receipt: "left a {n} star review for a practice near you {when}" },
      salon: { receipt: "left a {n} star review for a salon near you {when}" },
    },
  },
  hiring: {
    label: "Hiring right now",
    group: "growing",
    shapes: ["company", "local_business"],
    subject: "organization",
    supplier: "collector",
    basis: "public_record",
    tier: "bp",
    confidence: "observed",
    weight: 7,
    halfLifeDays: 21,
    actionableForDays: 90,
    sourceTag: "JOB POSTING",
    receipt: "posted {n} {role} roles {when}",
    receiptSlots: ["n", "role", "when"],
    slotDefaults: { n: "new", role: "" },
    impliesGoal: "generate_leads",
    valueHint: "high",
    byVertical: {
      dental: { receipt: "posted {n} {role} roles {when}" },
      saas: { receipt: "hiring {n} {role} — the team is growing" },
      agency: { receipt: "hiring {n} {role} {when}" },
    },
  },
  opening: {
    label: "Opening somewhere new",
    group: "growing",
    shapes: ["company", "local_business"],
    subject: "organization",
    supplier: "collector",
    basis: "public_record",
    tier: "bp",
    confidence: "reported",
    weight: 8,
    halfLifeDays: 45,
    actionableForDays: 120,
    sourceTag: "PUBLIC RECORD",
    receipt: "opening in {area} {when}",
    receiptSlots: ["area", "when"],
    slotDefaults: { area: "a new place" },
    impliesGoal: "generate_leads",
    valueHint: "high",
  },
  permit: {
    label: "Filed a permit",
    group: "growing",
    shapes: ["company", "local_business"],
    verticals: ["trades", "real_estate", "agency"],
    subject: "organization",
    supplier: "collector",
    basis: "public_record",
    tier: "bp",
    confidence: "observed",
    weight: 7,
    halfLifeDays: 30,
    actionableForDays: 120,
    sourceTag: "PUBLIC RECORD",
    receipt: "filed a permit in {area} {when}",
    receiptSlots: ["area", "when"],
    slotDefaults: { area: "your area" },
    impliesGoal: "accept_quotes",
    valueHint: "high",
  },
  funding: {
    label: "Just raised funding",
    group: "money",
    shapes: ["company"],
    subject: "organization",
    supplier: "provider",
    basis: "licensed",
    tier: "bp",
    confidence: "reported",
    weight: 8,
    halfLifeDays: 30,
    actionableForDays: 120,
    sourceTag: "PUBLIC RECORD",
    receipt: "raised funding {when}",
    receiptSlots: ["when"],
    impliesGoal: "generate_leads",
    valueHint: "high",
    byVertical: { saas: { receipt: "raised a round {when}" }, agency: { receipt: "raised funding {when}" } },
  },
  tech_change: {
    label: "Changed their tooling",
    group: "tooling",
    shapes: ["company"],
    subject: "organization",
    supplier: "provider",
    basis: "licensed",
    tier: "bp",
    confidence: "inferred",
    weight: 5,
    halfLifeDays: 30,
    actionableForDays: 90,
    sourceTag: "PUBLIC RECORD",
    receipt: "changed their {topic} {when}",
    receiptSlots: ["topic", "when"],
    slotDefaults: { topic: "tooling" },
    impliesGoal: "generate_leads",
    valueHint: "medium",
    byVertical: { saas: { receipt: "swapped their {topic} {when}" } },
  },
  ads_spend: {
    label: "Spending on ads",
    group: "market",
    shapes: ["company", "local_business"],
    subject: "organization",
    supplier: "collector",
    basis: "public_record",
    tier: "bp",
    confidence: "observed",
    weight: 6,
    halfLifeDays: 21,
    actionableForDays: 60,
    sourceTag: "AD LIBRARY",
    receipt: "running ads for {topic} {when}",
    receiptSlots: ["topic", "when"],
    slotDefaults: { topic: "what they sell" },
    impliesGoal: "generate_leads",
    valueHint: "medium",
  },
  review_velocity: {
    label: "Reviews moving",
    group: "market",
    shapes: ["company", "local_business"],
    subject: "organization",
    supplier: "collector",
    basis: "public_record",
    tier: "bp",
    confidence: "observed",
    weight: 5,
    halfLifeDays: 30,
    actionableForDays: 90,
    sourceTag: "REVIEW FEED",
    receipt: "reviews {topic} {when}",
    receiptSlots: ["topic", "when"],
    slotDefaults: { topic: "moving" },
    valueHint: "low",
  },
  news_mention: {
    label: "In the news",
    group: "market",
    shapes: ["company", "local_business"],
    subject: "organization",
    supplier: "collector",
    basis: "public_record",
    tier: "bp",
    confidence: "reported",
    weight: 5,
    halfLifeDays: 21,
    actionableForDays: 60,
    sourceTag: "NEWS",
    receipt: "in the news for {topic} {when}",
    receiptSlots: ["topic", "when"],
    slotDefaults: { topic: "something" },
    valueHint: "low",
  },
};

/* ── eligibility ────────────────────────────────────────────────────── */

/**
 * Which SUPPLIERS a shape may draw on.
 *
 * DEC-150 supersedes DEC-131 ruling 3's `consumer: ["first_party"]`. That
 * was an over-absolute reading — the owner has ruled that licensed consumer
 * signals (movers, new homeowners, life events) are legitimate to HOLD; what
 * is constrained is what may be DONE with them, per channel and per region,
 * enforced at the send/dial boundary from `basis` (B10.5).
 */
export const SOURCE_ELIGIBILITY: Record<IcpShape, SignalSupplier[]> = {
  company: ["first_party", "provider", "collector"],
  local_business: ["first_party", "provider", "collector"],
  consumer: ["first_party", "provider", "collector"],
};

/**
 * Whether we offer a person-level PROVIDER search to this shape at all —
 * a different question from which suppliers may produce SIGNALS. Widening
 * `SOURCE_ELIGIBILITY` for consumer signals (DEC-150) must not switch on a
 * consumer people-search we do not sell: a consumer-shape Direct search is
 * scoped to the workspace's own book (SURFACE_SPEC §7).
 */
export const PROVIDER_PEOPLE_SEARCH: Record<IcpShape, boolean> = {
  company: true,
  local_business: true,
  consumer: false,
};

/** True when a definition is available to this workspace at all. */
export function signalApplies(
  def: IntentSignalDef,
  shape: IcpShape,
  vertical?: string | null,
): boolean {
  if (!def.shapes.includes(shape)) return false;
  if (def.verticals && (!vertical || !def.verticals.includes(vertical))) return false;
  return SOURCE_ELIGIBILITY[shape].includes(def.supplier);
}

/** The types a workspace may actually receive rows for, tier respected. */
export function activeSignalTypes(
  shape: IcpShape,
  vertical: string | null | undefined,
  tierOn: boolean,
): string[] {
  return Object.entries(INTENT_SIGNALS)
    .filter(([, def]) => signalApplies(def, shape, vertical) && (def.tier === "core" || tierOn))
    .map(([key]) => key);
}

/** The types held back behind the tier — named honestly, never faked. */
export function lockedSignalTypes(shape: IcpShape, vertical?: string | null): string[] {
  return Object.entries(INTENT_SIGNALS)
    .filter(([, def]) => signalApplies(def, shape, vertical) && def.tier === "bp")
    .map(([key]) => key);
}

/* ── receipts ───────────────────────────────────────────────────────── */

/** Plain-English age, so `{when}` reads like a person wrote it. */
export function plainWhen(occurredAt: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - occurredAt.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 61) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? "over a year ago" : `${years} years ago`;
}

/** The template for a type, with the workspace's vertical vocabulary. */
export function intentReceiptTemplate(type: string, vertical?: string | null): string | null {
  const def = INTENT_SIGNALS[type];
  if (!def) return null;
  if (vertical) {
    const flavored = def.byVertical?.[vertical]?.receipt;
    if (flavored) return flavored;
  }
  return def.receipt;
}

/**
 * Interpolate a receipt from the facts that produced it. The registry has
 * always promised `{n}`; until B6.5 `intentReceipt()` returned the template
 * verbatim, so every receipt read like a category ("hiring right now")
 * rather than evidence ("posted 2 hygienist roles 3 days ago").
 *
 * Unfilled slots are removed WITH their surrounding whitespace rather than
 * printed raw — a receipt is shown to a person, and `{role}` on screen is
 * worse than a shorter true sentence.
 */
export function fillReceipt(
  template: string,
  slots: Partial<Record<ReceiptSlot, string | number>>,
): string {
  return template
    .replace(/\{(\w+)\}/g, (_m, key: string) => {
      const v = slots[key as ReceiptSlot];
      return v === undefined || v === null || v === "" ? "" : String(v);
    })
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s*\u2014\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Compose a receipt for a type in one call — the write-time path. */
export function intentReceipt(
  type: string,
  vertical?: string | null,
  slots: Partial<Record<ReceiptSlot, string | number>> = {},
): string | null {
  const template = intentReceiptTemplate(type, vertical);
  if (template === null) return null;
  const def = INTENT_SIGNALS[type];
  const defaults = {
    ...def?.slotDefaults,
    ...(vertical ? def?.byVertical?.[vertical]?.slotDefaults : undefined),
  };
  const supplied = Object.fromEntries(
    Object.entries(slots).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  return fillReceipt(template, { ...defaults, ...supplied });
}

/* ── scoring ────────────────────────────────────────────────────────── */

/**
 * Recency decay: weight halved every halfLifeDays, then scaled by how well
 * we know the fact and by what the moment is worth. Ranking reads weight,
 * decay and fit — never `supplier` (ADDENDUM_5 §3).
 */
export function decayedWeight(type: string, occurredAt: Date, now = new Date()): number {
  const def = INTENT_SIGNALS[type];
  if (!def) return 0;
  const days = Math.max(0, (now.getTime() - occurredAt.getTime()) / 86_400_000);
  const base = def.weight * Math.pow(0.5, days / def.halfLifeDays);
  return base * CONFIDENCE_MULTIPLIER[def.confidence] * VALUE_MULTIPLIER[def.valueHint ?? "medium"];
}

/** Below the floor a signal is no longer SHOWN — it is not deleted. */
export function isVisibleSignal(type: string, occurredAt: Date, now = new Date()): boolean {
  return decayedWeight(type, occurredAt, now) >= DECAY_FLOOR;
}

/** Still inside the window where the signal justifies reaching out. */
export function isActionable(type: string, occurredAt: Date, now = new Date()): boolean {
  const def = INTENT_SIGNALS[type];
  if (!def) return false;
  const days = (now.getTime() - occurredAt.getTime()) / 86_400_000;
  return days <= def.actionableForDays;
}

/* ── combination · saturation · fatigue ─────────────────────────────── */

/**
 * Signals that mean more together than apart. Nothing of this existed; the
 * owner named all three behaviours in one amendment, so they live in one
 * table: a bonus for a meaningful pair, a cap so eight weak signals never
 * outrank one strong one, and a fatigue curve keyed to how many times we
 * have already acted on this contact.
 */
export interface CombinationRule {
  types: [string, string];
  bonus: number;
  /** User-facing: why the pair matters. Shown in the drawer, not the row. */
  why: string;
}

export const SIGNAL_COMBINATIONS: CombinationRule[] = [
  { types: ["pricing_asked", "meeting_booked"], bonus: 6, why: "asked the price, then booked time" },
  { types: ["moved_in", "pricing_asked"], bonus: 5, why: "new to the area and already asking what it costs" },
  { types: ["home_purchase", "pricing_asked"], bonus: 5, why: "just bought, already pricing the work" },
  { types: ["review_complaint", "chat_started"], bonus: 5, why: "unhappy elsewhere and came looking at you" },
  { types: ["hiring", "funding"], bonus: 4, why: "raised money and started hiring" },
  { types: ["went_quiet", "link_clicked"], bonus: 4, why: "quiet for months, then opened your email" },
  { types: ["life_event", "form_submitted"], bonus: 4, why: "a life event, and they filled in your form" },
  { types: ["opening", "hiring"], bonus: 4, why: "opening somewhere new and staffing it" },
];

/**
 * Saturation: total intent from stacking is capped, so a pile of weak
 * signals cannot beat one strong one. Applied after combinations.
 */
export const SATURATION_CAP = 24;

/**
 * Fatigue: each time we have already acted on this contact, the intent we
 * claim from them is worth less. Index = prior actions; beyond the table,
 * the last value holds.
 */
export const FATIGUE_MULTIPLIER: readonly number[] = [1, 0.85, 0.7, 0.55, 0.4, 0.3];

export function fatigueMultiplier(priorActions: number): number {
  const i = Math.max(0, Math.min(priorActions, FATIGUE_MULTIPLIER.length - 1));
  return FATIGUE_MULTIPLIER[i] ?? 1;
}

/**
 * The whole intent number for one subject: decayed weights, plus pair
 * bonuses, capped, then faded by how often we have already been in touch.
 * Signals under the decay floor contribute nothing.
 */
export function intentScore(
  signals: Array<{ type: string; occurredAt: Date }>,
  opts: { priorActions?: number; now?: Date } = {},
): number {
  const now = opts.now ?? new Date();
  const live = signals.filter((s) => isVisibleSignal(s.type, s.occurredAt, now));
  let total = live.reduce((n, s) => n + decayedWeight(s.type, s.occurredAt, now), 0);
  const present = new Set(live.map((s) => s.type));
  for (const rule of SIGNAL_COMBINATIONS) {
    if (present.has(rule.types[0]) && present.has(rule.types[1])) total += rule.bonus;
  }
  total = Math.min(total, SATURATION_CAP);
  return Math.round(total * fatigueMultiplier(opts.priorActions ?? 0) * 10) / 10;
}

/* ── nouns and titles ───────────────────────────────────────────────── */

export interface SubjectNoun {
  one: string;
  many: string;
}

/**
 * The noun for the PEOPLE (or organizations) a workspace is looking at. The
 * UI needs it in every count line, and hard-coding one is already a review
 * defect (DEC-129 / SURFACE_SPEC §12.9).
 *
 * RELATION TO `audience.ts`: B9's `SHAPE_SIGNAL_NOUN` / `VERTICAL_SIGNAL_NOUN`
 * are the plural-only ancestors of this table, written for the onboarding's
 * closing line. This one carries singular AND plural and is keyed the same
 * way. Folding the two into one is its own ruling (Q-143) — B6.5 does not
 * touch the onboarding surface.
 */
export const SHAPE_SUBJECT_NOUN: Record<IcpShape, SubjectNoun> = {
  consumer: { one: "person", many: "people" },
  local_business: { one: "business", many: "businesses" },
  company: { one: "company", many: "companies" },
};

export const VERTICAL_SUBJECT_NOUN: Record<string, SubjectNoun> = {
  dental: { one: "patient", many: "patients" },
  clinic: { one: "patient", many: "patients" },
  salon: { one: "client", many: "clients" },
  fitness: { one: "member", many: "members" },
  legal: { one: "client", many: "clients" },
  agency: { one: "client", many: "clients" },
  saas: { one: "account", many: "accounts" },
  ecommerce: { one: "customer", many: "customers" },
  education: { one: "student", many: "students" },
  trades: { one: "customer", many: "customers" },
  real_estate: { one: "client", many: "clients" },
};

export function subjectNounFor(shape: IcpShape, vertical?: string | null): SubjectNoun {
  return (vertical ? VERTICAL_SUBJECT_NOUN[vertical] : undefined) ?? SHAPE_SUBJECT_NOUN[shape];
}

/**
 * The page's own question (SURFACE_SPEC §4.1). Never a fixed string: a
 * consumer dental workspace asks "Who's looking for a dentist", a company
 * one asks "Who's in the market".
 */
export const VERTICAL_TRADE_NOUN: Record<string, string> = {
  dental: "a dentist",
  clinic: "a clinic",
  salon: "a salon",
  fitness: "a gym",
  legal: "a solicitor",
  trades: "a tradesperson",
  real_estate: "an agent",
  education: "a course",
};

export function leadFinderTitle(shape: IcpShape, vertical?: string | null): string {
  const trade = vertical ? VERTICAL_TRADE_NOUN[vertical] : undefined;
  if (shape === "consumer" && trade) return `Who's looking for ${trade}`;
  if (shape === "consumer") return "Who's looking for what you sell";
  return "Who's in the market";
}

/* ── pool bands (SURFACE_SPEC §3.4) ─────────────────────────────────── */

export interface PoolBandDef {
  key: string;
  tag: string;
  sub: string;
  /** Inclusive fit floor; `null` for the free band, which is defined by
   *  holding the details rather than by a score. */
  min: number | null;
  max: number | null;
  free: boolean;
}

/** Cheapest first, always — working what you already have before buying
 *  anything is the honest advice, so it is the first card. */
export const POOL_BANDS: PoolBandDef[] = [
  { key: "yours", tag: "ALREADY YOURS", sub: "On file, and a match for your brief", min: null, max: null, free: true },
  { key: "strong", tag: "STRONG FIT · 90+", sub: "Look most like your yeses", min: 90, max: null, free: false },
  { key: "good", tag: "GOOD FIT · 80–89", sub: "Right area, fewer matching facts", min: 80, max: 89, free: false },
  { key: "try", tag: "WORTH A TRY · 70–79", sub: "Edge of your brief — lower odds", min: 70, max: 79, free: false },
];

/* ── watch topics · direct filters (unchanged from B6) ──────────────── */

/** Watch-topic suggestions, shape-appropriate (free text rides on top). */
export const WATCH_TOPIC_SUGGESTIONS: Record<
  IcpShape,
  { kinds: Array<"topic" | "competitor" | "area">; byVertical: Record<string, string[]>; fallback: string[] }
> = {
  company: {
    kinds: ["topic", "competitor"],
    byVertical: {
      saas: ["Pricing pages", "Migration guides", "Your competitors' names"],
      agency: ["Briefs you win", "Your competitors' names", "Categories you serve"],
    },
    fallback: ["What you sell", "Your category", "Your competitors' names"],
  },
  local_business: {
    kinds: ["topic", "area"],
    byVertical: {
      dental: ["Implants", "Aligners", "Emergency visits", "Your service areas"],
      salon: ["Colour services", "Bridal bookings", "Your service areas"],
      trades: ["Emergency call-outs", "Renovations", "Your service areas"],
      fitness: ["Class types", "Personal training", "Your service areas"],
      legal: ["Matters you take", "Your service areas"],
    },
    fallback: ["Your main services", "Your service areas"],
  },
  consumer: {
    kinds: ["topic", "area"],
    byVertical: {
      dental: ["Treatment interests your patients ask about", "Your service areas"],
      ecommerce: ["Products people ask about"],
      education: ["Courses people ask about"],
    },
    fallback: ["What your customers ask about", "Where they are"],
  },
};

/** Direct-mode filter sets per shape (labels + cycle options). */
export interface DirectFilterDef {
  key: string;
  label: string;
  options: string[];
}
export const DIRECT_FILTERS: Record<IcpShape, DirectFilterDef[]> = {
  company: [
    { key: "industry", label: "INDUSTRY", options: ["Software", "Services", "Manufacturing", "Any industry"] },
    { key: "size", label: "SIZE", options: ["1–10", "11–50", "51–200", "200+", "Any size"] },
    { key: "funding", label: "FUNDING", options: ["Bootstrapped", "Seed–A", "B and later", "Any"] },
    { key: "seniority", label: "DECISION MAKER", options: ["Founder / C-suite", "Director", "Manager", "Anyone reachable"] },
  ],
  local_business: [
    { key: "category", label: "WHAT THEY ARE", options: ["Your category", "Adjacent categories", "Any local business"] },
    { key: "radius", label: "WHERE", options: ["10 mi", "25 mi", "50 mi", "Statewide"] },
    { key: "size", label: "SIZE", options: ["1–4 staff", "5–25 staff", "25–100 staff", "Any size"] },
    { key: "owner", label: "DECISION MAKER", options: ["Owner-run", "Manager", "Anyone reachable"] },
  ],
  /** Consumer-shape Direct search is scoped to the workspace's own contacts:
   *  a person-level provider search is not something we offer (ADDENDUM_5
   *  §7 / SURFACE_SPEC §7). The filters describe your own book. */
  consumer: [
    { key: "area", label: "WHERE", options: ["Your service area", "Wider area", "Anywhere"] },
    { key: "history", label: "HISTORY", options: ["Been in touch", "Never worked", "Anyone"] },
  ],
};
