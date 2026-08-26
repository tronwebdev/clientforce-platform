"use client";

import type { CampaignGraph } from "@clientforce/core";

/**
 * Create-campaign vocabulary (B2.5, DEC-108/DEC-109) — the Bold-canon ten
 * goal kinds mapped onto the SHIPPED GoalKeys (Q-067: seven kinds map to
 * existing keys — renew rides `upsell_clients`; quote/nurture/winback are the
 * DEC-109 EXTEND), plus the shipped `custom` goal as an eleventh card so no
 * capability is lost (Q-073). Card copy is the prototype's, verbatim; the
 * value-basis line is GOAL_VALUE_META vocabulary rendered by the view.
 */

export interface CreateGoalCard {
  key: string;
  ic: string;
  title: string;
  sub: string;
  /** [icon bg, icon line, icon ink] — Bold tones. */
  tint: [string, string, string];
}

export const CREATE_GOALS: CreateGoalCard[] = [
  { key: "book_appointments", ic: "◷", title: "Book appointments", sub: "Consults, viewings, calls — anything on a calendar.", tint: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"] },
  { key: "promote_offer", ic: "◆", title: "Sell a product", sub: "A fixed-price thing, paid up front.", tint: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"] },
  { key: "reactivate_leads", ic: "⟳", title: "Bring people back", sub: "Dormant customers who already trust you.", tint: ["var(--cvb-amber-bg)", "var(--cvb-amber-line)", "var(--cvb-amber)"] },
  { key: "collect_reviews", ic: "★", title: "Collect reviews", sub: "Ask happy customers at the right moment.", tint: ["#f0edf9", "#dcd5ef", "#5b4a8a"] },
  { key: "generate_leads", ic: "◉", title: "Find new business", sub: "Reach people who have never heard of you.", tint: ["var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"] },
  { key: "accept_quotes", ic: "✎", title: "Get quotes accepted", sub: "Proposals and estimates already sent, waiting on a yes.", tint: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"] },
  { key: "fill_event", ic: "⛨", title: "Fill an event", sub: "An open day, webinar or clinic with a fixed date and seats.", tint: ["var(--cvb-amber-bg)", "var(--cvb-amber-line)", "var(--cvb-amber)"] },
  { key: "upsell_clients", ic: "↻", title: "Renew or resubscribe", sub: "Plans, memberships and recalls coming up for renewal.", tint: ["var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"] },
  { key: "nurture_leads", ic: "◌", title: "Warm people up slowly", sub: "Not ready yet. Stay useful until they are.", tint: ["var(--cvb-well)", "var(--cvb-line-ctl)", "var(--cvb-muted)"] },
  { key: "winback_deals", ic: "⤾", title: "Win back lost deals", sub: "People who said no or went quiet mid-conversation.", tint: ["var(--cvb-danger-bg)", "#f0d2cb", "var(--cvb-danger)"] },
  // Q-073: the shipped `custom` goal keeps a create path (not in the canon
  // ten — the eleventh card is the capability-preserving addition, flagged).
  { key: "custom", ic: "✱", title: "Something else", sub: "Describe the goal in your own words.", tint: ["var(--cvb-well)", "var(--cvb-line-ctl)", "var(--cvb-ink)"] },
];

/** Per-goal spec question (designed copy; the free-text answer becomes the
 *  campaign's goal summary — the Q-069 write) + the mechanism line. */
export const SPEC_QUESTIONS: Record<string, { q: string; ph: string; core: string }> = {
  book_appointments: { q: "What are you booking?", ph: "e.g. Implant consults for the 21st", core: "Availability and pricing come from your business core — she never invents them." },
  promote_offer: { q: "Which product or offer?", ph: "e.g. The take-home whitening kit", core: "Prices come from your business core, so she never invents one." },
  reactivate_leads: { q: "Who is coming back?", ph: "e.g. Patients we haven't seen in 18 months", core: "She reads the relationship from your records before writing." },
  collect_reviews: { q: "Which platform matters most?", ph: "e.g. Google reviews", core: "She only asks people with a good record on file." },
  generate_leads: { q: "Who are you trying to reach?", ph: "e.g. Practices like our best customers", core: "She grounds every claim in your business core." },
  accept_quotes: { q: "Which quotes are waiting?", ph: "e.g. Quotes sent in the last three months", core: "Pricing context comes from your business core, so the follow-up is concrete." },
  fill_event: { q: "Which event?", ph: "e.g. The open day on the 21st", core: "Date and details come from what she knows — fill the gaps in the next step." },
  upsell_clients: { q: "What is renewing or upgrading?", ph: "e.g. Six-month recalls", core: "The pitch grounds in the pricing on file." },
  nurture_leads: { q: "What are you staying useful with?", ph: "e.g. Monthly tips and treatment news", core: "Tone stays soft. No offers unless they ask." },
  winback_deals: { q: "Why did they walk?", ph: "e.g. Mostly price — a cheaper quote", core: "She answers the objection honestly, from your business core." },
  custom: { q: "Describe the goal in one line.", ph: "e.g. Get 20 lapsed members to a reactivation call", core: "The one-liner leads the campaign everywhere — pick it carefully." },
};

/**
 * The MECHANICAL starter sequence (DEC-108) — the deterministic path when the
 * AI planner is unavailable or the owner prefers to start simple. This is a
 * scaffold assembled from the shipped default-copy convention (`addStep`'s
 * merge-token placeholders), labeled as such in the UI — it is never
 * presented as Ada's plan. It writes through the ONE graph path
 * (`PUT /planner/graph`) like every other edit.
 */
export function starterGraph(channels: { sms: boolean }): CampaignGraph {
  const nodes: CampaignGraph["nodes"] = [
    {
      id: "create-step-1",
      type: "step",
      channel: "email",
      content: {
        subject: "Quick question for {{company}}",
        body: "Hi {{firstName}} — reaching out to see if this is relevant for {{company}}. Worth a quick look?",
      },
    },
    { id: "create-delay-1", type: "delay", amount: 3, unit: "days" },
    {
      id: "create-step-2",
      type: "step",
      channel: "email",
      content: {
        body: "Hi {{firstName}}, one more thought for {{company}} — happy to share details if useful.",
        threaded: true,
      },
    },
  ];
  const edges: CampaignGraph["edges"] = [
    { from: "create-step-1", to: "create-delay-1" },
    { from: "create-delay-1", to: "create-step-2" },
  ];
  let tail = "create-step-2";
  if (channels.sms) {
    nodes.push(
      { id: "create-delay-2", type: "delay", amount: 2, unit: "days" },
      {
        id: "create-step-3",
        type: "step",
        channel: "sms",
        content: {
          body: "Hi {{firstName}} — quick nudge from our side. Reply YES and we'll take it from there.",
        },
      },
    );
    edges.push({ from: tail, to: "create-delay-2" }, { from: "create-delay-2", to: "create-step-3" });
    tail = "create-step-3";
  }
  nodes.push(
    {
      id: "create-branch-reply",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "create-reply-1", pipeline: "interested" },
        { when: "default", goto: "create-end" },
      ],
    },
    {
      id: "create-reply-1",
      type: "step",
      channel: "email",
      content: {
        body: "Great — what does your schedule look like this week?",
        threaded: true,
      },
    },
    { id: "create-end", type: "end" },
  );
  edges.push({ from: tail, to: "create-branch-reply" }, { from: "create-reply-1", to: "create-end" });
  return { entry: "create-step-1", nodes, edges };
}
