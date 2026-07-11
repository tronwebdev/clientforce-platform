"use client";

/**
 * Create Agent wizard (C2.3) — 6 steps ported from the UPDATED
 * `Create Agent.dc.html` (checkpoints §3), wired to the live P1.2 ingest,
 * P1.3 context/citations/gaps (DEC-028 snapshots — chunk ids never render),
 * P1.4 planner, P1.5 senders, A5 create path. Prototype literals throughout.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
// B9: the wizard's "＋ Add sender" opens the same connect flow Settings uses —
// the prototype's binding is `openAddEmail: () => connectChannel('email')`.
import { ConnectFlowDrawer } from "../../(shell)/settings/shared";
import { branchWhenLabel, intentTint } from "../../../lib/intents";
import { mainPath, mainSteps, replyBranchOf, strategyStepsOf } from "../../../lib/graph-path";
import { BUSINESS_CATEGORIES, CONTEXT_FIELD_META, customTokensMissingFallback, GOAL_KEYS, goalTerminalLabel, requiredFieldsFor, type GoalKey } from "@clientforce/core";
import type { CampaignGraph, ContactFieldDefDto, DraftState, GraphNode } from "@clientforce/core";

/** Per-field one-liner under each gap row (registry-driven). */
const FIELD_HINTS: Record<string, string> = Object.fromEntries(
  Object.entries(CONTEXT_FIELD_META).map(([k, v]) => [k, v.hint]),
);

const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

const cf = (path: string, init?: RequestInit) =>
  fetch(`/api/cf/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  });

/**
 * B10: sending-schedule timezones. The A8 schema stores the IANA zone; the two
 * display formats are the prototype's own literals — menu rows follow the
 * "(GMT−06:00) Central Time" shape, the closed control follows
 * "America/Chicago (CT)". The prototype shows only the closed control, so the
 * menu anatomy reuses the wizard's existing dropdowns (flagged composition).
 */
const TZ_OPTIONS = [
  { zone: "UTC", offset: "GMT+00:00", label: "UTC", short: "UTC" },
  { zone: "America/New_York", offset: "GMT−05:00", label: "Eastern Time", short: "ET" },
  { zone: "America/Chicago", offset: "GMT−06:00", label: "Central Time", short: "CT" },
  { zone: "America/Denver", offset: "GMT−07:00", label: "Mountain Time", short: "MT" },
  { zone: "America/Los_Angeles", offset: "GMT−08:00", label: "Pacific Time", short: "PT" },
  { zone: "Europe/London", offset: "GMT+00:00", label: "London", short: "GMT" },
  { zone: "Europe/Berlin", offset: "GMT+01:00", label: "Central Europe", short: "CET" },
  { zone: "Africa/Lagos", offset: "GMT+01:00", label: "Lagos", short: "WAT" },
  { zone: "Asia/Dubai", offset: "GMT+04:00", label: "Dubai", short: "GST" },
  { zone: "Asia/Kolkata", offset: "GMT+05:30", label: "India", short: "IST" },
  { zone: "Asia/Singapore", offset: "GMT+08:00", label: "Singapore", short: "SGT" },
  { zone: "Australia/Sydney", offset: "GMT+10:00", label: "Sydney", short: "AEST" },
] as const;
const tzShort = (zone: string): string => TZ_OPTIONS.find((t) => t.zone === zone)?.short ?? zone;

/** Rail + header copy, verbatim from the prototype's step defs. */
const STEP_DEFS = [
  { label: "Set the goal", hint: "Goal & build method", title: "Set the goal", subtitle: "Tell the agent what to achieve — it orchestrates the sequence, channels, and copy." },
  { label: "Design sequence", hint: "AI-drafted steps", title: "Design the sequence", subtitle: "We drafted an outreach sequence — tweak any step." },
  { label: "Add contacts", hint: "Import or find leads", title: "Add your contacts", subtitle: "Choose who this agent should reach out to." },
  { label: "Enable lead capture", hint: "Optional inbound form", title: "Enable lead capture", subtitle: "Turn inbound interest into leads with a branded form." },
  { label: "Guardrails & compliance", hint: "Consent, schedule & limits", title: "Guardrails & compliance", subtitle: "Set the rules your agent stays within — consent, sending windows, and limits." },
  { label: "Preview & launch", hint: "Review & deploy", title: "Preview & launch", subtitle: "Review everything, then deploy your agent." },
];

/** Building-screen step list, verbatim from the prototype (BSTEPS). */
const BSTEPS = [
  { icon: "📚", label: "Parsing knowledge base & business context", category: "Knowledge" },
  { icon: "🎯", label: "Identifying target audience & pain points", category: "Analysis" },
  { icon: "⚖", label: "Applying CAN-SPAM, GDPR & compliance rules", category: "Compliance" },
  { icon: "📡", label: "Selecting optimal channel mix for your goal", category: "Strategy" },
  { icon: "✍", label: "Drafting personalised subject lines & hooks", category: "Copy" },
  { icon: "📊", label: "Scoring deliverability & inbox placement", category: "Deliverability" },
  { icon: "⏱", label: "Optimising send timing & sequence cadence", category: "Timing" },
  { icon: "🚀", label: "Generating multi-channel outreach sequence", category: "Build" },
];
const BUILD_DELAYS = [700, 650, 850, 600, 720, 580, 540, 820];

/** Personalization chips — the REAL merge-token set (P1.5 `renderTokens`);
 *  the prototype's `{{calendarLink}}` is omitted until a booking-link token exists. */
const TOKENS = ["{{firstName}}", "{{lastName}}", "{{company}}", "{{senderName}}"];

/** Deterministic deliverability rows (owner review, PR #34): subject length,
 *  reading level, read time, links, "free" count — the AI-only score/verdict
 *  and spam-risk rows are omitted, never faked. */
function emailChecks(subject: string, body: string) {
  const rendered = `${subject} ${body}`.replace(/\{\{\s*[\w.]+\s*\}\}/g, "Alex");
  const words = rendered.split(/\s+/).filter(Boolean);
  const sentences = Math.max(1, (body.match(/[.!?](\s|$)/g) ?? []).length);
  const syllables = words.reduce(
    (acc, w) => acc + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length),
    0,
  );
  // Flesch–Kincaid grade level, clamped to a sane display range.
  const grade = Math.min(
    16,
    Math.max(1, Math.round(0.39 * (words.length / sentences) + 11.8 * (syllables / Math.max(1, words.length)) - 15.59)),
  );
  const readSec = Math.max(1, Math.round((words.length / 220) * 60));
  const links = (body.match(/https?:\/\//g) ?? []).length;
  const freeCount = (rendered.toLowerCase().match(/\bfree\b/g) ?? []).length;
  const subjLen = subject.length;
  const good = { fg: "#16A82A", dot: "#35E834" };
  const warn = { fg: "#B8860B", dot: "#E8C45B" };
  const neutral = { fg: "#5C6B62", dot: "#C2B79F" };
  return [
    freeCount === 0
      ? { label: '"Free" appears', value: "Not used", ...good }
      : { label: `"Free" appears ${freeCount === 1 ? "once" : `${freeCount} times`}`, value: "Minor — consider rewording", ...warn },
    subjLen >= 1 && subjLen <= 60
      ? { label: "Subject length", value: `Good (${subjLen} chars)`, ...good }
      : { label: "Subject length", value: `${subjLen} chars — keep under 60`, ...warn },
    grade <= 8
      ? { label: "Reading level", value: `Grade ${grade} · easy`, ...good }
      : { label: "Reading level", value: `Grade ${grade} · simplify`, ...warn },
    { label: "Read time", value: `~${readSec} sec`, ...neutral },
    links <= 1
      ? { label: "Links", value: String(links), ...good }
      : { label: "Links", value: `${links} — fewer is safer`, ...warn },
  ];
}

/** Success-overlay confetti, verbatim from the prototype. */
const CONFETTI = [
  { left: "8%", bg: "#36D7ED", size: 9, delay: "0s", dur: "2.6s" }, { left: "17%", bg: "#35E834", size: 7, delay: ".3s", dur: "3.1s" },
  { left: "26%", bg: "#D0F56B", size: 11, delay: ".6s", dur: "2.4s" }, { left: "34%", bg: "#36D7ED", size: 6, delay: ".15s", dur: "2.9s" },
  { left: "43%", bg: "#EEFC53", size: 9, delay: ".5s", dur: "3.3s" }, { left: "52%", bg: "#35E834", size: 8, delay: ".05s", dur: "2.7s" },
  { left: "60%", bg: "#36D7ED", size: 10, delay: ".45s", dur: "3.0s" }, { left: "68%", bg: "#D0F56B", size: 7, delay: ".2s", dur: "2.5s" },
  { left: "76%", bg: "#35E834", size: 9, delay: ".6s", dur: "3.2s" }, { left: "84%", bg: "#EEFC53", size: 6, delay: ".1s", dur: "2.8s" },
  { left: "92%", bg: "#36D7ED", size: 8, delay: ".4s", dur: "3.0s" }, { left: "13%", bg: "#D0F56B", size: 7, delay: ".8s", dur: "2.6s" },
  { left: "47%", bg: "#35E834", size: 10, delay: ".9s", dur: "3.1s" }, { left: "72%", bg: "#EEFC53", size: 8, delay: ".75s", dur: "2.9s" },
];

/** Goal cards, verbatim from the prototype's goalDefs (keys = registry GoalKeys). */
const GOALS: Array<{ key: string; icon: string; title: string; desc: string }> = [
  { key: "book_appointments", icon: "📅", title: "Book appointments", desc: "Get prospects onto your calendar." },
  { key: "generate_leads", icon: "🎯", title: "Generate leads", desc: "Capture & qualify new leads." },
  { key: "reactivate_leads", icon: "♻", title: "Reactivate leads", desc: "Win back lapsed contacts." },
  { key: "drive_signups", icon: "🚀", title: "Drive sign-ups", desc: "Convert interest into trials." },
  { key: "collect_reviews", icon: "⭐", title: "Collect reviews", desc: "Request reviews from clients." },
  { key: "promote_offer", icon: "🏷", title: "Promote an offer", desc: "Pitch a product, promo or launch." },
  { key: "fill_event", icon: "🎟", title: "Fill an event", desc: "Drive webinar or open-house signups." },
  { key: "upsell_clients", icon: "📈", title: "Upsell clients", desc: "Pitch upgrades to current clients." },
  { key: "custom", icon: "✎", title: "Custom goal", desc: "Describe your own objective." },
];

interface Citation {
  chunkId: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: string;
  locator: string;
  quote: string;
}
interface ContextField {
  value: string;
  citations?: Citation[];
  source?: string;
}
interface KnowledgeSource {
  id: string;
  label: string;
  kind: string;
  status: "PENDING" | "INGESTING" | "READY" | "FAILED";
  uri?: string | null;
  chunkCount?: number;
  meta?: { chunkCount?: number } | null;
}
interface SenderRow {
  id: string;
  fromEmail: string;
  fromName?: string | null;
  dailyLimit: number;
  status: string;
  sentToday: number;
  domainAuthStatus?: Record<string, unknown> | null;
}
type AddMode = null | "picker" | "url" | "doc" | "connector";

interface Gap {
  key: string;
  label: string;
  description?: string;
  state: "open" | "typed" | "ai_decides" | "covered";
}

const SRC_ICON: Record<string, string> = { WEBSITE: "🌐", DOCUMENT: "📄", TEXT: "📝", CONNECTOR: "🔌" };
const SRC_KIND_LABEL: Record<string, string> = { WEBSITE: "Website", DOCUMENT: "Document", TEXT: "Pasted text", CONNECTOR: "Connector" };
/** v2: every not-yet-ready state renders amber and never counts as context. */
const ING_PILL: Record<string, { fg: string; label: string }> = {
  PENDING: { fg: "#D4A020", label: "Queued" },
  INGESTING: { fg: "#D4A020", label: "Ingesting" },
  READY: { fg: "#16A82A", label: "Ready" },
  FAILED: { fg: "#C9543F", label: "Failed" },
};

/** GET /system/health payload (the worker heartbeat + storage agreement). */
interface SystemHealth {
  worker: "alive" | "stale" | "unknown";
  heartbeat: { at?: string; planner?: boolean; storage?: string; uploadsRoot?: string } | null;
  uploadsMismatch?: boolean;
  /** Hardening (bug round #2): bounded probe of the uploads container; null = local file store. */
  api?: { storageReachable?: boolean | null };
}

export function Wizard() {
  const [step, setStep] = useState(0);
  const [busyMsg, setBusyMsg] = useState("");
  // §0 toast — same treatment as Settings (dark pill, green ✓ dot, dismiss ✕).
  const [toastMsg, setToastMsg] = useState("");
  const toast = useCallback((m: string) => setToastMsg(m), []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // environment banner — poll /system/health on mount + every 30s. First
  // fetch failing once is NOT "worker down"; only 2 consecutive failures are.
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const healthFails = useRef(0);
  useEffect(() => {
    const check = () =>
      cf("system/health")
        .then((h) => {
          healthFails.current = 0;
          setHealth(h as SystemHealth);
        })
        .catch(() => {
          healthFails.current += 1;
          if (healthFails.current >= 2) {
            setHealth({ worker: "unknown", heartbeat: null, uploadsMismatch: false });
          }
        });
    void check();
    const t = setInterval(() => void check(), 30_000);
    return () => clearInterval(t);
  }, []);
  const envIssue = !health
    ? null
    : health.worker !== "alive"
      ? "Background processing is offline — documents and sequence generation will wait until it's back. Ask your admin to check the worker service."
      : health.heartbeat && !health.heartbeat.planner
        ? "AI planning isn't configured yet — sequence generation will wait. Ask your admin to finish AI setup (Key Vault secret ANTHROPIC-API-KEY, exposed to the service as the ANTHROPIC_API_KEY environment variable)."
        : health.uploadsMismatch
          ? "Document storage is misconfigured — the API and worker are using different local folders. Ask your admin to set a shared UPLOADS_DIR."
          : health.api?.storageReachable === false
            ? "Document storage is unreachable — uploads will fail until it's back. Ask your admin to check the storage account's network access."
            : null;

  // step 1
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<string | null>(null);
  // C2.9 (DEC-059): custom goal's owner-typed terminal label (default "Goal met").
  const [goalLabel, setGoalLabel] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [category, setCategory] = useState("Dental & Orthodontics");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [urlInput, setUrlInput] = useState("");
  const [contextSummary, setContextSummary] = useState("");
  const [fields, setFields] = useState<Record<string, ContextField>>({});
  const [aboutEv, setAboutEv] = useState<string | null>(null); // sourceId
  const [gaps, setGaps] = useState<Gap[]>([]);
  // DEC-024: never all-clear by default — launch stays gated until a real
  // gap report says otherwise (the staging zero-source bug).
  const [gapMeta, setGapMeta] = useState({ resolved: 0, total: 0, launchReady: false });
  const [coveredEv, setCoveredEv] = useState<string | null>(null); // field key
  const [typedDrafts, setTypedDrafts] = useState<Record<string, string>>({});
  const [buildMethod, setBuildMethod] = useState<"ai" | "template" | "scratch">("ai");
  const [reportLoaded, setReportLoaded] = useState(false);
  // B8: the distill in-flight state — true from the moment a kick fires until
  // the context rows read READY again. Drives the "Reading your documents…"
  // treatment on the About card + gap checker so the resting "Not found in
  // your docs" copy never shows while the AI is still mid-read.
  const [distilling, setDistilling] = useState(false);
  const distillKickPending = useRef(false);
  const distillKickFailed = useRef(false);
  const distillFailToasted = useRef(false);
  const [uploadCfg, setUploadCfg] = useState<{ enabled: boolean; reason?: string | null } | null>(null);
  const [aboutEditing, setAboutEditing] = useState(false);
  const [aboutDraft, setAboutDraft] = useState("");

  // step 2
  const [graph, setGraph] = useState<CampaignGraph | null>(null);
  const [graphSource, setGraphSource] = useState("");
  const [graphVersion, setGraphVersion] = useState(1);
  const [seqView, setSeqView] = useState<"sequence" | "branches">("sequence");
  const [drafting, setDrafting] = useState(false);
  // building interstitial (prototype BSTEPS) — timed like the prototype, but the
  // final step only completes once the real planner graph has landed.
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  // B7: planner failure surfaced on the building screen ("" = failed, no reason).
  const [planFailed, setPlanFailed] = useState<string | null>(null);
  // B7: regenerate failure surfaced inline on step 2.
  const [regenError, setRegenError] = useState<string | null>(null);
  const [editNode, setEditNode] = useState<GraphNode | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  // C2.7: custom-field tokens — chip selection + the mandatory-fallback card.
  const [fieldDefs, setFieldDefs] = useState<ContactFieldDefDto[]>([]);
  const [customTokenKey, setCustomTokenKey] = useState<string | null>(null);
  const [customFallback, setCustomFallback] = useState("");
  const [delayEdit, setDelayEdit] = useState<GraphNode | null>(null);
  const [delayAmount, setDelayAmount] = useState(2);

  // step 3
  const [csvOpen, setCsvOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // C2.8: "Choose a list" — picked list enrolls its members at launch
  // (SNAPSHOT semantics: resolved at deploy time, same path as CSV adds).
  const [wizardLists, setWizardLists] = useState<{ id: string; name: string; memberCount: number; archived: boolean }[]>([]);
  const [pickedList, setPickedList] = useState<{ id: string; name: string; memberCount: number } | null>(null);
  const [listSearch, setListSearch] = useState("");
  const [csvText, setCsvText] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const EMPTY_MANUAL = { firstName: "", lastName: "", email: "", company: "", phone: "" };
  const [manual, setManual] = useState(EMPTY_MANUAL);
  // DEC-039a: multi-add — rows queue up "this session" and post together.
  const [manualQueue, setManualQueue] = useState<Array<typeof EMPTY_MANUAL>>([]);
  const [added, setAdded] = useState<Array<{ id: string; email: string; firstName?: string; src?: "manual" | "csv" }>>([]);

  // step 4 — visual only (checkpoints §3)
  const [capture, setCapture] = useState({ widget: false, form: false });

  // step 5
  const [senders, setSenders] = useState<SenderRow[]>([]);
  const [dailyCap, setDailyCap] = useState(200);
  // P2.1 (DEC-061): per-channel sms cap (guardrails dailyCap.sms).
  const [smsDailyCap, setSmsDailyCap] = useState(50);
  const [windowStart, setWindowStart] = useState("09:00");
  const [timezone, setTimezone] = useState("UTC"); // B10 — IANA, A8 sendingWindow
  const [tzOpen, setTzOpen] = useState(false);
  const [windowEnd, setWindowEnd] = useState("17:00");
  const [sendDays, setSendDays] = useState([true, true, true, true, true, false, false]);
  const [quietHours, setQuietHours] = useState(true);
  const [ramp, setRamp] = useState(true);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false); // B9 add-sender flow

  // step 6
  const [deploying, setDeploying] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [enrolled, setEnrolled] = useState(0);
  const [enrollTarget, setEnrollTarget] = useState(0); // C2.8: adds + list snapshot

  // ── B6: draft resume ("Continue setup" → /agents/new?agent=<id>) ─────────
  // Durable state (name/goal/instructions/sources/gaps/context/graph) refetches
  // from its own rows; draftState carries only the wizard's local working set.
  const [resuming, setResuming] = useState<boolean>(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("agent"),
  );
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("agent");
    if (!id) return;
    void (async () => {
      try {
        const a = await cf(`agents/${id}/draft`);
        if (a.status !== "DRAFT") {
          // Launched agents aren't resumable — hand over to the agent view.
          window.location.replace(`/agents/${a.id}`);
          return;
        }
        const ds = (a.draftState ?? {}) as Partial<DraftState>;
        setAgentId(a.id);
        setName(a.name ?? "");
        setGoal(a.goal ?? null);
        if (a.category) setCategory(a.category);
        setInstructions(a.instructions ?? "");
        if (ds.goalLabel) setGoalLabel(ds.goalLabel);
        if (ds.buildMethod) setBuildMethod(ds.buildMethod);
        if (ds.added) setAdded(ds.added);
        if (ds.capture) setCapture(ds.capture);
        if (typeof ds.dailyCap === "number") setDailyCap(ds.dailyCap);
        if (typeof ds.smsDailyCap === "number") setSmsDailyCap(ds.smsDailyCap);
        if (ds.windowStart) setWindowStart(ds.windowStart);
        if (ds.timezone) setTimezone(ds.timezone);
        // C2.8: re-resolve the picked list from the server (name/count are
        // truth, not draft copies — B6 rule); a deleted/archived list drops.
        if (ds.pickedListId) {
          void cf("lists")
            .then((ls: { id: string; name: string; memberCount: number; archived: boolean }[]) => {
              const l = ls.find((x) => x.id === ds.pickedListId && !x.archived);
              if (l) setPickedList({ id: l.id, name: l.name, memberCount: l.memberCount });
            })
            .catch(() => {});
        }
        if (ds.windowEnd) setWindowEnd(ds.windowEnd);
        if (ds.sendDays?.length === 7) setSendDays(ds.sendDays);
        if (typeof ds.quietHours === "boolean") setQuietHours(ds.quietHours);
        if (typeof ds.ramp === "boolean") setRamp(ds.ramp);
        let target = typeof ds.step === "number" ? Math.min(5, Math.max(0, ds.step)) : 0;
        if (target >= 1) {
          // Steps past the first need the sequence — refetch it; if the plan
          // never landed, resume on setup rather than an empty sequence.
          try {
            const res = await cf(`planner/graph?agentId=${a.id}`);
            if (res.graph?.graph) {
              setGraph(res.graph.graph as CampaignGraph);
              setGraphSource(res.graph.source);
              setGraphVersion(res.graph.version ?? 1);
            } else target = 0;
          } catch {
            target = 0;
          }
        }
        setStep(target);
      } catch {
        toast("Couldn't load that draft — starting fresh.");
      } finally {
        setResuming(false);
      }
    })();
  }, [toast]);

  // B6: autosave the working set on the DRAFT agent (debounced) so Continue
  // setup restores the exact step + entries. One toast per outage, not per tick.
  const draftSaveFailed = useRef(false);
  useEffect(() => {
    if (!agentId || launched || resuming || building) return;
    const t = setTimeout(() => {
      const draftState: DraftState = {
        step,
        buildMethod,
        added,
        capture,
        dailyCap,
        smsDailyCap,
        windowStart,
        windowEnd,
        timezone,
        sendDays,
        quietHours,
        ramp,
        ...(pickedList ? { pickedListId: pickedList.id } : {}),
        ...(goalLabel.trim() ? { goalLabel: goalLabel.trim() } : {}),
      };
      // M1a (DEC-065): category rides the same PATCH — it's a durable column
      // (not draftState), and picker changes after the implicit create must land.
      cf(`agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ draftState, category }) })
        .then(() => {
          draftSaveFailed.current = false;
        })
        .catch(() => {
          if (!draftSaveFailed.current) toast("Couldn't save your progress — check your connection.");
          draftSaveFailed.current = true;
        });
    }, 800);
    return () => clearTimeout(t);
  }, [agentId, launched, resuming, building, step, buildMethod, added, capture, dailyCap, smsDailyCap, windowStart, windowEnd, timezone, sendDays, quietHours, ramp, pickedList, goalLabel, category, toast]);

  // ── polling (A4: 5s) ────────────────────────────────────────────────────
  const readyCount = useRef(0);
  const refreshKnowledge = useCallback(async () => {
    if (!agentId) return;
    const list = (await cf(`knowledge/sources?agentId=${agentId}`)) as KnowledgeSource[];
    setSources(list.map((s) => ({ ...s, chunkCount: s.meta?.chunkCount })));
    // A source just turned READY → kick the P1.3 distill so the About card,
    // citations and gap report fill in from the new evidence. A failed kick
    // retries on every poll tick until it lands (B8: during the 2026-07-08
    // outage these POSTs 500'd into an empty catch, so the step-1 knowledge
    // state could never fill in-session — never a silent catch, B5 rule).
    const ready = list.filter((s) => s.status === "READY").length;
    if (ready > readyCount.current || distillKickFailed.current) {
      readyCount.current = ready;
      distillKickFailed.current = false;
      distillKickPending.current = true;
      setDistilling(true); // in-flight from the click, not a poll-tick later
      void cf("context/distill", { method: "POST", body: JSON.stringify({ agentId }) })
        .then(() => {
          distillKickPending.current = false;
          distillFailToasted.current = false;
        })
        .catch(() => {
          distillKickPending.current = false;
          distillKickFailed.current = true;
          setDistilling(false);
          if (!distillFailToasted.current) {
            distillFailToasted.current = true;
            toast("Couldn't start reading your documents — retrying automatically.");
          }
        });
    }
  }, [agentId, toast]);
  const refreshContext = useCallback(async () => {
    if (!agentId || !goal) return;
    try {
      const ctx = await cf(`context?agentId=${agentId}`);
      const merged = { ...(ctx.workspace?.fields ?? {}), ...(ctx.agent?.fields ?? {}) };
      setFields(merged as Record<string, ContextField>);
      setContextSummary(ctx.agent?.rawSummary || ctx.workspace?.rawSummary || "");
      // B8: the rows carry the distill status — in-flight while either layer
      // is DISTILLING (the same poll that flips it READY also delivers the
      // fresh fields + summary, so covered gaps/About update in one tick).
      if (!distillKickPending.current) {
        setDistilling(
          ctx.agent?.status === "DISTILLING" || ctx.workspace?.status === "DISTILLING",
        );
      }
    } catch {
      /* context not distilled yet — fine */
    }
    // DEC-024 fix: the gap report is fetched INDEPENDENTLY of the context row —
    // at zero sources it still returns every goal-required field as an open
    // gap (the old coupled fetch silently kept the all-clear default).
    try {
      const report = await cf(`context/gaps?agentId=${agentId}&goal=${goal}`);
      setGaps(
        (report.gaps ?? []).map(
          (g: { key: string; label: string; status: Gap["state"]; proposedAsk?: string }) => ({
            key: g.key,
            label: g.label,
            description: g.proposedAsk ?? FIELD_HINTS[g.key] ?? "",
            state: g.status,
          }),
        ),
      );
      setGapMeta({ resolved: report.resolved ?? 0, total: report.total ?? 0, launchReady: report.launchReady ?? false });
      setReportLoaded(true);
    } catch {
      /* gap report unavailable — the registry-seeded local gaps stay */
    }
  }, [agentId, goal]);

  useEffect(() => {
    if (!agentId) return;
    // immediate first fetch (v2: gap rows must seed as soon as agent+goal
    // exist, not a poll-tick later), then the A4 5s poll.
    void refreshKnowledge();
    void refreshContext();
    const t = setInterval(() => {
      void refreshKnowledge();
      void refreshContext();
    }, 5000);
    return () => clearInterval(t);
  }, [agentId, refreshKnowledge, refreshContext]);

  useEffect(() => {
    if (step === 4) void cf("senders").then(setSenders).catch(() => {});
  }, [step]);

  // DEC-026: the Upload-doc card is disabled-with-reason when storage is absent.
  useEffect(() => {
    void cf("knowledge/upload-config").then(setUploadCfg).catch(() => setUploadCfg({ enabled: true }));
    // C2.7: workspace custom-field defs feed the token picker.
    void cf("contact-fields").then(setFieldDefs).catch(() => {});
    // C2.8: saved lists feed the step-3 picker.
    void cf("lists").then(setWizardLists).catch(() => {});
  }, []);

  // C2.7: the fallback card never survives switching steps/closing the editor.
  useEffect(() => {
    setCustomTokenKey(null);
    setCustomFallback("");
  }, [editNode]);

  // ── derived ──────────────────────────────────────────────────────────────
  // DEC-024: before any server report exists, seed the goal's required fields
  // as OPEN gaps straight from the core registry — zero sources must never
  // read as launch-ready.
  const localGaps = useMemo<Gap[]>(() => {
    if (!goal || !(GOAL_KEYS as readonly string[]).includes(goal)) return [];
    return requiredFieldsFor(goal as GoalKey).map((k) => ({
      key: k,
      label: CONTEXT_FIELD_META[k].label,
      description: FIELD_HINTS[k] ?? "",
      state: "open" as const,
    }));
  }, [goal]);
  const gapRows = reportLoaded ? gaps : localGaps;
  const covered = useMemo(() => gapRows.filter((g) => g.state === "covered"), [gapRows]);
  const openGaps = useMemo(() => gapRows.filter((g) => g.state !== "covered"), [gapRows]);
  const gapTotal = reportLoaded ? gapMeta.total : localGaps.length;
  const gapResolved = reportLoaded ? gapMeta.resolved : 0;
  const allResolved = reportLoaded ? gapMeta.launchReady : false;

  // v2 gating: context = at least one READY source or one typed gap answer.
  const readyCnt = useMemo(() => sources.filter((x) => x.status === "READY").length, [sources]);
  const typedCnt = useMemo(() => gapRows.filter((g) => g.state === "typed").length, [gapRows]);
  const hasContext = readyCnt > 0 || typedCnt > 0;

  /** Grounded-in chips: citations aggregated BY SOURCE (chunk ids never shown). */
  const groundedSources = useMemo(() => {
    const bySource = new Map<string, { label: string; type: string; quotes: Citation[]; backs: Set<string> }>();
    for (const [key, f] of Object.entries(fields)) {
      for (const c of f.citations ?? []) {
        const entry = bySource.get(c.sourceId) ?? { label: c.sourceLabel, type: c.sourceType, quotes: [], backs: new Set<string>() };
        entry.quotes.push(c);
        entry.backs.add(key.replace(/_/g, " "));
        bySource.set(c.sourceId, entry);
      }
    }
    return [...bySource.entries()].map(([id, v]) => ({ id, ...v }));
  }, [fields]);

  // M1b (DEC-066): strategy steps are branch targets, not sequence steps —
  // the drawer header names their intent instead of a bogus "Step N".
  const editStepIndex = useMemo(() => {
    if (!graph || !editNode) return 0;
    return mainSteps(graph).findIndex((n) => n.id === editNode.id) + 1;
  }, [graph, editNode]);
  const editStrategyIntent = useMemo(() => {
    if (!graph || !editNode) return null;
    return strategyStepsOf(graph).find((s) => s.step.id === editNode.id)?.intent ?? null;
  }, [graph, editNode]);

  const branchCases = useMemo(() => {
    const b = graph?.nodes.find((n) => n.type === "branch");
    return b && b.type === "branch" ? b.cases : [];
  }, [graph]);

  const stepValid = [
    Boolean(goal && name.trim() && agentId && allResolvedForNext()),
    Boolean(graph),
    // C2.8: a picked list is a contact source — it satisfies the step like adds do.
    added.length > 0 || pickedList !== null,
    true,
    senders.length > 0,
    allResolved,
  ][step];

  function allResolvedForNext() {
    // Step 1 Next needs goal + name; gaps gate LAUNCH (step 6), not step 1.
    return true;
  }

  // ── actions ──────────────────────────────────────────────────────────────
  /** Double-create guard (B5): concurrent callers (debounced draft effect +
   *  addUrl/typeGap/next) share one in-flight create. */
  const agentCreate = useRef<Promise<string> | null>(null);
  async function ensureAgent(): Promise<string> {
    if (agentId) return agentId;
    if (agentCreate.current) return agentCreate.current;
    agentCreate.current = cf("agents", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        goal,
        // M1a (DEC-065): persist the step-1 picker — goal×category derives
        // the selling arc (supersedes DEC-038(6) visual-only).
        category,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      }),
    })
      .then((created) => {
        setAgentId(created.id);
        return created.id as string;
      })
      .catch((err: unknown) => {
        agentCreate.current = null;
        throw err;
      });
    return agentCreate.current;
  }

  // B5: implicit draft — name + goal are enough to create the draft agent
  // (knowledge attaches to it), no source/answer action required first. The
  // timer resets per keystroke (true debounce) so the draft gets the full name.
  useEffect(() => {
    // B6: while resuming, the draft already exists — never create a second one.
    if (resuming || !name.trim() || !goal || agentId) return;
    const t = setTimeout(() => {
      void ensureAgent().catch(() => toast("Couldn't save the draft — check your connection."));
    }, 800);
    return () => clearTimeout(t);
    // ensureAgent is deliberately not a dep: only name/goal/agentId gate the trigger.
  }, [name, goal, agentId, resuming]);

  async function addUrl() {
    if (!urlInput.trim()) return;
    if (!name.trim()) {
      toast("Name your agent first — knowledge attaches to it.");
      return;
    }
    try {
      const id = await ensureAgent();
      await cf("knowledge/sources", {
        method: "POST",
        body: JSON.stringify({ kind: "WEBSITE", uri: urlInput.trim(), label: urlInput.trim().replace(/^https?:\/\//, ""), agentId: id }),
      });
      setUrlInput("");
      setAddMode(null);
      await refreshKnowledge();
    } catch {
      toast("Couldn't add that URL — try again.");
    }
  }

  async function removeSource(id: string) {
    await cf(`knowledge/sources/${id}`, { method: "DELETE" }).catch(() => {
      toast("Couldn't remove the source.");
    });
    await refreshKnowledge();
  }

  /** B3: FAILED → PENDING + re-enqueue; the row's amber pill takes over. */
  async function retrySource(id: string) {
    try {
      await cf(`knowledge/sources/${id}/retry`, { method: "POST" });
      toast("Retrying ingestion…");
      await refreshKnowledge();
    } catch {
      toast("Couldn't retry — try again.");
    }
  }

  /** DEC-026: real multipart upload through the proxy (cf() forces JSON headers). */
  async function uploadDoc(file: File) {
    if (!name.trim()) {
      toast("Name your agent first — knowledge attaches to it.");
      return;
    }
    try {
      const id = await ensureAgent();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("agentId", id);
      // busyMsg covers the transfer only — the row's own pill takes over after.
      setBusyMsg("Uploading document…");
      const res = await fetch("/api/cf/knowledge/sources/upload", { method: "POST", body: fd });
      setBusyMsg("");
      if (!res.ok) {
        const apiMsg = await res
          .json()
          .then((j: { message?: unknown }) => (typeof j?.message === "string" ? j.message : null))
          .catch(() => null);
        toast(res.status < 500 && apiMsg ? apiMsg : "Upload failed — try again.");
        return;
      }
      setAddMode(null);
      await refreshKnowledge();
    } catch {
      setBusyMsg("");
      toast("Upload failed — try again.");
    }
  }

  async function saveAbout() {
    if (!agentId) return;
    try {
      await cf("context/summary", {
        method: "POST",
        body: JSON.stringify({ agentId, summary: aboutDraft }),
      });
      setContextSummary(aboutDraft);
      setAboutEditing(false);
    } catch {
      toast("Couldn't save the summary.");
    }
  }

  async function typeGap(key: string) {
    const value = typedDrafts[key]?.trim();
    if (!value || !name.trim() || !goal) return;
    try {
      // v2: a typed answer is a context-unlock path — it must work BEFORE any
      // source exists, so create the draft agent on demand.
      const id = agentId ?? (await ensureAgent());
      await cf("context/answers", {
        method: "POST",
        body: JSON.stringify({ agentId: id, key, value }),
      });
      await refreshContext();
    } catch {
      toast("Couldn't save that answer — try again.");
    }
  }
  async function delegateGap(key: string) {
    if (!name.trim() || !goal) return;
    try {
      const id = agentId ?? (await ensureAgent());
      await cf("context/delegate", { method: "POST", body: JSON.stringify({ agentId: id, key }) });
      await refreshContext();
    } catch {
      toast("Couldn't save that answer — try again.");
    }
  }
  async function undoGap(key: string) {
    if (!agentId) return;
    try {
      await cf("context/undo", { method: "POST", body: JSON.stringify({ agentId, key }) });
      setTypedDrafts((d) => ({ ...d, [key]: "" }));
      await refreshContext();
    } catch {
      toast("Couldn't save that answer — try again.");
    }
  }

  function finishBuild(g: CampaignGraph, source: string) {
    setGraph(g);
    setGraphSource(source);
    setGraphVersion(1);
    setDrafting(false);
    setBuildProgress(BSTEPS.length);
    setTimeout(() => {
      setBuilding(false);
      setBuildProgress(0);
      setStep(1);
    }, 1100);
  }

  /** DEC-038 amended (DEC-047): hold until graph OR failure — never infinite. */
  const buildPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  function pollBuild(id: string) {
    if (buildPoll.current) clearInterval(buildPoll.current);
    buildPoll.current = setInterval(async () => {
      try {
        const res = await cf(`planner/graph?agentId=${id}`);
        if (res.graph?.graph) {
          if (buildPoll.current) clearInterval(buildPoll.current);
          buildPoll.current = null;
          finishBuild(res.graph.graph as CampaignGraph, res.graph.source);
          return;
        }
      } catch {
        /* keep polling */
      }
      try {
        const st = await cf(`planner/status?agentId=${id}`);
        if (st.state === "failed") {
          if (buildPoll.current) clearInterval(buildPoll.current);
          buildPoll.current = null;
          setPlanFailed(typeof st.failedReason === "string" ? st.failedReason : "");
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
  }

  /** Prototype startBuild(), wired: BSTEPS advance on the prototype's timings,
   *  but step 8 ("Generating…") holds until the real planner graph arrives. */
  async function startBuild(id: string) {
    window.scrollTo({ top: 0 });
    setBuilding(true);
    setBuildProgress(0);
    setDrafting(true);
    setPlanFailed(null);
    let postFailed = false;
    const planned = cf("planner/plan", { method: "POST", body: JSON.stringify({ agentId: id }) }).catch((err: unknown) => {
      postFailed = true;
      setPlanFailed(err instanceof Error ? err.message : String(err));
    });
    let acc = 180 + 200;
    for (let idx = 0; idx < BUILD_DELAYS.length - 1; idx += 1) {
      acc += BUILD_DELAYS[idx]!;
      setTimeout(() => setBuildProgress(idx + 1), acc);
    }
    await planned;
    if (!postFailed) pollBuild(id);
  }

  /** B7: re-POST the plan from the building screen's failure panel and resume the poll. */
  async function retryBuild() {
    if (!agentId) return;
    setPlanFailed(null);
    setDrafting(true);
    try {
      await cf("planner/plan", { method: "POST", body: JSON.stringify({ agentId }) });
    } catch (err: unknown) {
      setPlanFailed(err instanceof Error ? err.message : String(err));
      return;
    }
    pollBuild(agentId);
  }

  /** B7: leave the failed building screen without losing the step-1 setup. */
  function backToSetup() {
    if (buildPoll.current) clearInterval(buildPoll.current);
    buildPoll.current = null;
    setPlanFailed(null);
    setDrafting(false);
    setBuilding(false);
    setBuildProgress(0);
  }

  async function next() {
    if (step === 0) {
      // B4: the blocked Generate click always explains itself (reason ladder).
      const reason = !name.trim()
        ? "Name your agent first."
        : !goal
          ? "Pick a goal first."
          : !hasContext && sources.some((s) => s.status === "PENDING" || s.status === "INGESTING")
            ? "Waiting for your knowledge sources to finish ingesting."
            : !hasContext
              ? "Add a knowledge source or answer a question above to unlock sequence building."
              : null;
      if (reason) {
        toast(reason);
        return;
      }
      let id: string;
      try {
        id = await ensureAgent();
      } catch {
        toast("Couldn't save the draft — check your connection.");
        return;
      }
      if (buildMethod === "ai" && !graph) {
        // "Generate with AI ✦" → building interstitial, then step 2
        void startBuild(id);
        return;
      }
    }
    if (step === 4 && agentId) {
      await cf(`agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          guardrails: {
            sendingWindow: {
              days: sendDays.flatMap((on, i) => (on ? [i + 1] : [])),
              start: windowStart,
              end: windowEnd,
              timezone,
            },
            dailyCap: { email: dailyCap, sms: smsDailyCap },
            consent: null,
            tracking: { openTracking: true, linkTracking: true },
            // C2.9: custom goal's terminal label survives launch here (DEC-059).
            ...(goal === "custom" && goalLabel.trim() ? { goalLabel: goalLabel.trim() } : {}),
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        }),
      });
    }
    setStep((s) => Math.min(5, s + 1));
  }

  /** C2.7: insert `{{custom.<key>|fallback}}` — only ever with the fallback
   *  (never-blank rule); the save-time check below is the typed-token backstop. */
  function insertCustomToken() {
    const fb = customFallback.trim();
    if (!customTokenKey || !fb) return;
    const token = `{{custom.${customTokenKey}|${fb}}}`;
    setEditBody((b) => (b ? `${b} ${token}` : token));
    setCustomTokenKey(null);
    setCustomFallback("");
  }

  async function saveEditedStep() {
    if (!graph || !editNode || !agentId) return;
    // C2.7: custom tokens carry a MANDATORY fallback ({{custom.key|fallback}})
    // — reject at save time so a blank can never reach the send boundary.
    const missing = customTokensMissingFallback(`${editSubject} ${editBody}`);
    if (missing.length > 0) {
      toast(`Add a fallback for {{custom.${missing[0]}}} — custom tokens never render blank.`);
      return;
    }
    const updated: CampaignGraph = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === editNode.id && n.type === "step"
          ? { ...n, content: { ...n.content, subject: editSubject, body: editBody } }
          : n,
      ),
    };
    setBusyMsg("Saving step…");
    const row = await cf("planner/graph", {
      method: "PUT",
      body: JSON.stringify({ agentId, graph: updated }),
    });
    setGraph(updated);
    setGraphSource(row.source ?? "MANUAL");
    setGraphVersion(row.version ?? graphVersion + 1);
    setEditNode(null);
    setBusyMsg("");
  }

  /** ✦ Regenerate with AI — re-runs the planner; the next AI version replaces the view.
   *  DEC-038 amended (DEC-047): hold until graph OR failure — never infinite. */
  async function regenerate() {
    if (!agentId || drafting) return;
    setDrafting(true);
    setRegenError(null);
    try {
      await cf("planner/plan", { method: "POST", body: JSON.stringify({ agentId }) });
    } catch (err: unknown) {
      toast("Sequence generation failed");
      setDrafting(false);
      setRegenError(err instanceof Error ? err.message : String(err));
      return;
    }
    const before = graphVersion;
    const poll = setInterval(async () => {
      try {
        const res = await cf(`planner/graph?agentId=${agentId}`);
        if (res.graph?.graph && (res.graph.version ?? 0) > before) {
          clearInterval(poll);
          setGraph(res.graph.graph as CampaignGraph);
          setGraphSource(res.graph.source);
          setGraphVersion(res.graph.version);
          setDrafting(false);
          return;
        }
      } catch {
        /* keep polling */
      }
      try {
        const st = await cf(`planner/status?agentId=${agentId}`);
        if (st.state === "failed") {
          clearInterval(poll);
          toast("Sequence generation failed");
          setDrafting(false);
          setRegenError(typeof st.failedReason === "string" ? st.failedReason : "");
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
  }

  /** + Add step: append delay + empty email step before the reply branch (MANUAL version).
   *  M1b: `last` walks the MAIN PATH — on a v4 graph the last node in the
   *  step-filter is a reply-STRATEGY step (its edge goes to an end/branch
   *  rejoin), and splicing after it would give the real last main step two
   *  outgoing edges — an invalid graph. */
  async function addStep() {
    if (!graph || !agentId) return;
    const branch = replyBranchOf(graph) ?? graph.nodes.find((x) => x.type === "branch");
    const pathToBranch = mainPath(graph);
    const branchAt = branch ? pathToBranch.findIndex((x) => x.id === branch.id) : -1;
    const steps = (branchAt >= 0 ? pathToBranch.slice(0, branchAt) : pathToBranch).filter(
      (x) => x.type === "step",
    );
    const last = steps[steps.length - 1];
    if (!last) return;
    const n = mainSteps(graph).length + 1;
    const delayId = `delay-added-${n}`;
    const stepId = `step-added-${n}`;
    const updated: CampaignGraph = {
      ...graph,
      nodes: [
        ...graph.nodes.filter((x) => x.type !== "branch" && x.type !== "end"),
        { id: delayId, type: "delay", amount: 2, unit: "days" },
        { id: stepId, type: "step", channel: "email", content: { subject: `Follow-up ${n}`, body: "Hi {{firstName}}, one more thought for {{company}}…" } },
        ...graph.nodes.filter((x) => x.type === "branch" || x.type === "end"),
      ],
      edges: [
        ...graph.edges.filter((e) => !(branch && e.from === last.id && e.to === branch.id)),
        { from: last.id, to: delayId },
        { from: delayId, to: stepId },
        ...(branch ? [{ from: stepId, to: branch.id }] : []),
      ],
    };
    setBusyMsg("Adding step…");
    const row = await cf("planner/graph", { method: "PUT", body: JSON.stringify({ agentId, graph: updated }) });
    setGraph(updated);
    setGraphSource(row.source ?? "MANUAL");
    setGraphVersion(row.version ?? graphVersion + 1);
    setBusyMsg("");
    const created = updated.nodes.find((x) => x.id === stepId);
    if (created && created.type === "step") {
      setEditNode(created);
      setEditSubject(created.content.subject ?? "");
      setEditBody(created.content.body ?? "");
    }
  }

  async function saveDelay() {
    if (!graph || !delayEdit || !agentId) return;
    const updated: CampaignGraph = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === delayEdit.id && n.type === "delay" ? { ...n, amount: delayAmount } : n,
      ),
    };
    const row = await cf("planner/graph", { method: "PUT", body: JSON.stringify({ agentId, graph: updated }) });
    setGraph(updated);
    setGraphSource(row.source ?? "MANUAL");
    setGraphVersion(row.version ?? graphVersion + 1);
    setDelayEdit(null);
  }

  async function addContacts(rows: Array<{ email: string; firstName?: string; lastName?: string; company?: string; phone?: string }>, src: "manual" | "csv") {
    for (const row of rows) {
      if (!row.email?.includes("@")) continue;
      try {
        const created = await cf("contacts", { method: "POST", body: JSON.stringify(row) });
        // 49-3: the source rides each entry so launch can tell the enrollment.
        setAdded((a) => [...a, { id: created.id, email: row.email, firstName: row.firstName, src }]);
      } catch {
        /* skip bad row */
      }
    }
  }

  async function launch() {
    if (!agentId || !allResolved || deploying || launched) return;
    setDeploying(true);
    // B6: launch clears draftState — a launched agent is no longer resumable.
    await cf(`agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ status: "ACTIVE", draftState: null }) });
    // Enroll every added contact on the primary campaign — each POST starts one
    // durable CampaignWorkflow (P1.6); idempotent on (campaignId, contactId).
    // C2.8: a picked list enrolls its members THROUGH THE SAME PATH — the
    // membership is resolved NOW (snapshot at launch; no live-sync, per plan).
    // 49-3: each enrollment carries its provenance — the Leads tab's
    // ORIGINATED FROM column renders it. Adds win over list membership when a
    // contact arrives both ways (the more specific action).
    const origins = new Map<string, { kind: "manual" | "csv" | "list"; listId?: string; listName?: string }>();
    if (pickedList) {
      const members = ((await cf(`contacts/view?listId=${pickedList.id}`).catch(() => ({ rows: [] }))) as { rows: { id: string }[] }).rows;
      for (const m of members) origins.set(m.id, { kind: "list", listId: pickedList.id, listName: pickedList.name });
    }
    for (const c of added) origins.set(c.id, { kind: c.src ?? "manual" });
    let ok = 0;
    for (const [contactId, origin] of origins) {
      await cf("enrollments", { method: "POST", body: JSON.stringify({ agentId, contactId, origin }) })
        .then(() => { ok += 1; })
        .catch(() => {});
    }
    setEnrollTarget(origins.size);
    setEnrolled(ok);
    setDeploying(false);
    setLaunched(true);
  }

  /** Limits modal save → Guardrails schema (A8): sendingWindow + dailyCap. */
  async function saveLimits() {
    if (agentId) {
      await cf(`agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          guardrails: {
            sendingWindow: {
              days: sendDays.flatMap((on, i) => (on ? [i + 1] : [])),
              start: windowStart,
              end: windowEnd,
              timezone,
            },
            dailyCap: { email: dailyCap, sms: smsDailyCap },
            consent: null,
            tracking: { openTracking: true, linkTracking: true },
            // C2.9: custom goal's terminal label survives launch here (DEC-059).
            ...(goal === "custom" && goalLabel.trim() ? { goalLabel: goalLabel.trim() } : {}),
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        }),
      }).catch(() => toast("Couldn't save limits — try again."));
    }
    setLimitsOpen(false);
  }

  const stepCount = graph ? mainSteps(graph).length : 0;

  // ── deploying overlay (prototype: dark, spinner) ─────────────────────────
  if (deploying) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 55, background: "#0C140F", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }} data-testid="launch-deploying">
        <style>{`@keyframes cfBuildSpin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ width: 62, height: 62, borderRadius: "50%", border: "4px solid rgba(255,255,255,.12)", borderTopColor: "#35E834", animation: "cfBuildSpin .8s linear infinite" }} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 22, color: "#fff", marginBottom: 6 }}>Launching your agent…</div>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.5)" }}>Activating senders, scheduling sends &amp; arming automations</div>
        </div>
      </div>
    );
  }

  // ── success overlay (prototype: confetti, pop rings, drawn check) ────────
  if (launched) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 56, overflow: "hidden", background: "radial-gradient(120% 85% at 50% -5%, #13241A 0%, #0C140F 58%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }} data-testid="launch-success">
        <style>{`@keyframes cfSuccPop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}@keyframes cfSuccRing{0%{transform:scale(.55);opacity:.65}100%{transform:scale(2);opacity:0}}@keyframes cfCheckDraw{from{stroke-dashoffset:42}to{stroke-dashoffset:0}}@keyframes cfFadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@keyframes cfConfFall{0%{transform:translateY(-30px) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(520px) rotate(600deg);opacity:0}}`}</style>
        {CONFETTI.map((c, i) => (
          <span key={i} style={{ position: "absolute", top: -30, left: c.left, width: c.size, height: c.size, background: c.bg, borderRadius: 2, animation: `cfConfFall ${c.dur} linear ${c.delay} infinite` }} />
        ))}
        <div style={{ position: "relative", width: 112, height: 112, marginBottom: 30, animation: "cfSuccPop .6s cubic-bezier(.2,.85,.25,1) both" }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: GRAD, animation: "cfSuccRing 1.8s ease-out .5s infinite" }} />
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: GRAD, animation: "cfSuccRing 1.8s ease-out 1.1s infinite" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: GRAD, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 18px 50px rgba(53,232,52,.4)" }}>
            <svg width="50" height="50" viewBox="0 0 46 46"><path d="M13 24 L20 31 L33 16" fill="none" stroke="#0A0F0C" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="42" strokeDashoffset="42" style={{ animation: "cfCheckDraw .5s .55s ease forwards" }} /></svg>
          </div>
        </div>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 34, letterSpacing: "-.02em", color: "#fff", marginBottom: 10, animation: "cfFadeUp .5s .3s both" }}>Your agent is live 🎉</div>
        <div style={{ fontSize: 15.5, color: "rgba(255,255,255,.6)", maxWidth: 440, lineHeight: 1.55, marginBottom: 22, animation: "cfFadeUp .5s .42s both" }}>
          <strong style={{ color: "#fff", fontWeight: 600 }}>{name}</strong> is now reaching {enrolled} contact{enrolled === 1 ? "" : "s"} over email. First sends go out in the next scheduled window.
        </div>
        {enrolled < enrollTarget ? (
          <div style={{ fontSize: 12.5, color: "#E8C45B", marginBottom: 18, animation: "cfFadeUp .5s .47s both" }} data-testid="enroll-warning">
            ⚠ {enrollTarget - enrolled} of {enrollTarget} contacts couldn&apos;t be enrolled — retry from the agent&apos;s Leads tab.
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 9, marginBottom: 32, animation: "cfFadeUp .5s .52s both" }}>
          {[`${stepCount}-step sequence`, "Email", `${enrolled} contact${enrolled === 1 ? "" : "s"}`].map((chip) => (
            <span key={chip} style={{ fontSize: 12.5, fontWeight: 600, color: "#D0F56B", background: "rgba(208,245,107,.12)", border: "1px solid rgba(208,245,107,.25)", borderRadius: 100, padding: "7px 15px" }}>{chip}</span>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, animation: "cfFadeUp .5s .62s both" }}>
          <a href={`/agents/${agentId}`} style={{ textDecoration: "none", fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: "#0A0F0C", background: GRAD, borderRadius: 13, padding: "15px 34px", boxShadow: "0 10px 30px rgba(53,232,52,.35)", cursor: "pointer" }} data-testid="view-agent">View agent dashboard →</a>
          <span onClick={() => { window.location.href = "/agents/new"; }} style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,.55)", cursor: "pointer" }}>Create another agent</span>
        </div>
      </div>
    );
  }

  // B6: hold the canvas while the draft hydrates (avoids a step-1 flash
  // before the resumed step lands).
  if (resuming) {
    return <div style={{ minHeight: "100vh", background: "#FBF7F0" }} data-testid="wizard-resuming" />;
  }

  const nextLabel = building ? "Building…" : step === 4 ? "Preview" : step === 0 ? "Generate with AI ✦" : "Next ›";

  return (
    // overflowX "clip" (not "hidden"): hidden creates a scroll container and
    // kills every descendant position:sticky — the v2 rail footer must stick.
    <div style={{ position: "relative", minHeight: "100vh", width: "100%", background: "#FBF7F0", fontFamily: "'Hanken Grotesk',sans-serif", overflowX: "clip" }}>
      {/* wizard top bar */}
      <div style={{ boxSizing: "border-box", display: "flex", alignItems: "center", gap: 14, height: 66, padding: "16px 26px 16px 72px", borderBottom: "1px solid #EBE3D6", background: "#fff" }}>
        <a href="/dashboard" style={{ boxSizing: "border-box", textDecoration: "none", display: "flex", alignItems: "center", gap: 7, height: 34, fontSize: 13.5, fontWeight: 600, color: "#5C6B62", border: "1px solid #EBE3D6", borderRadius: 10, padding: "0 13px", marginRight: 2 }}>‹ Dashboard</a>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: GRAD, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, color: "#0A0F0C", fontSize: 17 }}>f</div>
        <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: "#0E1512" }}>New agent</span>
        <span style={{ fontSize: 13, color: "#9AA59E", borderLeft: "1px solid #EBE3D6", paddingLeft: 14 }} data-testid="step-counter">Step {step + 1} of {STEP_DEFS.length}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {agentId ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#16A82A" }} data-testid="draft-saved"><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#35E834" }} />Draft saved · just now</span>
          ) : null}
          <span style={{ boxSizing: "border-box", display: "flex", alignItems: "center", height: 34, fontSize: 13, fontWeight: 600, color: "#5C6B62", border: "1px solid #EBE3D6", borderRadius: 10, padding: "0 15px" }}>Help</span>
          <a href="/dashboard" style={{ textDecoration: "none", width: 34, height: 34, borderRadius: 10, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E" }}>✕</a>
        </div>
      </div>

      <div style={{ display: "flex", background: "#FBF7F0", paddingLeft: 64 }}>
      {/* step rail — §3 v2: 332px, divider lives on the content, sticky footer */}
      <div style={{ boxSizing: "border-box", flex: "none", width: 332, padding: "26px 24px 0", minHeight: 680, height: "calc(100vh - 66px)", position: "sticky", top: 0, alignSelf: "flex-start", display: "flex", flexDirection: "column" }}>
        <div>
          {STEP_DEFS.map((d, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <div
                key={d.label}
                style={{ display: "flex", gap: 13, alignItems: "flex-start", padding: "12px 12px", borderRadius: 13, cursor: "pointer", marginBottom: 4, background: current ? "#fff" : "transparent" }}
                onClick={() => !building && i <= step && setStep(i)}
                data-testid={`rail-step-${i}`}
              >
                <span style={{ width: 30, height: 30, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, background: done ? "#16A82A" : current ? GRAD : "#fff", color: done ? "#fff" : current ? "#0A0F0C" : "#9AA59E", border: done || current ? "none" : "1px solid #D8CFBE" }}>
                  {done ? "✓" : i + 1}
                </span>
                <div style={{ minWidth: 0, paddingTop: 2 }}>
                  <div style={{ fontSize: 14.5, fontWeight: current ? 700 : 600, color: current ? "#0E1512" : done ? "#3B463F" : "#8A7F6B", whiteSpace: "nowrap" }}>{d.label}</div>
                  <div style={{ fontSize: 12.5, color: "#9AA59E" }}>{d.hint}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: "auto", display: "flex", gap: 10, paddingTop: 14, position: "sticky", bottom: 0, background: "#FBF7F0", paddingBottom: 24 }}>
          <button type="button" onClick={() => !building && setStep((s) => Math.max(0, s - 1))} style={{ flex: "none", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "11px 18px", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}>
            ‹ Back
          </button>
          {/* B4: on step 0 the button stays clickable while looking disabled so
              the click can explain (next()'s reason ladder → toast). */}
          {step < 5 ? (
            <button type="button" data-testid="wizard-next" onClick={() => void next()} disabled={building || (step !== 0 && !stepValid)} style={{ flex: 1, textAlign: "center", background: stepValid && !building ? GRAD : "#EDE8DC", border: "none", borderRadius: 11, padding: "11px 18px", fontSize: 15, fontWeight: 700, color: stepValid && !building ? "#0A0F0C" : "#A99F8C", cursor: stepValid && !building ? "pointer" : "default", boxShadow: stepValid && !building ? "0 6px 16px rgba(53,232,52,.26)" : "none", opacity: step === 0 && stepValid && !hasContext ? 0.55 : 1, transition: "opacity .2s", fontFamily: "'Hanken Grotesk',sans-serif" }}>
              {nextLabel}
            </button>
          ) : (
            <button type="button" data-testid="wizard-launch" onClick={() => void launch()} disabled={!allResolved} title={allResolved ? "Deploy agent" : "Resolve every gap before launching"} style={{ flex: 1, textAlign: "center", background: allResolved ? GRAD : "#EDE8DC", border: "none", borderRadius: 11, padding: "11px 18px", fontSize: 15, fontWeight: 700, color: allResolved ? "#0A0F0C" : "#A99F8C", cursor: allResolved ? "pointer" : "default", boxShadow: allResolved ? "0 6px 16px rgba(53,232,52,.26)" : "none", fontFamily: "'Hanken Grotesk',sans-serif" }}>
              Deploy agent
            </button>
          )}
        </div>
      </div>

      {/* step content — v2: carries the 1px divider as border-left */}
      <div style={{ boxSizing: "border-box", flex: 1, minWidth: 0, padding: "28px 32px", position: "relative", borderLeft: "1px solid #EBE3D6" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: "-.02em", color: "#0E1512" }}>{STEP_DEFS[step]!.title}</div>
          <div style={{ fontSize: 15, color: "#5C6B62" }}>{STEP_DEFS[step]!.subtitle}</div>
        </div>

        {envIssue ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid rgba(232,196,91,.48)", background: "rgba(232,196,91,.06)", borderRadius: 12, padding: "12px 16px", marginBottom: 18 }} data-testid="env-banner">
            <span style={{ fontSize: 15, color: "#D4A020", flex: "none" }}>⚠</span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "#8A7F6B" }}>{envIssue}</span>
          </div>
        ) : null}

        {building ? (
          <BuildingScreen
            progress={buildProgress}
            sources={sources}
            fields={fields}
            graph={graph}
            planFailed={planFailed}
            onRetry={() => void retryBuild()}
            onBack={backToSetup}
          />
        ) : null}

        {busyMsg ? <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "#0C140F", color: "#fff", borderRadius: 12, padding: "10px 18px", fontSize: 13.5, zIndex: 70 }}>{busyMsg}</div> : null}

        {/* §0 toast — Settings treatment: dark pill, 22px green ✓ dot, dismiss ✕ */}
        {toastMsg ? (
          <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 71, display: "flex", alignItems: "center", gap: 11, background: "#0C140F", color: "#fff", borderRadius: 12, padding: "12px 16px", boxShadow: "0 16px 40px rgba(0,0,0,.3)" }} data-testid="toast">
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#35E834", color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flex: "none" }}>✓</span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{toastMsg}</span>
            <span onClick={() => setToastMsg("")} style={{ marginLeft: 8, color: "rgba(255,255,255,.5)", cursor: "pointer" }}>✕</span>
          </div>
        ) : null}

        {step === 0 ? (
          <div style={{ maxWidth: 760 }}>
          <Step1
            {...{ name, setName, goal, setGoal, goalLabel, setGoalLabel, sources, addMode, setAddMode, category, setCategory, categoryOpen, setCategoryOpen, instructions, setInstructions, urlInput, setUrlInput, addUrl, contextSummary, groundedSources, aboutEv, setAboutEv, gaps: openGaps, covered, coveredEv, setCoveredEv, fields, gapResolved, gapTotal, typedDrafts, setTypedDrafts, typeGap, delegateGap, undoGap, buildMethod, setBuildMethod, ensureAgent, refreshKnowledge, hasContext, readyCnt, distilling, removeSource, retrySource, uploadDoc, uploadCfg, aboutEditing, setAboutEditing, aboutDraft, setAboutDraft, saveAbout, toast }}
          />
          </div>
        ) : null}

        {step === 1 ? (
          <div style={{ maxWidth: 760 }}>
            {drafting || !graph ? (
              <div style={{ border: "1px solid rgba(53,232,52,.32)", borderRadius: 13, background: "rgba(53,232,52,.04)", padding: "42px 24px", textAlign: "center" }} data-testid="drafting">
                <div style={{ fontSize: 26, marginBottom: 10 }}>✦</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 4 }}>Drafting your sequence…</div>
                <div style={{ fontSize: 13, color: "#8A7F6B" }}>Claude is planning steps grounded in your business context.</div>
              </div>
            ) : (
              <>
                {/* B7: regenerate failed — inline error row with Retry (never silent) */}
                {regenError !== null ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid rgba(224,121,107,.4)", background: "rgba(224,121,107,.06)", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }} data-testid="regen-failed">
                    <span style={{ fontSize: 14, color: "#C9543F", flex: "none" }}>⚠</span>
                    <span style={{ fontSize: 12.5, color: "#8A7F6B", flex: 1, minWidth: 0 }}>Sequence generation failed{regenError ? ` — ${regenError.slice(0, 200)}` : ""}</span>
                    <span onClick={() => void regenerate()} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }} data-testid="regen-retry">Retry</span>
                  </div>
                ) : null}
                {/* tab bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 22, borderBottom: "2px solid #EBE3D6" }}>
                  <div onClick={() => setSeqView("sequence")} style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", fontSize: 14, fontWeight: seqView === "sequence" ? 700 : 500, color: seqView === "sequence" ? "#0E1512" : "#8A7F6B", borderBottom: `2px solid ${seqView === "sequence" ? "#16A82A" : "transparent"}`, marginBottom: -2, cursor: "pointer" }} data-testid="tab-sequence">Main sequence</div>
                  <div onClick={() => setSeqView("branches")} style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", fontSize: 14, fontWeight: seqView === "branches" ? 700 : 500, color: seqView === "branches" ? "#0E1512" : "#8A7F6B", borderBottom: `2px solid ${seqView === "branches" ? "#16A82A" : "transparent"}`, marginBottom: -2, cursor: "pointer" }} data-testid="tab-branches">
                    Branches &amp; rules <span style={{ fontSize: 11, fontWeight: 800, color: seqView === "branches" ? "#fff" : "#8A7F6B", background: seqView === "branches" ? "#0E1512" : "#F2EEE4", borderRadius: 100, padding: "2px 8px" }}>{branchCases.length}</span>
                  </div>
                </div>

                {seqView === "sequence" ? (
                  <div data-testid="sequence">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 15px" }}>🕐 Mon–Fri · {parseInt(windowStart, 10)}–{parseInt(windowEnd, 10)} · {tzShort(timezone)} <span style={{ color: "#9AA59E" }}>⌄</span></span>
                      <span onClick={() => void regenerate()} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 11, padding: "9px 15px", cursor: "pointer" }} data-testid="regenerate">✦ Regenerate with AI</span>
                    </div>
                    {/* M1b (DEC-066): the sequence lists the MAIN PATH — reply-
                        strategy steps live in their own section below (they
                        belong to the branch, not the sequence). */}
                    {mainPath(graph).map((n) => {
                      if (n.type === "step") {
                        const idx = mainSteps(graph).indexOf(n) + 1;
                        return (
                          <div key={n.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }} data-testid="seq-step">
                            {/* P2.1 (DEC-061, §3 amendment): ChannelChip anatomy — sms
                                steps reuse the card with channel-true icon + tint. */}
                            <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: n.channel === "sms" ? "rgba(54,215,237,.16)" : "rgba(53,232,52,.16)", color: n.channel === "sms" ? "#1192A6" : "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>{n.channel === "sms" ? "💬" : "✉"}</span>
                            <div onClick={() => { setEditNode(n); setEditSubject(n.content.subject ?? ""); setEditBody(n.content.body ?? ""); }} style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "16px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)", cursor: "pointer" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8A7F6B" }}>Step {idx}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: n.channel === "sms" ? "rgba(54,215,237,.14)" : "rgba(53,232,52,.13)", color: n.channel === "sms" ? "#1192A6" : "#16A82A" }} data-testid="seq-channel-chip">{n.channel === "sms" ? "SMS" : "Email"}</span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 7, padding: "3px 9px" }}>✦ AI draft</span>
                                <span style={{ marginLeft: "auto", fontSize: 13, color: "#9AA59E" }} data-testid="seq-edit">✎ Edit</span>
                              </div>
                              <div style={{ fontSize: 15.5, fontWeight: 600, color: "#0E1512", marginBottom: 4 }}>{n.channel === "sms" ? "SMS message" : n.content.subject}</div>
                              <div style={{ fontSize: 14, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.content.body}</div>
                            </div>
                          </div>
                        );
                      }
                      if (n.type === "delay") {
                        return (
                          <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 4px 26px" }} data-testid="seq-delay-row">
                            <span style={{ width: 2, height: 34, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
                            <span onClick={() => { setDelayEdit(n); setDelayAmount(n.amount); }} style={{ fontSize: 13, fontWeight: 600, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "5px 14px", cursor: "pointer" }} data-testid="seq-delay">⏱ Wait {n.amount} {n.amount === 1 ? n.unit.replace(/s$/, "") : n.unit} <span style={{ color: "#C2B79F" }}>✎</span></span>
                          </div>
                        );
                      }
                      return null;
                    })}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 26, marginTop: 4 }}>
                      <span style={{ width: 2, height: 24, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
                      <span onClick={() => void addStep()} style={{ fontSize: 14, fontWeight: 600, color: "#16A82A", background: "#fff", border: "1.5px dashed #9FD8AC", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }} data-testid="add-step">+ Add step</span>
                    </div>
                    {/* M1b: reply-strategy steps — editable like sequence steps,
                        labeled by their intent (designed grouping, flagged). */}
                    {strategyStepsOf(graph).length > 0 ? (
                      <>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", margin: "26px 0 12px" }}>Reply strategies · sent when a reply classifies</div>
                        {strategyStepsOf(graph).map(({ intent, step: sNode }) => {
                          const tint = intentTint(intent);
                          return (
                            <div key={sNode.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }} data-testid="strategy-step">
                              <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>↩</span>
                              <div onClick={() => { setEditNode(sNode); setEditSubject(sNode.content.subject ?? ""); setEditBody(sNode.content.body ?? ""); }} style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "16px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)", cursor: "pointer", marginBottom: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: tint.fg }}>{tint.label}</span>
                                  <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: "rgba(53,232,52,.13)", color: "#16A82A" }}>Email · threaded</span>
                                  <span style={{ marginLeft: "auto", fontSize: 13, color: "#9AA59E" }}>✎ Edit</span>
                                </div>
                                <div style={{ fontSize: 14, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{sNode.content.body}</div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : null}
                    <div style={{ fontSize: 12, color: "#9AA59E", textAlign: "center", marginTop: 14 }}>Graph v{graphVersion} · {graphSource === "MANUAL" ? "edited — new version saved (MANUAL)" : "AI-planned"}</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 22 }} data-testid="branches">
                    <div>
                      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", flex: 1 }}>Campaign flow</div>
                      </div>
                      <div style={{ background: "#0C140F", borderRadius: 14, padding: "18px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#7FE8A0", textTransform: "uppercase", letterSpacing: ".08em" }}>Main sequence · {mainSteps(graph).length} steps</div>
                            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.4)", marginTop: 2 }}>{added.length ? `${added.length} contact${added.length === 1 ? "" : "s"} enroll at launch` : "Contacts enroll at launch"} · Draft</div>
                          </div>
                          <span onClick={() => setSeqView("sequence")} style={{ fontSize: 11.5, fontWeight: 700, color: "#0A0F0C", background: "#7FE8A0", borderRadius: 8, padding: "4px 11px", cursor: "pointer" }}>View steps</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                          {mainSteps(graph).map((s, i, arr) => (
                            <Fragment key={s.id}>
                              <div style={{ flex: "none", background: "rgba(255,255,255,.09)", borderRadius: 9, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap" }}>{s.type === "step" && s.channel === "sms" ? "💬 SMS" : `✉ ${s.type === "step" ? (s.content.subject ?? "") : ""}`}</div>
                              {i < arr.length - 1 ? <span style={{ color: "rgba(255,255,255,.25)", fontSize: 11, flex: "none" }}>→</span> : null}
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 12 }}>Reply branch</div>
                      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 16px rgba(14,21,18,.04)" }}>
                        {branchCases.map((c, i) => {
                          // M1b (DEC-066): when-labels come from the ONE intent
                          // vocabulary (verbatim fallback for unknown values);
                          // goto pills resolve the target node — a strategy
                          // step renders its subject, raw node ids never show.
                          const target = graph?.nodes.find((n) => n.id === c.goto);
                          const gotoLabel =
                            !target || target.type === "end"
                              ? c.goto === "end-won"
                                ? "Mark interested — hand to you"
                                : "End sequence"
                              : target.type === "step"
                                ? `Send “${(target.content.subject?.trim() || target.content.body?.trim() || "reply").slice(0, 34)}${(target.content.subject?.trim() || target.content.body?.trim() || "").length > 34 ? "…" : ""}”`
                                : target.type === "action"
                                  ? target.action.replaceAll("_", " ")
                                  : c.goto;
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderTop: i ? "1px solid #F2EEE4" : "none" }} data-testid="branch-rule">
                              <span style={{ fontSize: 13, color: "#0E1512", flex: 1 }}>{branchWhenLabel(c.when)}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "4px 11px", background: c.when === "default" ? "#F2EEE4" : "#D7F5DD", color: c.when === "default" ? "#8A7F6B" : "#16A82A", flex: "none" }}>→ {gotoLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 12, color: "#9AA59E", marginTop: 10 }}>Replies are classified by intent (P1.7) — the branch fires the moment a lead answers.</div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 18 }}>
              {[
                { icon: "⬆", title: "Upload CSV", desc: "Import contacts from a .csv file.", iconbg: "rgba(53,232,52,.16)", act: () => setCsvOpen(true), tid: "contacts-csv", picked: false },
                // C2.8: picked treatment composes the goal-card selected state
                // (the prototype shows only the resting card — flagged).
                pickedList
                  ? { icon: "❒", title: pickedList.name, desc: `${pickedList.memberCount} contact${pickedList.memberCount === 1 ? "" : "s"} enroll at launch · as of launch day`, iconbg: "rgba(54,215,237,.16)", act: () => { setListSearch(""); setListOpen(true); }, tid: "contacts-list", picked: true }
                  : { icon: "❒", title: "Choose a list", desc: "Pick an existing saved list.", iconbg: "rgba(54,215,237,.16)", act: () => { setListSearch(""); setListOpen(true); }, tid: "contacts-list", picked: false },
                { icon: "✎", title: "Add manually", desc: "Enter contacts one by one.", iconbg: "#F2EEE4", act: () => setManualOpen(true), tid: "contacts-manual", picked: false },
              ].map((c) => (
                <div key={c.tid} onClick={c.act} data-testid={c.tid} style={{ position: "relative", border: c.picked ? "2px solid #35E834" : "1px solid #EBE3D6", borderRadius: 13, background: c.picked ? "rgba(53,232,52,.07)" : "#fff", padding: "16px 14px", cursor: "pointer" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: c.iconbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, marginBottom: 11 }}>{c.icon}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                  <div style={{ fontSize: 13, color: "#8A7F6B", lineHeight: 1.4 }}>{c.desc}</div>
                  {c.picked ? (
                    <span onClick={(e) => { e.stopPropagation(); setPickedList(null); }} title="Remove list" style={{ position: "absolute", top: 10, right: 10, color: "#9AA59E", fontSize: 13, cursor: "pointer", padding: 4 }} data-testid="picked-list-clear">✕</span>
                  ) : null}
                </div>
              ))}
            </div>
            {added.length > 0 ? (
              <div style={{ border: "1px solid #EBE3D6", borderRadius: 13, background: "#fff" }} data-testid="contacts-added">
                {added.map((a, i) => (
                  <div key={`${a.email}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: i ? "1px solid #F2EEE4" : "none", fontSize: 13.5, color: "#0E1512" }}>
                    <span style={{ color: "#16A82A" }}>✓</span>
                    {a.firstName ? `${a.firstName} · ` : ""}{a.email}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#9AA59E" }}>No contacts yet — add at least one to continue.</div>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              {(
                [
                  { key: "widget", title: "Website chat widget", desc: "Qualify visitors and capture leads 24/7." },
                  { key: "form", title: "Form capture", desc: "Route form submissions into the sequence." },
                ] as const
              ).map((c) => (
                <div key={c.key} style={{ border: "1px solid #EBE3D6", borderRadius: 13, background: "#fff", padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>{c.title}</div>
                    <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>{c.desc}</div>
                  </div>
                  <div onClick={() => setCapture((v) => ({ ...v, [c.key]: !v[c.key] }))} style={{ width: 48, height: 28, borderRadius: 100, background: capture[c.key] ? GRAD : "#E4DDCE", position: "relative", cursor: "pointer", flex: "none", transition: "background .15s" }} data-testid={`capture-${c.key}`}>
                    <span style={{ position: "absolute", top: 3, left: capture[c.key] ? 23 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.2)", transition: "left .15s" }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 14 }}>This step is optional — you can skip it and connect capture sources any time later.</div>
          </div>
        ) : null}

        {step === 4 ? (
          <div style={{ maxWidth: 820 }}>
            {/* channel readiness (email-only phase: reqChannels = [Email]) */}
            {senders.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(53,232,52,.1)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 14, padding: "15px 18px", marginBottom: 12 }} data-testid="ready-banner">
                <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: GRAD, color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✓</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0E1512" }}>Email channel ready to send</div>
                  <div style={{ fontSize: 12.5, color: "#5C6B62" }}>Every step in your sequence has a connected, healthy sender.</div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(232,196,91,.12)", border: "1px solid rgba(232,196,91,.5)", borderRadius: 14, padding: "15px 18px", marginBottom: 12 }} data-testid="ready-banner">
                <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: "rgba(232,196,91,.25)", color: "#A87B16", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚠</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0E1512" }}>Email channel not ready</div>
                  <div style={{ fontSize: 12.5, color: "#5C6B62" }}>Connect Email below before this agent can launch.</div>
                </div>
              </div>
            )}

            <div style={{ margin: "4px 0 11px", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#16A82A" }}>Channels &amp; senders</div>

            {/* email senders (live P1.5 SenderConnections) */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", marginBottom: 18, overflow: "hidden" }} data-testid="senders-list">
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px" }}>
                <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512", flex: 1 }}>Email senders <span style={{ fontSize: 13, fontWeight: 600, color: "#9AA59E" }}>· {senders.length} connected</span></span>
                <span onClick={() => setConnectOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 10, padding: "8px 14px", cursor: "pointer" }} data-testid="wizard-add-sender">＋ Add sender</span>
              </div>
              {senders.length === 0 ? (
                <div style={{ borderTop: "1px solid #F2EEE4", padding: "20px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ width: 40, height: 40, borderRadius: 11, flex: "none", background: "#F2EEE4", color: "#9AA59E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✉</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>No email sender connected</div>
                    <div style={{ fontSize: 12, color: "#8A7F6B" }}>Required for Email steps.</div>
                  </div>
                </div>
              ) : (
                senders.map((s) => {
                  const auth = (s.domainAuthStatus ?? {}) as Record<string, { pass?: boolean } | boolean | undefined>;
                  const passes = ["spf", "dkim", "dmarc"].filter((k) => {
                    const v = auth[k];
                    return v === true || (typeof v === "object" && v?.pass === true);
                  }).length;
                  const healthy = passes === 3;
                  const pct = Math.min(100, Math.round((s.sentToday / Math.max(1, s.dailyLimit)) * 100));
                  const active = s.status === "ACTIVE";
                  return (
                    <div key={s.id} style={{ borderTop: "1px solid #F2EEE4", padding: "15px 18px" }} data-testid="sender-row">
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 13 }}>
                        <span style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: "rgba(208,245,107,.4)", color: "#6B7A1F", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 16 }}>f</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{s.fromEmail}</div>
                          <div style={{ fontSize: 12, color: "#9AA59E" }}>Clientforce Mailer · {s.fromName ?? "—"}</div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: active ? "#0F7A28" : "#A87B16", background: active ? "#D7F5DD" : "rgba(232,196,91,.18)", borderRadius: 7, padding: "5px 10px", flex: "none" }}>{active ? "Active" : s.status}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ flex: "none", textAlign: "left", minWidth: 74 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#9AA59E", marginBottom: 2 }}>Auth</div>
                          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 19, lineHeight: 1, color: healthy ? "#16A82A" : "#E8C45B" }}>{passes}/3<span style={{ fontSize: 11, fontWeight: 600, color: "#8A7F6B" }}> {healthy ? "Pass" : "Needs DNS"}</span></div>
                        </div>
                        <div style={{ flex: "none", minWidth: 90 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#9AA59E", marginBottom: 4 }}>Reputation</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 9, height: 9, borderRadius: "50%", background: active ? "#16A82A" : "#E8C45B" }} />
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>{active ? "Good" : "Building"}</span>
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#9AA59E" }}>Daily sending</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5C6B62" }}>{s.sentToday.toLocaleString()} / {s.dailyLimit.toLocaleString()}</span>
                          </div>
                          <div style={{ height: 7, borderRadius: 100, background: "#F2EEE4", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, borderRadius: 100, background: healthy ? "#16A82A" : "#E8C45B" }} />
                          </div>
                        </div>
                        <span onClick={() => setLimitsOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", border: "1px solid #EBE3D6", borderRadius: 10, padding: "8px 14px", cursor: "pointer", flex: "none" }} data-testid="sender-manage">Manage</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ margin: "26px 0 11px", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#16A82A" }}>Sending behavior</div>

            {/* sending schedule → Guardrails.sendingWindow */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", padding: "18px 20px", marginBottom: 18 }} data-testid="schedule-card">
              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512" }}>Sending schedule</div>
              <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 2, marginBottom: 16 }}>The agent only sends inside this window — replies are still handled 24/7.</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                <div style={{ flex: 1.4, position: "relative" }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 6 }}>Timezone</label>
                  {/* B10: the prototype's control is a picker (cursor:pointer + ▾) — make it one. */}
                  <div onClick={() => setTzOpen(!tzOpen)} style={{ height: 44, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", fontSize: 14, color: "#0E1512", cursor: "pointer" }} data-testid="tz-box">
                    {timezone === "UTC" ? "UTC" : `${timezone} (${tzShort(timezone)})`}
                    <span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span>
                  </div>
                  {tzOpen ? (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 12px 32px rgba(14,21,18,.12)", zIndex: 30, maxHeight: 264, overflowY: "auto" }} data-testid="tz-menu">
                      {TZ_OPTIONS.map((t) => (
                        <div key={t.zone} onClick={() => { setTimezone(t.zone); setTzOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 15px", fontSize: 13.5, color: "#0E1512", cursor: "pointer", background: timezone === t.zone ? "rgba(53,232,52,.07)" : "#fff" }} data-testid={`tz-opt-${t.zone.replace("/", "-")}`}>
                          <span style={{ color: "#9AA59E", fontSize: 12.5, flex: "none" }}>({t.offset})</span>
                          {t.label}
                          {timezone === t.zone ? <span style={{ marginLeft: "auto", color: "#16A82A", fontWeight: 700 }}>✓</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 6 }}>Sending window</label>
                  <div onClick={() => setLimitsOpen(true)} style={{ height: 44, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", fontSize: 14, color: "#0E1512", cursor: "pointer" }} data-testid="window-box">{windowStart} – {windowEnd}<span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span></div>
                </div>
              </div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 8 }}>Sending days</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => {
                  const on = sendDays[i];
                  return (
                    <span key={label} onClick={() => setSendDays((d) => d.map((v, j) => (j === i ? !v : v)))} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, padding: "9px 0", borderRadius: 10, background: on ? "#0E1512" : "#fff", color: on ? "#fff" : "#9AA59E", border: `1px solid ${on ? "#0E1512" : "#EBE3D6"}`, cursor: "pointer" }} data-testid={`day-${label}`}>{label}</span>
                  );
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "13px 15px" }}>
                <span style={{ fontSize: 18, flex: "none" }}>🌙</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>Pause outside business hours</div>
                  <div style={{ fontSize: 12, color: "#8A7F6B" }}>Hold queued messages overnight &amp; on weekends instead of sending late.</div>
                </div>
                <GradToggle on={quietHours} onClick={() => setQuietHours((v) => !v)} tid="toggle-quiet" />
              </div>
            </div>

            {/* volume & deliverability limits → Guardrails.dailyCap */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", padding: "18px 20px" }} data-testid="limits-card">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512" }}>Volume &amp; deliverability limits</div>
                  <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 2 }}>Daily caps protect your sender reputation across channels.</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 14 }}>
                <div onClick={() => setLimitsOpen(true)} style={{ display: "flex", alignItems: "center", gap: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 13px", cursor: "pointer" }} data-testid="limit-email">
                  <span style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "rgba(53,232,52,.16)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>✉</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "#8A7F6B", fontWeight: 600 }}>Email</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{dailyCap} / day</div>
                  </div>
                </div>
                {/* P2.1 (DEC-061): the sms cap tile — same anatomy, channel tint */}
                <div onClick={() => setLimitsOpen(true)} style={{ display: "flex", alignItems: "center", gap: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 13px", cursor: "pointer" }} data-testid="limit-sms">
                  <span style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "rgba(54,215,237,.16)", color: "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>💬</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "#8A7F6B", fontWeight: 600 }}>SMS</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{smsDailyCap} / day</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "13px 15px" }}>
                <span style={{ fontSize: 18, flex: "none" }}>📈</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>Gradually ramp send volume</div>
                  <div style={{ fontSize: 12, color: "#8A7F6B" }}>Warm-up-safe — increases daily volume slowly to protect new senders.</div>
                </div>
                <GradToggle on={ramp} onClick={() => setRamp((v) => !v)} tid="toggle-ramp" />
              </div>
            </div>

            <div style={{ margin: "26px 0 11px", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#16A82A" }}>Compliance &amp; consent</div>

            {/* AI compliance banner */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg,rgba(53,232,52,.12),rgba(54,215,237,.08))", border: "1px solid rgba(53,232,52,.28)", borderRadius: 14, padding: "15px 18px", marginBottom: 18 }} data-testid="compliance-banner">
              <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: GRAD, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#0A0F0C" }}>✓</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0E1512" }}>Compliance check passed</div>
                <div style={{ fontSize: 12.5, color: "#5C6B62" }}>Your sequence meets outreach regulations for the regions you&apos;re targeting.</div>
              </div>
              <div style={{ display: "flex", gap: 7, flex: "none" }}>
                {["CAN-SPAM ✓", "GDPR ✓", "CASL ✓"].map((c) => (
                  <span key={c} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.14)", borderRadius: 8, padding: "5px 10px" }}>{c}</span>
                ))}
              </div>
            </div>

            {/* consent & opt-out — A8: unsubscribeFooter + suppressionCheck are
                literal true, never disableable → locked rows, no toggles. */}
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", marginBottom: 18, overflow: "hidden" }} data-testid="consent-card">
              <div style={{ padding: "16px 20px 4px" }}>
                <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512" }}>Consent &amp; opt-out</div>
                <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 2 }}>How contacts opt out, and who the agent must never message.</div>
              </div>
              {[
                { icon: "✉", label: "One-click unsubscribe footer", desc: "Appended to every email — CAN-SPAM & GDPR compliant." },
                { icon: "🚫", label: "Honor suppression list", desc: "Never contact addresses on your workspace suppression list." },
                { icon: "⛔", label: "Respect opt-outs", desc: "Skip contacts who opted out and auto-suppress anyone who unsubscribes." },
              ].map((c) => (
                <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderTop: "1px solid #F2EEE4" }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, flex: "none", background: "rgba(53,232,52,.12)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{c.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{c.label}</div>
                    <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>{c.desc}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#0F7A28", background: "#D7F5DD", borderRadius: 7, padding: "5px 10px", flex: "none" }}>🔒 Required</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {step === 5 ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
              {[
                { label: "Goal", value: GOALS.find((g) => g.key === goal)?.title ?? "—" },
                { label: "Sequence", value: graph ? `${mainSteps(graph).length} steps · ${strategyStepsOf(graph).length ? `${strategyStepsOf(graph).length} reply strategies` : "reply branch"}` : "—" },
                { label: "Contacts", value: pickedList ? `${added.length + pickedList.memberCount} enrolled at launch (incl. “${pickedList.name}”)` : `${added.length} enrolled at launch` },
                { label: "Lead capture", value: capture.widget || capture.form ? "Enabled" : "Off (optional)" },
              ].map((c) => (
                <div key={c.label} style={{ border: "1px solid #EBE3D6", borderRadius: 13, background: "#fff", padding: "14px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#9AA59E", marginBottom: 6 }}>{c.label}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>{c.value}</div>
                </div>
              ))}
            </div>
            {!allResolved ? (
              <div style={{ border: "1px solid rgba(232,196,91,.48)", borderRadius: 12, background: "rgba(232,196,91,.06)", padding: "12px 16px", fontSize: 13, color: "#8A7F6B" }} data-testid="launch-gate">
                ✦ {gapTotal - gapResolved} unresolved gap{gapTotal - gapResolved > 1 ? "s" : ""} — resolve them in step 1 (type it or let AI decide) before launching.
              </div>
            ) : (
              <div style={{ border: "1px solid rgba(53,232,52,.32)", borderRadius: 12, background: "rgba(53,232,52,.05)", padding: "12px 16px", fontSize: 13, color: "#0F7A28" }}>
                ✓ Everything the agent needs is resolved — ready to launch.
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* step editor — §3 (amended): 560px right drawer w/ STEP header,
          deterministic deliverability rows, PERSONALIZATION token chips */}
      {editNode && editNode.type === "step" ? (
        <div onClick={() => setEditNode(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.4)", zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 560, maxWidth: "100%", background: "#fff", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column" }} data-testid="step-editor">
            <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "18px 22px", borderBottom: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, flex: "none", background: "rgba(53,232,52,.16)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700 }}>✉</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8A7F6B" }}>{editStrategyIntent ? `${intentTint(editStrategyIntent).label} reply` : `Step ${editStepIndex}`}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "2px 9px", background: "rgba(53,232,52,.13)", color: "#16A82A" }}>Email</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{editSubject || "Untitled step"}</div>
              </div>
              <span onClick={() => setEditNode(null)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }}>✕</span>
            </div>

            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18, flex: 1, overflow: "auto", minHeight: 0 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 7 }}>Subject line</label>
                <input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} style={{ boxSizing: "border-box", width: "100%", borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="edit-subject" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 7 }}>Body</label>
                <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8} style={{ boxSizing: "border-box", width: "100%", borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "13px 14px", fontSize: 14, color: "#3B463F", lineHeight: 1.6, minHeight: 150, resize: "vertical", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="edit-body" />
                <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 6 }}>The signature and compliance footer are added at send time.</div>
              </div>

              {/* deliverability — deterministic rows only (AI-only score/verdict omitted) */}
              <div style={{ border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden" }} data-testid="deliverability-card">
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", background: "linear-gradient(90deg,rgba(53,232,52,.1),rgba(54,215,237,.07))", borderBottom: "1px solid #EBE3D6" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", flex: 1 }}>✦ AI deliverability check</span>
                </div>
                {emailChecks(editSubject, editBody).map((c, i) => (
                  <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 15px", borderTop: i ? "1px solid #F2EEE4" : "none" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, flex: "none" }} />
                    <span style={{ fontSize: 13, color: "#3B463F", flex: 1 }}>{c.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: c.fg }}>{c.value}</span>
                  </div>
                ))}
              </div>

              {/* personalization — REAL merge tokens (P1.5 renderTokens set) +
                  C2.7 custom-field chips (v3 Create Agent.dc.html:1198): custom
                  tokens need a MANDATORY fallback before they insert. */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Personalization</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {TOKENS.map((t) => (
                    <span key={t} onClick={() => { setCustomTokenKey(null); setEditBody((b) => (b ? `${b} ${t}` : t)); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#1192A6", background: "rgba(54,215,237,.12)", border: "1px solid rgba(54,215,237,.3)", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }} data-testid={`token-${t.replace(/[^a-zA-Z]/g, "")}`}>{t}</span>
                  ))}
                  {fieldDefs.filter((d) => !d.archived).map((d) => {
                    const on = customTokenKey === d.key;
                    return (
                      <span key={d.id} onClick={() => { setCustomTokenKey(on ? null : d.key); setCustomFallback(""); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#1192A6", background: on ? "rgba(54,215,237,.24)" : "rgba(54,215,237,.12)", border: `1px solid ${on ? "#36D7ED" : "rgba(54,215,237,.3)"}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }} data-testid={`token-custom-${d.key}`}>{`{{custom.${d.key}}}`}</span>
                    );
                  })}
                </div>
                {customTokenKey ? (
                  <div style={{ marginTop: 10, background: "rgba(54,215,237,.06)", border: "1px solid rgba(54,215,237,.28)", borderRadius: 11, padding: "12px 14px" }} data-testid="fallback-card">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#1192A6", textTransform: "uppercase", letterSpacing: ".05em" }}>{`Fallback for {{custom.${customTokenKey}}}`}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "#C9543F", background: "#FBEEEA", borderRadius: 100, padding: "2px 7px" }}>Required</span>
                    </div>
                    <input
                      autoFocus
                      value={customFallback}
                      onChange={(e) => setCustomFallback(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") insertCustomToken(); }}
                      placeholder="e.g. your practice"
                      style={{ width: "100%", boxSizing: "border-box", height: 38, borderRadius: 9, background: "#fff", border: "1px solid rgba(54,215,237,.4)", padding: "0 12px", fontSize: 13, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" }}
                      data-testid="fallback-input"
                    />
                    <div style={{ fontSize: 11.5, color: "#5C6B62", lineHeight: 1.5, marginTop: 7 }}>
                      Used when a contact has no <strong>{fieldDefs.find((d) => d.key === customTokenKey)?.label ?? customTokenKey}</strong> value — custom tokens never render blank.
                    </div>
                    <span onClick={insertCustomToken} style={{ display: "inline-block", marginTop: 9, fontSize: 12.5, fontWeight: 700, color: customFallback.trim() ? "#0A0F0C" : "#9AA59E", background: customFallback.trim() ? GRAD : "#ECE7DC", borderRadius: 9, padding: "7px 14px", cursor: customFallback.trim() ? "pointer" : "not-allowed" }} data-testid="fallback-insert">Insert token</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
              <span title="AI rewrite arrives with the sequence tools — use ✦ Regenerate for a full re-plan" style={{ fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 10, padding: "9px 14px", cursor: "default" }}>✦ Rewrite with AI</span>
              <span onClick={() => setEditNode(null)} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
              <span onClick={() => void saveEditedStep()} style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 22px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }} data-testid="modal-save">Save step</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* delay modal */}
      {delayEdit ? (
        <Modal onClose={() => setDelayEdit(null)} title="Edit delay" tid="delay-modal">
          <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "center", margin: "10px 0 18px" }}>
            <Stepper onMinus={() => setDelayAmount((v) => Math.max(1, v - 1))} onPlus={() => setDelayAmount((v) => v + 1)} value={`${delayAmount} ${delayEdit.type === "delay" ? delayEdit.unit : "days"}`} />
          </div>
          <ModalActions onCancel={() => setDelayEdit(null)} onSave={() => void saveDelay()} />
        </Modal>
      ) : null}

      {/* list picker — designed; no saved lists exist yet in P1 */}
      {/* C2.8: live 480px list picker (prototype anatomy) — SNAPSHOT semantics:
          the picked list's members enroll at launch through the CSV path. */}
      {listOpen ? (
        <div onClick={() => setListOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 36, zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid="list-picker">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512" }}>Choose a list</div>
                <div style={{ fontSize: 12.5, color: "#9AA59E" }}>Pick a saved contact list to enroll.</div>
              </div>
              <span onClick={() => setListOpen(false)} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
            </div>
            <div style={{ padding: "14px 16px" }}>
              {/* 49-4: the prototype's search row */}
              <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 14px", marginBottom: 12 }}>
                <span style={{ color: "#9AA59E" }}>⚲</span>
                <input value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="Search lists…" style={{ border: "none", background: "transparent", fontSize: 13.5, color: "#0E1512", flex: 1, minWidth: 0, outline: "none", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="list-picker-search" />
              </div>
              {wizardLists.filter((l) => !l.archived).length === 0 ? (
                <div style={{ border: "1px dashed #D8CFBE", borderRadius: 12, background: "#FBF7F0", padding: "26px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>❒</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>No saved lists yet</div>
                  <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>Lists you save from Contacts appear here — upload a CSV or add contacts manually for now.</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 340, overflowY: "auto" }}>
                  {wizardLists.filter((l) => !l.archived && l.name.toLowerCase().includes(listSearch.trim().toLowerCase())).map((l) => (
                    <div key={l.id} onClick={() => { setPickedList({ id: l.id, name: l.name, memberCount: l.memberCount }); setListOpen(false); }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#9FD8AC"; e.currentTarget.style.background = "#FBF7F0"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#EBE3D6"; e.currentTarget.style.background = "#fff"; }} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #EBE3D6", borderRadius: 12, padding: "12px 14px", cursor: "pointer", background: "#fff" }} data-testid={`list-pick-${l.id}`}>
                      <span style={{ width: 38, height: 38, borderRadius: 10, background: "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flex: "none" }}>❒</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{l.name}</div>
                        <div style={{ fontSize: 12, color: "#9AA59E" }}>{l.memberCount} contact{l.memberCount === 1 ? "" : "s"}</div>
                      </div>
                      <span style={{ color: "#C9CFC9", fontSize: 18 }}>›</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* B9: add-sender connect flow — the same drawer Settings → Channels uses
          (prototype `openAddEmail`); the senders list + readiness banner refetch
          on close so a sender added mid-wizard counts immediately. */}
      {connectOpen ? (
        <ConnectFlowDrawer
          channel="email"
          onClose={() => {
            setConnectOpen(false);
            void cf("senders").then(setSenders).catch(() => {});
          }}
          toast={toast}
          onMailerCreated={() => void cf("senders").then(setSenders).catch(() => {})}
        />
      ) : null}

      {/* volume & limits modal — stepper controls writing the Guardrails schema */}
      {limitsOpen ? (
        <Modal onClose={() => setLimitsOpen(false)} title="Volume & limits" tid="limits-modal">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <LimitCard label="Daily email cap" value={String(dailyCap)} onMinus={() => setDailyCap((v) => Math.max(10, v - 10))} onPlus={() => setDailyCap((v) => v + 10)} tid="cap" />
            {/* P2.1 (DEC-061): per-channel sms cap (guardrails dailyCap.sms) */}
            <LimitCard label="Daily SMS cap" value={String(smsDailyCap)} onMinus={() => setSmsDailyCap((v) => Math.max(10, v - 10))} onPlus={() => setSmsDailyCap((v) => v + 10)} tid="sms-cap" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <LimitCard label="Window start (UTC)" value={windowStart} onMinus={() => setWindowStart(shiftH(windowStart, -1))} onPlus={() => setWindowStart(shiftH(windowStart, 1))} tid="start" />
            <LimitCard label="Window end (UTC)" value={windowEnd} onMinus={() => setWindowEnd(shiftH(windowEnd, -1))} onPlus={() => setWindowEnd(shiftH(windowEnd, 1))} tid="end" />
          </div>
          <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 14 }}>Unsubscribe footer and suppression checks are always on — they can&apos;t be disabled.</div>
          <ModalActions onCancel={() => setLimitsOpen(false)} onSave={() => void saveLimits()} />
        </Modal>
      ) : null}

      {/* CSV modal */}
      {csvOpen ? (
        <Modal onClose={() => setCsvOpen(false)} title="Upload CSV" tid="csv-modal">
          <div style={{ fontSize: 12.5, color: "#8A7F6B", marginBottom: 8 }}>Paste rows as <code>email,firstName,lastName,company</code> — header row optional.</div>
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={7} style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 12.5 }} data-testid="csv-text" placeholder={"email,firstName\njane@acme.io,Jane"} />
          <ModalActions
            onCancel={() => setCsvOpen(false)}
            saveLabel="Import"
            onSave={() => {
              const rows = csvText
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l && !l.toLowerCase().startsWith("email,"))
                .map((l) => {
                  const [email, firstName, lastName, company] = l.split(",").map((v) => v?.trim());
                  return { email: email ?? "", firstName, lastName, company };
                });
              void addContacts(rows, "csv").then(() => {
                setCsvOpen(false);
                setCsvText("");
              });
            }}
          />
        </Modal>
      ) : null}

      {/* manual-add drawer — §3/DEC-039a: full prototype anatomy, multi-add session */}
      {manualOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
          <div onClick={() => setManualOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(12,20,15,.4)" }} />
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "100%", background: "#FBF7F0", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column" }} data-testid="manual-drawer">
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6" }}>
              <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Add contacts manually</span>
              <span onClick={() => setManualOpen(false)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }} data-testid="manual-close">✕</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "20px 22px" }}>
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: 16, marginBottom: 18 }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                  {([["firstName", "First name", "Jane"], ["lastName", "Last name", "Doe"]] as const).map(([k, label, ph]) => (
                    <div key={k} style={{ flex: 1 }}>
                      <label style={manualLbl}>{label}</label>
                      <input value={manual[k]} onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))} placeholder={ph} style={manualInp} data-testid={`manual-${k}`} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={manualLbl}>Email</label>
                  <input value={manual.email} onChange={(e) => setManual((m) => ({ ...m, email: e.target.value }))} placeholder="jane@clinic.com" style={manualInp} data-testid="manual-email" />
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                  {([["company", "Company", "Clinic name"], ["phone", "Phone", "+1…"]] as const).map(([k, label, ph]) => (
                    <div key={k} style={{ flex: 1 }}>
                      <label style={manualLbl}>{label}</label>
                      <input value={manual[k]} onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))} placeholder={ph} style={manualInp} data-testid={`manual-${k}`} />
                    </div>
                  ))}
                </div>
                <div
                  onClick={() => { if (!manual.email.includes("@")) return; setManualQueue((q) => [...q, manual]); setManual(EMPTY_MANUAL); }}
                  style={{ textAlign: "center", fontSize: 13.5, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.08)", border: "1.5px solid rgba(53,232,52,.3)", borderRadius: 11, padding: 11, cursor: manual.email.includes("@") ? "pointer" : "default", opacity: manual.email.includes("@") ? 1 : 0.6 }}
                  data-testid="manual-queue-add"
                >
                  + Add contact
                </div>
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>Added this session · {manualQueue.length}</div>
              {manualQueue.map((c, i) => (
                <div key={`${c.email}-${i}`} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 14px", marginBottom: 8 }} data-testid="manual-queued-row">
                  <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: i % 2 === 0 ? "rgba(53,232,52,.16)" : "rgba(54,215,237,.16)", color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700 }}>
                    {`${(c.firstName.replace(/^dr\.?\s+/i, "")[0] ?? "").toUpperCase()}${(c.lastName[0] ?? "").toUpperCase()}` || c.email.slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>{[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}</div>
                    <div style={{ fontSize: 12, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}{c.company ? ` · ${c.company}` : ""}</div>
                  </div>
                  <span onClick={() => setManualQueue((q) => q.filter((_, j) => j !== i))} style={{ color: "#C9543F", fontSize: 12, fontWeight: 600, cursor: "pointer", flex: "none" }}>Remove</span>
                </div>
              ))}
            </div>
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff" }}>
              <span style={{ fontSize: 13, color: "#9AA59E", flex: 1 }}>{manualQueue.length} contact{manualQueue.length === 1 ? "" : "s"} ready to add</span>
              <span
                onClick={() => { if (manualQueue.length === 0) return; void addContacts(manualQueue, "manual").then(() => { setManualQueue([]); setManualOpen(false); }); }}
                style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 22px", cursor: manualQueue.length ? "pointer" : "default", boxShadow: "0 6px 16px rgba(53,232,52,.26)", opacity: manualQueue.length ? 1 : 0.55 }}
                data-testid="manual-save"
              >
                Add to campaign
              </span>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}

/* ── building screen (prototype BSTEPS overlay, wired to live data) ────────── */
function BuildingScreen({ progress, sources, fields, graph, planFailed, onRetry, onBack }: {
  progress: number;
  sources: KnowledgeSource[];
  fields: Record<string, ContextField>;
  graph: CampaignGraph | null;
  /** B7: non-null = the planner job failed (value = failedReason, may be ""). */
  planFailed: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const bp = progress;
  const buildDone = bp >= BSTEPS.length;
  const headline = buildDone ? "Agent ready ✓" : bp >= 5 ? "Almost there…" : "Building your agent…";
  const subline = buildDone ? "Opening your sequence designer…" : `Step ${Math.min(bp + 1, BSTEPS.length)} of ${BSTEPS.length} — analysing goal, knowledge & compliance`;
  const pct = `${Math.round((bp / BSTEPS.length) * 100)}%`;
  const ready = sources.filter((s) => s.status === "READY").length;
  const fieldVal = (k: string) => fields[k]?.value;
  const stepCount = graph ? mainSteps(graph).length : 0;
  const waitDays = graph
    ? mainPath(graph).reduce((acc, n) => (n.type === "delay" ? acc + (n.unit === "days" ? n.amount : 0) : acc), 0)
    : 0;
  // "What we found" — same panel, live values (no invented metrics).
  const discovered = [
    { show: bp >= 1, icon: "📚", label: "Knowledge", value: sources.length ? `${sources.length} source${sources.length > 1 ? "s" : ""} · ${ready} ready` : "No sources added — using your answers" },
    { show: bp >= 2, icon: "🎯", label: "Audience", value: fieldVal("target_audience") ?? fieldVal("audience") ?? "From your business context" },
    { show: bp >= 3, icon: "⚖", label: "Compliance", value: "CAN-SPAM ✓ · GDPR ✓ · CASL ✓" },
    { show: bp >= 4, icon: "📡", label: "Channels", value: "Email" },
    { show: bp >= 5, icon: "✍", label: "Lead hook", value: fieldVal("offer") ?? fieldVal("value_proposition") ?? "Personalised per contact" },
    { show: bp >= 6, icon: "📊", label: "Deliverability", value: "Suppression & unsubscribe checks enforced" },
    { show: bp >= 7 && stepCount > 0, icon: "⏱", label: "Cadence", value: `${stepCount} steps over ${waitDays} days · Optimal send times` },
    { show: bp >= 8 && stepCount > 0, icon: "🚀", label: "Sequence", value: `${stepCount}-step email sequence generated` },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#FBF7F0", zIndex: 20, display: "flex", flexDirection: "column", padding: "36px 32px", overflowY: "auto" }} data-testid="building">
      <style>{`@keyframes cfBuildPulse{0%,100%{box-shadow:0 0 0 0 rgba(53,232,52,.5),0 0 0 0 rgba(53,232,52,.18)}60%{box-shadow:0 0 0 10px rgba(53,232,52,.22),0 0 0 22px rgba(53,232,52,.07)}}@keyframes cfReveal{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ width: 58, height: 58, borderRadius: 17, background: GRAD, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 28, color: "#0A0F0C", margin: "0 auto 20px", animation: "cfBuildPulse 1.9s ease-in-out infinite" }}>f</div>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-.02em", color: "#0E1512", marginBottom: 6 }}>{headline}</div>
        <div style={{ fontSize: 13.5, color: "#9AA59E" }}>{subline}</div>
      </div>
      <div style={{ marginBottom: 26 }}>
        <div style={{ height: 5, background: "#E4EAE6", borderRadius: 100, overflow: "hidden", marginBottom: 7 }}>
          <div style={{ height: "100%", borderRadius: 100, background: "linear-gradient(90deg,#36D7ED,#35E834 60%,#D0F56B)", transition: "width .65s cubic-bezier(.22,1,.36,1)", width: pct }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#9AA59E" }}>{bp} of {BSTEPS.length} steps complete</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16A82A" }}>{pct}</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 22, flex: 1 }}>
        {planFailed !== null ? (
          /* B7: DEC-038 amended (DEC-047): hold until graph OR failure — never infinite. */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, padding: "22px 20px", alignSelf: "flex-start", width: "100%", boxSizing: "border-box" }} data-testid="plan-failed">
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(224,121,107,.16)", color: "#C9543F", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⚠</div>
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512" }}>Sequence generation failed</div>
            {planFailed ? <div style={{ fontSize: 12.5, color: "#8A7F6B", lineHeight: 1.5 }}>{planFailed.slice(0, 200)}</div> : null}
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button type="button" onClick={onRetry} style={{ background: GRAD, border: "none", borderRadius: 11, padding: "10px 20px", fontSize: 14, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="plan-failed-retry">Retry</button>
              <button type="button" onClick={onBack} style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", fontSize: 14, fontWeight: 600, color: "#5C6B62", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="plan-failed-back">Back to setup</button>
            </div>
          </div>
        ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {BSTEPS.map((s, idx) => {
            const done = bp > idx;
            const active = bp === idx && !buildDone;
            return (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 11, background: active ? "rgba(53,232,52,.08)" : "transparent" }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, flex: "none", background: done ? "#D7F5DD" : active ? "rgba(53,232,52,.22)" : "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{done ? "✓" : s.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: active || done ? 600 : 500, color: active ? "#0E1512" : done ? "#3B463F" : "#9AA59E", lineHeight: 1.3 }}>{s.label}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "#C2B79F", letterSpacing: ".05em", textTransform: "uppercase", marginTop: 1 }}>{s.category}</div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: done ? "#16A82A" : active ? "#1192A6" : "transparent", whiteSpace: "nowrap", minWidth: 56, textAlign: "right" }}>{done ? "Done" : active ? "Working…" : ""}</span>
              </div>
            );
          })}
        </div>
        )}
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 10 }}>What we found</div>
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden", boxShadow: "0 1px 4px rgba(14,21,18,.04)" }}>
            {discovered.filter((d) => d.show).map((d) => (
              <div key={d.label} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 13px", borderBottom: "1px solid #F5F0E8", animation: "cfReveal .28s ease both" }}>
                <span style={{ fontSize: 15, flex: "none", marginTop: 1 }}>{d.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 2 }}>{d.label}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0E1512", lineHeight: 1.4 }}>{d.value}</div>
                </div>
              </div>
            ))}
          </div>
          {bp >= 3 ? (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, animation: "cfReveal .3s ease both" }}>
              {["CAN-SPAM guidelines applied", "GDPR & CASL compliant", "Opt-out & unsubscribe flow ready"].map((t) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(53,232,52,.07)", border: "1px solid rgba(53,232,52,.22)", borderRadius: 9, padding: "7px 11px" }}>
                  <span style={{ fontSize: 12, color: "#16A82A" }}>✓</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#16A82A" }}>{t}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── step 1 (goal + knowledge + citations + gaps + method) ────────────────── */
function Step1(props: {
  name: string; setName: (v: string) => void;
  goal: string | null; setGoal: (v: string) => void;
  goalLabel: string; setGoalLabel: (v: string) => void;
  sources: KnowledgeSource[];
  addMode: AddMode; setAddMode: (v: AddMode) => void;
  category: string; setCategory: (v: string) => void;
  categoryOpen: boolean; setCategoryOpen: (v: boolean) => void;
  instructions: string; setInstructions: (v: string) => void;
  urlInput: string; setUrlInput: (v: string) => void; addUrl: () => Promise<void>;
  contextSummary: string;
  groundedSources: Array<{ id: string; label: string; type: string; quotes: Citation[]; backs: Set<string> }>;
  aboutEv: string | null; setAboutEv: (v: string | null) => void;
  gaps: Gap[]; covered: Gap[]; coveredEv: string | null; setCoveredEv: (v: string | null) => void;
  fields: Record<string, ContextField>;
  gapResolved: number; gapTotal: number;
  typedDrafts: Record<string, string>; setTypedDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  typeGap: (k: string) => Promise<void>; delegateGap: (k: string) => Promise<void>; undoGap: (k: string) => Promise<void>;
  buildMethod: "ai" | "template" | "scratch"; setBuildMethod: (v: "ai" | "template" | "scratch") => void;
  ensureAgent: () => Promise<string>; refreshKnowledge: () => Promise<void>;
  hasContext: boolean; readyCnt: number; distilling: boolean;
  removeSource: (id: string) => Promise<void>;
  retrySource: (id: string) => Promise<void>;
  uploadDoc: (f: File) => Promise<void>;
  uploadCfg: { enabled: boolean; reason?: string | null } | null;
  aboutEditing: boolean; setAboutEditing: (v: boolean) => void;
  aboutDraft: string; setAboutDraft: (v: string) => void;
  saveAbout: () => Promise<void>;
  toast: (m: string) => void;
}) {
  const p = props;
  // B2: URL scope — "Entire site" is designed-but-inert (Coming soon); only
  // the current single-page extract ships, so the value always stays "page".
  const [urlScope, setUrlScope] = useState<"page" | "site">("page");
  const [scopeOpen, setScopeOpen] = useState(false);
  const openSource = p.groundedSources.find((s) => s.id === p.aboutEv);
  const openQuote = openSource?.quotes[0];
  const coveredField = p.coveredEv ? p.fields[p.coveredEv] : undefined;
  const coveredQuote = coveredField?.citations?.[0];
  return (
    <div>
      {/* B3: indeterminate ingest bar (30% amber segment sliding left→right) */}
      <style>{`@keyframes cfIngestSlide{0%{left:-30%}100%{left:100%}}`}</style>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ flex: 1.5 }}>
          <label style={upLbl}>Campaign name</label>
          <input value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder="e.g. Q3 Reactivation" style={{ height: 50, width: "100%", boxSizing: "border-box", borderRadius: 12, background: "#fff", border: "1px solid #EBE3D6", padding: "0 16px", fontSize: 15, color: "#0E1512", boxShadow: "0 1px 4px rgba(14,21,18,.04)", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="agent-name" />
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          <label style={upLbl}>Business category</label>
          <div onClick={() => p.setCategoryOpen(!p.categoryOpen)} style={{ height: 50, borderRadius: 12, background: "#fff", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", padding: "0 16px", fontSize: 14.5, color: "#0E1512", boxShadow: "0 1px 4px rgba(14,21,18,.04)", cursor: "pointer" }} data-testid="category">
            {p.category}<span style={{ marginLeft: "auto", color: "#B7BDB6", fontSize: 11 }}>▾</span>
          </div>
          {p.categoryOpen ? (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 12px 32px rgba(14,21,18,.16)", zIndex: 15, overflow: "hidden" }}>
              {CATEGORIES.map((c) => (
                <div key={c} onClick={() => { p.setCategory(c); p.setCategoryOpen(false); }} style={{ padding: "10px 15px", fontSize: 14, color: "#0E1512", cursor: "pointer" }}>{c}</div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>What should this agent achieve?</div>
        <div style={{ fontSize: 13.5, color: "#9AA59E" }}>Select the primary goal — this shapes the entire sequence and copy.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, marginBottom: 20 }}>
        {GOALS.map((g) => {
          const on = p.goal === g.key;
          return (
            <div key={g.key} onClick={() => p.setGoal(g.key)} data-testid={`goal-${g.key}`} style={{ borderRadius: 13, border: on ? "2px solid #35E834" : "1px solid #EBE3D6", background: on ? "rgba(53,232,52,.07)" : "#fff", padding: "16px 14px", cursor: "pointer", transition: "border-color .12s" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 11 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: on ? "rgba(53,232,52,.16)" : "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{g.icon}</span>
                <span style={{ width: 18, height: 18, borderRadius: "50%", border: on ? "none" : "1.5px solid #D8CFBE", background: on ? "#16A82A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", flex: "none" }}>{on ? "✓" : ""}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>{g.title}</div>
              <div style={{ fontSize: 12, color: "#8A7F6B", lineHeight: 1.45 }}>{g.desc}</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={upLbl}>Agent instructions <span style={{ fontWeight: 400, color: "#C2B79F", letterSpacing: 0, textTransform: "none", fontSize: 11 }}>optional context</span></label>
        <textarea value={p.instructions} onChange={(e) => p.setInstructions(e.target.value)} placeholder="Anything the agent should know or how it should behave — audience, offer to lead with, tone rules…" rows={3} style={{ display: "block", width: "100%", boxSizing: "border-box", borderRadius: 12, background: "#fff", border: "1px solid #EBE3D6", padding: "14px 16px", fontSize: 14.5, color: "#3B463F", lineHeight: 1.6, boxShadow: "0 1px 4px rgba(14,21,18,.04)", minHeight: 76, resize: "vertical", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="agent-instructions" />
      </div>

      {p.goal ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: p.goal === "custom" ? 14 : 28 }} data-testid="goal-pill">
            <div style={{ height: 1, flex: 1, background: "#EBE3D6" }} />
            {/* C2.9 (DEC-059): the completion-signal explainer — names the goal's
                own terminal label (GOAL_META; custom = the typed label). */}
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 100, padding: "4px 13px", whiteSpace: "nowrap" }}>
              ✓ Goal: {GOALS.find((g) => g.key === p.goal)?.title}
              <span style={{ fontWeight: 600, color: "#0F7A28" }} data-testid="goal-explainer"> · completes when: “{goalTerminalLabel(p.goal, p.goalLabel)}”</span>
            </span>
            <div style={{ height: 1, flex: 1, background: "#EBE3D6" }} />
          </div>
          {p.goal === "custom" ? (
            <div style={{ marginBottom: 28, maxWidth: 420 }}>
              <label style={upLbl}>Completed-state label <span style={{ fontWeight: 400, color: "#C2B79F", letterSpacing: 0, textTransform: "none", fontSize: 11 }}>optional — how this goal reads once met</span></label>
              <input value={p.goalLabel} onChange={(e) => p.setGoalLabel(e.target.value.slice(0, 60))} placeholder="Goal met" style={{ display: "block", width: "100%", boxSizing: "border-box", height: 44, borderRadius: 12, background: "#fff", border: "1px solid #EBE3D6", padding: "0 14px", fontSize: 14, color: "#0E1512", boxShadow: "0 1px 4px rgba(14,21,18,.04)", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="goal-label-input" />
            </div>
          ) : null}

          {/* Knowledge base — header above the card, add-source picker below */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>Knowledge base</span>
              <span style={{ fontSize: 12.5, color: "#9AA59E" }}>the agent reads these before building anything</span>
            </div>
            <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(14,21,18,.04)" }}>
              {p.sources.map((s) => {
                const st = ING_PILL[s.status]!;
                const meta = s.status === "READY"
                  ? `${SRC_KIND_LABEL[s.kind] ?? "Source"}${s.chunkCount ? ` — ${s.chunkCount} section${s.chunkCount === 1 ? "" : "s"} indexed` : ""}`
                  : s.status === "FAILED"
                    ? `${SRC_KIND_LABEL[s.kind] ?? "Source"} — couldn't be read`
                    : SRC_KIND_LABEL[s.kind] ?? "Source";
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", borderBottom: "1px solid #F5F0E8" }} data-testid={`source-${s.status.toLowerCase()}`}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flex: "none" }}>{SRC_ICON[s.kind] ?? "📄"}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</div>
                      <div style={{ fontSize: 11.5, color: "#9AA59E" }}>{meta}</div>
                      {s.status === "PENDING" || s.status === "INGESTING" ? (
                        <div style={{ position: "relative", height: 3, borderRadius: 100, background: "#F2EEE4", overflow: "hidden", marginTop: 5 }} data-testid="source-progress">
                          <span style={{ position: "absolute", top: 0, bottom: 0, left: "-30%", width: "30%", borderRadius: 100, background: "#D4A020", animation: "cfIngestSlide 1.2s linear infinite" }} />
                        </div>
                      ) : null}
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: st.fg }}>{st.label}</span>
                    {s.status === "FAILED" ? (
                      <span onClick={() => void p.retrySource(s.id)} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }} data-testid={`source-retry-${s.id}`}>Retry</span>
                    ) : null}
                    <span onClick={() => void p.removeSource(s.id)} title="Remove source" style={{ fontSize: 12, color: "#C2B79F", cursor: "pointer", flex: "none", padding: "2px 5px", lineHeight: 1 }} data-testid={`source-remove-${s.id}`}>✕</span>
                  </div>
                );
              })}
              <div onClick={() => p.setAddMode(p.addMode ? null : "picker")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", cursor: "pointer" }} data-testid="add-source">
                <span style={{ width: 26, height: 26, borderRadius: 7, border: "1.5px dashed #9FD8AC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#16A82A", flex: "none" }}>+</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#16A82A" }}>Add source</span>
                <span style={{ fontSize: 12.5, color: "#B7BDB6", fontWeight: 400 }}>website · document · connector</span>
              </div>
            </div>

            {p.addMode ? (
              <div style={{ marginTop: 8, border: "1px solid #EBE3D6", borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 2px 10px rgba(14,21,18,.07)" }} data-testid="add-source-panel">
                {/* B5: knowledge needs a draft agent, and the draft needs a name. */}
                {!p.name.trim() ? (
                  <div style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 600, color: "#B7791F", background: "rgba(232,196,91,.08)", borderBottom: "1px solid #F2EEE4" }} data-testid="no-name-notice">Name your agent first — knowledge attaches to it.</div>
                ) : null}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #F2EEE4" }}>
                  {p.addMode === "picker" ? (
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", flex: 1 }}>Add a knowledge source</span>
                  ) : (
                    <>
                      <span onClick={() => p.setAddMode("picker")} style={{ fontSize: 12, fontWeight: 600, color: "#9AA59E", cursor: "pointer", flex: "none" }}>‹ Back</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", flex: 1, marginLeft: 8 }}>
                        {p.addMode === "url" ? "Website URL" : p.addMode === "doc" ? "Upload document" : "Connect an app"}
                      </span>
                    </>
                  )}
                  <span onClick={() => p.setAddMode(null)} style={{ color: "#C2B79F", cursor: "pointer", fontSize: 15, flex: "none", lineHeight: 1 }}>×</span>
                </div>

                {p.addMode === "picker" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
                    {(
                      [
                        { key: "doc", icon: "📄", label: "Document", sub: "PDF · DOCX · TXT" },
                        { key: "url", icon: "🔗", label: "Website URL", sub: "Pages · sitemap" },
                        { key: "connector", icon: "🔌", label: "Connector", sub: "Drive · Notion…" },
                      ] as const
                    ).map((m, i) => (
                      <div key={m.key} onClick={() => p.setAddMode(m.key)} style={{ padding: "18px 14px", textAlign: "center", cursor: "pointer", borderRight: i < 2 ? "1px solid #F2EEE4" : "none" }} data-testid={`add-${m.key}`}>
                        <div style={{ width: 38, height: 38, borderRadius: 11, background: "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, margin: "0 auto 10px" }}>{m.icon}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>{m.label}</div>
                        <div style={{ fontSize: 11.5, color: "#9AA59E" }}>{m.sub}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {p.addMode === "url" ? (
                  <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <input value={p.urlInput} onChange={(e) => p.setUrlInput(e.target.value)} placeholder="https://yoursite.com" style={{ height: 46, boxSizing: "border-box", borderRadius: 10, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "0 14px", fontSize: 14, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="url-input" />
                    {/* B2: real scope dropdown — "Entire site" is Coming soon (stays "page") */}
                    <div style={{ position: "relative" }}>
                      <div onClick={() => setScopeOpen(!scopeOpen)} style={{ height: 40, borderRadius: 10, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 13, color: "#5C6B62", cursor: "pointer" }} data-testid="url-scope">
                        {urlScope === "page" ? "This page" : "Entire site"}<span style={{ marginLeft: "auto", color: "#B7BDB6" }}>▾</span>
                      </div>
                      {scopeOpen ? (
                        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 12px 32px rgba(14,21,18,.16)", zIndex: 15, overflow: "hidden" }}>
                          <div onClick={() => { setUrlScope("page"); setScopeOpen(false); }} style={{ padding: "10px 15px", fontSize: 14, color: "#0E1512", cursor: "pointer" }} data-testid="url-scope-page">This page</div>
                          <div onClick={() => { p.toast("Site crawl is coming soon — this page will be indexed for now"); setUrlScope("page"); setScopeOpen(false); }} style={{ display: "flex", alignItems: "center", padding: "10px 15px", fontSize: 14, color: "#0E1512", cursor: "pointer" }} data-testid="url-scope-site">
                            Entire site<span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "2px 8px" }}>Coming soon</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <span onClick={() => p.setAddMode(null)} style={{ fontSize: 13, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 9, padding: "8px 14px", cursor: "pointer" }}>Cancel</span>
                      <span onClick={() => void p.addUrl()} style={{ fontSize: 13, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 9, padding: "8px 16px", cursor: "pointer" }} data-testid="url-add">Add URL</span>
                    </div>
                  </div>
                ) : null}

                {p.addMode === "doc" ? (
                  <div style={{ padding: "14px 16px" }}>
                    {p.uploadCfg && !p.uploadCfg.enabled ? (
                      /* DEC-026: never a dead click — disabled with the reason. */
                      <div style={{ border: "1.5px dashed #D8CFBE", borderRadius: 11, padding: "28px 20px", textAlign: "center", background: "#FBF7F0", opacity: 0.65, cursor: "default" }} data-testid="upload-disabled">
                        <div style={{ fontSize: 26, marginBottom: 9 }}>📄</div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", marginBottom: 4 }}>Document upload unavailable</div>
                        <div style={{ fontSize: 12, color: "#8A7F6B", maxWidth: 380, margin: "0 auto" }}>{p.uploadCfg.reason}</div>
                      </div>
                    ) : (
                      <label style={{ display: "block", border: "1.5px dashed #D8CFBE", borderRadius: 11, padding: "28px 20px", textAlign: "center", background: "#FBF7F0", cursor: "pointer" }} data-testid="upload-dropzone">
                        <input type="file" accept=".pdf,.docx,.txt,.md,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void p.uploadDoc(f); e.target.value = ""; }} data-testid="upload-input" />
                        <div style={{ fontSize: 26, marginBottom: 9 }}>📄</div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", marginBottom: 4 }}>Drop a file here or browse</div>
                        <div style={{ fontSize: 12, color: "#9AA59E" }}>PDF · DOCX · TXT · CSV · up to 20 MB</div>
                      </label>
                    )}
                  </div>
                ) : null}

                {p.addMode === "connector" ? (
                  <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7 }}>
                    {["HubSpot", "Notion", "Google Drive", "Salesforce", "Slack", "Zendesk"].map((c) => (
                      <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 12px", background: "#fff", fontSize: 12.5, fontWeight: 600, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 15, flex: "none" }}>🔌</span>{c}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* About your business — v2: dashed empty card until a READY source exists */}
          {p.readyCnt === 0 ? (
            <div style={{ border: "1px dashed #D8CFBE", borderRadius: 13, padding: "15px 16px", background: "#FBF7F0", marginBottom: 14 }} data-testid="about-empty">
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#8A7F6B" }}>No business profile yet — </span>
              <span style={{ fontSize: 13.5, color: "#9AA59E" }}>add a knowledge source and we’ll distill one for personalisation.</span>
            </div>
          ) : (
          <div style={{ border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden", boxShadow: "0 1px 4px rgba(14,21,18,.04)", marginBottom: 14 }} data-testid="about-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#F7F9F8", borderBottom: "1px solid #EBE3D6" }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", flex: 1 }}>About your business</span>
              <span style={{ fontSize: 12, color: "#9AA59E" }}>used to personalise every message</span>
              {p.aboutEditing ? (
                <>
                  <span onClick={() => p.setAboutEditing(false)} style={{ fontSize: 12, fontWeight: 600, color: "#9AA59E", cursor: "pointer" }}>Cancel</span>
                  <span onClick={() => void p.saveAbout()} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", cursor: "pointer" }} data-testid="about-save">Save</span>
                </>
              ) : (
                <span onClick={() => { p.setAboutDraft(p.contextSummary); p.setAboutEditing(true); }} style={{ fontSize: 12, fontWeight: 600, color: "#16A82A", cursor: "pointer" }} data-testid="about-edit">Edit</span>
              )}
            </div>
            {p.aboutEditing ? (
              <div style={{ padding: "10px 12px", background: "#fff" }}>
                <textarea value={p.aboutDraft} onChange={(e) => p.setAboutDraft(e.target.value)} rows={4} style={{ display: "block", width: "100%", boxSizing: "border-box", borderRadius: 10, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "10px 13px", fontSize: 14, color: "#3B463F", lineHeight: 1.55, resize: "vertical", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="about-textarea" />
              </div>
            ) : (
            <div style={{ padding: "14px 16px", background: "#fff", fontSize: 14.5, color: "#3B463F", lineHeight: 1.55 }}>
              {p.contextSummary ||
                (p.distilling ? (
                  // B8 in-flight treatment (designed state, no prototype anchor —
                  // same amber + indeterminate-bar motion as the B3 source rows).
                  <span data-testid="about-distilling">
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#B7791F" }}>Reading your documents…</span>
                    <span style={{ display: "block", fontSize: 12.5, color: "#9AA59E", marginTop: 2 }}>The distilled business brief appears here in a moment — every claim cited to your own docs.</span>
                    <span style={{ display: "block", position: "relative", height: 3, borderRadius: 100, background: "#F2EEE4", overflow: "hidden", marginTop: 10 }}>
                      <span style={{ position: "absolute", top: 0, bottom: 0, left: "-30%", width: "30%", borderRadius: 100, background: "#D4A020", animation: "cfIngestSlide 1.2s linear infinite" }} />
                    </span>
                  </span>
                ) : (
                  "Ingest a source and the distilled business brief appears here — every claim cited to your own docs."
                ))}
            </div>
            )}
            {p.groundedSources.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", padding: "9px 16px 10px", background: "#fff", borderTop: "1px solid #F2EEE4" }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "#9AA59E", flex: "none" }}>Grounded in</span>
                {p.groundedSources.map((s) => (
                  <span key={s.id} onClick={() => p.setAboutEv(p.aboutEv === s.id ? null : s.id)} data-testid="grounded-chip" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3.5px 10px", borderRadius: 100, border: `1px solid ${p.aboutEv === s.id ? "#35E834" : "#EBE3D6"}`, background: p.aboutEv === s.id ? "rgba(53,232,52,.07)" : "#fff", fontSize: 11.5, fontWeight: 600, color: "#3B463F", cursor: "pointer" }}>
                    <span style={{ fontSize: 11 }}>{SRC_ICON[s.type] ?? "📄"}</span>
                    {s.label}
                  </span>
                ))}
              </div>
            ) : null}
            {openSource && openQuote ? (
              <div style={{ padding: "10px 16px 13px", background: "#FBFDF9", borderTop: "1px solid #F2EEE4" }} data-testid="grounded-evidence">
                <div style={{ borderLeft: "2px solid #35E834", padding: "1px 0 1px 11px" }}>
                  <div style={{ fontSize: 12.5, color: "#3B463F", lineHeight: 1.55, fontStyle: "italic" }}>“{openQuote.quote}”</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#9AA59E" }}>{SRC_ICON[openSource.type] ?? "📄"} {openSource.label} — {openQuote.locator}</span>
                    <span style={{ fontSize: 11, color: "#C4BAB0" }}>·</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#8A7F6B" }}>backs {[...openSource.backs].join(" · ")}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "#16A82A", cursor: "pointer", flex: "none" }}>Open source ↗</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          )}

          {/* AI gap checker */}
          <div style={{ border: "1px solid rgba(232,196,91,.48)", borderRadius: 12, overflow: "hidden", background: "rgba(232,196,91,.04)", marginBottom: 22 }} data-testid="gap-checker">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid rgba(232,196,91,.28)" }}>
              <span style={{ fontSize: 13, color: "#D4A020" }}>✦</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>A few things the agent still needs</div>
                {p.distilling ? (
                  // B8: while the distiller is mid-read, the resting "Not found
                  // in your docs" copy is a lie — say what's actually happening.
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "#B7791F" }} data-testid="gap-distilling">
                    <span style={{ display: "inline-block", position: "relative", width: 34, height: 3, borderRadius: 100, background: "#F2EEE4", overflow: "hidden", flex: "none" }}>
                      <span style={{ position: "absolute", top: 0, bottom: 0, left: "-30%", width: "30%", borderRadius: 100, background: "#D4A020", animation: "cfIngestSlide 1.2s linear infinite" }} />
                    </span>
                    Reading your documents — results update as soon as it finishes.
                  </div>
                ) : p.hasContext ? (
                  <div style={{ fontSize: 12, color: "#8A7F6B" }}>Not found in your docs — resolve before launching.</div>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#B7791F" }} data-testid="gap-nocontext">No context yet — add a source or type answers before launch.</div>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "rgba(232,196,91,.2)", borderRadius: 7, padding: "3px 9px" }} data-testid="gap-counter">{p.gapResolved}/{p.gapTotal}</span>
            </div>
            {p.hasContext && p.covered.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", padding: "8px 16px", background: "rgba(53,232,52,.06)", borderBottom: "1px solid rgba(232,196,91,.2)" }}>
                <span style={{ color: "#16A82A", fontSize: 12, flex: "none" }}>✓</span>
                <span style={{ fontSize: 12, color: "#16A82A", fontWeight: 600, flex: "none" }}>Found in your docs:</span>
                {p.covered.map((c) => (
                  <span key={c.key} onClick={() => p.setCoveredEv(p.coveredEv === c.key ? null : c.key)} data-testid="covered-chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2.5px 9px", borderRadius: 100, border: `1px solid ${p.coveredEv === c.key ? "#35E834" : "rgba(53,232,52,.35)"}`, background: p.coveredEv === c.key ? "rgba(53,232,52,.12)" : "rgba(53,232,52,.06)", fontSize: 11.5, fontWeight: 600, color: "#0F7A28", cursor: "pointer" }}>
                    {c.label}
                    <span style={{ fontSize: 9, opacity: 0.6 }}>{p.coveredEv === c.key ? "▴" : "▾"}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {coveredQuote ? (
              <div style={{ padding: "9px 16px 12px", background: "rgba(53,232,52,.04)", borderBottom: "1px solid rgba(232,196,91,.2)" }} data-testid="covered-evidence">
                <div style={{ borderLeft: "2px solid #35E834", padding: "1px 0 1px 11px" }}>
                  <div style={{ fontSize: 12.5, color: "#3B463F", lineHeight: 1.55, fontStyle: "italic" }}>“{coveredQuote.quote}”</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                    <span style={{ fontSize: 11, color: "#8A7F6B" }}>{SRC_ICON[coveredQuote.sourceType] ?? "📄"} {coveredQuote.sourceLabel} — {coveredQuote.locator}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "#16A82A", cursor: "pointer", flex: "none" }}>Open source ↗</span>
                  </div>
                </div>
              </div>
            ) : null}
            {p.gaps.map((g) => (
              <div key={g.key} style={{ padding: "11px 16px", borderTop: "1px solid rgba(232,196,91,.16)" }} data-testid={`gap-${g.state}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.state === "open" ? "#D4A020" : "#16A82A", flex: "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>{g.label}</div>
                    <div style={{ fontSize: 11.5, color: "#9AA59E" }}>{g.description}</div>
                  </div>
                  {g.state === "open" ? (
                    <>
                      <span onClick={() => p.setTypedDrafts((d) => ({ ...d, [g.key]: d[g.key] ?? "" }))} style={{ fontSize: 12, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 9, padding: "5px 10px", cursor: "pointer", flex: "none" }} data-testid={`gap-type-${g.key}`}>Type it</span>
                      <span onClick={() => void p.delegateGap(g.key)} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 9, padding: "5px 10px", cursor: "pointer", flex: "none" }} data-testid={`gap-ai-${g.key}`}>✦ Let AI</span>
                    </>
                  ) : g.state === "ai_decides" ? (
                    <>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 8, padding: "4px 9px", flex: "none" }}>✦ AI decides</span>
                      <span onClick={() => void p.undoGap(g.key)} style={{ fontSize: 12, color: "#9AA59E", cursor: "pointer", flex: "none" }}>Undo</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0F7A28", background: "#D7F5DD", borderRadius: 8, padding: "4px 9px", flex: "none" }}>Typed ✓</span>
                      <span onClick={() => void p.undoGap(g.key)} style={{ fontSize: 12, color: "#9AA59E", cursor: "pointer", flex: "none" }}>Clear</span>
                    </>
                  )}
                </div>
                {g.state === "open" && p.typedDrafts[g.key] !== undefined ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input value={p.typedDrafts[g.key]} onChange={(e) => p.setTypedDrafts((d) => ({ ...d, [g.key]: e.target.value }))} placeholder={`Type your ${g.label.toLowerCase()}…`} style={{ ...inp, flex: 1, marginBottom: 0 }} data-testid={`gap-input-${g.key}`} />
                    <button type="button" onClick={() => void p.typeGap(g.key)} style={{ background: GRAD, border: "none", borderRadius: 10, padding: "0 16px", fontSize: 13, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid={`gap-save-${g.key}`}>Save</button>
                  </div>
                ) : null}
              </div>
            ))}
            {p.gaps.length === 0 ? <div style={{ padding: "12px 16px", fontSize: 12.5, color: "#0F7A28" }}>✓ Nothing missing — everything the goal needs is covered or resolved.</div> : null}
          </div>

          {/* build method — v2: locked until ≥1 READY source or a typed answer */}
          {!p.hasContext ? (
            <div style={{ borderTop: "1px solid #EBE3D6", paddingTop: 22, paddingBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px dashed #D8CFBE", borderRadius: 12, padding: "14px 16px", background: "#FBF7F0" }} data-testid="build-locked">
                <span style={{ fontSize: 13, color: "#D4A020", flex: "none" }}>✦</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#8A7F6B" }}>Add a knowledge source or answer a question above to unlock sequence building.</span>
              </div>
            </div>
          ) : (
          <div style={{ borderTop: "1px solid #EBE3D6", paddingTop: 26, paddingBottom: 30 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>How should we build the sequence?</div>
              <div style={{ fontSize: 13.5, color: "#9AA59E" }}>Choose how the agent&apos;s outreach gets created.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, marginBottom: 14 }}>
              {(
                [
                  { key: "ai", icon: "✦", title: "Let AI build it", desc: "Generate the full agent from your goal." },
                  { key: "template", icon: "❒", title: "Use a template", desc: "Start from a proven playbook." },
                  { key: "scratch", icon: "✎", title: "From scratch", desc: "Build every step yourself." },
                ] as const
              ).map((b) => {
                const on = p.buildMethod === b.key;
                return (
                  <div key={b.key} onClick={() => b.key === "ai" && p.setBuildMethod(b.key)} style={{ borderRadius: 13, border: on ? "1.5px solid #35E834" : "1px solid #EBE3D6", background: on ? "rgba(53,232,52,.05)" : "#fff", padding: "16px 14px", cursor: b.key === "ai" ? "pointer" : "default", opacity: b.key === "ai" ? 1 : 0.6 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, marginBottom: 11 }}>{b.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>{b.title}</div>
                    <div style={{ fontSize: 12, color: "#8A7F6B", lineHeight: 1.4 }}>{b.desc}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ border: "1px solid rgba(53,232,52,.32)", borderRadius: 12, overflow: "hidden", background: "rgba(53,232,52,.04)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 16px", borderBottom: "1px solid rgba(53,232,52,.18)" }}>
                <span style={{ fontSize: 13, color: "#16A82A" }}>✦</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512", flex: 1 }}>Clientforce will orchestrate this for you</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 7, padding: "3px 9px" }}>Recommended</span>
              </div>
              {[
                { label: "Sequence steps, timing and reply branches", value: "planned from your goal" },
                { label: "Copy grounded in your business context", value: "every claim cited" },
                { label: "Guardrails & compliance defaults", value: "editable in step 5" },
              ].map((o) => (
                <div key={o.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderTop: "1px solid rgba(53,232,52,.1)" }}>
                  <span style={{ color: "#16A82A", fontSize: 12, flex: "none" }}>✓</span>
                  <span style={{ fontSize: 13, color: "#3B463F", flex: 1 }}>{o.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#8A7F6B" }}>{o.value}</span>
                </div>
              ))}
              <div style={{ padding: "10px 16px", fontSize: 12, color: "#8A7F6B", borderTop: "1px solid rgba(53,232,52,.1)" }}>You&apos;ll review and tweak everything in the next steps.</div>
            </div>
          </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/* ── shared bits ──────────────────────────────────────────────────────────── */
/** Prototype's uppercase micro-caps field label. */
const upLbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 8 };
// M1a (DEC-065): the picker vocabulary lives in core beside the arc map so
// the two can never fork; this alias keeps the render sites unchanged.
const CATEGORIES = BUSINESS_CATEGORIES;
/** DEC-039a drawer micro-caps label + 42px field. */
const manualLbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 };
const manualInp: React.CSSProperties = { height: 42, width: "100%", boxSizing: "border-box", borderRadius: 10, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", padding: "0 13px", fontSize: 13.5, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "10px 13px", fontSize: 13.5, color: "#0E1512", marginBottom: 6, fontFamily: "'Hanken Grotesk',sans-serif" };

function Modal({ title, children, onClose, tid }: { title: string; children: React.ReactNode; onClose: () => void; tid?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(12,20,15,.45)" }} />
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 560, maxWidth: "92vw", background: "#FBF7F0", borderRadius: 18, boxShadow: "0 30px 80px rgba(0,0,0,.32)", overflow: "hidden" }} data-testid={tid}>
        <div style={{ background: "#fff", borderBottom: "1px solid #EBE3D6", padding: "14px 20px", fontSize: 16, fontWeight: 700, color: "#0E1512" }}>{title}</div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function ModalActions({ onCancel, onSave, saveLabel = "Save" }: { onCancel: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 8 }}>
      <button type="button" onClick={onCancel} style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, color: "#0E1512", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}>Cancel</button>
      <button type="button" onClick={onSave} data-testid="modal-save" style={{ background: GRAD, border: "none", borderRadius: 11, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)", fontFamily: "'Hanken Grotesk',sans-serif" }}>{saveLabel}</button>
    </div>
  );
}

function Stepper({ value, onMinus, onPlus }: { value: string; onMinus: () => void; onPlus: () => void }) {
  const btn: React.CSSProperties = { width: 34, height: 34, borderRadius: 10, border: "1px solid #EBE3D6", background: "#fff", fontSize: 16, cursor: "pointer", color: "#0E1512" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button type="button" onClick={onMinus} style={btn}>−</button>
      <span style={{ minWidth: 90, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{value}</span>
      <button type="button" onClick={onPlus} style={btn}>+</button>
    </div>
  );
}

/** Prototype 44×25 gradient toggle (step-5 sending-behavior rows). */
function GradToggle({ on, onClick, tid }: { on: boolean; onClick: () => void; tid: string }) {
  return (
    <div onClick={onClick} style={{ width: 44, height: 25, borderRadius: 100, background: on ? GRAD : "#D8CFBE", display: "flex", alignItems: "center", justifyContent: on ? "flex-end" : "flex-start", padding: 3, cursor: "pointer", flex: "none", transition: "background .2s" }} data-testid={tid}>
      <span style={{ width: 19, height: 19, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
    </div>
  );
}

function LimitCard({ label, value, onMinus, onPlus, tid }: { label: string; value: string; onMinus: () => void; onPlus: () => void; tid: string }) {
  return (
    <div style={{ border: "1px solid #EBE3D6", borderRadius: 13, background: "#fff", padding: "14px 14px" }} data-testid={`limit-${tid}`}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#9AA59E", marginBottom: 10 }}>{label}</div>
      <Stepper value={value} onMinus={onMinus} onPlus={onPlus} />
    </div>
  );
}

function shiftH(hhmm: string, delta: number): string {
  const [h = 9] = hhmm.split(":").map(Number);
  const nh = Math.min(23, Math.max(0, h + delta));
  return `${String(nh).padStart(2, "0")}:00`;
}
