"use client";

/**
 * Create Agent wizard (C2.3) — 6 steps ported from the UPDATED
 * `Create Agent.dc.html` (checkpoints §3), wired to the live P1.2 ingest,
 * P1.3 context/citations/gaps (DEC-028 snapshots — chunk ids never render),
 * P1.4 planner, P1.5 senders, A5 create path. Prototype literals throughout.
 *
 * W3 commit 0: the monolith is split into per-step components (steps/*) —
 * pure move, no behavior change. This file keeps ALL state, effects and
 * actions (the orchestrator); each step renders from props.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addStep as addStepMutation, BRIEF_TALKING_POINTS_MIN, CONTEXT_FIELD_META, customTokensMissingFallback, GOAL_KEYS, GraphMutationError, GUIDED_EMAIL_CREDITS, GUIDED_SMS_CREDITS, requiredFieldsFor, subcampaignChains, updateDelay as updateDelayMutation, updateStepBrief, updateStepContent, type GoalKey } from "@clientforce/core";
import type { CampaignGraph, CampaignOutcomes, CampaignRuleTrigger, ContactFieldDefDto, DraftState, GraphNode } from "@clientforce/core";
import type { SubcampaignCreated } from "../../../components/sequence/SubcampaignCreator";
import type { WizardSubRule } from "./steps/Step2Sequence";
import { mainSteps, strategyStepsOf } from "../../../lib/graph-path";
import { goalFitOf } from "../../../lib/goal-fit";
import { BSTEPS, BUILD_DELAYS, DEFAULT_CAPTURE, EMPTY_MANUAL, GRAD, cf, type AddMode, type AddedContact, type BriefDraft, type CaptureState, type Citation, type ContextField, type Gap, type KnowledgeSource, type PreviewState, type SenderRow } from "./shared";
import { BuildingScreen } from "./steps/BuildingScreen";
import { Step1 } from "./steps/Step1Setup";
import { Step2Sequence } from "./steps/Step2Sequence";
import { Step3Contacts } from "./steps/Step3Contacts";
import { Step4Capture } from "./steps/Step4Capture";
import { Step5Guardrails } from "./steps/Step5Guardrails";
import { Step6Review } from "./steps/Step6Review";


/** Per-field one-liner under each gap row (registry-driven). */
const FIELD_HINTS: Record<string, string> = Object.fromEntries(
  Object.entries(CONTEXT_FIELD_META).map(([k, v]) => [k, v.hint]),
);

/** Rail + header copy, verbatim from the prototype's step defs. */
const STEP_DEFS = [
  { label: "Set the goal", hint: "Goal & build method", title: "Set the goal", subtitle: "Tell the agent what to achieve — it orchestrates the sequence, channels, and copy." },
  { label: "Design sequence", hint: "AI-drafted steps", title: "Design the sequence", subtitle: "We drafted an outreach sequence — tweak any step." },
  { label: "Add contacts", hint: "Import or find leads", title: "Add your contacts", subtitle: "Choose who this agent should reach out to." },
  { label: "Enable lead capture", hint: "Optional inbound form", title: "Enable lead capture", subtitle: "Turn inbound interest into leads with a branded form." },
  { label: "Guardrails & compliance", hint: "Consent, schedule & limits", title: "Guardrails & compliance", subtitle: "Set the rules your agent stays within — consent, sending windows, and limits." },
  { label: "Preview & launch", hint: "Review & deploy", title: "Preview & launch", subtitle: "Review everything, then deploy your agent." },
];

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
  // G3 (DEC-075): the step-2 Scripted | ✦ Guided control — the SAME guardrails
  // rider the Settings toggle owns (no new storage). The planner reads it at
  // the NEXT plan; flipping never rewrites already-planned steps.
  const [composeMode, setComposeMode] = useState<"scripted" | "guided">("scripted");
  // F1 (DEC-068): per-step outcomes for the step-card badges. Fresh drafts
  // report all-none (no badges — honest absence); a resumed/relaunched agent
  // with live sends shows low/ok chips. Failure → null → no badges.
  const [outcomes, setOutcomes] = useState<CampaignOutcomes | null>(null);
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
  // G1 (DEC-070): the guided step's BRIEF editor — bullets, never copy.
  // G2 (DEC-071): channel-aware — email briefs add the subjectHint field.
  const [editBrief, setEditBrief] = useState<BriefDraft | null>(null);
  const [briefPointInput, setBriefPointInput] = useState("");
  const [briefMustInput, setBriefMustInput] = useState("");
  const [briefNeverInput, setBriefNeverInput] = useState("");
  // G1: sample preview — composes against the fixed sample lead (free at
  // launch, Q-020 meters it); refusals are a designed display state.
  // G2: email previews carry a composed subject too.
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // C2.7: custom-field tokens — chip selection + the mandatory-fallback card.
  const [fieldDefs, setFieldDefs] = useState<ContactFieldDefDto[]>([]);
  const [customTokenKey, setCustomTokenKey] = useState<string | null>(null);
  const [customFallback, setCustomFallback] = useState("");
  const [delayEdit, setDelayEdit] = useState<GraphNode | null>(null);
  const [delayAmount, setDelayAmount] = useState(2);
  // W2 (#94): the sub-campaign creator (shared component) + the wizard's
  // IN-SESSION created-rules state — trigger chips (and known-provenance
  // ✦ AI chips) for branches created this session; resumed drafts render
  // "Rule pending" (honest absence — provenance isn't persisted).
  const [subNewOpen, setSubNewOpen] = useState(false);
  const [subNewPrefill, setSubNewPrefill] = useState<{ name: string; trigger: CampaignRuleTrigger } | null>(null);
  const [subRules, setSubRules] = useState<WizardSubRule[]>([]);

  // step 3
  // W3-1: "Upload CSV" opens the REAL C2.5 import flow (shared component)
  // as a modal over the step; the run lands in a list and the wizard keeps
  // only the REFERENCE (B6: name/count/sample resolve live, never copied).
  const [importOpen, setImportOpen] = useState(false);
  const [csvImport, setCsvImport] = useState<{ listId: string; name: string; count: number } | null>(null);
  // the import flow's review-step estimate + admin gating (same inputs the
  // Contacts mount feeds it) — fetched when the modal first opens.
  const [importRows, setImportRows] = useState<{ email: string | null; unsub: boolean }[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // C2.8: "Choose a list" — picked list enrolls its members at launch
  // (SNAPSHOT semantics: resolved at deploy time, same path as CSV adds).
  const [wizardLists, setWizardLists] = useState<{ id: string; name: string; memberCount: number; archived: boolean }[]>([]);
  const [pickedList, setPickedList] = useState<{ id: string; name: string; memberCount: number } | null>(null);
  const [listSearch, setListSearch] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  // DEC-039a: multi-add — rows queue up "this session" and post together.
  const [manualQueue, setManualQueue] = useState<Array<typeof EMPTY_MANUAL>>([]);
  const [added, setAdded] = useState<AddedContact[]>([]);
  // W3-7: audience-preview member rows per referenced list (first ~4, via the
  // existing contacts/view?listId= — display only; launch re-resolves fully).
  const [listSamples, setListSamples] = useState<Record<string, { name: string; email: string; company: string }[]>>({});

  // step 4 — visual only (checkpoints §3): W3-9/W3-10 full config; `ap: null`
  // means the goal-fit default applies until the user toggles (W3-10).
  const [capture, setCapture] = useState<CaptureState>(DEFAULT_CAPTURE);

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
        // G3 (DEC-075): the mode control reflects the stored rider on resume.
        if (a.composeMode === "guided") setComposeMode("guided");
        if (ds.goalLabel) setGoalLabel(ds.goalLabel);
        if (ds.buildMethod) setBuildMethod(ds.buildMethod);
        if (ds.added) setAdded(ds.added);
        // W3-9: old drafts carry only {widget, form} — merge over defaults;
        // `ap` absent = no explicit choice, the goal-fit default applies.
        if (ds.capture) setCapture({ ...DEFAULT_CAPTURE, ...ds.capture, ap: ds.capture.ap ?? null });
        if (typeof ds.dailyCap === "number") setDailyCap(ds.dailyCap);
        if (typeof ds.smsDailyCap === "number") setSmsDailyCap(ds.smsDailyCap);
        if (ds.windowStart) setWindowStart(ds.windowStart);
        if (ds.timezone) setTimezone(ds.timezone);
        // C2.8/W3-1: re-resolve the referenced lists from the server (name/
        // count are truth, not draft copies — B6 rule); a deleted/archived
        // list drops its reference.
        if (ds.pickedListId || ds.csvListId) {
          void cf("lists")
            .then((ls: { id: string; name: string; memberCount: number; archived: boolean }[]) => {
              const picked = ls.find((x) => x.id === ds.pickedListId && !x.archived);
              if (picked) setPickedList({ id: picked.id, name: picked.name, memberCount: picked.memberCount });
              const csv = ls.find((x) => x.id === ds.csvListId && !x.archived);
              if (csv) setCsvImport({ listId: csv.id, name: csv.name, count: csv.memberCount });
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
        capture: {
          widget: capture.widget,
          form: capture.form,
          embed: capture.embed,
          enabled: capture.enabled,
          ...(capture.ap !== null ? { ap: capture.ap } : {}),
          apKeywords: capture.apKeywords,
          apParams: capture.apParams,
          apSignals: capture.apSignals,
        },
        dailyCap,
        smsDailyCap,
        windowStart,
        windowEnd,
        timezone,
        sendDays,
        quietHours,
        ramp,
        ...(pickedList ? { pickedListId: pickedList.id } : {}),
        ...(csvImport ? { csvListId: csvImport.listId } : {}),
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
  }, [agentId, launched, resuming, building, step, buildMethod, added, capture, dailyCap, smsDailyCap, windowStart, windowEnd, timezone, sendDays, quietHours, ramp, pickedList, csvImport, goalLabel, category, toast]);

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
    // W2 (#94): step 2 needs the live sender scan too — the sub-campaign
    // creator's email-backed triggers disable honestly without one.
    if (step === 1 || step === 4) void cf("senders").then(setSenders).catch(() => {});
  }, [step]);

  // F1 (DEC-068): step-2 outcome badges — refetch on entry and on every graph
  // version bump (regen / manual edit) so badges track the sequence in view.
  useEffect(() => {
    if (step !== 1 || !agentId) return;
    let cancelled = false;
    cf(`agents/${agentId}/outcomes`)
      .then((o) => !cancelled && setOutcomes(o as CampaignOutcomes))
      .catch(() => !cancelled && setOutcomes(null));
    return () => {
      cancelled = true;
    };
  }, [step, agentId, graphVersion]);

  // DEC-026: the Upload-doc card is disabled-with-reason when storage is absent.
  useEffect(() => {
    void cf("knowledge/upload-config").then(setUploadCfg).catch(() => setUploadCfg({ enabled: true }));
    // C2.7: workspace custom-field defs feed the token picker.
    void cf("contact-fields").then(setFieldDefs).catch(() => {});
    // C2.8: saved lists feed the step-3 picker.
    void cf("lists").then(setWizardLists).catch(() => {});
    // W3-1: the import flow's custom-field CREATE row is admin-gated (C2.7).
    void cf("me")
      .then((m: { role?: string }) => setIsAdmin(m.role === "OWNER" || m.role === "ADMIN"))
      .catch(() => {});
  }, []);

  // C2.7: the fallback card never survives switching steps/closing the editor.
  useEffect(() => {
    setCustomTokenKey(null);
    setCustomFallback("");
  }, [editNode]);

  // W3-1: the import flow's review step estimates dupes/suppression against
  // the workspace rows (IMP-2 — the server stays authoritative). Fetched once
  // when the modal first opens; the same call the Contacts screen makes.
  useEffect(() => {
    if (!importOpen || importRows !== null) return;
    void cf("contacts/view")
      .then((res: { rows: { email: string | null; unsub: boolean }[] }) => setImportRows(res.rows))
      .catch(() => setImportRows([]));
  }, [importOpen, importRows]);

  // W3-7: first ~4 member rows per referenced list feed the audience preview
  // (display only — launch re-resolves full membership live).
  useEffect(() => {
    const ids = [pickedList?.id, csvImport?.listId].filter((x): x is string => Boolean(x));
    for (const id of ids) {
      if (id in listSamples) continue;
      setListSamples((s) => ({ ...s, [id]: [] }));
      void cf(`contacts/view?listId=${id}`)
        .then((res: { rows: { firstName: string | null; lastName: string | null; email: string | null; company: string | null }[] }) => {
          const sample = res.rows.slice(0, 4).map((r) => ({
            name: [r.firstName, r.lastName].filter(Boolean).join(" ") || (r.email ?? "Unknown"),
            email: r.email ?? "—",
            company: r.company ?? "—",
          }));
          setListSamples((s) => ({ ...s, [id]: sample }));
        })
        .catch(() => {});
    }
  }, [pickedList?.id, csvImport?.listId, listSamples]);

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

  // M1b (DEC-068): strategy steps are branch targets, not sequence steps —
  // the drawer header names their intent instead of a bogus "Step N".
  // W2 (#94): sub-campaign chain steps take their position WITHIN the container.
  const editStepIndex = useMemo(() => {
    if (!graph || !editNode) return 0;
    const main = mainSteps(graph).findIndex((n) => n.id === editNode.id) + 1;
    if (main > 0) return main;
    for (const { chain } of subcampaignChains(graph)) {
      const k = chain.filter((n) => n.type === "step").findIndex((n) => n.id === editNode.id) + 1;
      if (k > 0) return k;
    }
    return 0;
  }, [graph, editNode]);
  const editStrategyIntent = useMemo(() => {
    if (!graph || !editNode) return null;
    return strategyStepsOf(graph).find((s) => s.step.id === editNode.id)?.intent ?? null;
  }, [graph, editNode]);

  const branchCases = useMemo(() => {
    const b = graph?.nodes.find((n) => n.type === "branch");
    return b && b.type === "branch" ? b.cases : [];
  }, [graph]);

  // W3-7: the audience the wizard will enroll — REAL counts from every active
  // source (manual adds + picked list + CSV-imported list; the same arithmetic
  // launch resolves), plus up to 4 preview rows drawn from whichever sources
  // are in play. Never an estimate, never a fake.
  const audienceTotal = added.length + (pickedList?.memberCount ?? 0) + (csvImport?.count ?? 0);
  const audienceSample = useMemo(() => {
    const rows: { key: string; name: string; email: string; company: string; initials: string }[] = [];
    const initialsOf = (name: string, email: string) => {
      const parts = name.replace(/^dr\.?\s+/i, "").split(/\s+/).filter(Boolean);
      const ab = `${parts[0]?.[0] ?? ""}${parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""}`;
      return (ab || email.slice(0, 2)).toUpperCase();
    };
    const push = (key: string, name: string, email: string, company: string) =>
      rows.push({ key, name, email, company, initials: initialsOf(name, email) });
    if (pickedList) for (const [i, r] of (listSamples[pickedList.id] ?? []).entries()) push(`picked-${i}`, r.name, r.email, r.company);
    if (csvImport) for (const [i, r] of (listSamples[csvImport.listId] ?? []).entries()) push(`csv-${i}`, r.name, r.email, r.company);
    for (const a of added) push(a.id, [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email, a.email, a.company ?? "—");
    return rows.slice(0, 4);
  }, [added, pickedList, csvImport, listSamples]);

  // W3-9: keyword suggestions derive from the agent's own distilled context
  // fields (icp/services/offer values) — real data, never invented; empty
  // until step-1 knowledge exists (the dropdown shows the honest absence).
  const apSuggestions = useMemo(() => {
    const texts = ["icp", "services", "offer"].map((k) => fields[k]?.value ?? "").join(" · ");
    const parts = texts
      .split(/[,;·\n]|\band\b/gi)
      .map((x) => x.trim().replace(/[.]+$/, "").toLowerCase())
      .filter((x) => x.length >= 3 && x.length <= 32 && /^[a-z0-9"'&() -]+$/i.test(x));
    return [...new Set(parts)].filter((x) => !capture.apKeywords.some((k) => k.toLowerCase() === x)).slice(0, 6);
  }, [fields, capture.apKeywords]);

  const stepValid = [
    Boolean(goal && name.trim() && agentId && allResolvedForNext()),
    Boolean(graph),
    // C2.8/W3-1: a referenced list (picked or CSV-imported) is a contact
    // source — it satisfies the step exactly like manual adds do.
    added.length > 0 || pickedList !== null || csvImport !== null,
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
        body: JSON.stringify({ guardrails: guardrailsPayload() }),
      });
    }
    setStep((s) => Math.min(5, s + 1));
  }

  /** A8 guardrails payload from wizard state (step-5 rebuild + limits modal).
   *  `composeMode`/`language` are deliberately ABSENT — the API preserves the
   *  stored riders when a payload omits them (DEC-072 / DEC-075); only the
   *  step-2 mode control and the Settings rows write them, explicitly. */
  function guardrailsPayload() {
    return {
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
    };
  }

  /** G3 (DEC-075): the step-2 mode control — writes `composeMode` onto the
   *  DRAFT guardrails immediately (the field the Settings toggle owns; one
   *  semantics). Steps already planned keep their baked mode until the next
   *  ✦ Regenerate — the control never rewrites a sequence in place. */
  async function setSequenceMode(mode: "scripted" | "guided") {
    if (!agentId || mode === composeMode) return;
    const prev = composeMode;
    setComposeMode(mode);
    try {
      await cf(`agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify({ guardrails: { ...guardrailsPayload(), composeMode: mode } }),
      });
    } catch {
      setComposeMode(prev);
      toast("Couldn't switch the composing mode — check your connection.");
    }
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

  /** W3-4 (DEC-076): the ONE write path — a graph produced by the shared core
   *  mutation helpers, PUT through the three-layer edit gate; a 422 (or a
   *  mutation refusal) surfaces as a toast, never a stuck busy state. */
  async function putGraphEdit(updated: CampaignGraph, busy: string): Promise<boolean> {
    setBusyMsg(busy);
    try {
      const row = await cf("planner/graph", {
        method: "PUT",
        body: JSON.stringify({ agentId, graph: updated }),
      });
      setGraph(updated);
      setGraphSource(row.source ?? "MANUAL");
      setGraphVersion(row.version ?? graphVersion + 1);
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the sequence — try again.");
      return false;
    } finally {
      setBusyMsg("");
    }
  }

  async function saveEditedStep() {
    if (!graph || !editNode || !agentId) return;
    // G1 (DEC-070): a guided step saves its BRIEF (bullets, never copy) —
    // content stays empty; the composer writes per-lead text at send time.
    if (editBrief) {
      if (!editBrief.objective.trim()) {
        toast("Give the step an objective — it steers every composed message.");
        return;
      }
      if (editBrief.talkingPoints.length < BRIEF_TALKING_POINTS_MIN) {
        toast(`Add at least ${BRIEF_TALKING_POINTS_MIN} talking points — the composer needs material to draw from.`);
        return;
      }
      const brief = {
        objective: editBrief.objective.trim(),
        talkingPoints: editBrief.talkingPoints,
        ...(editBrief.mustSay.length > 0 ? { mustSay: editBrief.mustSay } : {}),
        ...(editBrief.neverSay.length > 0 ? { neverSay: editBrief.neverSay } : {}),
        // G2: subject hints are email-only (layer-2 rule) — never saved on sms.
        ...(editBrief.channel === "email" && editBrief.subjectHint.trim()
          ? { subjectHint: editBrief.subjectHint.trim() }
          : {}),
      };
      let updatedGuided: CampaignGraph;
      try {
        updatedGuided = updateStepBrief(graph, editNode.id, brief);
      } catch (err) {
        toast(err instanceof GraphMutationError ? err.message : String(err));
        return;
      }
      if (await putGraphEdit(updatedGuided, "Saving step…")) {
        setEditNode(null);
        setEditBrief(null);
      }
      return;
    }
    // C2.7: custom tokens carry a MANDATORY fallback ({{custom.key|fallback}})
    // — reject at save time so a blank can never reach the send boundary.
    const missing = customTokensMissingFallback(`${editSubject} ${editBody}`);
    if (missing.length > 0) {
      toast(`Add a fallback for {{custom.${missing[0]}}} — custom tokens never render blank.`);
      return;
    }
    let updated: CampaignGraph;
    try {
      updated = updateStepContent(graph, editNode.id, { subject: editSubject, body: editBody });
    } catch (err) {
      toast(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    if (await putGraphEdit(updated, "Saving step…")) setEditNode(null);
  }

  /** G1 (DEC-070): sample preview — the api composes the CURRENT saved brief
   *  against the fixed sample lead through the real checks. A refusal is a
   *  designed display state, not an error. Free at launch (Q-020). */
  async function sampleCompose() {
    if (!agentId || !editNode || previewBusy) return;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const res = await cf("planner/compose-preview", {
        method: "POST",
        body: JSON.stringify({ agentId, stepNodeId: editNode.id }),
      });
      if (res.composed) {
        // G2: email previews carry a composed subject; per-channel credits.
        setPreview({
          kind: "composed",
          ...(res.composed.subject ? { subject: res.composed.subject } : {}),
          body: res.composed.body,
          credits: res.credits ?? (editBrief?.channel === "email" ? GUIDED_EMAIL_CREDITS : GUIDED_SMS_CREDITS),
        });
      } else if (res.refused) {
        setPreview({ kind: "refused", reason: res.refused.reason, detail: res.refused.detail ?? "" });
      }
    } catch {
      setPreview({ kind: "error", message: "Preview isn't available right now — AI composing may not be configured for this environment yet." });
    }
    setPreviewBusy(false);
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

  /** + Add step: append delay + email step before the reply branch (MANUAL
   *  version) — via the shared core mutation (W3-4: one mutation layer for
   *  both hosts; the main-sequence walk avoids the M1b strategy-step trap). */
  async function addStep() {
    if (!graph || !agentId) return;
    let result: { graph: CampaignGraph; stepId: string };
    try {
      result = addStepMutation(graph, { container: { kind: "main" }, channel: "email" });
    } catch (err) {
      toast(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    if (!(await putGraphEdit(result.graph, "Adding step…"))) return;
    const created = result.graph.nodes.find((x) => x.id === result.stepId);
    if (created && created.type === "step") {
      setEditNode(created);
      setEditBrief(null); // added steps are scripted email — never a stale brief
      setEditSubject(created.content.subject ?? "");
      setEditBody(created.content.body ?? "");
    }
  }

  async function saveDelay() {
    if (!graph || !delayEdit || !agentId) return;
    let updated: CampaignGraph;
    try {
      updated = updateDelayMutation(graph, delayEdit.id, delayAmount);
    } catch (err) {
      toast(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    if (await putGraphEdit(updated, "Saving delay…")) setDelayEdit(null);
  }

  /** W2 (#94): the creator's POST returned the persisted graph row — set it
   *  directly (the putGraphEdit pattern: no refetch race) and record the
   *  entry rule in the in-session state that feeds the branch cards. */
  function subcampaignCreated(created: SubcampaignCreated) {
    setGraph(created.graph);
    setGraphSource(created.source);
    setGraphVersion(created.version);
    setSubRules((rs) => [
      ...rs.filter((r) => r.ruleId !== created.ruleId),
      { ruleId: created.ruleId, targetNodeId: created.subcampaignId, trigger: created.trigger, ai: created.builtWithAI },
    ]);
  }

  /** W3-1: a def created inside the import flow must land in the token
   *  picker too — the same refetch the mount effect ran. */
  function refreshFieldDefs() {
    void cf("contact-fields").then(setFieldDefs).catch(() => {});
  }

  /** W3-1: the wizard's import lands in a referenceable list — with none
   *  picked, one is created from the file name at import start (name
   *  collisions get a numbered suffix; POST /lists 409s on duplicates). */
  async function ensureImportList(fileName: string): Promise<{ id: string; name: string }> {
    const base = fileName.replace(/\.[^.]+$/, "").trim().slice(0, 72) || "CSV import";
    for (let i = 0; i < 20; i += 1) {
      const listName = i === 0 ? base : `${base} (${i + 1})`;
      try {
        const created = await cf("lists", { method: "POST", body: JSON.stringify({ name: listName, origin: "csv_import" }) });
        return { id: created.id as string, name: (created.name as string) ?? listName };
      } catch (err) {
        const status = err instanceof Error ? /:\s*(\d+)$/.exec(err.message)?.[1] : null;
        if (status !== "409") throw err;
      }
    }
    throw new Error("lists: 409");
  }

  /** W3-1/W3-7: an import run finished — re-resolve the list reference from
   *  the server (count = the list's real memberCount, never a client tally)
   *  and refresh the preview sample for that list. */
  function importCompleted(listId: string | null) {
    if (!listId) return;
    void cf("lists")
      .then((ls: { id: string; name: string; memberCount: number; archived: boolean }[]) => {
        setWizardLists(ls);
        const l = ls.find((x) => x.id === listId && !x.archived);
        if (l) setCsvImport({ listId: l.id, name: l.name, count: l.memberCount });
        setListSamples((s) => {
          const next = { ...s };
          delete next[listId];
          return next;
        });
      })
      .catch(() => {});
  }

  async function addContacts(rows: Array<{ email: string; firstName?: string; lastName?: string; company?: string; phone?: string }>, src: "manual" | "csv") {
    for (const row of rows) {
      if (!row.email?.includes("@")) continue;
      try {
        const created = await cf("contacts", { method: "POST", body: JSON.stringify(row) });
        // 49-3: the source rides each entry so launch can tell the enrollment.
        // W3-7: name/company ride too — the audience-preview rows render them.
        setAdded((a) => [...a, { id: created.id, email: row.email, firstName: row.firstName, lastName: row.lastName, company: row.company, src }]);
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
    // W3-1: the CSV import's list resolves NOW too (reference, never a copy) —
    // members added to that list after the import still enroll at launch.
    if (csvImport) {
      const members = ((await cf(`contacts/view?listId=${csvImport.listId}`).catch(() => ({ rows: [] }))) as { rows: { id: string }[] }).rows;
      for (const m of members) origins.set(m.id, { kind: "csv", listId: csvImport.listId, listName: csvImport.name });
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
        body: JSON.stringify({ guardrails: guardrailsPayload() }),
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
          <Step2Sequence
            {...{ drafting, graph, graphSource, graphVersion, outcomes, seqView, setSeqView, regenError, regenerate, addStep, branchCases, windowStart, windowEnd, timezone, audienceTotal, composeMode, setSequenceMode, editNode, setEditNode, editSubject, setEditSubject, editBody, setEditBody, editBrief, setEditBrief, briefPointInput, setBriefPointInput, briefMustInput, setBriefMustInput, briefNeverInput, setBriefNeverInput, previewBusy, preview, setPreview, fieldDefs, customTokenKey, setCustomTokenKey, customFallback, setCustomFallback, delayEdit, setDelayEdit, delayAmount, setDelayAmount, editStepIndex, editStrategyIntent, insertCustomToken, saveEditedStep, sampleCompose, saveDelay, agentId, goal, emailConnected: senders.some((s) => s.type !== "TWILIO_SMS" && s.status === "ACTIVE"), subRules, subNewOpen, setSubNewOpen, subNewPrefill, setSubNewPrefill, onSubcampaignCreated: subcampaignCreated }}
          />
        ) : null}

        {step === 2 ? (
          <Step3Contacts
            {...{ importOpen, setImportOpen, csvImport, setCsvImport, importRows, isAdmin, fieldDefs, refreshFieldDefs, ensureImportList, importCompleted, listOpen, setListOpen, wizardLists, pickedList, setPickedList, listSearch, setListSearch, manualOpen, setManualOpen, manual, setManual, manualQueue, setManualQueue, addContacts, audienceTotal, audienceSample, toast, goalFit: goalFitOf(goal) }}
          />
        ) : null}

        {step === 3 ? <Step4Capture {...{ capture, setCapture, goal, goalFit: goalFitOf(goal), apSuggestions }} /> : null}

        {step === 4 ? (
          <Step5Guardrails
            {...{ senders, setSenders, dailyCap, setDailyCap, smsDailyCap, setSmsDailyCap, windowStart, setWindowStart, windowEnd, setWindowEnd, timezone, setTimezone, tzOpen, setTzOpen, sendDays, setSendDays, quietHours, setQuietHours, ramp, setRamp, limitsOpen, setLimitsOpen, connectOpen, setConnectOpen, saveLimits, toast }}
          />
        ) : null}

        {step === 5 ? <Step6Review {...{ name, graph, audienceTotal, capture, apOn: capture.ap ?? goalFitOf(goal) !== "existing_audience", sendDays, windowStart, windowEnd, timezone, dailyCap, smsDailyCap, allResolved, gapTotal, gapResolved, launch }} /> : null}
      </div>
      </div>
    </div>
  );
}
