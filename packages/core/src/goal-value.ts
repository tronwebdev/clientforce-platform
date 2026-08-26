import { z } from "zod";
import { GOAL_KEYS, type GoalKey } from "./context";

/**
 * Campaign value semantics per goal (B1, Console Bold — DEC-104).
 *
 * The Bold hero expresses every goal as count AND money (`8 booked × $2,400 =
 * $19.2k potential`, ADDENDUM_4_BOLD §4.2). The repo had no value model, so
 * B1 adds the Addendum-2 §D fields as nullable columns on Agent
 * (`valueEstCents` · `valueGoalUnits` · `valueSalesGoalCents`) and this
 * registry — value WORDING per shipped goal key, living in code beside
 * GOAL_META exactly like the PLAN_GOAL_STATE label table (no migration for
 * words). Bold's ten-goal creation vocabulary maps onto the SHIPPED nine keys
 * here; extending the goal enum itself belongs to the campaign-creation wave
 * (Q-067).
 */
export interface GoalValueMeta {
  /** The Bold goal-kind chip (`Bookings`, `Product sales`, …). */
  kindLabel: string;
  /** One-line description of what the goal means (hero sub-line). */
  brief: string;
  /** What one unit of value is (`value per booking`, `no direct revenue`). */
  valueBasis: string;
  /** Noun for one completed unit (`booking`, `sale`, `review`). */
  unitNoun: string;
  /** Goals with no direct revenue never render a money expression. */
  monetary: boolean;
  /** What leads the hero: the completion COUNT (bookings-style goals) or the
   *  MONEY realized (product-sales goals) — prototype hero semantics. */
  heroMode: "count" | "money";
}

export const GOAL_VALUE_META: Record<GoalKey, GoalValueMeta> = {
  book_appointments: {
    kindLabel: "Bookings",
    brief: "Consults, viewings, calls — anything on a calendar.",
    valueBasis: "value per booking",
    unitNoun: "booking",
    monetary: true,
    heroMode: "count",
  },
  generate_leads: {
    kindLabel: "New business",
    brief: "Reach people who have never heard of you.",
    valueBasis: "value per closed deal",
    unitNoun: "qualified lead",
    monetary: true,
    heroMode: "count",
  },
  reactivate_leads: {
    kindLabel: "Win-back",
    brief: "Dormant customers who already trust you.",
    valueBasis: "average visit value",
    unitNoun: "reactivation",
    monetary: true,
    heroMode: "count",
  },
  drive_signups: {
    kindLabel: "Sign-ups",
    brief: "Trials, accounts, registrations — the first yes.",
    valueBasis: "value per sign-up",
    unitNoun: "sign-up",
    monetary: true,
    heroMode: "count",
  },
  collect_reviews: {
    kindLabel: "Reviews",
    brief: "Ask happy customers at the right moment.",
    valueBasis: "no direct revenue",
    unitNoun: "review",
    monetary: false,
    heroMode: "count",
  },
  promote_offer: {
    kindLabel: "Product sales",
    brief: "A fixed-price thing, paid up front.",
    valueBasis: "price per unit",
    unitNoun: "sale",
    monetary: true,
    heroMode: "money",
  },
  fill_event: {
    kindLabel: "Event",
    brief: "Seats filled before the date arrives.",
    valueBasis: "value per attendee",
    unitNoun: "registration",
    monetary: true,
    heroMode: "count",
  },
  upsell_clients: {
    kindLabel: "Upsell",
    brief: "Existing clients, one tier up.",
    valueBasis: "value per upgrade",
    unitNoun: "upgrade",
    monetary: true,
    heroMode: "count",
  },
  // B2.5 (DEC-109): the Q-067 EXTEND rows — Bold-canon wording verbatim.
  accept_quotes: {
    kindLabel: "Quotes",
    brief: "Proposals and estimates already sent, waiting on a yes.",
    valueBasis: "value per accepted quote",
    unitNoun: "accepted quote",
    monetary: true,
    heroMode: "count",
  },
  nurture_leads: {
    kindLabel: "Nurture",
    brief: "Not ready yet. Stay useful until they are.",
    valueBasis: "no direct revenue",
    unitNoun: "warmed lead",
    monetary: false,
    heroMode: "count",
  },
  winback_deals: {
    kindLabel: "Deal recovery",
    brief: "People who said no or went quiet mid-conversation.",
    valueBasis: "value per recovered deal",
    unitNoun: "recovered deal",
    monetary: true,
    heroMode: "count",
  },
  custom: {
    kindLabel: "Custom goal",
    brief: "The goal you described, in her words.",
    valueBasis: "value per completion",
    unitNoun: "completion",
    monetary: true,
    heroMode: "count",
  },
};

export function goalValueMeta(goalKey: string): GoalValueMeta {
  return GOAL_VALUE_META[(GOAL_KEYS as readonly string[]).includes(goalKey) ? (goalKey as GoalKey) : "custom"];
}

/**
 * The campaign's own goal sentence for the hero/list lead. Three-tier
 * resolution (Q-069, closed in B2.5/DEC-109): the guided-create summary the
 * owner typed wins; pre-enum agents carry free text in `goal` — that IS
 * their sentence; key-based agents without a summary fall back to the
 * registry brief (the exact fallback Q-069 approved).
 */
export function goalSentence(goal: string, summary?: string | null): string {
  const typed = summary?.trim();
  if (typed) return typed;
  return (GOAL_KEYS as readonly string[]).includes(goal) ? goalValueMeta(goal).brief : goal;
}

/** Additive PATCH fields for the per-campaign value estimate (owner-editable
 *  in the Bold overview strip; D0-safe — no wizard fields, edit-after). */
export const agentValueSchema = z.object({
  valueEstCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  valueGoalUnits: z.number().int().min(1).max(100_000).nullable().optional(),
  valueSalesGoalCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
});

/* ------------------------------------------------------------ activity read */

/** Bold activity row kinds (GET /agents/:id/activity). Data-shaped — the web
 *  client composes the English; the API never invents narrative. */
export const BOLD_ACTIVITY_KINDS = ["goal", "won", "reply", "send", "proposal", "call", "decision"] as const;
export type BoldActivityKind = (typeof BOLD_ACTIVITY_KINDS)[number];

export interface BoldActivityContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface BoldActivityRow {
  /** Stable row id (event id, or `send:{stepNodeId}:{day}` for aggregates). */
  id: string;
  kind: BoldActivityKind;
  occurredAt: string;
  contact: BoldActivityContact | null;
  /** Classified intent on reply rows (IntentSchema values). */
  intent: string | null;
  /** Money on won rows (payment.received.v1 / proposal.paid.v1), cents. */
  amountCents: number | null;
  /** Resolved goal-terminal label on goal rows (C2.9 wording). */
  goalLabel: string | null;
  /** Aggregated send rows: recipients in this step × UTC day. */
  count: number | null;
  stepNodeId: string | null;
  channel: string | null;
  /** UTC day key (YYYY-MM-DD) for aggregate drills. */
  day: string | null;
  /** Refusal/hold reason on decision rows. */
  reason: string | null;
}

export interface BoldActivityResponse {
  rows: BoldActivityRow[];
  /** Pass back as ?cursor= for the next (older) page; null = exhausted. */
  nextCursor: string | null;
}

/** One recipient of an aggregated send row (the `sent to 22` drill). */
export interface BoldSendRecipient {
  contact: BoldActivityContact;
  /** Furthest state this recipient reached for that step's message. */
  status: "replied" | "booked" | "opened" | "delivered" | "sent";
  sentAt: string;
}

export interface BoldSendRecipientsResponse {
  stepNodeId: string;
  day: string;
  total: number;
  recipients: BoldSendRecipient[];
}

/* ------------------------------------------------------- cross-workspace needs */

/** GET /me/needs — replies waiting in the caller's OTHER workspaces (the
 *  rail workspace-card amber pill, owner-filed to B1 on the B0 review). */
export interface WorkspaceNeeds {
  workspaceId: string;
  name: string;
  slug: string;
  /** Undone inbound messages (each one is a reply waiting until marked done). */
  repliesWaiting: number;
}

export interface MeNeedsResponse {
  elsewhere: WorkspaceNeeds[];
  totalElsewhere: number;
}
