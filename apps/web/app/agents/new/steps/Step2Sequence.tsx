"use client";

/**
 * Step 2 — Design sequence (W3 commit 0: pure move from Wizard.tsx).
 * Renders the planner graph (main path + reply strategies + branches view),
 * the 560px step/brief editor drawer and the delay modal. All state stays in
 * the Wizard orchestrator.
 */
import { Fragment } from "react";
import { GUIDED_EMAIL_CREDITS, GUIDED_SMS_CREDITS } from "@clientforce/core";
import type { CampaignGraph, CampaignOutcomes, ContactFieldDefDto, GraphNode } from "@clientforce/core";
import { OutcomeBadge } from "../../../../components/OutcomeBadge";
import { StepEditorDrawer } from "../../../../components/sequence/StepEditorDrawer";
import { branchWhenLabel, intentTint } from "../../../../lib/intents";
import { mainPath, mainSteps, strategyStepsOf } from "../../../../lib/graph-path";
import { Modal, ModalActions, Stepper, tzShort, type BriefDraft, type PreviewState } from "../shared";

type BranchCases = Extract<GraphNode, { type: "branch" }>["cases"];

interface Step2Props {
  drafting: boolean;
  graph: CampaignGraph | null;
  graphSource: string;
  graphVersion: number;
  outcomes: CampaignOutcomes | null;
  seqView: "sequence" | "branches";
  setSeqView: React.Dispatch<React.SetStateAction<"sequence" | "branches">>;
  regenError: string | null;
  regenerate: () => Promise<void>;
  addStep: () => Promise<void>;
  branchCases: BranchCases;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  /** W3-7: the real audience arithmetic (adds + referenced lists). */
  audienceTotal: number;
  /** G3 (DEC-075): the guardrails composeMode rider — the toolbar's
   *  Scripted | ✦ Guided control reads/writes the Settings toggle's field. */
  composeMode: "scripted" | "guided";
  setSequenceMode: (mode: "scripted" | "guided") => Promise<void>;
  editNode: GraphNode | null;
  setEditNode: React.Dispatch<React.SetStateAction<GraphNode | null>>;
  editSubject: string;
  setEditSubject: React.Dispatch<React.SetStateAction<string>>;
  editBody: string;
  setEditBody: React.Dispatch<React.SetStateAction<string>>;
  editBrief: BriefDraft | null;
  setEditBrief: React.Dispatch<React.SetStateAction<BriefDraft | null>>;
  briefPointInput: string;
  setBriefPointInput: React.Dispatch<React.SetStateAction<string>>;
  briefMustInput: string;
  setBriefMustInput: React.Dispatch<React.SetStateAction<string>>;
  briefNeverInput: string;
  setBriefNeverInput: React.Dispatch<React.SetStateAction<string>>;
  previewBusy: boolean;
  preview: PreviewState | null;
  setPreview: React.Dispatch<React.SetStateAction<PreviewState | null>>;
  fieldDefs: ContactFieldDefDto[];
  customTokenKey: string | null;
  setCustomTokenKey: React.Dispatch<React.SetStateAction<string | null>>;
  customFallback: string;
  setCustomFallback: React.Dispatch<React.SetStateAction<string>>;
  delayEdit: GraphNode | null;
  setDelayEdit: React.Dispatch<React.SetStateAction<GraphNode | null>>;
  delayAmount: number;
  setDelayAmount: React.Dispatch<React.SetStateAction<number>>;
  editStepIndex: number;
  editStrategyIntent: string | null;
  insertCustomToken: () => void;
  saveEditedStep: () => Promise<void>;
  sampleCompose: () => Promise<void>;
  saveDelay: () => Promise<void>;
}

export function Step2Sequence(props: Step2Props) {
  const {
    drafting, graph, graphSource, graphVersion, outcomes, seqView, setSeqView, regenError, regenerate, addStep,
    branchCases, windowStart, windowEnd, timezone, audienceTotal, composeMode, setSequenceMode,
    editNode, setEditNode, editSubject, setEditSubject, editBody, setEditBody, editBrief, setEditBrief,
    briefPointInput, setBriefPointInput, briefMustInput, setBriefMustInput, briefNeverInput, setBriefNeverInput,
    previewBusy, preview, setPreview, fieldDefs, customTokenKey, setCustomTokenKey, customFallback, setCustomFallback,
    delayEdit, setDelayEdit, delayAmount, setDelayAmount, editStepIndex, editStrategyIntent,
    insertCustomToken, saveEditedStep, sampleCompose, saveDelay,
  } = props;
  // G3 (DEC-075): mode applies at the NEXT plan — when the planned steps
  // don't match the selected mode, the existing Regenerate button carries the
  // "Regenerate to apply" affordance instead of the sequence changing under
  // the owner (one semantics with the Settings toggle, never two).
  const guidedPlanned = graph ? mainSteps(graph).some((s) => s.mode === "guided") : false;
  const modeMismatch = graph !== null && mainSteps(graph).length > 0 && (composeMode === "guided") !== guidedPlanned;
  return (
    <>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 15px" }}>🕐 Mon–Fri · {parseInt(windowStart, 10)}–{parseInt(windowEnd, 10)} · {tzShort(timezone)} <span style={{ color: "#9AA59E" }}>⌄</span></span>
                      {/* G3 (DEC-075): Scripted | ✦ Guided — writes the SAME guardrails
                          rider the Settings toggle owns; applies at the next plan. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 2, background: "#F2EEE4", borderRadius: 11, padding: 3, marginLeft: "auto" }} data-testid="seq-mode-control">
                        <span onClick={() => void setSequenceMode("scripted")} style={{ fontSize: 12.5, fontWeight: composeMode === "guided" ? 600 : 700, color: composeMode === "guided" ? "#8A7F6B" : "#0E1512", background: composeMode === "guided" ? "transparent" : "#fff", boxShadow: composeMode === "guided" ? "none" : "0 1px 4px rgba(14,21,18,.1)", borderRadius: 9, padding: "7px 13px", cursor: "pointer", whiteSpace: "nowrap" }} data-testid="seq-mode-scripted">Scripted</span>
                        <span onClick={() => void setSequenceMode("guided")} style={{ fontSize: 12.5, fontWeight: composeMode === "guided" ? 700 : 600, color: composeMode === "guided" ? "#0E1512" : "#8A7F6B", background: composeMode === "guided" ? "#fff" : "transparent", boxShadow: composeMode === "guided" ? "0 1px 4px rgba(14,21,18,.1)" : "none", borderRadius: 9, padding: "7px 13px", cursor: "pointer", whiteSpace: "nowrap" }} data-testid="seq-mode-guided"><span style={{ color: "#1192A6" }}>✦</span> Guided</span>
                      </div>
                      <span onClick={() => void regenerate()} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 11, padding: "9px 15px", cursor: "pointer", whiteSpace: "nowrap" }} data-testid="regenerate">{modeMismatch ? "✦ Regenerate to apply" : "✦ Regenerate with AI"}</span>
                    </div>
                    {/* G3: guided explainer (canon) — the mismatch line renders only
                        while planned steps predate the flip. Prototype copy names
                        WhatsApp/voice; the build plans email + SMS only (honest
                        absence, flagged in the fidelity log). */}
                    {composeMode === "guided" ? (
                      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: "#5C6B62", background: "rgba(54,215,237,.07)", border: "1px solid rgba(54,215,237,.25)", borderRadius: 11, padding: "10px 14px", marginBottom: 16, lineHeight: 1.5 }} data-testid="seq-guided-banner">
                        <span style={{ flex: "none", color: "#1192A6" }}>✦</span>
                        <span>
                          Email and SMS steps carry a <b>brief</b> instead of fixed copy — the AI composes a fresh message per lead at send time, inside your rails.
                          {modeMismatch ? <span data-testid="regen-to-apply-note"> <b>These steps were planned as scripted</b> — hit ✦ Regenerate to apply guided composing.</span> : null}
                        </span>
                      </div>
                    ) : null}
                    {/* M1b (DEC-068): the sequence lists the MAIN PATH — reply-
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
                            <div onClick={() => { setEditNode(n); setPreview(null); if (n.mode === "guided" && n.brief) { setEditBrief({ channel: n.channel === "sms" ? "sms" : "email", objective: n.brief.objective, subjectHint: n.brief.subjectHint ?? "", talkingPoints: [...n.brief.talkingPoints], mustSay: [...(n.brief.mustSay ?? [])], neverSay: [...(n.brief.neverSay ?? [])] }); } else { setEditBrief(null); setEditSubject(n.content.subject ?? ""); setEditBody(n.content.body ?? ""); } }} style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "16px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)", cursor: "pointer" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8A7F6B" }}>Step {idx}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: n.channel === "sms" ? "rgba(54,215,237,.14)" : "rgba(53,232,52,.13)", color: n.channel === "sms" ? "#1192A6" : "#16A82A" }} data-testid="seq-channel-chip">{n.channel === "sms" ? "SMS" : "Email"}</span>
                                {/* G1 (DEC-070) / G2 (DEC-071): guided steps compose at send —
                                    the card carries the brief, never copy; per-channel credits
                                    figure is display-only (Q-020). */}
                                {n.mode === "guided" ? (
                                  <>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 7, padding: "3px 9px" }} data-testid="seq-guided-tag">✦ Composed at send</span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 7, padding: "3px 9px" }} data-testid="seq-guided-credits">{n.channel === "sms" ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS} credits / send</span>
                                  </>
                                ) : (
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 7, padding: "3px 9px" }}>✦ AI draft</span>
                                )}
                                {/* F1 (DEC-068): outcome badge — fresh drafts are all-none → no chip */}
                                <OutcomeBadge step={outcomes?.steps.find((s) => s.stepNodeId === n.id)} />
                                <span style={{ marginLeft: "auto", fontSize: 13, color: "#9AA59E" }} data-testid="seq-edit">✎ Edit</span>
                              </div>
                              {n.mode === "guided" && n.brief ? (
                                <>
                                  <div style={{ fontSize: 15.5, fontWeight: 600, color: "#0E1512", marginBottom: 6 }}>{n.brief.objective}</div>
                                  {/* G2: the email brief's subject direction — a hint, never copy */}
                                  {n.channel === "email" && n.brief.subjectHint ? (
                                    <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 6 }} data-testid="seq-brief-subject-hint">Subject hint: <span style={{ color: "#5C6B62", fontWeight: 600 }}>{n.brief.subjectHint}</span></div>
                                  ) : null}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }} data-testid="seq-brief-points">
                                    {n.brief.talkingPoints.map((p, i) => (
                                      <div key={i} style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.45, display: "flex", gap: 8 }}>
                                        <span style={{ color: "#1192A6", flex: "none" }}>•</span>
                                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div style={{ fontSize: 15.5, fontWeight: 600, color: "#0E1512", marginBottom: 4 }}>{n.channel === "sms" ? "SMS message" : n.content.subject}</div>
                                  <div style={{ fontSize: 14, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.content.body}</div>
                                </>
                              )}
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
                            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.4)", marginTop: 2 }}>{audienceTotal ? `${audienceTotal} contact${audienceTotal === 1 ? "" : "s"} enroll at launch` : "Contacts enroll at launch"} · Draft</div>
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
                          // M1b (DEC-068): when-labels come from the ONE intent
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

      {/* step editor — §3 (amended): the SHARED 560px drawer (W3-4 extraction —
          the Steps tab hosts the same component; wizard rendering unchanged) */}
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
        onClose={() => setEditNode(null)}
        onSave={saveEditedStep}
      />
      {/* delay modal */}
      {delayEdit ? (
        <Modal onClose={() => setDelayEdit(null)} title="Edit delay" tid="delay-modal">
          <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "center", margin: "10px 0 18px" }}>
            <Stepper onMinus={() => setDelayAmount((v) => Math.max(1, v - 1))} onPlus={() => setDelayAmount((v) => v + 1)} value={`${delayAmount} ${delayEdit.type === "delay" ? delayEdit.unit : "days"}`} />
          </div>
          <ModalActions onCancel={() => setDelayEdit(null)} onSave={() => void saveDelay()} />
        </Modal>
      ) : null}
    </>
  );
}
