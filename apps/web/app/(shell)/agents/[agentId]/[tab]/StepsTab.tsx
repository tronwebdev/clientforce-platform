"use client";

/**
 * Steps tab (checkpoints §4, W3-4 DEC-076) — the persisted CampaignGraph,
 * now EDITABLE per the Campaign View Steps-tab canon: add-step popover,
 * the SHARED step editor drawer (wizard step-2's component — never a fork),
 * inline delay editing, reorder + delete (designed additions — canon has no
 * such affordances; flagged in the fidelity log), and ✦ Regenerate (Create
 * Agent canon extension). Every write goes through the core mutation helpers
 * and PUT /planner/graph's three-layer edit gate; a launched agent renders
 * the DEC-076 versioning notice (in-flight enrollments finish on their
 * enrolled version — edits apply to new contacts and upcoming steps).
 * Per-step counts + outcome badges come from the F1 rollup (DEC-068).
 */
import { useEffect, useRef, useState } from "react";
import {
  addStep as addStepMutation,
  arcRoleAt,
  BRIEF_TALKING_POINTS_MIN,
  deriveBriefSeed,
  GraphMutationError,
  GUIDED_EMAIL_CREDITS,
  GUIDED_SMS_CREDITS,
  moveStep as moveStepMutation,
  removeStep as removeStepMutation,
  selectStrategy,
  setStepMode,
  subcampaignChains,
  updateDelay as updateDelayMutation,
  updateStepBrief,
  updateStepContent,
  type CampaignGraph,
  type CampaignOutcomes,
  type CampaignRuleTrigger,
  type Channel,
  type ContactFieldDefDto,
  type GraphNode,
  type StepBrief,
} from "@clientforce/core";
import { OutcomeBadge } from "../../../../../components/OutcomeBadge";
import { StepEditorDrawer } from "../../../../../components/sequence/StepEditorDrawer";
import { chainMeta, stepPillText, SubcampaignSection } from "../../../../../components/sequence/SubcampaignCards";
import { SubcampaignCreator, type SubcampaignCreated } from "../../../../../components/sequence/SubcampaignCreator";
import { GRAD, guidedCardDisplay, LIVE_GRAPH_NOTICE, type BriefDraft, type PreviewState } from "../../../../../components/sequence/shared";
import type { AgentViewData } from "./AgentView";
import { cf, intentTint } from "./shared";
import { mainPath, mainSteps, replyBranchOf, strategyChains } from "../../../../../lib/graph-path";
import { triggerChip } from "../../../../../lib/triggers";

type StepNode = Extract<GraphNode, { type: "step" }>;

/** Add-step picker rows — Campaign View canon order; live channels enable,
 *  the rest render the honest capability disclosure (never a dead pick). */
const ADD_TYPES: Array<{ channel: Channel; label: string; icon: string; chipbg: string; chipfg: string }> = [
  { channel: "email", label: "Email", icon: "✉", chipbg: "rgba(53,232,52,.13)", chipfg: "#16A82A" },
  { channel: "sms", label: "SMS", icon: "💬", chipbg: "rgba(54,215,237,.16)", chipfg: "#1192A6" },
  { channel: "whatsapp", label: "WhatsApp", icon: "🗨", chipbg: "rgba(208,245,107,.5)", chipfg: "#6B7A1F" },
  { channel: "voice", label: "Voice", icon: "☎", chipbg: "#ECE7DC", chipfg: "#0E1512" },
];

export function StepsTab({ view, outcomes, onChanged }: { view: AgentViewData | null; outcomes: CampaignOutcomes | null; onChanged?: () => Promise<void> | void }) {
  // ── editor state (the wizard orchestrator's shape — the drawer is shared) ──
  const [editNode, setEditNode] = useState<StepNode | null>(null);
  const [editStrategyIntent, setEditStrategyIntent] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editBrief, setEditBrief] = useState<BriefDraft | null>(null);
  const [briefPointInput, setBriefPointInput] = useState("");
  const [briefMustInput, setBriefMustInput] = useState("");
  const [briefNeverInput, setBriefNeverInput] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [fieldDefs, setFieldDefs] = useState<ContactFieldDefDto[]>([]);
  const [customTokenKey, setCustomTokenKey] = useState<string | null>(null);
  const [customFallback, setCustomFallback] = useState("");
  // ── W2: per-step mode flip — a STAGED mode change persists only on Save;
  // ✦ provenance derives by comparison against the seed snapshot (a field
  // stays marked while its value is still the AI-seeded/picked one). ──
  const [pendingMode, setPendingMode] = useState<"guided" | "scripted" | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const seedRef = useRef<{ objective: string; subjectHint: string; points: string[] } | null>(null);
  const draftRef = useRef<{ subject: string; body: string } | null>(null);
  // Review round (DEC-076): async compose calls are uncancellable fetches —
  // the epoch fences their resolutions so a close/reopen/flip can never let
  // one step's AI output land in another step's editor.
  const editEpochRef = useRef(0);
  const mountedRef = useRef(true);
  // ── add-step picker + inline delay editor + write plumbing ──
  const [addOpen, setAddOpen] = useState(false);
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [delayEditId, setDelayEditId] = useState<string | null>(null);
  const [delayDraft, setDelayDraft] = useState(2);
  const [busyMsg, setBusyMsg] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  // ── regenerate (B7 semantics: hold until graph OR failure, never infinite) ──
  const [drafting, setDrafting] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ── DEC-086: the canon Scripted | ✦ Guided control on the sequence header
  // (2026-07-15 Campaign View canon) — writes the SAME guardrails rider the
  // Settings toggle owns, with its full-payload preservation discipline.
  // Optimistic until the refreshed view confirms the write, then the store
  // is the only truth (rollback + visible error on failure). ──
  const [modeOverride, setModeOverride] = useState<"scripted" | "guided" | null>(null);
  // ── W2 (#94): sub-campaigns — the creator modal, the container grid's rule
  // rows (the lightweight subcampaign-rules READ; rules CRUD stays out of
  // scope), inline chain editing, and the email-connectivity honest-absence
  // input for the trigger picker. ──
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [subRules, setSubRules] = useState<Array<{ ruleId: string; targetNodeId: string; trigger: CampaignRuleTrigger }>>([]);
  const [subNewOpen, setSubNewOpen] = useState(false);
  const [subExpandedId, setSubExpandedId] = useState<string | null>(null);
  // The open editor's sub-campaign container (null = main/strategy) — sub
  // steps get no mode control (flipMode's arc seed is main-sequence-derived).
  const [editSubId, setEditSubId] = useState<string | null>(null);

  useEffect(() => {
    void cf("contact-fields").then(setFieldDefs).catch(() => {});
    // DEC-061 capability rule — sms steps are addable only with an ACTIVE Twilio sender.
    void cf("senders")
      .then((rows: Array<{ type?: string; status?: string }>) => {
        setSmsAvailable(rows.some((r) => r.type === "TWILIO_SMS" && r.status === "ACTIVE"));
        // W2 (#94): email-backed triggers need a live email sender (honest absence).
        setEmailAvailable(rows.some((r) => r.type !== "TWILIO_SMS" && r.status === "ACTIVE"));
      })
      .catch(() => {
        setSmsAvailable(false);
        setEmailAvailable(false);
      });
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // DEC-086: optimistic until the refreshed view carries the flipped rider,
  // then the store is the only truth (a Settings-tab change can never lose
  // to a stale override).
  const viewMode = view?.guardrails?.composeMode ?? "scripted";
  useEffect(() => {
    if (modeOverride && viewMode === modeOverride) setModeOverride(null);
  }, [viewMode, modeOverride]);

  // W2 (#94): the container cards' trigger chips read the enabled entry rules
  // (re-pulled on every graph version bump — creation lands as a new version).
  const rulesAgentId = view?.agent.id ?? null;
  const rulesGraphVersion = view?.graphVersion ?? 0;
  useEffect(() => {
    if (!rulesAgentId) return;
    let cancelled = false;
    cf(`planner/subcampaign-rules?agentId=${rulesAgentId}`)
      .then((rows: Array<{ ruleId: string; targetNodeId: string; trigger: CampaignRuleTrigger }>) => {
        if (!cancelled) setSubRules(rows);
      })
      .catch(() => {
        if (!cancelled) setSubRules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rulesAgentId, rulesGraphVersion]);

  if (!view) {
    return (
      <div style={{ maxWidth: 820, margin: "0 auto", paddingLeft: 48 }} data-testid="steps-skeleton">
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, background: "#F2EEE4", flex: "none" }} />
            <div style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "15px 18px" }}>
              <div style={{ height: 12, width: "30%", background: "#F2EEE4", borderRadius: 6, marginBottom: 8 }} />
              <div style={{ height: 10, width: "70%", background: "#F7F2EA", borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const graph = view.graph;
  const agentId = view.agent.id;
  if (!graph) {
    return (
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: "64px 20px", textAlign: "center" }} data-testid="steps-empty">
        <div style={{ fontSize: 26, marginBottom: 10 }}>⋔</div>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20, color: "#0E1512", marginBottom: 6 }}>No sequence yet</div>
        <div style={{ fontSize: 13.5, color: "#8A7F6B" }}>Plan the campaign from the Create Agent wizard to see its steps here.</div>
      </div>
    );
  }
  // M1b (DEC-068): the tab lists the MAIN PATH — reply-strategy steps render
  // in their own group below (they belong to the branch, not the sequence).
  // W3-4 W3: the group is CHAIN-TRUE (multi-step chains per case).
  const steps = mainSteps(graph);
  const replyBranch = replyBranchOf(graph);
  const chains = strategyChains(graph).filter((c) => c.steps.length > 0);
  const isDraft = view.agent.status === "DRAFT";
  const w = view.guardrails?.sendingWindow;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = w ? `${dayNames[(w.days[0] ?? 1) - 1]}–${dayNames[(w.days[w.days.length - 1] ?? 5) - 1]}` : "Mon–Fri";
  // G3 (DEC-075): mode applies at the NEXT plan — mismatch flips the
  // Regenerate label (one semantics with the Settings toggle, never two).
  const storedMode = view.guardrails?.composeMode ?? "scripted";
  const composeMode = modeOverride ?? storedMode;
  const guidedPlanned = steps.some((s) => s.mode === "guided");
  const modeMismatch = steps.length > 0 && (composeMode === "guided") !== guidedPlanned;
  // DEC-086: display keys off the SELECTED mode — while the plan predates a
  // guided flip, cards render the pending guided treatment (never the
  // scripted body); the banner below + "✦ Regenerate to apply" carry the
  // honesty (a mixed sequence is deliberate per-step state → baked truth).
  const pendingGuided = composeMode === "guided" && modeMismatch;

  // ── writes: core mutation → PUT through the three-layer edit gate.
  // Returns null on success, the owner-readable failure otherwise — callers
  // route it to the visible sink (page row vs. inside the open drawer). ──
  async function putGraph(updated: CampaignGraph, busy: string): Promise<string | null> {
    setBusyMsg(busy);
    try {
      await cf("planner/graph", { method: "PUT", body: JSON.stringify({ agentId, graph: updated }) });
      await onChanged?.();
      return null;
    } catch (err) {
      // The gate's 422 detail is owner-readable — surface it, never silent.
      return err instanceof Error ? err.message : String(err);
    } finally {
      setBusyMsg("");
    }
  }

  /** DEC-086: the header control's write — the SAME rider the Settings
   *  toggle owns, assembled with its full-payload preservation discipline
   *  (an edit here must never erase another surface's write); mode applies
   *  at the NEXT plan (DEC-075 semantics, byte-untouched). */
  async function setSequenceMode(mode: "scripted" | "guided") {
    if (!view || mode === composeMode) return;
    const g = view.guardrails;
    setModeOverride(mode);
    try {
      await cf(`agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          guardrails: {
            sendingWindow: g?.sendingWindow ?? { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
            dailyCap: g?.dailyCap ?? { email: 200 },
            consent: g?.consent ?? null,
            tracking: g?.tracking ?? { openTracking: true, linkTracking: true },
            ...(g?.goalLabel ? { goalLabel: g.goalLabel } : {}),
            ...(g?.strategy ? { strategy: g.strategy } : {}),
            composeMode: mode,
            ...(g?.language ? { language: g.language } : {}),
            ...(g?.language && g.languageSource ? { languageSource: g.languageSource } : {}),
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        }),
      });
      await onChanged?.();
    } catch {
      setModeOverride(null); // rollback to the stored truth — never silent
      setActionError("Couldn't switch the composing mode — check your connection.");
    }
  }

  function closeEditor() {
    editEpochRef.current += 1;
    setEditNode(null);
    setEditStrategyIntent(null);
    setEditSubId(null);
    setPendingMode(null);
    setDrawerError(null);
    seedRef.current = null;
    draftRef.current = null;
  }

  function openEditor(n: StepNode, strategyIntent: string | null, subcampaignId: string | null = null) {
    editEpochRef.current += 1;
    setEditNode(n);
    setEditStrategyIntent(strategyIntent);
    setEditSubId(subcampaignId);
    setPreview(null);
    setPendingMode(null);
    setDrawerError(null);
    seedRef.current = null;
    draftRef.current = null;
    // G1/G2: a guided step edits its BRIEF (the wizard's card seeding, verbatim).
    if (n.mode === "guided" && n.brief) {
      setEditBrief({
        channel: n.channel === "sms" ? "sms" : "email",
        objective: n.brief.objective,
        subjectHint: n.brief.subjectHint ?? "",
        talkingPoints: [...n.brief.talkingPoints],
        mustSay: [...(n.brief.mustSay ?? [])],
        neverSay: [...(n.brief.neverSay ?? [])],
      });
      setEditSubject("");
      setEditBody("");
    } else {
      setEditBrief(null);
      setEditSubject(n.content.subject ?? "");
      setEditBody(n.content.body ?? "");
    }
  }

  /** The staged brief, trimmed to the persistable shape (G2 layer-2 rules). */
  function briefPayload(): StepBrief | null {
    if (!editBrief) return null;
    if (!editBrief.objective.trim()) {
      setDrawerError("Give the step an objective — it steers every composed message.");
      return null;
    }
    if (editBrief.talkingPoints.length < BRIEF_TALKING_POINTS_MIN) {
      setDrawerError(`Add at least ${BRIEF_TALKING_POINTS_MIN} talking points — the composer needs material to draw from.`);
      return null;
    }
    return {
      objective: editBrief.objective.trim(),
      talkingPoints: editBrief.talkingPoints,
      ...(editBrief.mustSay.length > 0 ? { mustSay: editBrief.mustSay } : {}),
      ...(editBrief.neverSay.length > 0 ? { neverSay: editBrief.neverSay } : {}),
      ...(editBrief.channel === "email" && editBrief.subjectHint.trim()
        ? { subjectHint: editBrief.subjectHint.trim() }
        : {}),
    };
  }

  /** W2: the per-step scripted⇄guided flip — STAGED until Save (DEC-076). */
  async function flipMode(mode: "guided" | "scripted") {
    if (!editNode || !graph || !view) return;
    editEpochRef.current += 1;
    setDrawerError(null);
    setPreview(null);
    // Flipping BACK to the step's saved mode restores the saved values —
    // an un-flip is an undo, never a re-derivation.
    const savedMode = editNode.mode === "guided" ? "guided" : "scripted";
    if (mode === savedMode) {
      seedRef.current = null;
      draftRef.current = null;
      setPendingMode(null);
      if (savedMode === "guided" && editNode.brief) {
        setEditBrief({
          channel: editNode.channel === "sms" ? "sms" : "email",
          objective: editNode.brief.objective,
          subjectHint: editNode.brief.subjectHint ?? "",
          talkingPoints: [...editNode.brief.talkingPoints],
          mustSay: [...(editNode.brief.mustSay ?? [])],
          neverSay: [...(editNode.brief.neverSay ?? [])],
        });
        setEditSubject("");
        setEditBody("");
      } else {
        setEditBrief(null);
        setEditSubject(editNode.content.subject ?? "");
        setEditBody(editNode.content.body ?? "");
      }
      return;
    }
    if (mode === "guided") {
      // Seed the editable brief DETERMINISTICALLY from the step's own copy +
      // its M1a arc role; every seeded value renders ✦-marked until edited or
      // confirmed. The one-step compose (sandbox) proves it right below.
      const idx = steps.findIndex((s) => s.id === editNode.id) + 1;
      const arc = selectStrategy(view.agent.goal, view.agent.category ?? null).arc;
      const seed = deriveBriefSeed(editNode, arcRoleAt(arc.roles, idx, steps.length));
      const channel = editNode.channel === "sms" ? "sms" as const : "email" as const;
      seedRef.current = {
        objective: seed.objective,
        subjectHint: channel === "email" ? (seed.subjectHint ?? "") : "",
        points: [...seed.talkingPoints],
      };
      setEditBrief({
        channel,
        objective: seed.objective,
        subjectHint: channel === "email" ? (seed.subjectHint ?? "") : "",
        talkingPoints: [...seed.talkingPoints],
        mustSay: [],
        neverSay: [],
      });
      setPendingMode("guided");
      if (seed.complete) {
        // The ONE-STEP COMPOSE: the staged seed through the real sandbox
        // composer — refusal is a designed display state, never hidden.
        void sampleComposeStaged({
          objective: seed.objective,
          talkingPoints: seed.talkingPoints,
          ...(channel === "email" && seed.subjectHint ? { subjectHint: seed.subjectHint } : {}),
        });
      }
    } else {
      // guided→scripted: the step needs body copy — compose a draft (real
      // sandbox compose of the saved brief, ✦-marked) or author it.
      setEditBrief(null);
      setEditSubject("");
      setEditBody("");
      draftRef.current = null;
      setPendingMode("scripted");
    }
  }

  /** W2: one sandbox compose of the SAVED brief → scripted draft copy. */
  async function composeDraftRun() {
    if (!editNode || draftBusy) return;
    const epoch = editEpochRef.current;
    setDraftBusy(true);
    setDrawerError(null);
    try {
      const res = await cf("planner/compose-preview", {
        method: "POST",
        body: JSON.stringify({ agentId, stepNodeId: editNode.id }),
      });
      if (editEpochRef.current !== epoch) return; // editor moved on — drop the stale draft
      if (res.composed) {
        const subject = res.composed.subject ?? "";
        const body = res.composed.body ?? "";
        draftRef.current = { subject, body };
        setEditSubject(subject);
        setEditBody(body);
      } else if (res.refused) {
        setDrawerError(`Composer refused — ${res.refused.reason}${res.refused.detail ? `: ${res.refused.detail}` : ""}. Write the copy yourself, or fix the brief and retry.`);
      }
    } catch {
      if (editEpochRef.current === epoch) {
        setDrawerError("Drafting isn't available right now — AI composing may not be configured for this environment yet. You can write the copy yourself.");
      }
    } finally {
      setDraftBusy(false);
    }
  }

  async function saveEditedStep() {
    if (!editNode || !graph) return;
    setDrawerError(null);
    let updated: CampaignGraph;
    try {
      if (pendingMode === "guided") {
        const brief = briefPayload();
        if (!brief) return;
        updated = setStepMode(graph, editNode.id, { mode: "guided", brief });
      } else if (pendingMode === "scripted") {
        updated = setStepMode(graph, editNode.id, {
          mode: "scripted",
          content: { ...(editSubject.trim() ? { subject: editSubject } : {}), body: editBody },
        });
      } else if (editBrief) {
        const brief = briefPayload();
        if (!brief) return;
        updated = updateStepBrief(graph, editNode.id, brief);
      } else {
        updated = updateStepContent(graph, editNode.id, { subject: editSubject, body: editBody });
      }
    } catch (err) {
      setDrawerError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    const failure = await putGraph(updated, "Saving step…");
    if (failure) setDrawerError(failure);
    else closeEditor();
  }

  async function handleDelete() {
    if (!editNode || !graph) return;
    let updated: CampaignGraph;
    try {
      updated = removeStepMutation(graph, editNode.id);
    } catch (err) {
      // The drawer overlay covers the page rows — refusals surface IN it.
      setDrawerError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    const failure = await putGraph(updated, "Deleting step…");
    if (failure) setDrawerError(failure);
    else closeEditor();
  }

  async function handleMove(stepId: string, direction: "up" | "down") {
    if (!graph) return;
    let updated: CampaignGraph;
    try {
      updated = moveStepMutation(graph, stepId, direction);
    } catch (err) {
      setActionError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    setActionError(await putGraph(updated, "Reordering…"));
  }

  async function handleAdd(channel: Channel) {
    if (!graph) return;
    setAddOpen(false);
    let result: { graph: CampaignGraph; stepId: string };
    try {
      result = addStepMutation(graph, { container: { kind: "main" }, channel });
    } catch (err) {
      setActionError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    const failure = await putGraph(result.graph, "Adding step…");
    if (failure) {
      setActionError(failure);
      return;
    }
    const created = result.graph.nodes.find((x) => x.id === result.stepId);
    if (created && created.type === "step") openEditor(created, null);
  }

  /** W3: append a step to a reply-strategy CHAIN (branch-case container).
   *  Chain steps are threaded email replies — the strategy contract. */
  async function handleAddToChain(branchId: string, intent: string) {
    if (!graph || !branchId) return;
    let result: { graph: CampaignGraph; stepId: string };
    try {
      result = addStepMutation(graph, {
        container: { kind: "case", branchId, caseKey: intent },
        channel: "email",
        content: { body: "One more thought on this, {{firstName}} —", threaded: true },
      });
    } catch (err) {
      setActionError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    const failure = await putGraph(result.graph, "Adding step…");
    if (failure) {
      setActionError(failure);
      return;
    }
    const created = result.graph.nodes.find((x) => x.id === result.stepId);
    if (created && created.type === "step") openEditor(created, intent);
  }

  /** W2 (#94): append a step to a sub-campaign container's chain — the same
   *  addStep mutation with the subcampaign container, through the same gate. */
  async function handleAddToSub(subcampaignId: string) {
    if (!graph) return;
    let result: { graph: CampaignGraph; stepId: string };
    try {
      result = addStepMutation(graph, { container: { kind: "subcampaign", subcampaignId }, channel: "email" });
    } catch (err) {
      setActionError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    const failure = await putGraph(result.graph, "Adding step…");
    if (failure) {
      setActionError(failure);
      return;
    }
    const created = result.graph.nodes.find((x) => x.id === result.stepId);
    if (created && created.type === "step") openEditor(created, null, subcampaignId);
  }

  async function saveDelay(delayId: string) {
    if (!graph) return;
    let updated: CampaignGraph;
    try {
      updated = updateDelayMutation(graph, delayId, delayDraft);
    } catch (err) {
      setActionError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    const failure = await putGraph(updated, "Saving delay…");
    if (failure) setActionError(failure);
    else setDelayEditId(null);
  }

  /** ✦ Regenerate — the existing planner path (composeMode picks the pinned
   *  scripted/guided prompt server-side; the UI hardcodes no version).
   *  DEC-038/047 semantics: hold until a NEWER version or a failure. */
  async function regenerate() {
    if (drafting) return;
    setDrafting(true);
    setRegenError(null);
    try {
      await cf("planner/plan", { method: "POST", body: JSON.stringify({ agentId }) });
    } catch (err) {
      setDrafting(false);
      setRegenError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!mountedRef.current) return; // unmounted mid-POST — never arm a leaked poll
    const before = view?.graphVersion ?? 0;
    pollRef.current = setInterval(async () => {
      try {
        const res = await cf(`planner/graph?agentId=${agentId}`);
        if (res.graph?.graph && (res.graph.version ?? 0) > before) {
          if (pollRef.current) clearInterval(pollRef.current);
          setDrafting(false);
          await onChanged?.();
          return;
        }
      } catch {
        /* keep polling */
      }
      try {
        const st = await cf(`planner/status?agentId=${agentId}`);
        if (st.state === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setDrafting(false);
          setRegenError(typeof st.failedReason === "string" ? st.failedReason : "");
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
  }

  /** W2: samples compose the STAGED brief (what the owner SEES), through the
   *  real sandbox checks — a refusal is a designed display state. */
  async function sampleComposeStaged(staged: StepBrief | null) {
    const node = editNode;
    if (!node || previewBusy) return;
    const epoch = editEpochRef.current;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const res = await cf("planner/compose-preview", {
        method: "POST",
        body: JSON.stringify({ agentId, stepNodeId: node.id, ...(staged ? { brief: staged } : {}) }),
      });
      if (editEpochRef.current !== epoch) return; // editor moved on — drop the stale preview
      if (res.composed) {
        setPreview({
          kind: "composed",
          ...(res.composed.subject ? { subject: res.composed.subject } : {}),
          body: res.composed.body,
          credits: res.credits ?? (node.channel === "sms" ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS),
        });
      } else if (res.refused) {
        setPreview({ kind: "refused", reason: res.refused.reason, detail: res.refused.detail ?? "" });
      }
    } catch {
      if (editEpochRef.current === epoch) {
        setPreview({ kind: "error", message: "Preview isn't available right now — AI composing may not be configured for this environment yet." });
      }
    } finally {
      setPreviewBusy(false);
    }
  }

  async function sampleCompose() {
    if (!editNode || !editBrief) return;
    if (editBrief.talkingPoints.length < BRIEF_TALKING_POINTS_MIN || !editBrief.objective.trim()) {
      setPreview({ kind: "error", message: `The brief needs an objective and at least ${BRIEF_TALKING_POINTS_MIN} talking points before a sample can compose.` });
      return;
    }
    await sampleComposeStaged({
      objective: editBrief.objective.trim(),
      talkingPoints: editBrief.talkingPoints,
      ...(editBrief.mustSay.length > 0 ? { mustSay: editBrief.mustSay } : {}),
      ...(editBrief.neverSay.length > 0 ? { neverSay: editBrief.neverSay } : {}),
      ...(editBrief.channel === "email" && editBrief.subjectHint.trim() ? { subjectHint: editBrief.subjectHint.trim() } : {}),
    });
  }

  /** C2.7: insert `{{custom.<key>|fallback}}` — only ever with the fallback. */
  function insertCustomToken() {
    const fb = customFallback.trim();
    if (!customTokenKey || !fb) return;
    const token = `{{custom.${customTokenKey}|${fb}}}`;
    setEditBody((b) => (b ? `${b} ${token}` : token));
    setCustomTokenKey(null);
    setCustomFallback("");
  }

  // W2 (#94): sub-campaign chains — containers + rule chips + inline editing.
  const subChains = subcampaignChains(graph);
  const subCards = subChains.map(({ node, chain }) => {
    const meta = chainMeta(chain);
    const rule = subRules.find((r) => r.targetNodeId === node.id);
    return {
      id: node.id,
      name: node.ref,
      // "Rule pending" fallback when no enabled rule row matches (honest absence).
      chip: rule ? triggerChip(rule.trigger) : null,
      pills: meta.steps.map(stepPillText),
      stepCount: meta.steps.length,
      days: meta.days,
    };
  });
  const expandedSub = subExpandedId ? subChains.find((s) => s.node.id === subExpandedId) : undefined;

  const editStepIndex = editNode
    ? editSubId
      ? (subChains
          .find((s) => s.node.id === editSubId)
          ?.chain.filter((n): n is StepNode => n.type === "step")
          .findIndex((s) => s.id === editNode.id) ?? -1) + 1
      : steps.findIndex((s) => s.id === editNode.id) + 1
    : 0;

  /** Delay row (Campaign View canon: pill → inline − / amount / + / Done,
   *  clamp 1–30) — shared by the main path and W3's strategy chains. */
  function renderDelayRow(n: Extract<GraphNode, { type: "delay" }>, indent: number, tidPrefix: string) {
    const editing = delayEditId === n.id;
    return (
      <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: `4px 0 4px ${indent}px` }}>
        <span style={{ width: 2, height: 32, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
        {editing ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 100, padding: "4px 6px 4px 14px" }} data-testid={`${tidPrefix}-editor`}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#8A7F6B" }}>⏱ Wait</span>
            <span onClick={() => setDelayDraft((v) => Math.max(1, v - 1))} style={{ width: 24, height: 24, borderRadius: "50%", background: "#F2EEE4", color: "#5C6B62", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, cursor: "pointer" }} data-testid={`${tidPrefix}-dec`}>−</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1512", minWidth: 48, textAlign: "center" }}>{delayDraft} {delayDraft === 1 ? n.unit.replace(/s$/, "") : n.unit}</span>
            {/* clamp cap honors a stored amount above the canon's 30 (planner
                emits 14–45d re-engagement waits) — + never snaps a wait down */}
            <span onClick={() => setDelayDraft((v) => Math.min(Math.max(30, n.amount), v + 1))} style={{ width: 24, height: 24, borderRadius: "50%", background: "#F2EEE4", color: "#5C6B62", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, cursor: "pointer" }} data-testid={`${tidPrefix}-inc`}>+</span>
            <span onClick={() => void saveDelay(n.id)} style={{ fontSize: 12.5, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 100, padding: "5px 13px", cursor: "pointer" }} data-testid={`${tidPrefix}-done`}>Done</span>
          </span>
        ) : (
          <span onClick={() => { setDelayEditId(n.id); setDelayDraft(n.amount); setAddOpen(false); }} style={{ fontSize: 13, fontWeight: 600, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "5px 14px", cursor: "pointer" }} data-testid={tidPrefix}>⏱ Wait {n.amount} {n.amount === 1 ? n.unit.replace(/s$/, "") : n.unit} <span style={{ color: "#B6AB97", fontSize: 11 }}>✎</span></span>
        )}
      </div>
    );
  }

  // W2 ✦ provenance: a field stays marked while its value is still the
  // seeded/composed one — editing it clears the mark; Save confirms the rest.
  const seedMarks = (() => {
    if (editBrief && seedRef.current) {
      const s = seedRef.current;
      return {
        objective: editBrief.objective === s.objective,
        subjectHint: s.subjectHint !== "" && editBrief.subjectHint === s.subjectHint,
        points: editBrief.talkingPoints.map((p) => s.points.includes(p)),
      };
    }
    if (!editBrief && draftRef.current) {
      const d = draftRef.current;
      return {
        subject: d.subject !== "" && editSubject === d.subject,
        body: d.body !== "" && editBody === d.body,
      };
    }
    return undefined;
  })();

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", paddingLeft: 48 }} data-testid="steps">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: "#0E1512" }}>Main sequence</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#9AA59E" }}> · {steps.length} steps · Email</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {/* DEC-086: the canon Scripted | ✦ Guided control (2026-07-15
              Campaign View canon) — persisted selected state from the
              stored rider; one field, one semantics with Settings. */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, background: "#F2EEE4", borderRadius: 11, padding: 3 }} data-testid="steps-mode-control">
            <span onClick={() => void setSequenceMode("scripted")} style={{ fontSize: 12.5, fontWeight: composeMode === "guided" ? 600 : 700, color: composeMode === "guided" ? "#8A7F6B" : "#0E1512", background: composeMode === "guided" ? "transparent" : "#fff", boxShadow: composeMode === "guided" ? "none" : "0 1px 4px rgba(14,21,18,.1)", borderRadius: 9, padding: "6px 13px", cursor: "pointer", whiteSpace: "nowrap" }} data-testid="steps-mode-scripted">Scripted</span>
            <span onClick={() => void setSequenceMode("guided")} style={{ fontSize: 12.5, fontWeight: composeMode === "guided" ? 700 : 600, color: composeMode === "guided" ? "#0E1512" : "#8A7F6B", background: composeMode === "guided" ? "#fff" : "transparent", boxShadow: composeMode === "guided" ? "0 1px 4px rgba(14,21,18,.1)" : "none", borderRadius: 9, padding: "6px 13px", cursor: "pointer", whiteSpace: "nowrap" }} data-testid="steps-mode-guided"><span style={{ color: "#1192A6" }}>✦</span> Guided</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 15px" }}>
            🕐 {days} · {w ? `${w.start}–${w.end}` : "9:00–17:00"} · {w?.timezone ?? "UTC"} ⌄
          </span>
          {/* W3-4: whole-sequence Regenerate in the agent view (Create Agent
              canon extension, flagged) — carries the G3 mismatch affordance. */}
          <span onClick={() => void regenerate()} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: drafting ? "#9AA59E" : "#16A82A", background: drafting ? "#F2EEE4" : "rgba(53,232,52,.1)", border: `1px solid ${drafting ? "#EBE3D6" : "rgba(53,232,52,.3)"}`, borderRadius: 11, padding: "9px 15px", cursor: drafting ? "default" : "pointer", whiteSpace: "nowrap" }} data-testid="steps-regenerate">
            {drafting ? "✦ Drafting…" : modeMismatch ? "✦ Regenerate to apply" : "✦ Regenerate with AI"}
          </span>
        </span>
      </div>

      {/* W3-4 (DEC-076): the honest versioning banner on any launched agent */}
      {!isDraft ? (
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: "#5C6B62", background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 14px", marginBottom: 14, lineHeight: 1.5 }} data-testid="live-graph-banner">
          <span style={{ flex: "none" }}>⏱</span>
          <span>{LIVE_GRAPH_NOTICE}</span>
        </div>
      ) : null}

      {/* DEC-086: the guided explainer (2026-07-15 Campaign View canon —
          renders whenever guided is selected); the mismatch line rides it
          only while planned steps predate the flip (wizard parity). Canon's
          WhatsApp/voice sentence stays dropped — the build plans email +
          SMS only this phase (the DEC-075 honest absence, restated). */}
      {composeMode === "guided" ? (
        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: "#5C6B62", background: "rgba(54,215,237,.07)", border: "1px solid rgba(54,215,237,.25)", borderRadius: 11, padding: "11px 14px", marginBottom: 14, lineHeight: 1.5 }} data-testid="steps-guided-banner">
          <span style={{ flex: "none", color: "#1192A6", fontSize: 14 }}>✦</span>
          <span>
            Email and SMS steps carry a <strong style={{ color: "#0E1512" }}>brief</strong> instead of fixed copy — the AI composes a fresh message per lead at send time, inside your rails.
            {pendingGuided ? <span data-testid="steps-regen-to-apply-note"> <b>These steps were planned as scripted</b> — hit ✦ Regenerate to apply guided composing.</span> : null}
          </span>
        </div>
      ) : null}

      {/* B7: regenerate failed — inline error row with Retry (never silent) */}
      {regenError !== null ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid rgba(224,121,107,.4)", background: "rgba(224,121,107,.06)", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }} data-testid="steps-regen-failed">
          <span style={{ fontSize: 14, color: "#C9543F", flex: "none" }}>⚠</span>
          <span style={{ fontSize: 12.5, color: "#8A7F6B", flex: 1, minWidth: 0 }}>Sequence generation failed{regenError ? ` — ${regenError.slice(0, 200)}` : ""}</span>
          <span onClick={() => void regenerate()} style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", cursor: "pointer", flex: "none" }} data-testid="steps-regen-retry">Retry</span>
        </div>
      ) : null}

      {/* edit-gate rejections + mutation refusals — owner-readable, dismissible */}
      {actionError !== null ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid rgba(224,121,107,.4)", background: "rgba(224,121,107,.06)", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }} data-testid="steps-edit-error">
          <span style={{ fontSize: 14, color: "#C9543F", flex: "none" }}>⚠</span>
          <span style={{ fontSize: 12.5, color: "#8A7F6B", flex: 1, minWidth: 0 }}>{actionError.slice(0, 300)}</span>
          <span onClick={() => setActionError(null)} style={{ fontSize: 12, fontWeight: 700, color: "#5C6B62", cursor: "pointer", flex: "none" }} data-testid="steps-edit-error-dismiss">Dismiss</span>
        </div>
      ) : null}

      {drafting ? (
        <div style={{ border: "1px solid rgba(53,232,52,.32)", borderRadius: 13, background: "rgba(53,232,52,.04)", padding: "42px 24px", textAlign: "center" }} data-testid="steps-drafting">
          <div style={{ fontSize: 26, marginBottom: 10 }}>✦</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 4 }}>Drafting your sequence…</div>
          <div style={{ fontSize: 13, color: "#8A7F6B" }}>Claude is planning steps grounded in your business context.</div>
        </div>
      ) : (
      <>
      {mainPath(graph).map((n) => {
        if (n.type === "delay") {
          return renderDelayRow(n, 26, "step-delay");
        }
        if (n.type === "step") {
          const idx = steps.indexOf(n) + 1;
          // G1 (DEC-070): a guided step renders its BRIEF, not copy.
          // DEC-086: resolved from the SELECTED mode too — a scripted plan
          // under a guided rider renders the pending treatment, never the body.
          const gd = guidedCardDisplay(n, pendingGuided, { index: idx, count: steps.length }, { goal: view.agent.goal, category: view.agent.category ?? null });
          const o = outcomes?.steps.find((s) => s.stepNodeId === n.id);
          const sent = o?.sent ?? view.perStep[n.id]?.sent ?? 0;
          const replies = o?.replies ?? 0;
          return (
            <div key={n.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }} data-testid="step-card">
              {/* P2.1 (DEC-061, §3/§4 amendment): ChannelChip anatomy — sms steps
                  reuse the same card with channel-true icon + chip tint. */}
              <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: n.channel === "sms" ? "rgba(54,215,237,.16)" : "rgba(53,232,52,.16)", color: n.channel === "sms" ? "#1192A6" : "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>{n.channel === "sms" ? "💬" : "✉"}</span>
              <div style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "15px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#8A7F6B" }}>Step {idx}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: n.channel === "sms" ? "rgba(54,215,237,.14)" : "rgba(53,232,52,.13)", color: n.channel === "sms" ? "#1192A6" : "#16A82A" }} data-testid="step-channel-chip">{n.channel === "sms" ? "SMS" : "Email"}</span>
                  {gd && gd.kind !== "aidraft" ? (
                    <>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 7, padding: "3px 9px" }} data-testid="step-guided-tag">✦ Composed at send</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 7, padding: "3px 9px" }} data-testid="step-guided-credits">{n.channel === "sms" ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS} credits / send</span>
                    </>
                  ) : gd?.kind === "aidraft" ? (
                    // DEC-086 canon mapping: a non-briefable channel under a
                    // guided rider stays as written — tagged "✦ AI draft".
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 7, padding: "3px 9px" }} data-testid="step-aidraft-tag">✦ AI draft</span>
                  ) : null}
                  {/* F1 (DEC-068): outcome badge — none renders nothing (honest absence) */}
                  <OutcomeBadge step={o} />
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#9AA59E" }} data-testid="step-stats">
                    {sent > 0 ? `${sent} sent · ${replies} repl${replies === 1 ? "y" : "ies"}` : "0 sent"}
                  </span>
                  {/* W3-4: reorder — designed addition (canon has no reorder). */}
                  <span onClick={idx > 1 ? () => void handleMove(n.id, "up") : undefined} style={{ fontSize: 13, color: idx > 1 ? "#5C6B62" : "#D8CFBE", cursor: idx > 1 ? "pointer" : "default", flex: "none" }} data-testid="step-move-up">↑</span>
                  <span onClick={idx < steps.length ? () => void handleMove(n.id, "down") : undefined} style={{ fontSize: 13, color: idx < steps.length ? "#5C6B62" : "#D8CFBE", cursor: idx < steps.length ? "pointer" : "default", flex: "none" }} data-testid="step-move-down">↓</span>
                  {/* Campaign View canon: the green ✎ Edit link is the click
                      target — W2: guided briefs edit here too (the wizard
                      brief editor, same component). */}
                  <span onClick={() => openEditor(n, null)} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", cursor: "pointer", flex: "none" }} data-testid="step-edit">✎ Edit</span>
                </div>
                {gd?.kind === "brief" ? (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#0E1512", marginBottom: 5 }}>{gd.brief.objective}</div>
                    {n.channel === "email" && gd.brief.subjectHint ? (
                      <div style={{ fontSize: 12.5, color: "#8A7F6B", marginBottom: 5 }} data-testid="step-brief-subject-hint">Subject hint: <span style={{ color: "#5C6B62", fontWeight: 600 }}>{gd.brief.subjectHint}</span></div>
                    ) : null}
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }} data-testid="step-brief-points">
                      {gd.brief.talkingPoints.map((p, i) => (
                        <div key={i} style={{ fontSize: 13, color: "#5C6B62", lineHeight: 1.45, display: "flex", gap: 8 }}>
                          <span style={{ color: "#1192A6", flex: "none" }}>•</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : gd?.kind === "pending" ? (
                  <>
                    {/* DEC-086: canon guided preview — "Objective: …", never
                        the scripted body while guided is selected. */}
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#0E1512", marginBottom: 4 }}>{n.channel === "sms" ? "SMS message" : n.content.subject}</div>
                    <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} data-testid="step-brief-pending">Objective: {gd.objective}</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#0E1512", marginBottom: 4 }}>{n.channel === "sms" ? "SMS message" : n.content.subject}</div>
                    <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.content.body}</div>
                  </>
                )}
              </div>
            </div>
          );
        }
        if (n.type === "branch") {
          return (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0 4px 26px" }}>
              <span style={{ width: 2, height: 24, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid rgba(54,215,237,.4)", borderRadius: 100, background: "rgba(54,215,237,.08)", padding: "5px 14px", fontSize: 12.5, fontWeight: 600, color: "#1192A6" }} data-testid="step-branch">
                {/* M1b (DEC-068): vocabulary labels, verbatim fallback for unknown intents */}
                ⎇ on reply → {n.cases.map((c) => (c.when === "default" ? "default" : intentTint(c.when.intent).label)).join(" · ")}
              </span>
            </div>
          );
        }
        return null;
      })}

      {/* W3-4: add-step — Campaign View canon (dashed button + anchored 236px
          "Choose a step type" popover; append wait-2-days + step, editor opens
          on the new step). Live channels enable; the rest disclose honestly. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, paddingLeft: 26, marginTop: 4 }}>
        <span style={{ width: 2, height: 24, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
        <div style={{ position: "relative" }}>
          <span onClick={() => { setAddOpen((v) => !v); setDelayEditId(null); }} style={{ fontSize: 14, fontWeight: 600, color: "#16A82A", background: "#fff", border: "1.5px dashed #9FD8AC", borderRadius: 11, padding: "10px 18px", cursor: "pointer", display: "inline-block" }} data-testid="add-step">+ Add step</span>
          {addOpen ? (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, width: 236, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", zIndex: 20 }} data-testid="add-step-picker">
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#9AA59E", padding: "11px 15px 7px" }}>Choose a step type</div>
              {ADD_TYPES.map((o) => {
                const enabled = o.channel === "email" || (o.channel === "sms" && smsAvailable);
                const note =
                  o.channel === "sms" && !enabled
                    ? "Connect a Twilio sender first"
                    : o.channel === "whatsapp"
                      ? "Arrives with the WhatsApp channel"
                      : o.channel === "voice"
                        ? "Arrives with the voice channel"
                        : null;
                return (
                  <div key={o.channel} onClick={enabled ? () => void handleAdd(o.channel) : undefined} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 15px", cursor: enabled ? "pointer" : "default", borderTop: "1px solid #F7F2EA", opacity: enabled ? 1 : 0.55 }} data-testid={`add-step-${o.channel}`}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, flex: "none", background: o.chipbg, color: o.chipfg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>{o.icon}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{o.label}</span>
                      {note ? <span style={{ display: "block", fontSize: 11, color: "#9AA59E" }}>{note}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        {busyMsg ? <span style={{ fontSize: 12.5, color: "#8A7F6B", alignSelf: "center" }} data-testid="steps-busy">{busyMsg}</span> : null}
      </div>

      {/* M1b (DEC-068) / W3-4 W3: reply-strategy CHAINS — grouped under the
          branch they belong to, labeled by intent, chain-true (multi-step
          chains within a branch render and edit; the standing W3-4 gap).
          Mutations resolve their branch-case container by node id; reply
          strategies stay scripted this phase (DEC-070(7)) so chain steps
          carry no mode control. */}
      {chains.length > 0 ? (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", margin: "24px 0 12px" }} data-testid="strategy-group">
            Reply strategies · sent when a reply classifies
          </div>
          {chains.map(({ intent, chain, steps: chainSteps }) => {
            const tint = intentTint(intent);
            const branchId = replyBranch?.id ?? "";
            return (
              <div key={intent} style={{ marginBottom: 14 }} data-testid="strategy-chain">
                {chain.map((cNode) => {
                  if (cNode.type === "delay") {
                    return renderDelayRow(cNode, 24, "strategy-delay");
                  }
                  if (cNode.type !== "step") return null;
                  const sNode = cNode;
                  const k = chainSteps.findIndex((s) => s.id === sNode.id) + 1;
                  const stats = view.perStep[sNode.id];
                  return (
                    <div key={sNode.id} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 6 }} data-testid="strategy-step-card">
                      <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>↩</span>
                      <div style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "15px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: tint.fg }}>{tint.label}{chainSteps.length > 1 ? ` · step ${k} of ${chainSteps.length}` : ""}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: "rgba(53,232,52,.13)", color: "#16A82A" }}>Email · threaded</span>
                          <span style={{ marginLeft: "auto", fontSize: 12, color: "#9AA59E" }} data-testid="strategy-step-stats">
                            {stats ? `${stats.sent} sent · ${stats.replies} repl${stats.replies === 1 ? "y" : "ies"}` : "0 sent"}
                          </span>
                          {chainSteps.length > 1 ? (
                            <>
                              <span onClick={k > 1 ? () => void handleMove(sNode.id, "up") : undefined} style={{ fontSize: 13, color: k > 1 ? "#5C6B62" : "#D8CFBE", cursor: k > 1 ? "pointer" : "default", flex: "none" }} data-testid="strategy-step-move-up">↑</span>
                              <span onClick={k < chainSteps.length ? () => void handleMove(sNode.id, "down") : undefined} style={{ fontSize: 13, color: k < chainSteps.length ? "#5C6B62" : "#D8CFBE", cursor: k < chainSteps.length ? "pointer" : "default", flex: "none" }} data-testid="strategy-step-move-down">↓</span>
                            </>
                          ) : null}
                          <span onClick={() => openEditor(sNode, intent)} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", cursor: "pointer", flex: "none" }} data-testid="strategy-step-edit">✎ Edit</span>
                        </div>
                        <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{sNode.content.body}</div>
                      </div>
                    </div>
                  );
                })}
                {/* within-branch add — the sub-campaign drawer's indented
                    dashed "+ Add step" anatomy; chain steps are threaded
                    email replies (the strategy contract). */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 24, marginTop: 2 }}>
                  <span style={{ width: 2, height: 18, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
                  <span onClick={() => void handleAddToChain(branchId, intent)} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", background: "#fff", border: "1.5px dashed #9FD8AC", borderRadius: 10, padding: "7px 12px", cursor: "pointer" }} data-testid={`strategy-add-step-${intent}`}>+ Add step</span>
                </div>
              </div>
            );
          })}

        </>
      ) : null}

      {/* W2 (#94): sub-campaigns — the W3-4 honest-absence card goes LIVE
          (R1's trigger vocabulary shipped). Canon cards in a 2-col grid with
          the entry-rule trigger chip, then the dashed add card opening the
          shared creator. Rendered outside the reply-chains block — containers
          exist independently of reply strategies. NO ✦ AI chip here:
          provenance isn't persisted, so the canon chip awaits a persisted
          provenance field (DEC note) — never rendered from guesswork. */}
      <SubcampaignSection
        cards={subCards}
        expandedId={subExpandedId}
        onEdit={(id) => setSubExpandedId((v) => (v === id ? null : id))}
        onAdd={() => setSubNewOpen(true)}
        expanded={
          expandedSub ? (
            <div style={{ marginTop: 12 }} data-testid="subcampaign-expanded">
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>
                {expandedSub.node.ref} · steps
              </div>
              {expandedSub.chain.map((cNode) => {
                if (cNode.type === "delay") return renderDelayRow(cNode, 24, "sub-delay");
                if (cNode.type !== "step") return null;
                const sNode = cNode;
                const k =
                  expandedSub.chain.filter((n): n is StepNode => n.type === "step").findIndex((s) => s.id === sNode.id) + 1;
                const stats = view.perStep[sNode.id];
                return (
                  <div key={sNode.id} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 6 }} data-testid="subcampaign-step-card">
                    <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: sNode.channel === "sms" ? "rgba(54,215,237,.16)" : "rgba(53,232,52,.16)", color: sNode.channel === "sms" ? "#1192A6" : "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>{sNode.channel === "sms" ? "💬" : "✉"}</span>
                    <div style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "15px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#8A7F6B" }}>Step {k}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: sNode.channel === "sms" ? "rgba(54,215,237,.14)" : "rgba(53,232,52,.13)", color: sNode.channel === "sms" ? "#1192A6" : "#16A82A" }}>{sNode.channel === "sms" ? "SMS" : sNode.content.threaded ? "Email · threaded" : "Email"}</span>
                        <span style={{ marginLeft: "auto", fontSize: 12, color: "#9AA59E" }} data-testid="subcampaign-step-stats">
                          {stats ? `${stats.sent} sent · ${stats.replies} repl${stats.replies === 1 ? "y" : "ies"}` : "0 sent"}
                        </span>
                        <span onClick={() => openEditor(sNode, null, expandedSub.node.id)} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", cursor: "pointer", flex: "none" }} data-testid="subcampaign-step-edit">✎ Edit</span>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#0E1512", marginBottom: 4 }}>{sNode.mode === "guided" && sNode.brief ? sNode.brief.objective : sNode.channel === "sms" ? "SMS message" : (sNode.content.subject ?? "Threaded reply")}</div>
                      <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{sNode.mode === "guided" && sNode.brief ? sNode.brief.talkingPoints.join(" · ") : sNode.content.body}</div>
                    </div>
                  </div>
                );
              })}
              {/* within-container add — the canon sub-drawer's indented dashed anatomy */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 24, marginTop: 2 }}>
                <span style={{ width: 2, height: 18, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
                <span onClick={() => void handleAddToSub(expandedSub.node.id)} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", background: "#fff", border: "1.5px dashed #9FD8AC", borderRadius: 10, padding: "7px 12px", cursor: "pointer" }} data-testid="subcampaign-add-step">+ Add step</span>
              </div>
            </div>
          ) : null
        }
      />

      <div style={{ fontSize: 12, color: "#9AA59E", marginTop: 16, paddingLeft: 48 }}>
        Graph v{view.graphVersion ?? "—"} · {view.graphSource === "MANUAL" ? "edited — new version saved (MANUAL)" : "AI-planned"}
      </div>
      </>
      )}

      {/* W3-4: the SHARED step editor drawer (wizard step-2's component) —
          W2 adds the per-step mode override, ✦ seed provenance (marks derive
          by comparison with the seed snapshot) and the guided→scripted
          compose-a-draft path. */}
      <StepEditorDrawer
        editNode={editNode}
        editStepIndex={editStepIndex}
        editStrategyIntent={editStrategyIntent}
        editSubject={editSubject}
        setEditSubject={setEditSubject}
        editBody={editBody}
        setEditBody={setEditBody}
        editBrief={editBrief}
        setEditBrief={setEditBrief}
        briefPointInput={briefPointInput}
        setBriefPointInput={setBriefPointInput}
        briefMustInput={briefMustInput}
        setBriefMustInput={setBriefMustInput}
        briefNeverInput={briefNeverInput}
        setBriefNeverInput={setBriefNeverInput}
        previewBusy={previewBusy}
        preview={preview}
        fieldDefs={fieldDefs}
        customTokenKey={customTokenKey}
        setCustomTokenKey={setCustomTokenKey}
        customFallback={customFallback}
        setCustomFallback={setCustomFallback}
        insertCustomToken={insertCustomToken}
        sampleCompose={sampleCompose}
        onClose={closeEditor}
        onSave={saveEditedStep}
        onDelete={handleDelete}
        liveNotice={!isDraft}
        modeControl={
          // W2 (#94): sub-campaign chain steps carry no mode control — the
          // flip's brief seed derives from the MAIN sequence's arc position.
          editNode && editStrategyIntent === null && editSubId === null && (editNode.channel === "email" || editNode.channel === "sms")
            ? {
                mode: pendingMode ?? (editNode.mode === "guided" ? "guided" : "scripted"),
                busy: busyMsg !== "",
                onFlip: (m) => void flipMode(m),
              }
            : undefined
        }
        seedMarks={seedMarks}
        composeDraft={pendingMode === "scripted" ? { busy: draftBusy, run: () => void composeDraftRun() } : undefined}
        scriptedEmptyNote={
          pendingMode === "scripted"
            ? "This step has no written copy yet — scripted steps send exactly what you save. Compose a draft with AI (marked until you edit or confirm it) or write it below."
            : undefined
        }
        footerError={drawerError}
      />

      {/* W2 (#94): the SHARED sub-campaign creator (one component, two hosts
          — host deltas ride props). Launched agents render the DEC-076
          notice inside it (isDraft); lead capture has no backend in P1 →
          honest false. */}
      <SubcampaignCreator
        open={subNewOpen}
        onClose={() => setSubNewOpen(false)}
        agentId={agentId}
        isDraft={isDraft}
        cf={cf}
        connected={{ email: emailAvailable, leadCapture: false }}
        goal={view.agent.goal ?? null}
        onCreated={(created: SubcampaignCreated) => {
          // The rule row is known from the response — no refetch race; the
          // graph re-pull (onChanged) brings the new container into view.
          setSubRules((rs) => [
            ...rs.filter((r) => r.ruleId !== created.ruleId),
            { ruleId: created.ruleId, targetNodeId: created.subcampaignId, trigger: created.trigger },
          ]);
          void onChanged?.();
        }}
      />

    </div>
  );
}
