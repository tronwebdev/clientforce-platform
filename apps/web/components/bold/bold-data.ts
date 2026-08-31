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
  | "activity"
  | "newcamp";

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

// B7 (DEC-133): the B0 FIXTURE_CORE card is retired — the rail's Business
// core + credits card reads live queries (fetchCoreSummary in bold-live).

/* ------------------------------------------------- surface title map (SURF) */

/** Ported verbatim from the prototype's SURF map: surface → [eyebrow, title]. */
export const SURFACE_TITLES: Record<Exclude<BoldSurface, "campaign">, [string, string]> = {
  contacts: ["312 PEOPLE", "Contacts"],
  // B5 (DEC-130): live surfaces compose their eyebrows from queries in the
  // shell — these are the pre-load fallbacks, never a canned count.
  proposals: ["DOCUMENTS", "Proposals"],
  forms: ["FORMS", "Forms"],
  chatbot: ["INBOUND CHANNEL · ON YOUR SITE", "Site agent"],
  automations: ["RULES", "Automations"],
  lead: ["LEAD FINDER", "Find who fits"],
  camps: ["4 CAMPAIGNS", "Campaigns"],
  // The hub card, the spec and this page all say "usage": a workspace spends
  // credits, and its plan, card and invoices live in the account area.
  credits: ["WORKSPACE", "Credits and usage"],
  analytics: ["WORKSPACE · ALL CAMPAIGNS", "Analytics"],
  wssettings: ["WORKSPACE", "Settings"],
  wsinbox: ["WORKSPACE · 5 CONVERSATIONS", "Inbox"],
  // B8 (DEC-135): the eyebrow count is LIVE (the shell overrides with the
  // real connected count) — the B0 fixture string is retired.
  integrations: ["WORKSPACE", "Integrations"],
  rcp: ["ADD-ON · INBOUND CALLS", "AI Receptionist"],
  activity: ["AGENT ACTIVITY", "Everything Ada did"],
  // B2.5 (DEC-108): the create-campaign surface (prototype `SURF.newcamp`).
  newcamp: ["SET IT UP ONCE", "New campaign"],
};

/** Which wave delivers each surface — shown on the B0 canvas stub. */
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
    // B6.5: on this page the bar is the brief editor and the watch
    // controller, not a search box (ADDENDUM_5 §6c). The chips were
    // hard-coded B2B nouns — a review defect on a surface whose every other
    // noun comes from the shape/vertical registry (§6.2/§12.9). Neutral
    // until the commands are wired; wiring them is Q-146.
    hint: "Tell her what to watch…",
    chips: ["Who is worth reaching first?", "Why is this one here?", "Only show me 90 and above"],
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
export function dockTileTitle(
  def: BoldDockDef,
  widget?: { installed: boolean; busy: boolean; busyCount: number } | null,
): string {
  // B4 (DEC-124): the chatbot tile speaks the REAL overview truth; the
  // receptionist add-on has no owned state until its engine exists (Q-090).
  if (def.key === "chatbot" && widget) {
    if (!widget.installed) return "Site agent · not on your site";
    if (widget.busy) return `Site agent · ${widget.busyCount} chatting`;
  }
  return def.name;
}

/* ------------------------------------------------------------------- tour */

export interface BoldTourStep {
  sel: string;
  title: string;
  body: string;
  grow?: boolean;
  pre?: { surface?: BoldSurface; tab?: string };
}

/**
 * The 8-step arc, copy verbatim from the canon tour prototype
 * (design_handoff_console_v3/prototypes/Product Tour.dc.html, owner ruling
 * 2026-08-30). Anchors are measured from the live layout at runtime — the
 * prototype's px rects are illustration only and never ship.
 */
export const TOUR_STEPS: BoldTourStep[] = [
  {
    sel: "ada",
    title: "Meet Ada — she runs the work",
    body: "This bar is the whole product. Ask anything in plain words — she prospects, writes, calls, books and reports back. Everything else on this screen is her work, visible.",
    pre: { surface: "campaign", tab: "overview" },
  },
  {
    sel: "camps",
    title: "Campaigns are goals, not blasts",
    body: "Each row is one goal with its own money math — live dot, progress, value. Ada suggests new ones (✦) when your own data says there's money on the table.",
  },
  {
    sel: "hero",
    title: "The money is always visible",
    body: "Booked, potential at your price, realized when payment lands. Set the value once ('Edit value') and every number on this page speaks dollars honestly — no vanity metrics.",
    pre: { surface: "campaign", tab: "overview" },
  },
  {
    sel: "act",
    grow: true,
    title: "Watch it happen live",
    body: "Every send, reply, booking and call lands here as it happens — with Ada's own notes on what she's learning. Money moments get the mint chip.",
  },
  {
    sel: "needs",
    title: "When she needs you, it's one tap",
    body: "Amber rows wait for your yes — a reply to approve, a call to allow. You choose how much she decides alone in Settings; the safety rails always hold.",
  },
  {
    sel: "alwayson",
    title: "Inbound never sleeps",
    body: "The Site agent chats and books from your website around the clock; the Receptionist add-on answers your phone line. Same brain, same business facts.",
  },
  {
    sel: "core",
    title: "She only says what you told her",
    body: "Business core is Ada's memory — your prices, hours, policies. Facts she quotes; gaps she won't invent, she asks. Credits below meter what her work costs.",
  },
  {
    sel: "dock",
    title: "Everything else, one column",
    body: "Calls, inbox, contacts, lead finder, automations, forms, proposals, stats — the dock. And this tour lives under the ? button, whenever you want it again.",
  },
];

/** Workspace-mark gradients cycled by membership index (prototype palette). */
export const WS_MARKS = [
  "var(--cvb-gradient-mark)",
  "var(--cvb-gradient-mark-2)",
  "var(--cvb-gradient-mark-3)",
] as const;
