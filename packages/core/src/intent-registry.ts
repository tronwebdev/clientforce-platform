import { type IcpShape } from "./icp";

/**
 * B6 (DEC-131, ruling 3): intent is multi-industry BY CONSTRUCTION — the
 * signal taxonomy, source eligibility, Direct-mode filter sets and
 * watch-topic suggestions are REGISTRY DATA keyed by shape (+ vertical),
 * never code paths. Adding an industry = rows here, not new code.
 *
 * Receipt templates carry the vertical vocabulary ("asked about pricing
 * twice this week", "hiring right now"); `{n}` interpolates a count.
 * Weights and half-lives are NON-BLOCKING defaults for owner tuning.
 */
export interface IntentSignalDef {
  /** Which ICP shapes this signal applies to. */
  shapes: IcpShape[];
  source: "first_party" | "provider";
  weight: number;
  halfLifeDays: number;
  receipt: string;
  byVertical?: Record<string, { receipt?: string }>;
}

export const INTENT_SIGNALS: Record<string, IntentSignalDef> = {
  // ── first-party (free tier, real-time, every shape) ──
  chat_started: {
    shapes: ["company", "local_business", "consumer"],
    source: "first_party",
    weight: 4,
    halfLifeDays: 7,
    receipt: "started a chat on your site",
  },
  lead_captured: {
    shapes: ["company", "local_business", "consumer"],
    source: "first_party",
    weight: 8,
    halfLifeDays: 14,
    receipt: "left their details through your site",
  },
  form_submitted: {
    shapes: ["company", "local_business", "consumer"],
    source: "first_party",
    weight: 8,
    halfLifeDays: 14,
    receipt: "filled in one of your forms",
  },
  reply_interested: {
    shapes: ["company", "local_business", "consumer"],
    source: "first_party",
    weight: 10,
    halfLifeDays: 10,
    receipt: "replied and sounded interested",
  },
  pricing_asked: {
    shapes: ["company", "local_business", "consumer"],
    source: "first_party",
    weight: 9,
    halfLifeDays: 10,
    receipt: "asked about pricing",
    byVertical: { dental: { receipt: "asked what treatment would cost" } },
  },
  link_clicked: {
    shapes: ["company", "local_business", "consumer"],
    source: "first_party",
    weight: 3,
    halfLifeDays: 5,
    receipt: "opened a link you sent",
  },
  call_finished: {
    shapes: ["company", "local_business", "consumer"],
    source: "first_party",
    weight: 6,
    halfLifeDays: 10,
    receipt: "was on a call with you",
  },
  meeting_booked: {
    shapes: ["company", "local_business", "consumer"],
    source: "first_party",
    weight: 12,
    halfLifeDays: 21,
    receipt: "booked time with you",
  },
  // ── provider-derived warm signals (never for consumer shape) ──
  hiring: {
    shapes: ["company", "local_business"],
    source: "provider",
    weight: 7,
    halfLifeDays: 21,
    receipt: "hiring right now",
    byVertical: { dental: { receipt: "hiring a hygienist" }, saas: { receipt: "growing the team" } },
  },
  funding: {
    shapes: ["company"],
    source: "provider",
    weight: 8,
    halfLifeDays: 30,
    receipt: "just raised funding",
    byVertical: { saas: { receipt: "just raised a round" } },
  },
  tech_change: {
    shapes: ["company"],
    source: "provider",
    weight: 5,
    halfLifeDays: 30,
    receipt: "changed their tooling",
  },
};

/** Ruling 3 source eligibility: consumer = first-party ONLY, ever. */
export const SOURCE_ELIGIBILITY: Record<IcpShape, Array<"first_party" | "provider">> = {
  company: ["first_party", "provider"],
  local_business: ["first_party", "provider"],
  consumer: ["first_party"],
};

export function intentReceipt(type: string, vertical?: string | null): string | null {
  const def = INTENT_SIGNALS[type];
  if (!def) return null;
  if (vertical) {
    const flavored = def.byVertical?.[vertical]?.receipt;
    if (flavored) return flavored;
  }
  return def.receipt;
}

/** Recency decay: weight halved every halfLifeDays. */
export function decayedWeight(type: string, occurredAt: Date, now = new Date()): number {
  const def = INTENT_SIGNALS[type];
  if (!def) return 0;
  const days = Math.max(0, (now.getTime() - occurredAt.getTime()) / 86_400_000);
  return def.weight * Math.pow(0.5, days / def.halfLifeDays);
}

/** Watch-topic suggestions, shape-appropriate (free text rides on top). */
export const WATCH_TOPIC_SUGGESTIONS: Record<
  IcpShape,
  { kinds: Array<"topic" | "competitor" | "area">; byVertical: Record<string, string[]>; fallback: string[] }
> = {
  company: {
    kinds: ["topic", "competitor"],
    byVertical: { saas: ["Pricing pages", "Migration guides", "Your competitors' names"] },
    fallback: ["What you sell", "Your category", "Your competitors' names"],
  },
  local_business: {
    kinds: ["topic", "area"],
    byVertical: {
      dental: ["Implants", "Aligners", "Emergency visits", "Your service areas"],
      salon: ["Colour services", "Bridal bookings", "Your service areas"],
    },
    fallback: ["Your main services", "Your service areas"],
  },
  consumer: {
    kinds: ["topic"],
    byVertical: { dental: ["Treatment interests your patients ask about"] },
    fallback: ["What your customers ask about"],
  },
};

/** Direct-mode filter sets per shape (labels + cycle options). Consumer-shape
 *  workspaces get NO provider search — the registry says so explicitly. */
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
  consumer: [],
};
