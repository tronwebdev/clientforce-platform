import type { GoalKey } from "./context";
import type { IcpShape } from "./icp";

/**
 * B9 revision (DEC-137): the AUDIENCE registry — who a goal is allowed to be
 * pointed at, and how many audiences one campaign brief can carry.
 *
 * Registry data, not UI constants: the onboarding's audience step reads this,
 * so the options a person sees are derived from the goal they just picked
 * rather than typed into a screen (the DEC-129/131 rule — a hard-coded B2B
 * noun in a shared surface is a review defect).
 *
 * WHY A SIBLING TABLE, not fields on `GOAL_META`: `GOAL_META` is the
 * owner-approved terminal-label table and `packages/core/test/goal-meta.test.ts`
 * pins it by deep value equality AND pins its key set — extra fields fail the
 * pin by design. `GOAL_VALUE_META` (goal-value.ts) set the precedent for
 * per-goal metadata living beside it: "in code beside GOAL_META… no migration
 * for words".
 *
 * RELATION TO `GOAL_FIT` (apps/web/lib/goal-fit.ts): that is the shipped
 * 2-valued cousin (`existing_audience | prospecting`) driving the create
 * wizard's step-4 default. It is web-only, so the API and worker cannot read
 * it, and it has no `mixed`. This table is 3-valued and lives in core; the two
 * agree wherever `GOAL_FIT` is decisive (every `existing_audience` goal is
 * `own_book` here). Folding one into the other is its own ruling.
 */

/** Where a goal's people come from. `mixed` = either is legitimate. */
export const AUDIENCE_SCOPES = ["own_book", "new_demand", "mixed"] as const;
export type AudienceScope = (typeof AUDIENCE_SCOPES)[number];

export interface GoalAudienceMeta {
  /** Which audience shapes this goal may point at. */
  scope: AudienceScope;
  /** How many audiences one brief can carry (the proto's per-goal cap). */
  max: number;
}

/**
 * Per-goal audience rules. The four goals the onboarding offers carry the
 * canon prototype's own values verbatim (lead/book/sell/revive → scope + max);
 * the remaining keys follow the shipped `GOAL_FIT` orientation, so nothing
 * here contradicts the create wizard's default.
 *
 * Win-back-shaped goals cap at 2: there are only so many ways to describe
 * people you already have.
 */
export const GOAL_AUDIENCE: Record<GoalKey, GoalAudienceMeta> = {
  // Canon prototype rows (revised Business Core Onboarding, GOALS registry).
  generate_leads: { scope: "new_demand", max: 3 }, // proto `lead`
  book_appointments: { scope: "mixed", max: 3 }, // proto `book`
  drive_signups: { scope: "mixed", max: 3 }, // proto `sell` (mapping: Q-121)
  winback_deals: { scope: "own_book", max: 2 }, // proto `revive` (mapping: Q-121)
  // The rest, aligned to GOAL_FIT: existing_audience → own_book.
  reactivate_leads: { scope: "own_book", max: 2 },
  collect_reviews: { scope: "own_book", max: 2 },
  upsell_clients: { scope: "own_book", max: 2 },
  accept_quotes: { scope: "own_book", max: 2 },
  nurture_leads: { scope: "own_book", max: 2 },
  promote_offer: { scope: "mixed", max: 3 },
  fill_event: { scope: "mixed", max: 3 },
  custom: { scope: "mixed", max: 3 },
};

export const goalAudienceOf = (goal: string | null | undefined): GoalAudienceMeta =>
  GOAL_AUDIENCE[(goal ?? "") as GoalKey] ?? { scope: "mixed", max: 3 };

/** The shape an audience option draws its people from. */
export type AudienceOptionShape = AudienceScope | "any";

export interface AudienceOption {
  key: string;
  /** Where these people come from — `any` fits every goal. */
  shape: AudienceOptionShape;
  label: string;
  sub: string;
  /** The option is a free-text description rather than a defined segment. */
  describe?: boolean;
}

/** Copy verbatim from the revised canon prototype's `ICP_ALL`. */
export const AUDIENCE_OPTIONS: readonly AudienceOption[] = [
  {
    key: "match",
    shape: "new_demand",
    label: "New people who match your best customers",
    sub: "She goes and finds them — matched on the buyer your offer already speaks to",
  },
  {
    key: "inbound",
    shape: "new_demand",
    label: "Anyone who asks about you",
    sub: "Inbound only — website chats, forms, calls. Widest net, lowest fit.",
  },
  {
    key: "quiet",
    shape: "own_book",
    label: "Customers who went quiet",
    sub: "Already in your records, already know you. Cheapest revenue you have.",
  },
  {
    key: "never_bought",
    shape: "own_book",
    label: "Enquiries that never bought",
    sub: "They asked once and went cold — she picks the thread back up",
  },
  {
    key: "describe",
    shape: "any",
    label: "Let me describe them myself",
    sub: "Industry, size, role, region — whatever defines a good one",
    describe: true,
  },
];

/** The options a goal's scope allows — `mixed` allows everything. */
export const audienceOptionsFor = (scope: AudienceScope): AudienceOption[] =>
  AUDIENCE_OPTIONS.filter((o) => o.shape === "any" || scope === "mixed" || o.shape === scope);

/** True when a pick draws on people the workspace already has (the contacts
 *  step exists only then — the ruling says "any picked audience is
 *  own-book-shaped", not merely that the goal is). */
export const isOwnBookAudience = (key: string): boolean =>
  AUDIENCE_OPTIONS.find((o) => o.key === key)?.shape === "own_book";

export const audienceLabel = (key: string): string =>
  AUDIENCE_OPTIONS.find((o) => o.key === key)?.label ?? key;

/**
 * The plural SUBJECT noun a signal line counts, keyed by the shape of the
 * people being described. Registry data so the noun is never hard-coded: a
 * consumer-target workspace reads "11 families…", a company-target one reads
 * "3 businesses…" — and a vertical may flavour it ("practices" for dental).
 *
 * SEEDED, NOT COMPLETE (Q-122). Every string here is the owner's own wording
 * from the ruling; the full per-shape × per-vertical vocabulary is
 * owner-approved copy that does not exist in the repo yet. Nothing renders it
 * today — the outside-world count that would feed it has no producer
 * (Q-105/Q-106 both OPEN), so the line is absent on every deployment. The
 * registry exists so that when a producer lands, the noun comes from here.
 */
export const SHAPE_SIGNAL_NOUN: Record<IcpShape, string> = {
  consumer: "families",
  local_business: "businesses",
  company: "businesses",
};

/** Vertical flavours, applied over the shape noun where the trade has its own
 *  word for its people (Q-122 for the full vocabulary). */
export const VERTICAL_SIGNAL_NOUN: Record<string, string> = {
  dental: "practices",
};

export const signalNounFor = (shape: IcpShape, vertical?: string | null): string =>
  (vertical ? VERTICAL_SIGNAL_NOUN[vertical] : undefined) ?? SHAPE_SIGNAL_NOUN[shape];
