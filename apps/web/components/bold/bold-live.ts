"use client";

import type {
  AgentListItem,
  BoldActivityRow,
  BoldSendRecipientsResponse,
  CampaignGraph,
  CampaignOutcomes,
  CampaignRuleTrigger,
  ContactListDto,
  EffectiveCreditPrices,
  Guardrails,
} from "@clientforce/core";

/**
 * Console Bold — client reads (B1, DEC-104). Everything goes through the
 * shipped `/api/cf/*` proxy (auth + workspace headers server-side); every
 * helper fails soft so a dead endpoint renders honest absence, never a crash.
 */

/** Exported so the settings write layer shares ONE proxy contract with the
 *  reads here — a second copy of this would be a second failure policy. */
export async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/cf/${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const fetchBoldAgents = () => get<AgentListItem[]>("agents");
export const fetchBoldOutcomes = (agentId: string) => get<CampaignOutcomes>(`agents/${agentId}/outcomes`);
export const fetchBoldActivity = (agentId: string, kind?: string, cursor?: string) => {
  const q = new URLSearchParams();
  if (kind && kind !== "all") q.set("kind", kind);
  if (cursor) q.set("cursor", cursor);
  const qs = q.toString();
  return get<{ rows: BoldActivityRow[]; nextCursor: string | null }>(
    `agents/${agentId}/activity${qs ? `?${qs}` : ""}`,
  );
};
export const fetchBoldRecipients = (agentId: string, stepNodeId: string | null, day: string) =>
  get<BoldSendRecipientsResponse>(
    `agents/${agentId}/activity/recipients?day=${day}${stepNodeId ? `&stepNodeId=${encodeURIComponent(stepNodeId)}` : ""}`,
  );
export interface TimelineEvent {
  id: string;
  type: string;
  payload: unknown;
  occurredAt: string;
}

/** B3a (DEC-112): the timeline read's additive `enrollments` rider — the
 *  campaigns this contact is in (§7 contact detail). */
export interface ContactEnrollmentRef {
  id: string;
  stage: string;
  status: string;
  campaignId: string | null;
  campaignName: string | null;
  agentId: string | null;
  agentName: string | null;
}

/** B2.6 signal conditions this contact meets (DEC-112(7)) — the drawer's
 *  ✦ footer renders the factual sentence, or nothing. */
export interface ContactSignalFact {
  signal: string;
  at: string;
  days?: number;
}

/** The shipped timeline read returns `{ events: [...] }` — unwrap defensively
 *  (this exact shape mismatch crashed the person drawer in review). */
/** B3b (DEC-114): the next-best-action slot's server-computed rule result —
 *  null when no rule fires (the slot then renders NOTHING). */
export interface ContactNextStep {
  key: string;
  live: boolean;
  label: string;
  provenance: string;
  campaignId?: string | null;
  agentId?: string;
  agentName?: string;
}

export const fetchContactTimeline = async (
  contactId: string,
): Promise<{
  events: TimelineEvent[];
  enrollments: ContactEnrollmentRef[];
  signalFacts: ContactSignalFact[];
  nextStep: ContactNextStep | null;
} | null> => {
  const res = await get<{
    events?: TimelineEvent[];
    enrollments?: ContactEnrollmentRef[];
    signalFacts?: ContactSignalFact[];
    nextStep?: ContactNextStep | null;
  }>(`contacts/${contactId}/timeline`);
  if (!res) return null;
  return {
    events: Array.isArray(res.events) ? res.events : [],
    enrollments: Array.isArray(res.enrollments) ? res.enrollments : [],
    signalFacts: Array.isArray(res.signalFacts) ? res.signalFacts : [],
    nextStep: res.nextStep ?? null,
  };
};

/* ---------------------------------------------------------- B2 (DEC-105) */

/** One contact ref as the shipped reads select it (inbox · enrollments). */
export interface BoldContactRef {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
}

/** `GET /pipeline-stages` row (workspace defaults, ordered). */
export interface PipelineStageRow {
  id: string;
  key: string;
  label: string;
  order: number;
}

/** `GET /enrollments?agentId=` row — raw Enrollment columns + contact
 *  (the shipped read returns Prisma rows verbatim; typed to what B2 uses). */
export interface BoldEnrollmentRow {
  id: string;
  contactId: string;
  pipelineStage: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  contact: BoldContactRef | null;
}

/** One message inside a `GET /agents/:id/inbox` thread. */
export interface BoldInboxMessage {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  channel: string;
  subject: string | null;
  body: string | null;
  intent: string | null;
  sentAt: string;
  /** Compose provenance — guided-meta OUTBOUND rows only (shipped contract). */
  composed?: { composerVersion: string | null };
  /** B3b: human-reply provenance (who sent, whether Ada drafted it). */
  reply?: { userId: string; draft: "ada" | "none"; draftEdited?: boolean };
}

/** `GET /agents/:id/inbox` thread — keyed by contactId (no Thread table);
 *  the same local-typing precedent as TimelineEvent above (the controller
 *  builds this shape in-memory; there is no core DTO to import). */
export interface BoldInboxThread {
  contactId: string;
  contact: BoldContactRef | null;
  /** B3a (DEC-112): campaign attribution — present on both scopes' reads. */
  campaign?: { id: string; name: string; agentId: string; agentName: string };
  enrollmentId: string | null;
  stage: string | null;
  /** B3b (DEC-117): Ada is paused on this thread (a human replied). */
  adaHeld?: boolean;
  assignee?: { id: string; email: string; name: string | null } | null;
  snoozedUntil?: string | null;
  channels: string[];
  intent: string | null;
  unread: boolean;
  done: boolean;
  lastAt: string;
  preview: string;
  messageCount: number;
  events: TimelineEvent[];
  messages: BoldInboxMessage[];
}

/** `GET /agents/:id/view` — the slice the Bold plan tab reads. */
export interface BoldAgentView {
  agent: {
    id: string;
    name: string;
    goal: string;
    goalLabel?: string;
    status: string;
    createdAt: string;
  };
  campaign: { id: string; name: string } | null;
  graph: CampaignGraph | null;
  graphVersion: number | null;
  guardrails: Guardrails | null;
  perStep: Record<string, { sent: number; replies: number }>;
}

/** `GET /planner/subcampaign-rules?agentId=` row (enabled, container-targeting). */
export interface SubcampaignRuleRow {
  ruleId: string;
  targetNodeId: string;
  trigger: CampaignRuleTrigger;
}

/** `GET /senders` — the slice B2 needs (DEC-061 channel capability). B7
 *  widens the type to the settings page's slice of the same response. */
export interface BoldSenderRow {
  id: string;
  type: string;
  status: string;
  fromEmail?: string;
  fromName?: string | null;
  replyTo?: string | null;
  dailyLimit?: number;
  sentToday?: number;
  domainAuthStatus?: Record<string, unknown>;
  health?: { state?: string; score?: number | null } | null;
  /**
   * The warm-up projection as `warmupProgressFor` actually returns it. The
   * earlier shape here declared `cap`, which the API never sends — so the
   * settings health row's "today's ceiling" was permanently blank. Typed
   * against the producer now, so a missing field is a compile error rather
   * than an empty string nobody notices.
   */
  warmup?: {
    active: boolean;
    day: number;
    days: number;
    currentCap: number | null;
    target: number | null;
    pct: number;
    holding: boolean;
    startedAt: string;
    completedAt?: string;
  } | null;
  createdAt?: string;
}

export const fetchBoldView = (agentId: string) => get<BoldAgentView>(`agents/${agentId}/view`);
export const fetchPipelineStages = () => get<PipelineStageRow[]>("pipeline-stages");
export const fetchEnrollments = (agentId: string) =>
  get<BoldEnrollmentRow[]>(`enrollments?agentId=${encodeURIComponent(agentId)}`);
export const fetchBoldInbox = (agentId: string) =>
  get<{ threads: BoldInboxThread[] }>(`agents/${agentId}/inbox`);
/** B3a (DEC-112): the workspace-wide inbox — the SAME thread shape from the
 *  same server-side builder, plus per-thread campaign attribution. */
export const fetchWorkspaceInbox = () => get<{ threads: BoldInboxThread[] }>("inbox");
export const fetchCreditPrices = () => get<EffectiveCreditPrices>("credit-prices");
export const fetchSubcampaignRules = (agentId: string) =>
  get<SubcampaignRuleRow[]>(`planner/subcampaign-rules?agentId=${encodeURIComponent(agentId)}`);
export const fetchSenders = () => get<BoldSenderRow[]>("senders");
export const fetchLists = () => get<ContactListDto[]>("lists");

/** `GET /contacts/view` row — the slice the Bold contacts page reads (B3a).
 *  The read is the SHIPPED C2.5 surface; `valueEstCents` is its one additive
 *  B3a rider (DEC-112). */
export interface BoldContactRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  source: string;
  custom: Record<string, unknown>;
  lists: Array<{ id: string; name: string }>;
  emailVerdict: string | null;
  createdAt: string;
  stage: string | null;
  goal: { key: string; label: string; pill: string } | null;
  agentName: string | null;
  valueEstCents: number | null;
  enrollmentStatus: string | null;
  replied: boolean;
  tags: string[];
  notes: string | null;
  /** B3c-1 (DEC-118(2)): granted | denied | unknown — unknown = Ada may not call. */
  callConsent: string;
  timezone: string | null;
  /** The newest inbound message — the "last asked about" human context. */
  lastInbound: { body: string; intent: string | null; channel: string; sentAt: string } | null;
  unsub: boolean;
  lastActivity: string | null;
}
export const fetchContactsView = () => get<{ rows: BoldContactRow[] }>("contacts/view");

export type BoldWriteResult = { ok: true; body: unknown } | { ok: false; error: string };

/** Writes surface the API's owner-readable message (422 gate detail, 409
 *  version race) instead of failing soft — a swallowed write is a lie. */
export async function send(path: string, method: string, body: unknown): Promise<BoldWriteResult> {
  try {
    const res = await fetch(`/api/cf/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, body: parsed };
    const b = parsed as { detail?: unknown; message?: unknown } | null;
    const detail =
      typeof b?.detail === "string"
        ? b.detail
        : typeof b?.message === "string"
          ? b.message
          : `Request failed (${res.status})`;
    return { ok: false, error: detail };
  } catch {
    return { ok: false, error: "Network error — nothing was saved" };
  }
}

/** Stage move — `PATCH /enrollments/:id` publishes `lead.stage_changed.v1`
 *  on the bus, so rules fire for human moves exactly like machine moves
 *  (DEC-085). Never the `/contacts/:id/move` sibling (inline write, no bus). */
export const moveEnrollmentStage = (enrollmentId: string, pipelineStage: string) =>
  send(`enrollments/${encodeURIComponent(enrollmentId)}`, "PATCH", { pipelineStage });

/** Mark the thread's LAST INBOUND message done/undone (the read side inspects
 *  exactly that row's meta). */
export const setMessageDone = (messageId: string, done: boolean) =>
  send(`messages/${encodeURIComponent(messageId)}/done`, "PATCH", { done });

/** The ONE graph write path (DEC-076): whole-graph PUT against latest+1.
 *  409 = the sequence changed underneath the edit; 422 = the gate's message. */
export const putPlannerGraph = (agentId: string, graph: CampaignGraph) =>
  send("planner/graph", "PUT", { agentId, graph });

export const addContactsToList = (listId: string, contactIds: string[]) =>
  send(`lists/${encodeURIComponent(listId)}/members`, "POST", { contactIds });

/** Full-replace guardrails write (`PATCH /agents/:id`) — the server preserves
 *  its own riders; the caller must send the complete object back. */
export const patchAgentGuardrails = (agentId: string, guardrails: Guardrails) =>
  send(`agents/${encodeURIComponent(agentId)}`, "PATCH", { guardrails });

/* -------------------------------------------------------- B2.5 (DEC-108) */

/** `GET /context/gaps` item (core `gapItemSchema` — typed to what B2.5 reads). */
export interface BoldGapItem {
  key: string;
  label: string;
  layer: "workspace" | "agent";
  status: "open" | "typed" | "ai_decides" | "covered";
  coveredBy?: "workspace" | "agent";
  proposedAsk?: string;
}
export interface BoldGapReport {
  gaps: BoldGapItem[];
  resolved: number;
  total: number;
  launchReady: boolean;
}
/** `GET /context` — the merged layer view (fields as `{value, ...}`). */
export interface BoldContextRead {
  merged: Record<string, { value?: string } | undefined>;
}
export interface BoldImportResult {
  created: number;
  skippedDuplicates: number;
  suppressed: number;
  failed: Array<{ index: number; email: string; reason: string }>;
  validationBatchId?: string;
}

export const createBoldAgent = (body: {
  name: string;
  goal: string;
  category?: string;
  instructions?: string;
  goalSummary?: string;
}) => send("agents", "POST", body);
export const deleteBoldAgent = (agentId: string) =>
  send(`agents/${encodeURIComponent(agentId)}`, "DELETE", {});
export const patchBoldAgent = (agentId: string, body: unknown) =>
  send(`agents/${encodeURIComponent(agentId)}`, "PATCH", body);
export const fetchContextMerged = (agentId: string) =>
  get<BoldContextRead>(`context?agentId=${encodeURIComponent(agentId)}`);
export const fetchGapReport = (agentId: string, goal: string) =>
  get<BoldGapReport>(`context/gaps?agentId=${encodeURIComponent(agentId)}&goal=${encodeURIComponent(goal)}`);
export const answerGap = (agentId: string, key: string, value: string) =>
  send("context/answers", "POST", { agentId, key, value });
export const delegateGap = (agentId: string, key: string) =>
  send("context/delegate", "POST", { agentId, key });
export const planCampaign = (agentId: string) => send("planner/plan", "POST", { agentId });
export const fetchPlannerGraph = (agentId: string) =>
  get<{ campaign: unknown; graph: { version: number; graph: unknown } | null }>(
    `planner/graph?agentId=${encodeURIComponent(agentId)}`,
  );
export const fetchPlannerStatus = (agentId: string) =>
  get<{ state: "none" | "waiting" | "active" | "completed" | "failed"; failedReason?: string | null }>(
    `planner/status?agentId=${encodeURIComponent(agentId)}`,
  );
export const createContactList = (name: string, origin: "manual" | "csv_import") =>
  send("lists", "POST", { name, origin });
export const importContactRows = (rows: unknown[], listId: string | undefined, validationBatchKey: string) =>
  send("contacts/import", "POST", { rows, ...(listId ? { listId } : {}), validationBatchKey });
export const fetchListMemberIds = async (listId: string): Promise<string[] | null> => {
  const res = await get<{ rows?: Array<{ id: string }> }>(
    `contacts/view?listId=${encodeURIComponent(listId)}`,
  );
  if (!res) return null;
  return (res.rows ?? []).map((r) => r.id);
};
/** B2.6 (DEC-110): the deterministic suggestion sweep (idempotent; the shell
 *  fires it best-effort on load — AGENT members simply 403 into fail-soft). */
export const sweepSuggestions = () => send("suggestions/sweep", "POST", {});
export const dismissSuggestion = (agentId: string) =>
  send(`agents/${encodeURIComponent(agentId)}`, "PATCH", { dismissSuggestion: true });

/** B3a review (DEC-112(7)): tags (full replace) + notes on the contact PATCH.
 *  B3c-1 (DEC-118(2)): callConsent rides the same PATCH — every flip lands
 *  provenance on the timeline. */
export const patchContactFacts = (
  contactId: string,
  body: { tags?: string[]; notes?: string | null; callConsent?: "granted" | "denied" | "unknown" },
) => send(`contacts/${encodeURIComponent(contactId)}`, "PATCH", body);

/* ---------------------------------------------------- B3c-1 (DEC-118/119) */

/** The checkable "Ada picks the best time" read — the SAME resolver the dial
 *  rail enforces; the confirm sheet renders exactly this. */
export interface CallWindowRead {
  window: {
    timezone: string;
    source: "contact" | "calendar" | "campaign";
    days: number[];
    start: string;
    end: string;
    floorStart: string;
    floorEnd: string;
  };
  nextOpenAt: string | null;
  insideNow: boolean;
  callConsent: string;
}
export const fetchCallWindow = (agentId: string, contactId: string) =>
  get<CallWindowRead>(
    `voice/call-window?agentId=${encodeURIComponent(agentId)}&contactId=${encodeURIComponent(contactId)}`,
  );

/** Queue (or place) one Ada call through the full dial rail. */
export const dialAdaCall = (agentId: string, contactId: string, when: "now" | "best_time") =>
  send(`agents/${encodeURIComponent(agentId)}/calls`, "POST", { contactId, when });

/* ---------------------------------------------------- B3c-2 (DEC-118(1)) */

/** Start a HUMAN browser-mic call: the full rail runs server-side (any
 *  non-DNC contact with a phone — consent never gates a human dial); the
 *  response carries either a real device token or `sandbox: true` (keyless
 *  practice line — no real call is placed). */
export const startBrowserCall = (agentId: string, contactId: string) =>
  send("voice/browser-calls", "POST", { agentId, contactId });

/** Sandbox-only: report the practice call's outcome. A live call's truth
 *  arrives from the provider — the server refuses this on real rows. */
export const finishBrowserCall = (callId: string, outcome: string, durationSec: number) =>
  send(`voice/browser-calls/${encodeURIComponent(callId)}/finish`, "POST", { outcome, durationSec });

/* ---------------------------------------------------- B5 (DEC-130) */

export interface BoldFormField {
  key: string;
  label: string;
  type: "text" | "phone" | "email" | "choice" | "longtext";
  required: boolean;
  options?: string[];
}
export interface BoldFormRow {
  id: string;
  title: string;
  status: "draft" | "live" | string;
  publicId: string | null;
  fields: BoldFormField[];
  design: { intro?: string; submitLabel?: string; kind?: string };
  routing: { campaignId?: string | null; tag?: string; redirectUrl?: string };
  responses?: number;
  createdAt: string;
}
export interface BoldFormSubmissionRow {
  id: string;
  contactId: string | null;
  contactName: string | null;
  answers: Record<string, string>;
  submittedAt: string;
}
export const fetchForms = () => get<{ forms: BoldFormRow[] }>("forms");
export const fetchFormDetail = (id: string) =>
  get<{ form: BoldFormRow; responses: number; submissions: BoldFormSubmissionRow[] }>(
    `forms/${encodeURIComponent(id)}`,
  );
export const createForm = (body: Record<string, unknown>) => send("forms", "POST", body);
export const patchForm = (id: string, body: Record<string, unknown>) =>
  send(`forms/${encodeURIComponent(id)}`, "PATCH", body);

export interface BoldProposalPriceOption {
  name: string;
  sub?: string;
  amount: string;
  best?: boolean;
}
export type BoldProposalBlock =
  | { kind: "cover"; eyebrow?: string; title: string; body?: string }
  | { kind: "text"; label?: string; title: string; body: string }
  | { kind: "price"; label?: string; title: string; options: BoldProposalPriceOption[] }
  | { kind: "signature"; label?: string; body?: string };
export interface BoldProposalRow {
  id: string;
  title: string;
  status: string;
  blocks: BoldProposalBlock[];
  contactId: string | null;
  contactName?: string | null;
  createdAt: string;
}
export const fetchProposals = () => get<{ proposals: BoldProposalRow[] }>("proposals");
export const fetchProposal = (id: string) =>
  get<{ proposal: BoldProposalRow; contactName: string | null }>(
    `proposals/${encodeURIComponent(id)}`,
  );
export const createProposal = (body: Record<string, unknown>) => send("proposals", "POST", body);
export const patchProposal = (id: string, body: Record<string, unknown>) =>
  send(`proposals/${encodeURIComponent(id)}`, "PATCH", body);

export interface BoldAutomationRow {
  id: string;
  name: string;
  enabled: boolean;
  invalid: boolean;
  trigger: { kind: string; intents?: string[]; days?: number; hours?: number } | null;
  actions: Array<{ kind: string; tag?: string; note?: string; stage?: string }>;
  runs: number;
  lastRunAt: string | null;
}
export const fetchAutomations = () => get<BoldAutomationRow[]>("automations");
export const toggleAutomation = (id: string, enabled: boolean) =>
  send(`automations/${encodeURIComponent(id)}`, "PATCH", { enabled });
export const createAutomation = (body: Record<string, unknown>) =>
  send("automations", "POST", body);
export interface BoldAutomationRunRow {
  id: string;
  status: string;
  trigger: string | null;
  detail: string | null;
  contactLabel: string | null;
  occurredAt: string;
}
export const fetchAutomationRuns = (id: string) =>
  get<BoldAutomationRunRow[]>(`automations/${encodeURIComponent(id)}/runs`);

/* ---------------------------------------------------- B6 (DEC-131) */

export interface SubjectNoun {
  one: string;
  many: string;
}
/** A user-facing signal GROUP — what a person recognises, not an event key. */
export interface LeadSignalGroup {
  key: string;
  label: string;
  why: string;
  tier: "core" | "bp";
  types: string[];
  /** Present on locked groups; `null` when no honest number exists (Q-140). */
  estimate?: string | null;
}
export interface LeadFinderConfig {
  providerConfigured: boolean;
  buyerping: { connected: boolean; signalsToday: number };
  profile: {
    shape: "company" | "local_business" | "consumer";
    vertical?: string;
    location?: string;
    radiusMiles?: number;
    headcountBand?: string;
    titles?: string[];
    ownerRun?: boolean;
  };
  directFilters: Array<{ key: string; label: string; options: string[] }>;
  providerPeopleSearch: boolean;
  topicSuggestions: { kinds: string[]; byVertical: Record<string, string[]>; fallback: string[] };
  sources: string[];
  watchTopics: Array<{ id: string; kind: string; label: string }>;
  /* B6.5 (DEC-153): the standing-watch shell, all server-derived. */
  title: string;
  noun: SubjectNoun;
  brief: {
    sentence: string;
    provenance: string;
    watchingSince: string | null;
    scoredAgainst: number;
  };
  watching: LeadSignalGroup[];
  locked: LeadSignalGroup[];
  lockedTypes: string[];
  basis: string;
  poolBands: Array<{ key: string; tag: string; sub: string; min: number | null; max: number | null; free: boolean }>;
}
export const fetchLeadConfig = () => get<LeadFinderConfig>("leads/config");

export interface LeadCandidateRow {
  id: string;
  origin: "own" | "provider";
  provider: string;
  providerRef: string;
  contactId: string | null;
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  headcount: number | null;
  maskedEmail: string | null;
  maskedPhone: string | null;
  fit: number;
  fitReasons: string[];
  /** False when no data-backed reason exists — the surface shows "unscored". */
  scored: boolean;
  intentWeight: number;
  intentReceipts: string[];
  revealed: boolean;
  /* B6.5 row contract (SURFACE_SPEC §5/§10) — the drawer may read only what
   * the row itself carries, so everything it needs is here. */
  signalType: string | null;
  group: string | null;
  receipt: string;
  about: string;
  sourceTag: string;
  basis: string;
  channelLabel: string;
  channelWarm: boolean;
  occurredAt: string | null;
  bucket: "today" | "week" | "older";
  actionable: boolean;
}
export interface LeadSuppression {
  total: number;
  reasons: Array<{ key: string; label: string; n: number }>;
}
export interface LeadSearchResult {
  providerConfigured: boolean;
  consumerShape?: boolean;
  tierOn?: boolean;
  waiting?: number;
  counts?: {
    groups: Record<string, number>;
    when: { any: number; today: number; week: number };
    fit: Record<string, number>;
  };
  suppression?: LeadSuppression;
  candidates: LeadCandidateRow[];
}
export interface LeadPoolRow {
  id: string;
  contactId: string;
  name: string;
  fit: number;
  why: string[];
  about: string;
  sourceTag: string;
  onFile: boolean;
}
export interface LeadPool {
  bands: Array<{
    key: string;
    tag: string;
    sub: string;
    free: boolean;
    count: number | null;
    estimate: boolean;
    rows: LeadPoolRow[];
    note: string | null;
  }>;
  total: number;
  noun: SubjectNoun;
  scoredNote: string;
  suppression: LeadSuppression;
}
export const fetchLeadPool = () => get<LeadPool>("leads/pool");
export const saveBrief = (profile: Record<string, unknown>) => send("leads/brief", "POST", profile);
export const searchLeads = (mode: "ada" | "direct", filters?: Record<string, string>) =>
  send("leads/search", "POST", { mode, ...(filters ? { filters } : {}) });
export const revealLead = (providerRef: string) => send("leads/reveal", "POST", { providerRef });
export const hideLead = (provider: string, providerRef: string) =>
  send("leads/hide", "POST", { provider, providerRef });
export const setBuyerping = (enabled: boolean) => send("leads/buyerping", "POST", { enabled });
export const addWatchTopic = (kind: string, label: string) =>
  send("leads/watch-topics", "POST", { kind, label });
export const removeWatchTopic = (id: string) =>
  send(`leads/watch-topics/${encodeURIComponent(id)}`, "DELETE", {});

/* ---------------------------------------------------- B4.5 (DEC-128) */

/** One row of the live-call feed the shell polls. */
export interface LiveCallRow {
  id: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  caller: string;
  status: string;
  takenOver: boolean;
  startedAt: string;
}
export const fetchLiveCalls = () => get<{ calls: LiveCallRow[] }>("calls/live");

/** One transcript line of a call (live or finished — same rows either way). */
export interface CallTranscriptLine {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  sentAt: string;
}
export interface CallDetailRead {
  call: {
    id: string;
    status: string;
    outcome: string | null;
    durationSec: number | null;
    startedAt: string;
    endedAt: string | null;
    meta: Record<string, unknown> | null;
  };
  contact: { id: string; firstName: string | null; lastName: string | null } | null;
  transcript: CallTranscriptLine[];
}
export const fetchCallDetail = (callId: string) =>
  get<CallDetailRead>(`calls/${encodeURIComponent(callId)}`);

/** JUMP IN: take over an in-progress call — the contact leg moves into the
 *  call's conference room and the browser leg joins it (sandbox: the state
 *  flip is real, no Device mounts). */
export const jumpIntoCall = (callId: string) =>
  send(`voice/calls/${encodeURIComponent(callId)}/jump-in`, "POST", {});

/* ---------------------------------------------------- B4 (DEC-124) */

/** The one-flag truth the rail, dock and site-agent page all read. */
export interface WidgetOverview {
  installed: boolean;
  busy: boolean;
  busyCount: number;
  chats30d: number;
  booked30d: number;
}
export const fetchWidgetOverview = () => get<WidgetOverview>("widgets/overview");

export interface WidgetRow {
  id: string;
  publicId: string | null;
  design: Record<string, unknown>;
  flows: Record<string, boolean>;
  consentAsk: boolean;
  allowedOrigins: string[];
  agentId: string;
  createdAt: string;
}
export const fetchWidgets = () => get<{ widgets: WidgetRow[] }>("widgets");
/** One widget per workspace in v1 — returns the existing row or mints one. */
export const ensureWidget = () => send("widgets/ensure", "POST", {});
export const patchWidget = (
  id: string,
  body: {
    design?: Record<string, unknown>;
    flows?: Record<string, boolean>;
    consentAsk?: boolean;
  },
) => send(`widgets/${encodeURIComponent(id)}`, "PATCH", body);

/** Enabled feature keys for this workspace (`GET /flags`). */
export const fetchFlags = async (): Promise<string[]> => {
  const res = await get<{ flags?: string[] }>("flags");
  return Array.isArray(res?.flags) ? res.flags : [];
};

/* ---------------------------------------------------- B3d (DEC-122) */

/** One typed item in the unified approvals queue. */
export interface ApprovalQueueItem {
  kind: string;
  approvalId: string | null;
  agentId: string;
  campaignId: string | null;
  contactId: string | null;
  contactName: string | null;
  reason: string;
  createdAt: string;
  enrollmentId?: string | null;
  intent?: string | null;
}
export const fetchApprovals = (agentId?: string) =>
  get<{ items: ApprovalQueueItem[] }>(`approvals${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`);

/** Decide a row-backed item — approve releases the parked step, dismiss
 *  ends that path visibly. Derived items decide on their own endpoints. */
export const decideApproval = (approvalId: string, decision: "approved" | "dismissed") =>
  send(`approvals/${encodeURIComponent(approvalId)}/decide`, "POST", { decision });

/** Ada's may-we-call ask — one fixed line through the send boundary; an
 *  affirmative reply flips call consent with the message as provenance. */
export const sendConsentAsk = (agentId: string, contactId: string) =>
  send("inbox/consent-ask", "POST", { agentId, contactId });

/* ---------------------------------------------------- B3b (DEC-116/117) */

/** A human reply on a thread — through the shipped send boundary. */
export const sendInboxReply = (body: {
  campaignId: string;
  contactId: string;
  body: string;
  channel: "email" | "sms";
  draft: "ada" | "none";
  draftEdited?: boolean;
}) => send("inbox/reply", "POST", body);

export interface ReplyDraft {
  body: string;
  composerVersion: string;
  usedNote: boolean;
}
/** Ada drafts a reply for approve/edit/send — never auto-sent. */
export const requestReplyDraft = (body: { campaignId: string; contactId: string; channel: "email" | "sms" }) =>
  send("inbox/draft", "POST", body);

/** The explicit Resume Ada control (owner ruling — no auto-resume timer). */
export const resumeAda = (contactId: string) => send("inbox/resume", "POST", { contactId });

export const patchThreadState = (body: {
  campaignId: string;
  contactId: string;
  assigneeUserId?: string | null;
  snoozedUntil?: string | null;
}) => send("inbox/thread-state", "PATCH", body);

export interface WorkspaceMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
}
export const fetchInboxMembers = () => get<WorkspaceMember[]>("inbox/members");

export const enrollContact = (
  agentId: string,
  contactId: string,
  origin: { kind: "manual" | "csv" | "list"; listId?: string; listName?: string },
) => send("enrollments", "POST", { agentId, contactId, origin });

export async function patchAgentValue(
  agentId: string,
  body: { valueEstCents?: number | null; valueGoalUnits?: number | null },
): Promise<boolean> {
  try {
    const res = await fetch(`/api/cf/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- formatting */

export function money(cents: number): string {
  const d = cents / 100;
  if (d >= 100_000) return `$${(d / 1000).toFixed(0)}k`;
  if (d >= 10_000) return `$${(d / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${d.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function contactName(c: { firstName: string | null; lastName: string | null; email: string | null } | null): string {
  if (!c) return "A contact";
  const n = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return n || c.email || "A contact";
}

/** Repo avatar convention (no photo data exists — Q-068): initials + tint. */
export function initials(c: { firstName: string | null; lastName: string | null; email: string | null } | null): string {
  if (!c) return "?";
  const a = c.firstName?.trim().charAt(0) ?? "";
  const b = c.lastName?.trim().charAt(0) ?? "";
  return (a + b || c.email?.charAt(0) || "?").toUpperCase();
}
const AV_TINTS = [
  ["var(--cvb-mint)", "var(--cvb-forest)"],
  ["var(--cvb-cyan-tint)", "var(--cvb-cyan)"],
  ["var(--cvb-slate-tint)", "var(--cvb-slate)"],
  ["var(--cvb-amber-bg)", "var(--cvb-amber)"],
] as const;
export function avTint(key: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AV_TINTS[h % AV_TINTS.length]!;
  return { bg, fg };
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 7 * 24 * 60) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dayGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dayKey = (x: Date) => x.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(d) === dayKey(now)) return "TODAY";
  if (dayKey(d) === dayKey(yesterday)) return "YESTERDAY";
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) return "EARLIER THIS WEEK";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

/* ------------------------------------------------- row composition (English) */

/** kind → [chip fg, chip bg, chip border, spine, glyph] — prototype KINDS. */
export const KIND_TONES: Record<string, [string, string, string, string, string]> = {
  goal: ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)", "◷"],
  won: ["#0e5c2b", "#e4f3e9", "#c3e2cf", "#0e5c2b", "✓"],
  reply: ["var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)", "↩"],
  question: ["var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "#36a9c4", "?"],
  objection: ["var(--cvb-danger)", "var(--cvb-danger-bg)", "#f0d5ce", "var(--cvb-danger)", "!"],
  send: ["var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)", "var(--cvb-faint)", "➤"],
  call: ["var(--cvb-slate)", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)", "☎"],
  decision: ["var(--cvb-amber)", "var(--cvb-amber-bg)", "var(--cvb-amber-line)", "var(--cvb-dot-amber)", "✦"],
  proposal: ["#5b4a8a", "#f0edf9", "#dcd5ef", "#7a66b5", "◫"],
};

/** Intent → the Bold reply sub-kind (question/objection tones ride replies). */
export function replyTone(intent: string | null): keyof typeof KIND_TONES {
  if (intent === "question" || intent === "info_request") return "question";
  if (intent === "objection_price" || intent === "objection_timing" || intent === "not_interested" || intent === "not")
    return "objection";
  return "reply";
}

export interface ComposedRow {
  row: BoldActivityRow;
  tone: keyof typeof KIND_TONES;
  chip: string;
  body: string;
  value: string | null;
}

const INTENT_LINE: Record<string, string> = {
  interested: "replied — interested",
  replied: "replied",
  question: "asked a question",
  info_request: "asked a question",
  objection_price: "raised a price objection",
  objection_timing: "said not right now",
  not: "said not now",
  not_interested: "is not interested",
  wrong_person: "is the wrong person",
  ooo: "is out of office",
  unsubscribe: "unsubscribed",
  booked: "booked",
};

/** Compose one factual English line from a data row — nothing invented. */
export function composeRow(row: BoldActivityRow, stepLabel?: string): ComposedRow {
  const name = contactName(row.contact);
  switch (row.kind) {
    case "goal":
      return {
        row,
        tone: "goal",
        chip: row.goalLabel ?? "Goal met",
        body: `${name} — ${row.goalLabel ?? "reached the goal"}.`,
        value: null,
      };
    case "won":
      return {
        row,
        tone: "won",
        chip: "Paid",
        body: `Payment received — ${name}.`,
        value: row.amountCents != null ? money(row.amountCents) : null,
      };
    case "reply": {
      const tone = replyTone(row.intent);
      return {
        row,
        tone,
        chip: tone === "question" ? "Question" : tone === "objection" ? "Objection" : "Reply",
        body: `${name} ${INTENT_LINE[row.intent ?? ""] ?? "replied"}.`,
        value: null,
      };
    }
    case "send":
      return {
        row,
        tone: "send",
        chip: "Send",
        body: `Sent to ${row.count ?? 0} ${row.channel === "sms" ? "by SMS" : "by email"}${stepLabel ? ` — ${stepLabel}` : ""}.`,
        value: null,
      };
    case "proposal":
      return { row, tone: "proposal", chip: "Proposal", body: `Proposal activity — ${name}.`, value: null };
    case "call":
      return { row, tone: "call", chip: "Call", body: `Call with ${name}.`, value: null };
    case "decision": {
      // B3d: the new decision types speak their own factual sentence — only
      // the original refusal/unsubscribe family reads as a hold.
      const selfWorded =
        row.type === "campaign.autonomy_changed.v1" ||
        row.type === "approval.created.v1" ||
        row.type === "approval.decided.v1";
      return {
        row,
        tone: "decision",
        chip: "Decision",
        body: selfWorded
          ? (row.reason ?? "A decision landed.")
          : `Held ${name} back${row.reason ? ` — ${row.reason}` : ""}.`,
        value: null,
      };
    }
  }
}

/* ---------------------------------------------------- B7 (DEC-133) */

/** `GET /workspaces/members` row — the Team page's first real data. */
export interface WorkspaceMemberRow {
  userId: string;
  name: string | null;
  email: string;
  // VIEWER is in the shipped enum too — the settings Team page renders it.
  role: "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
  since: string;
}
export const fetchWorkspaceMembers = () => get<WorkspaceMemberRow[]>("workspaces/members");

/** `GET /workspaces/guardrail-defaults` — stored defaults + per-campaign
 *  CURRENT values so the surface can say which campaigns differ (Q-109:
 *  editing a default never rewrites a live campaign). */
export interface GuardrailDefaultsDto {
  dailyCap?: { email?: number; sms?: number; voice?: number };
  sendingWindow?: { days: number[]; start: string; end: string; timezone: string };
}
export interface GuardrailDefaultsView {
  defaults: GuardrailDefaultsDto;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    dailyCap: { email: number; sms?: number; voice?: number } | null;
    sendingWindow: { days: number[]; start: string; end: string; timezone: string } | null;
  }>;
}
export const fetchGuardrailDefaults = () => get<GuardrailDefaultsView>("workspaces/guardrail-defaults");
export const patchGuardrailDefaults = (defaults: GuardrailDefaultsDto) =>
  send("workspaces/guardrail-defaults", "PATCH", defaults);

/** `GET /credits/summary` — the REAL ledger only (Q-108: sends/minutes
 *  don't meter yet; the surface says so instead of inventing rows). */
export interface CreditsSummary {
  balance: number;
  monthStart: string;
  spent: Array<{ reason: string; credits: number; entries: number }>;
  added: Array<{ reason: string; credits: number; entries: number }>;
  recent: Array<{
    id: string;
    delta: number;
    reason: string;
    channel: string | null;
    balanceAfter: number;
    createdAt: string;
  }>;
}
export const fetchCreditsSummary = () => get<CreditsSummary>("credits/summary");

/** Sender wizard writes — the SHIPPED senders API, nothing parallel. */
export const createEmailSender = (body: { fromEmail: string; fromName?: string; replyTo?: string }) =>
  send("senders", "POST", { type: "CF_MANAGED", ...body });
export const runDnsCheck = (senderId: string) =>
  send(`senders/${encodeURIComponent(senderId)}/dns-check`, "POST", {});

/** Answer a gap on the WORKSPACE layer (no agentId — layerFor routes it
 *  there), so every campaign that needs the fact stops asking. */
export const answerWorkspaceGap = (key: string, value: string) =>
  send("context/answers", "POST", { key, value });

/** B7: the rail's live Business-core + credits summary — real counts only.
 *  Facts = workspace-layer fields with a value; gaps = the union of the
 *  LIVE campaigns' open gap keys (gaps are goal-relative, so the union is
 *  "what your live campaigns still miss"). Credit % has no plan-allowance
 *  denominator yet — the bar shows balance vs what the month started with,
 *  real arithmetic from the ledger. */
export interface CoreSummary {
  facts: number;
  gaps: number;
  balance: number | null;
  monthStartBalance: number | null;
  vertical: string | null;
  location: string | null;
}
export async function fetchCoreSummary(agents: AgentListItem[]): Promise<CoreSummary> {
  const live = agents.filter((a) => a.status === "ACTIVE" || a.status === "PAUSED");
  const [ctx, credits, cfg, reports] = await Promise.all([
    get<{ workspace?: { fields?: Record<string, { value?: string }> } | null }>("context"),
    fetchCreditsSummary(),
    fetchLeadConfig(),
    Promise.all(live.map((a) => fetchGapReport(a.id, a.goal))),
  ]);
  const facts = Object.values(ctx?.workspace?.fields ?? {}).filter(
    (v) => ((v as { value?: string })?.value ?? "").trim().length > 0,
  ).length;
  const open = new Set<string>();
  for (const rep of reports) for (const g of rep?.gaps ?? []) if (g.status === "open") open.add(g.key);
  const spent = (credits?.spent ?? []).reduce((n, r) => n + r.credits, 0);
  const added = (credits?.added ?? []).reduce((n, r) => n + r.credits, 0);
  const profile = (cfg?.profile ?? null) as { vertical?: string; location?: string } | null;
  return {
    facts,
    gaps: open.size,
    balance: credits?.balance ?? null,
    monthStartBalance: credits ? credits.balance + spent - added : null,
    vertical: profile?.vertical ?? null,
    location: profile?.location ?? null,
  };
}

/* ---------------------------------------------------- B8 (DEC-135) */

/** `GET /stats` — the ONE analytics read (campaign Stats + workspace
 *  Analytics call the same endpoint, so the surfaces cannot disagree).
 *  Every number server-derived from real rows; rates null below the F1
 *  min-send floors (the surface says "too few to read", never invents). */
export interface BoldStatsResponse {
  scope: "campaign" | "workspace";
  range: "7" | "30" | "all";
  since: string | null;
  floors: { low: number; ok: number; totalSent: number };
  tiles: {
    reached: number;
    replied: number;
    repliedPct: number | null;
    booked: number;
    bookedPctOfRepliers: number | null;
    estValueCents: number | null;
    collectedCents: number | null;
  };
  funnel: Array<{ key: string; label: string; count: number; note?: string; outcome?: boolean }>;
  channels: Array<{ channel: string; sent: number; repliers: number; booked: number }>;
  reading: string[];
}
export const fetchStats = (range: "7" | "30" | "all", agentId?: string) =>
  get<BoldStatsResponse>(`stats?range=${range}${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ""}`);

/** `GET /integrations` — real per-provider status rows (probe-backed). */
export interface IntegrationStatusRow {
  provider: string;
  status: "connected" | "unhealthy" | "revoked";
}
export const fetchIntegrationStatuses = async (): Promise<Map<string, IntegrationStatusRow>> => {
  const res = await get<{ integrations?: Array<{ provider?: string; status?: string }> }>("integrations");
  const map = new Map<string, IntegrationStatusRow>();
  for (const r of res?.integrations ?? []) {
    if (r.provider && r.status) map.set(r.provider, { provider: r.provider, status: r.status as IntegrationStatusRow["status"] });
  }
  return map;
};

/* ------------------------------------------------- B9: tour + first steps */

/** `GET /me/getting-started` — the drawer checklist, every done-state
 *  server-derived from real rows (DEC-136 tour addendum). */
export interface GettingStartedResponse {
  items: Array<{ key: string; label: string; done: boolean }>;
  done: number;
  total: number;
}
export const fetchGettingStarted = () => get<GettingStartedResponse>("me/getting-started");

/** `PATCH /me/settings` — tour-seen persists with the account, never a browser. */
export async function patchMeSettings(body: { tourSeen?: boolean }): Promise<boolean> {
  try {
    const res = await fetch("/api/cf/me/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
