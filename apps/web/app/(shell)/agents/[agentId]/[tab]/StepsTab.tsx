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
  GraphMutationError,
  GUIDED_EMAIL_CREDITS,
  GUIDED_SMS_CREDITS,
  moveStep as moveStepMutation,
  removeStep as removeStepMutation,
  updateDelay as updateDelayMutation,
  updateStepContent,
  type CampaignGraph,
  type CampaignOutcomes,
  type Channel,
  type ContactFieldDefDto,
  type GraphNode,
} from "@clientforce/core";
import { OutcomeBadge } from "../../../../../components/OutcomeBadge";
import { StepEditorDrawer } from "../../../../../components/sequence/StepEditorDrawer";
import { GRAD, LIVE_GRAPH_NOTICE, type BriefDraft, type PreviewState } from "../../../../../components/sequence/shared";
import type { AgentViewData } from "./AgentView";
import { cf, intentTint } from "./shared";
import { mainPath, mainSteps, strategyStepsOf } from "../../../../../lib/graph-path";

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
  // ── G3 read-only brief viewer (guided steps stay view-only until W2) ──
  const [briefNode, setBriefNode] = useState<StepNode | null>(null);
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

  useEffect(() => {
    void cf("contact-fields").then(setFieldDefs).catch(() => {});
    // DEC-061 capability rule — sms steps are addable only with an ACTIVE Twilio sender.
    void cf("senders")
      .then((rows: Array<{ type?: string; status?: string }>) =>
        setSmsAvailable(rows.some((r) => r.type === "TWILIO_SMS" && r.status === "ACTIVE")),
      )
      .catch(() => setSmsAvailable(false));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
  const steps = mainSteps(graph);
  const strategies = strategyStepsOf(graph);
  const isDraft = view.agent.status === "DRAFT";
  const w = view.guardrails?.sendingWindow;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = w ? `${dayNames[(w.days[0] ?? 1) - 1]}–${dayNames[(w.days[w.days.length - 1] ?? 5) - 1]}` : "Mon–Fri";
  // G3 (DEC-075): mode applies at the NEXT plan — mismatch flips the
  // Regenerate label (one semantics with the Settings toggle, never two).
  const composeMode = view.guardrails?.composeMode ?? "scripted";
  const guidedPlanned = steps.some((s) => s.mode === "guided");
  const modeMismatch = steps.length > 0 && (composeMode === "guided") !== guidedPlanned;

  // ── writes: core mutation → PUT through the three-layer edit gate ──
  async function putGraph(updated: CampaignGraph, busy: string): Promise<boolean> {
    setBusyMsg(busy);
    setActionError(null);
    try {
      await cf("planner/graph", { method: "PUT", body: JSON.stringify({ agentId, graph: updated }) });
      await onChanged?.();
      return true;
    } catch (err) {
      // The gate's 422 detail is owner-readable — surface it, never silent.
      setActionError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusyMsg("");
    }
  }

  function openEditor(n: StepNode, strategyIntent: string | null) {
    setEditNode(n);
    setEditStrategyIntent(strategyIntent);
    setPreview(null);
    setEditBrief(null);
    setEditSubject(n.content.subject ?? "");
    setEditBody(n.content.body ?? "");
  }

  async function saveEditedStep() {
    if (!editNode || !graph) return;
    let updated: CampaignGraph;
    try {
      updated = updateStepContent(graph, editNode.id, { subject: editSubject, body: editBody });
    } catch (err) {
      setActionError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    if (await putGraph(updated, "Saving step…")) {
      setEditNode(null);
      setEditStrategyIntent(null);
    }
  }

  async function handleDelete() {
    if (!editNode || !graph) return;
    let updated: CampaignGraph;
    try {
      updated = removeStepMutation(graph, editNode.id);
    } catch (err) {
      setActionError(err instanceof GraphMutationError ? err.message : String(err));
      return;
    }
    if (await putGraph(updated, "Deleting step…")) {
      setEditNode(null);
      setEditStrategyIntent(null);
    }
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
    await putGraph(updated, "Reordering…");
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
    if (await putGraph(result.graph, "Adding step…")) {
      const created = result.graph.nodes.find((x) => x.id === result.stepId);
      if (created && created.type === "step") openEditor(created, null);
    }
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
    if (await putGraph(updated, "Saving delay…")) setDelayEditId(null);
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

  async function sampleCompose() {
    const node = briefNode ?? editNode;
    if (!node || previewBusy) return;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const res = await cf("planner/compose-preview", {
        method: "POST",
        body: JSON.stringify({ agentId, stepNodeId: node.id }),
      });
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
      setPreview({ kind: "error", message: "Preview isn't available right now — AI composing may not be configured for this environment yet." });
    }
    setPreviewBusy(false);
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

  const editStepIndex = editNode ? steps.findIndex((s) => s.id === editNode.id) + 1 : 0;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", paddingLeft: 48 }} data-testid="steps">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: "#0E1512" }}>Main sequence</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#9AA59E" }}> · {steps.length} steps · Email</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
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
          const editing = delayEditId === n.id;
          return (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 4px 26px" }}>
              <span style={{ width: 2, height: 32, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
              {editing ? (
                /* Campaign View canon: inline − / amount / + / Done, clamp 1–30 */
                <span style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 100, padding: "4px 6px 4px 14px" }} data-testid="step-delay-editor">
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#8A7F6B" }}>⏱ Wait</span>
                  <span onClick={() => setDelayDraft((v) => Math.max(1, v - 1))} style={{ width: 24, height: 24, borderRadius: "50%", background: "#F2EEE4", color: "#5C6B62", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, cursor: "pointer" }} data-testid="step-delay-dec">−</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1512", minWidth: 48, textAlign: "center" }}>{delayDraft} {delayDraft === 1 ? n.unit.replace(/s$/, "") : n.unit}</span>
                  <span onClick={() => setDelayDraft((v) => Math.min(30, v + 1))} style={{ width: 24, height: 24, borderRadius: "50%", background: "#F2EEE4", color: "#5C6B62", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, cursor: "pointer" }} data-testid="step-delay-inc">+</span>
                  <span onClick={() => void saveDelay(n.id)} style={{ fontSize: 12.5, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 100, padding: "5px 13px", cursor: "pointer" }} data-testid="step-delay-done">Done</span>
                </span>
              ) : (
                <span onClick={() => { setDelayEditId(n.id); setDelayDraft(n.amount); setAddOpen(false); }} style={{ fontSize: 13, fontWeight: 600, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "5px 14px", cursor: "pointer" }} data-testid="step-delay">⏱ Wait {n.amount} {n.amount === 1 ? n.unit.replace(/s$/, "") : n.unit} <span style={{ color: "#B6AB97", fontSize: 11 }}>✎</span></span>
              )}
            </div>
          );
        }
        if (n.type === "step") {
          const idx = steps.indexOf(n) + 1;
          // G1 (DEC-070): a guided step renders its BRIEF, not copy.
          const guided = n.mode === "guided" && n.brief;
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
                  {guided ? (
                    <>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 7, padding: "3px 9px" }} data-testid="step-guided-tag">✦ Composed at send</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 7, padding: "3px 9px" }} data-testid="step-guided-credits">{n.channel === "sms" ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS} credits / send</span>
                    </>
                  ) : null}
                  {/* F1 (DEC-068): outcome badge — none renders nothing (honest absence) */}
                  <OutcomeBadge step={o} />
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#9AA59E" }} data-testid="step-stats">
                    {sent > 0 ? `${sent} sent · ${replies} repl${replies === 1 ? "y" : "ies"}` : "0 sent"}
                  </span>
                  {/* W3-4: reorder — designed addition (canon has no reorder). */}
                  <span onClick={idx > 1 ? () => void handleMove(n.id, "up") : undefined} style={{ fontSize: 13, color: idx > 1 ? "#5C6B62" : "#D8CFBE", cursor: idx > 1 ? "pointer" : "default", flex: "none" }} data-testid="step-move-up">↑</span>
                  <span onClick={idx < steps.length ? () => void handleMove(n.id, "down") : undefined} style={{ fontSize: 13, color: idx < steps.length ? "#5C6B62" : "#D8CFBE", cursor: idx < steps.length ? "pointer" : "default", flex: "none" }} data-testid="step-move-down">↓</span>
                  {/* Campaign View canon: the green ✎ Edit link is the click target.
                      Guided briefs stay view-only until W2 (brief editing wave). */}
                  {guided ? (
                    <span onClick={() => { setBriefNode(n); setPreview(null); }} style={{ fontSize: 12, fontWeight: 600, color: "#1192A6", cursor: "pointer", flex: "none" }} data-testid="step-view-brief">View brief ›</span>
                  ) : (
                    <span onClick={() => openEditor(n, null)} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", cursor: "pointer", flex: "none" }} data-testid="step-edit">✎ Edit</span>
                  )}
                </div>
                {guided ? (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#0E1512", marginBottom: 5 }}>{n.brief!.objective}</div>
                    {n.channel === "email" && n.brief!.subjectHint ? (
                      <div style={{ fontSize: 12.5, color: "#8A7F6B", marginBottom: 5 }} data-testid="step-brief-subject-hint">Subject hint: <span style={{ color: "#5C6B62", fontWeight: 600 }}>{n.brief!.subjectHint}</span></div>
                    ) : null}
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }} data-testid="step-brief-points">
                      {n.brief!.talkingPoints.map((p, i) => (
                        <div key={i} style={{ fontSize: 13, color: "#5C6B62", lineHeight: 1.45, display: "flex", gap: 8 }}>
                          <span style={{ color: "#1192A6", flex: "none" }}>•</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                        </div>
                      ))}
                    </div>
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

      {/* M1b (DEC-068): reply-strategy steps — grouped under the branch they
          belong to, labeled by intent; editable via the shared drawer (the
          wizard already edits them; W3 adds chain-level editing). */}
      {strategies.length > 0 ? (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", margin: "24px 0 12px" }} data-testid="strategy-group">
            Reply strategies · sent when a reply classifies
          </div>
          {strategies.map(({ intent, step: sNode }) => {
            const tint = intentTint(intent);
            const stats = view.perStep[sNode.id];
            return (
              <div key={sNode.id} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 10 }} data-testid="strategy-step-card">
                <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>↩</span>
                <div style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "15px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: tint.fg }}>{tint.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: "rgba(53,232,52,.13)", color: "#16A82A" }}>Email · threaded</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "#9AA59E" }} data-testid="strategy-step-stats">
                      {stats ? `${stats.sent} sent · ${stats.replies} repl${stats.replies === 1 ? "y" : "ies"}` : "0 sent"}
                    </span>
                    <span onClick={() => openEditor(sNode, intent)} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", cursor: "pointer", flex: "none" }} data-testid="strategy-step-edit">✎ Edit</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{sNode.content.body}</div>
                </div>
              </div>
            );
          })}
        </>
      ) : null}
      <div style={{ fontSize: 12, color: "#9AA59E", marginTop: 16, paddingLeft: 48 }}>
        Graph v{view.graphVersion ?? "—"} · {view.graphSource === "MANUAL" ? "edited — new version saved (MANUAL)" : "AI-planned"}
      </div>
      </>
      )}

      {/* W3-4: the SHARED step editor drawer (wizard step-2's component). */}
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
        onClose={() => { setEditNode(null); setEditStrategyIntent(null); }}
        onSave={saveEditedStep}
        onDelete={editStrategyIntent === null ? handleDelete : undefined}
        liveNotice={!isDraft}
      />

      {/* G3 (DEC-075): READ-ONLY brief drawer — guided steps stay view-only
          until W2 (brief editing on the dashboard) replaces this with the
          shared editor. Anatomy unchanged from G3. */}
      {briefNode?.brief ? (() => {
        const b = briefNode.brief!;
        const sms = briefNode.channel === "sms";
        const stepNo = steps.indexOf(briefNode) + 1;
        const briefSent = outcomes?.steps.find((s) => s.stepNodeId === briefNode.id)?.sent ?? view.perStep[briefNode.id]?.sent ?? 0;
        return (
          <div onClick={() => setBriefNode(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.4)", zIndex: 60 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 560, maxWidth: "100%", background: "#fff", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column" }} data-testid="brief-viewer">
              <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "18px 22px", borderBottom: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
                <span style={{ width: 40, height: 40, borderRadius: 12, flex: "none", background: sms ? "rgba(54,215,237,.16)" : "rgba(53,232,52,.16)", color: sms ? "#1192A6" : "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700 }}>{sms ? "💬" : "✉"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8A7F6B" }}>Step {stepNo > 0 ? stepNo : "—"}</span>
                    {sms ? (
                      <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "2px 9px", background: "rgba(54,215,237,.14)", color: "#1192A6" }}>SMS</span>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "2px 9px", background: "rgba(53,232,52,.13)", color: "#16A82A" }}>Email</span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 7, padding: "2px 9px" }}>✦ Composed at send</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.objective || "Untitled brief"}</div>
                </div>
                <span onClick={() => setBriefNode(null)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }} data-testid="brief-viewer-close">✕</span>
              </div>

              <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18, flex: 1, overflow: "auto", minHeight: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#0E6E7E", background: "rgba(54,215,237,.08)", border: "1px solid rgba(54,215,237,.28)", borderRadius: 11, padding: "11px 14px" }} data-testid="brief-viewer-note">
                  <span style={{ fontSize: 13 }}>✦</span>
                  <span>This step has no fixed text. At send time the AI composes a fresh {sms ? "SMS" : "email"} for each lead from these talking points — checked against your never-say list, {sms ? "length" : "subject rules, length"} and grounding rules before anything sends.{sms ? " The STOP line is always appended by the platform." : " The unsubscribe footer is always added by the platform, never written by the AI."} {sms ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS} credits per send.</span>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 7 }}>Objective</label>
                  <div style={{ borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#0E1512" }} data-testid="brief-viewer-objective">{b.objective}</div>
                </div>

                {!sms && b.subjectHint ? (
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 4 }}>Subject hint</label>
                    <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 8 }}>A direction for the subject line — the AI adapts it per lead. Subject rules (≤60 chars, no clickbait, no ALL CAPS) are checked on every composed email.</div>
                    <div style={{ borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#0E1512" }} data-testid="brief-viewer-subject-hint">{b.subjectHint}</div>
                  </div>
                ) : null}

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 7 }}>Talking points <span style={{ fontWeight: 600, color: "#9AA59E" }}>· {b.talkingPoints.length}</span></label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {b.talkingPoints.map((p, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 12px" }} data-testid="brief-viewer-point">
                        <span style={{ color: "#1192A6", flex: "none" }}>•</span>
                        <span style={{ fontSize: 13.5, color: "#3B463F", flex: 1, lineHeight: 1.45 }}>{p}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {(b.mustSay?.length ?? 0) > 0 || (b.neverSay?.length ?? 0) > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {([
                      { label: "Must say", terms: b.mustSay ?? [], tint: "#0F7A28", bg: "rgba(53,232,52,.09)", tid: "brief-viewer-must" },
                      { label: "Never say", terms: b.neverSay ?? [], tint: "#C9543F", bg: "rgba(224,121,107,.08)", tid: "brief-viewer-never" },
                    ]).map((s) => (
                      <div key={s.label}>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 7 }}>{s.label}</label>
                        {s.terms.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                            {s.terms.map((term) => (
                              <span key={term} style={{ display: "inline-flex", alignItems: "center", fontSize: 12.5, fontWeight: 600, color: s.tint, background: s.bg, border: "1px solid #EBE3D6", borderRadius: 100, padding: "5px 12px" }} data-testid={`${s.tid}-chip`}>{term}</span>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: "#9AA59E" }}>None for this step.</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Honest sends line — count only; per-message surfaces are the
                    lead threads (no step-scoped message list exists this phase). */}
                <div style={{ fontSize: 12.5, color: "#8A7F6B", background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 14px" }} data-testid="brief-viewer-sent">
                  {briefSent > 0
                    ? `${briefSent} message${briefSent === 1 ? "" : "s"} sent from this brief — each composed per lead; sent copies live on each lead's timeline.`
                    : "No sends from this step yet."}
                </div>

                <div style={{ border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden", flex: "none" }} data-testid="brief-viewer-preview-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", background: "linear-gradient(90deg,rgba(54,215,237,.1),rgba(53,232,52,.07))", borderBottom: "1px solid #EBE3D6" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", flex: 1 }}>✦ Sample preview</span>
                    <span onClick={() => void sampleCompose()} style={{ fontSize: 12.5, fontWeight: 700, color: previewBusy ? "#9AA59E" : "#0A0F0C", background: previewBusy ? "#ECE7DC" : GRAD, borderRadius: 9, padding: "7px 14px", cursor: previewBusy ? "default" : "pointer" }} data-testid="brief-viewer-preview-run">{previewBusy ? "Composing…" : "Compose sample"}</span>
                  </div>
                  <div style={{ padding: "12px 15px" }}>
                    {preview === null && !previewBusy ? (
                      <div style={{ fontSize: 12.5, color: "#9AA59E" }}>See what the composer writes for a sample lead (Jane Doe · Acme Dental) using the saved brief. Free while guided mode is new.</div>
                    ) : previewBusy ? (
                      <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>Composing against the sample lead…</div>
                    ) : preview?.kind === "composed" ? (
                      <div data-testid="brief-viewer-preview-result">
                        {preview.subject ? (
                          <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 14px", fontSize: 13, color: "#0E1512", fontWeight: 700, marginBottom: 7 }}>{preview.subject}</div>
                        ) : null}
                        <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "11px 14px", fontSize: 13.5, color: "#0E1512", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{preview.body}</div>
                        <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 7 }}>Sample lead: Jane Doe · Acme Dental — every real lead gets its own text.{preview.subject ? " The unsubscribe footer is appended at send time." : ""} {preview.credits} credits per real send (display only for now).</div>
                      </div>
                    ) : preview?.kind === "refused" ? (
                      <div style={{ border: "1px solid rgba(232,196,91,.48)", borderRadius: 11, background: "rgba(232,196,91,.08)", padding: "11px 14px" }} data-testid="brief-viewer-preview-refused">
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#9A6B12", marginBottom: 3 }}>⚠ Composer refused — nothing would send</div>
                        <div style={{ fontSize: 12.5, color: "#8A7F6B", lineHeight: 1.5 }}>{preview.reason}{preview.detail ? ` — ${preview.detail}` : ""}. The same check pauses a real lead instead of sending unchecked copy.</div>
                      </div>
                    ) : preview?.kind === "error" ? (
                      <div style={{ fontSize: 12.5, color: "#C9543F" }} data-testid="brief-viewer-preview-error">{preview.message}</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
                {isDraft ? (
                  <a href={`/agents/new?agent=${view.agent.id}`} style={{ textDecoration: "none", fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 10, padding: "9px 14px" }} data-testid="brief-viewer-edit-link">✎ Edit in campaign setup</a>
                ) : (
                  <span style={{ fontSize: 12.5, color: "#9AA59E" }} data-testid="brief-viewer-readonly-note">Read-only — brief editing on this tab arrives with the guided-editing wave (W2).</span>
                )}
                <span onClick={() => setBriefNode(null)} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }} data-testid="brief-viewer-done">Close</span>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
