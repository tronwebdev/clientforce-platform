/**
 * Console Bold — B0 shell data (fixture + static maps).
 *
 * Everything here is either a STATIC map ported verbatim from the prototype's
 * render script (`design_handoff_console_v3/prototypes/Console Bold.dc.html`)
 * or clearly-marked B0 FIXTURE content mirroring the prototype's sample data.
 * B0 ports the shell chrome only; each later wave replaces the fixture slice
 * it owns with live reads (B1 rail campaigns · B4 site agent/receptionist ·
 * B7 credits/core · …). Nothing in this file reaches the API.
 */

export type BoldSurface =
  | "campaign"
  | "rcp"
  | "wsinbox"
  | "contacts"
  | "lead"
  | "automations"
  | "forms"
  | "chatbot"
  | "proposals"
  | "analytics"
  | "integrations"
  | "wssettings"
  | "credits"
  | "camps"
  | "activity";

/* ---------------------------------------------------------------- fixture */

// B1 (DEC-104): the B0 campaign-list and Ada-suggestion fixtures are RETIRED —
// the rail reads live AgentListItem rows, and Ada's proposals render only when
// a real proposal source ships (Q-066: no engine exists; nothing canned
// renders as live). ALWAYS ON and the core card stay fixture until B4/B7.

/** B0 FIXTURE — the ALWAYS ON / INBOUND block (B4 wires the one-flag truth). */
export const FIXTURE_ALWAYS_ON = {
  siteAgent: { installed: true, busy: true, sub: "2 chatting now · 14 booked this month", value: "$33.6k" },
  receptionist: { owned: false, sub: "Add-on — your line goes to voicemail", value: "$39/mo" },
} as const;

/** B0 FIXTURE — ICP + credits card (B7 wires the business core + spend). */
export const FIXTURE_CORE = {
  name: "Business core",
  sector: "Implants · Austin, TX",
  facts: "14 facts",
  gaps: "2 gaps",
  credits: "2,340",
  creditPct: 58,
} as const;

/* ------------------------------------------------- surface title map (SURF) */

/** Ported verbatim from the prototype's SURF map: surface → [eyebrow, title]. */
export const SURFACE_TITLES: Record<Exclude<BoldSurface, "campaign">, [string, string]> = {
  contacts: ["312 PEOPLE", "Contacts"],
  proposals: ["4 DOCUMENTS", "Proposals"],
  forms: ["3 FORMS · 43 RESPONSES", "Forms"],
  chatbot: ["INBOUND CHANNEL · ON YOUR SITE", "Site agent"],
  automations: ["5 RULES · 3 ON", "Automations"],
  lead: ["LEAD FINDER", "Find who fits"],
  camps: ["4 CAMPAIGNS", "Campaigns"],
  credits: ["WORKSPACE", "Credits and billing"],
  analytics: ["WORKSPACE · ALL CAMPAIGNS", "Analytics"],
  wssettings: ["WORKSPACE", "Settings"],
  wsinbox: ["WORKSPACE · 5 CONVERSATIONS", "Inbox"],
  integrations: ["3 CONNECTED · 2 ADD-ONS", "Integrations"],
  rcp: ["ADD-ON · INBOUND CALLS", "AI Receptionist"],
  activity: ["AGENT ACTIVITY", "Everything Ada did"],
};

/** Which wave delivers each surface — shown on the B0 canvas stub. */
export const SURFACE_WAVE: Record<BoldSurface, string> = {
  campaign: "B1 · campaign console",
  camps: "B1 · campaign console",
  wsinbox: "B3 · workspace inbox",
  contacts: "B3 · contacts",
  lead: "B6 · lead finder",
  automations: "B5 · automations",
  forms: "B5 · forms",
  chatbot: "B4 · site agent",
  rcp: "B4 · receptionist add-on",
  proposals: "B5 · proposals",
  analytics: "B8 · analytics",
  integrations: "B8 · integrations",
  wssettings: "B7 · settings & business core",
  credits: "B7 · credits spend view",
  activity: "B1 · campaign console",
};

/* --------------------------------------------------------- Ada map (ADAMAP) */

export interface AdaContext {
  where: string;
  hint: string;
  chips: string[];
}

/** Ported verbatim from the prototype's ADAMAP (page-aware prompts). */
export const ADA_MAP: Record<string, AdaContext> = {
  "campaign:overview": {
    where: "Ada · {camp}",
    hint: "Ask about this campaign…",
    chips: ["Why is this working?", "What needs me?", "Where is my money going?"],
  },
  contacts: {
    where: "Ada · contacts",
    hint: "Ask her to segment or import…",
    chips: ["Upload a CSV", "Segment my customers", "Who is worth a call?"],
  },
  lead: {
    where: "Ada · lead finder",
    hint: "Describe who you want…",
    chips: ["Practices like my best customers", "Add the top 5 to a list", "Who is hiring?"],
  },
  automations: {
    where: "Ada · automations",
    hint: "Ask her to build a rule…",
    chips: ["Build one for no-shows", "What should I automate?", "Turn off the noisy one"],
  },
  forms: {
    where: "Ada · forms",
    hint: "Ask her to build a form…",
    chips: ["Build a booking form", "Where do responses go?", "Add a phone field"],
  },
  chatbot: {
    where: "Ada · site agent",
    hint: "Ask her to build an assistant…",
    chips: ["Build one for the open day", "Change the greeting", "What does it get wrong?"],
  },
  proposals: {
    where: "Ada · proposals",
    hint: "Ask her to draft one…",
    chips: ["Draft one for Leo", "Why has Marcus not signed?", "Add financing options"],
  },
  analytics: {
    where: "Ada · analytics",
    hint: "Ask across every campaign…",
    chips: ["Which campaign earns most?", "Where am I losing people?", "Build me a report"],
  },
  integrations: {
    where: "Ada · integrations",
    hint: "Ask what to connect…",
    chips: ["What should I connect?", "Fix HubSpot", "What do add-ons cost?"],
  },
  rcp: {
    where: "Ada · receptionist",
    hint: "Ask about the add-on…",
    chips: ["What does she say?", "How does hand-over work?", "Show a transcript"],
  },
  wssettings: {
    where: "Ada · workspace",
    hint: "Ask about your setup…",
    chips: ["What are my knowledge gaps?", "Add a sender", "Who is on the team?"],
  },
  wsinbox: {
    where: "Ada · all conversations",
    hint: "Ask across campaigns…",
    chips: ["Who is waiting longest?", "Draft every pending reply", "Anything urgent?"],
  },
  credits: {
    where: "Ada · workspace",
    hint: "Ask about your setup…",
    chips: ["What are my knowledge gaps?", "Add a sender", "Who is on the team?"],
  },
  camps: {
    where: "Ada · {camp}",
    hint: "Ask about this campaign…",
    chips: ["Why is this working?", "What needs me?", "Where is my money going?"],
  },
};

export function adaContextFor(surface: BoldSurface, campaignName: string): AdaContext {
  const key = surface === "campaign" ? "campaign:overview" : surface;
  const ctx = ADA_MAP[key] ?? (ADA_MAP["campaign:overview"] as AdaContext);
  return { ...ctx, where: ctx.where.replace("{camp}", campaignName) };
}

/* ------------------------------------------------------------------- dock */

export interface BoldDockDef {
  key: BoldSurface;
  name: string;
  /** SVG path, ported verbatim from the prototype's DOCK array (Style A). */
  d: string;
}

/** 11 tiles, order fixed (ADDENDUM_4_BOLD §3) — Receptionist alone at top. */
export const DOCK_DEFS: BoldDockDef[] = [
  { key: "rcp", name: "Receptionist", d: "M4 5.5c0 8 6.5 14.5 14.5 14.5v-3.2l-4-1.6-2 2A11 11 0 0 1 7.3 11l2-2L7.7 5H4.5z" },
  { key: "wsinbox", name: "Inbox", d: "M3 5h18v14H3zM3 5l9 7 9-7" },
  { key: "contacts", name: "Contacts", d: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" },
  { key: "lead", name: "Lead finder", d: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5" },
  { key: "automations", name: "Automations", d: "M13 2 4 14h7l-1 8 9-12h-7z" },
  { key: "forms", name: "Forms", d: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h3" },
  { key: "chatbot", name: "Site agent", d: "M4 5h16v11H9l-5 4z" },
  { key: "proposals", name: "Proposals", d: "M7 3h7l5 5v13H7zM14 3v5h5" },
  { key: "analytics", name: "Analytics", d: "M4 20V9M10 20V4M16 20v-8M22 20H2" },
  { key: "integrations", name: "Integrations", d: "M9 3v5.5M15 3v5.5M6.5 8.5h11l-1 6.2a4.6 4.6 0 0 1-9 0zM12 15v6" },
  {
    key: "wssettings",
    name: "Settings",
    d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z",
  },
];

/** Dynamic dock tile title per state (ADDENDUM_4_BOLD §3). */
export function dockTileTitle(def: BoldDockDef): string {
  if (def.key === "rcp" && FIXTURE_ALWAYS_ON.receptionist.owned) return "Receptionist · live";
  if (def.key === "chatbot") {
    if (!FIXTURE_ALWAYS_ON.siteAgent.installed) return "Site agent · not on your site";
    if (FIXTURE_ALWAYS_ON.siteAgent.busy) return "Site agent · 2 chatting";
  }
  return def.name;
}

/* ------------------------------------------------------------------- tour */

export interface BoldTourStep {
  ch: string;
  sel: string;
  title: string;
  body: string;
  grow?: boolean;
  pre?: { surface?: BoldSurface; tab?: string };
}

/**
 * The full 14-step table, ported verbatim from the prototype's tourSteps().
 * The B0 scaffold runs only steps whose `data-tour` anchor exists in the DOM
 * (hero/act/tabs arrive with B1 and light their steps up by existing).
 */
export const TOUR_STEPS: BoldTourStep[] = [
  {
    ch: "THE SHAPE",
    sel: "ws",
    title: "Everything sits inside a workspace",
    body: "One business, one set of senders, one business core. Agencies run several — the badge tells you when another one needs a person.",
  },
  {
    ch: "THE SHAPE",
    sel: "camps",
    title: "One campaign per goal",
    body: "Not per channel. Each row shows what it has produced in money, not opens. ✦ marks the ones Ada proposed herself.",
  },
  {
    ch: "THE SHAPE",
    sel: "sugg",
    title: "She proposes work you have not asked for",
    body: "Read from your own data — lapsed patients, quiet customers, review gaps. Start it and it becomes a normal campaign. Dismiss and she stops suggesting it.",
  },
  {
    ch: "THE SHAPE",
    sel: "core",
    title: "What she knows, and what it costs",
    body: "The business core is where prices, hours and rules live — she never invents an answer outside it. Credits burn only when something leaves the building.",
  },
  {
    ch: "A CAMPAIGN",
    sel: "hero",
    title: "The number is money, not activity",
    body: "Goal, brief, value booked so far, and pace against target. Underneath: the three counts that produced it.",
    pre: { surface: "campaign", tab: "overview" },
  },
  {
    ch: "A CAMPAIGN",
    sel: "act",
    grow: true,
    title: "Every decision she made, in order",
    body: "Sends, replies, bookings, objections, and the ones she held back. Each row opens what it refers to — a person, or all 22 recipients of a send.",
  },
  {
    ch: "A CAMPAIGN",
    sel: "tabs",
    title: "Pipeline is people, not stages you maintain",
    body: "She moves contacts herself as replies land. Board or list, and every card opens the contact.",
    pre: { surface: "campaign", tab: "pipeline" },
  },
  {
    ch: "A CAMPAIGN",
    sel: "tabs",
    title: "The plan, and what happens off-plan",
    body: "The sequence is only what she sends. Below it sit the branch rules — interested, question, price pushback, silence — which run without you.",
    pre: { surface: "campaign", tab: "plan" },
  },
  {
    ch: "A CAMPAIGN",
    sel: "tabs",
    title: "The inbox is where you step in",
    body: "Filter by channel or status. She drafts; you send, rewrite, move or call. Nothing sends behind your back when approval is on.",
    pre: { surface: "campaign", tab: "inbox" },
  },
  {
    ch: "THE WORKSPACE",
    sel: "dock",
    title: "Everything else lives on the dock",
    body: "Inbox, contacts, lead finder, automations, forms, chatbot, proposals, analytics, integrations, settings. The receptionist sits on top with a live dot when she is answering your line.",
    pre: { surface: "campaign", tab: "overview" },
  },
  {
    ch: "THE WORKSPACE",
    sel: "canvas",
    title: "Find new business three ways",
    body: "Her matches from your closed business, your own filters, or a direct people search with reveal-per-credit. Intent signals arrive through BuyerPing.",
    pre: { surface: "lead" },
  },
  {
    ch: "THE WORKSPACE",
    sel: "canvas",
    title: "You build things by asking",
    body: "Forms, chatbots, proposals and automations all have the same two doors: build it yourself, or let Ada walk you through every field. She never invents copy your core cannot support.",
    pre: { surface: "forms" },
  },
  {
    ch: "THE WORKSPACE",
    sel: "canvas",
    title: "Add-ons extend what she can do",
    body: "Calendars, Stripe, Slack and Zapier are plumbing. Ads Closed Loop pushes receipted money back to Meta and Google so their bidding optimises on revenue.",
    pre: { surface: "integrations" },
  },
  {
    ch: "ADA",
    sel: "ada",
    title: "This bar changes with the page",
    body: "On a campaign it asks about that campaign. On contacts it segments and imports. On forms it builds one. Type, or take one of her suggestions.",
    pre: { surface: "campaign", tab: "overview" },
  },
];

/** Workspace-mark gradients cycled by membership index (prototype palette). */
export const WS_MARKS = [
  "var(--cvb-gradient-mark)",
  "var(--cvb-gradient-mark-2)",
  "var(--cvb-gradient-mark-3)",
] as const;
