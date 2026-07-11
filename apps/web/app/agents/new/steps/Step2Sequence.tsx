"use client";

/**
 * Step 2 — Design sequence (W3 commit 0: pure move from Wizard.tsx).
 * Renders the planner graph (main path + reply strategies + branches view),
 * the 560px step/brief editor drawer and the delay modal. All state stays in
 * the Wizard orchestrator.
 */
import { Fragment } from "react";
import { BRIEF_MUST_SAY_MAX, BRIEF_NEVER_SAY_MAX, BRIEF_SUBJECT_HINT_MAX, BRIEF_TALKING_POINTS_MAX, BRIEF_TALKING_POINTS_MIN, GUIDED_EMAIL_CREDITS, GUIDED_SMS_CREDITS } from "@clientforce/core";
import type { CampaignGraph, CampaignOutcomes, ContactFieldDefDto, GraphNode } from "@clientforce/core";
import { OutcomeBadge } from "../../../../components/OutcomeBadge";
import { branchWhenLabel, intentTint } from "../../../../lib/intents";
import { mainPath, mainSteps, strategyStepsOf } from "../../../../lib/graph-path";
import { GRAD, Modal, ModalActions, Stepper, tzShort, type AddedContact, type BriefDraft, type PreviewState } from "../shared";

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
  added: AddedContact[];
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
    branchCases, windowStart, windowEnd, timezone, added,
    editNode, setEditNode, editSubject, setEditSubject, editBody, setEditBody, editBrief, setEditBrief,
    briefPointInput, setBriefPointInput, briefMustInput, setBriefMustInput, briefNeverInput, setBriefNeverInput,
    previewBusy, preview, setPreview, fieldDefs, customTokenKey, setCustomTokenKey, customFallback, setCustomFallback,
    delayEdit, setDelayEdit, delayAmount, setDelayAmount, editStepIndex, editStrategyIntent,
    insertCustomToken, saveEditedStep, sampleCompose, saveDelay,
  } = props;
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
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 15px" }}>🕐 Mon–Fri · {parseInt(windowStart, 10)}–{parseInt(windowEnd, 10)} · {tzShort(timezone)} <span style={{ color: "#9AA59E" }}>⌄</span></span>
                      <span onClick={() => void regenerate()} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 11, padding: "9px 15px", cursor: "pointer" }} data-testid="regenerate">✦ Regenerate with AI</span>
                    </div>
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

      {/* step editor — §3 (amended): 560px right drawer w/ STEP header,
          deterministic deliverability rows, PERSONALIZATION token chips */}
      {editNode && editNode.type === "step" ? (
        <div onClick={() => setEditNode(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.4)", zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 560, maxWidth: "100%", background: "#fff", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column" }} data-testid="step-editor">
            <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "18px 22px", borderBottom: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, flex: "none", background: editBrief?.channel === "sms" ? "rgba(54,215,237,.16)" : "rgba(53,232,52,.16)", color: editBrief?.channel === "sms" ? "#1192A6" : "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700 }}>{editBrief?.channel === "sms" ? "💬" : "✉"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8A7F6B" }}>{editStrategyIntent ? `${intentTint(editStrategyIntent).label} reply` : `Step ${editStepIndex}`}</span>
                  {editBrief ? (
                    /* G2 (DEC-071): channel-true chips — the brief editor now serves email too */
                    <>
                      {editBrief.channel === "sms" ? (
                        <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "2px 9px", background: "rgba(54,215,237,.14)", color: "#1192A6" }}>SMS</span>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "2px 9px", background: "rgba(53,232,52,.13)", color: "#16A82A" }}>Email</span>
                      )}
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 7, padding: "2px 9px" }}>✦ Composed at send</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "2px 9px", background: "rgba(53,232,52,.13)", color: "#16A82A" }}>Email</span>
                  )}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{editBrief ? (editBrief.objective || "Untitled brief") : (editSubject || "Untitled step")}</div>
              </div>
              <span onClick={() => setEditNode(null)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }}>✕</span>
            </div>

            {editBrief ? (
              /* G1 (DEC-070): the BRIEF editor — the owner edits bullets, never
                 copy; a composer renders the real message per lead at send
                 time (designed surface — no prototype anchor; §3 drawer
                 conventions). */
              <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18, flex: 1, overflow: "auto", minHeight: 0 }} data-testid="brief-editor">
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#0E6E7E", background: "rgba(54,215,237,.08)", border: "1px solid rgba(54,215,237,.28)", borderRadius: 11, padding: "11px 14px" }} data-testid="brief-note">
                  <span style={{ fontSize: 13 }}>✦</span>
                  <span>This step has no fixed text. At send time the AI composes a fresh {editBrief.channel === "sms" ? "SMS" : "email"} for each lead from these talking points — checked against your never-say list, {editBrief.channel === "sms" ? "length" : "subject rules, length"} and grounding rules before anything sends.{editBrief.channel === "email" ? " The unsubscribe footer is always added by the platform, never written by the AI." : ""} {editBrief.channel === "sms" ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS} credits per send.</span>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 7 }}>Objective</label>
                  <input value={editBrief.objective} maxLength={200} onChange={(e) => setEditBrief((b) => (b ? { ...b, objective: e.target.value } : b))} placeholder="What must this message achieve?" style={{ boxSizing: "border-box", width: "100%", borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="brief-objective" />
                </div>

                {/* G2 (DEC-071): the email brief's subject hint — planner-emitted,
                    owner-editable; a direction the composer adapts per lead,
                    never pasted (deterministic subject checks still apply). */}
                {editBrief.channel === "email" ? (
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 4 }}>Subject hint <span style={{ fontWeight: 600, color: "#9AA59E" }}>· optional</span></label>
                    <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 8 }}>A direction for the subject line — the AI adapts it per lead. Subject rules (≤60 chars, no clickbait, no ALL CAPS) are checked on every composed email.</div>
                    <input value={editBrief.subjectHint} maxLength={BRIEF_SUBJECT_HINT_MAX} onChange={(e) => setEditBrief((b) => (b ? { ...b, subjectHint: e.target.value } : b))} placeholder="e.g. where phone-only booking leaks patients" style={{ boxSizing: "border-box", width: "100%", borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="brief-subject-hint" />
                  </div>
                ) : null}

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 4 }}>Talking points <span style={{ fontWeight: 600, color: "#9AA59E" }}>· {editBrief.talkingPoints.length} of {BRIEF_TALKING_POINTS_MAX} (min {BRIEF_TALKING_POINTS_MIN})</span></label>
                  <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 8 }}>Facts the message may draw from — the AI picks what fits each lead, it never pastes them as-is.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {editBrief.talkingPoints.map((p, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 12px" }} data-testid="brief-point-row">
                        <span style={{ color: "#1192A6", flex: "none" }}>•</span>
                        <span style={{ fontSize: 13.5, color: "#3B463F", flex: 1, lineHeight: 1.45 }}>{p}</span>
                        <span onClick={() => setEditBrief((b) => (b ? { ...b, talkingPoints: b.talkingPoints.filter((_, j) => j !== i) } : b))} style={{ width: 20, height: 20, borderRadius: "50%", background: "#EBE3D6", color: "#5C6B62", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, cursor: "pointer", flex: "none" }} data-testid="brief-point-remove">✕</span>
                      </div>
                    ))}
                  </div>
                  {editBrief.talkingPoints.length < BRIEF_TALKING_POINTS_MAX ? (
                    <input
                      value={briefPointInput}
                      maxLength={200}
                      onChange={(e) => setBriefPointInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = briefPointInput.trim(); if (v) { setEditBrief((b) => (b ? { ...b, talkingPoints: [...b.talkingPoints, v] } : b)); setBriefPointInput(""); } } }}
                      placeholder="Add a talking point and press Enter"
                      style={{ boxSizing: "border-box", width: "100%", marginTop: 8, height: 40, borderRadius: 11, background: "#fff", border: "1px dashed #C9D6CB", padding: "0 14px", fontSize: 13.5, color: "#0E1512", outline: "none", fontFamily: "'Hanken Grotesk',sans-serif" }}
                      data-testid="brief-point-input"
                    />
                  ) : (
                    <div style={{ fontSize: 12.5, color: "#9A6B12", background: "#FBEFD2", borderRadius: 9, padding: "8px 12px", marginTop: 8 }}>{BRIEF_TALKING_POINTS_MAX} of {BRIEF_TALKING_POINTS_MAX} — remove one to add another.</div>
                  )}
                </div>

                {([
                  { key: "mustSay" as const, label: "Must say", desc: "Strings every composed message includes verbatim — keep for compliance-critical facts only.", max: BRIEF_MUST_SAY_MAX, input: briefMustInput, setInput: setBriefMustInput, tint: "#0F7A28", bg: "rgba(53,232,52,.09)", tid: "brief-must" },
                  { key: "neverSay" as const, label: "Never say", desc: "Hard bans for this step — checked on every composed message before it can send.", max: BRIEF_NEVER_SAY_MAX, input: briefNeverInput, setInput: setBriefNeverInput, tint: "#C9543F", bg: "rgba(224,121,107,.08)", tid: "brief-never" },
                ]).map((s) => (
                  <div key={s.key}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 4 }}>{s.label} <span style={{ fontWeight: 600, color: "#9AA59E" }}>· optional</span></label>
                    <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 8 }}>{s.desc}</div>
                    {editBrief[s.key].length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 8 }}>
                        {editBrief[s.key].map((term) => (
                          <span key={term} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: s.tint, background: s.bg, border: "1px solid #EBE3D6", borderRadius: 100, padding: "5px 7px 5px 12px" }} data-testid={`${s.tid}-chip`}>
                            {term}
                            <span onClick={() => setEditBrief((b) => (b ? { ...b, [s.key]: b[s.key].filter((x) => x !== term) } : b))} style={{ width: 17, height: 17, borderRadius: "50%", background: "#EBE3D6", color: "#5C6B62", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, cursor: "pointer" }}>✕</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {editBrief[s.key].length < s.max ? (
                      <input
                        value={s.input}
                        maxLength={s.key === "mustSay" ? 120 : 80}
                        onChange={(e) => s.setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = s.input.trim(); if (v && !editBrief[s.key].some((x) => x.toLowerCase() === v.toLowerCase())) { setEditBrief((b) => (b ? { ...b, [s.key]: [...b[s.key], v] } : b)); } s.setInput(""); } }}
                        placeholder="Type a phrase and press Enter"
                        style={{ boxSizing: "border-box", width: "100%", height: 38, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "0 14px", fontSize: 13, color: "#0E1512", outline: "none", fontFamily: "'Hanken Grotesk',sans-serif" }}
                        data-testid={`${s.tid}-input`}
                      />
                    ) : (
                      <div style={{ fontSize: 12.5, color: "#9A6B12", background: "#FBEFD2", borderRadius: 9, padding: "8px 12px" }}>{s.max} of {s.max} — remove one to add another.</div>
                    )}
                  </div>
                ))}

                {/* sample preview — composes the SAVED brief via the real checks.
                    flex:none — inside the drawer's overflow column this card
                    would otherwise flex-shrink to nothing (overflow:hidden
                    gives it no intrinsic floor). */}
                <div style={{ border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden", flex: "none" }} data-testid="sample-preview-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", background: "linear-gradient(90deg,rgba(54,215,237,.1),rgba(53,232,52,.07))", borderBottom: "1px solid #EBE3D6" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", flex: 1 }}>✦ Sample preview</span>
                    <span onClick={() => void sampleCompose()} style={{ fontSize: 12.5, fontWeight: 700, color: previewBusy ? "#9AA59E" : "#0A0F0C", background: previewBusy ? "#ECE7DC" : GRAD, borderRadius: 9, padding: "7px 14px", cursor: previewBusy ? "default" : "pointer" }} data-testid="sample-preview-run">{previewBusy ? "Composing…" : "Compose sample"}</span>
                  </div>
                  <div style={{ padding: "12px 15px" }}>
                    {preview === null && !previewBusy ? (
                      <div style={{ fontSize: 12.5, color: "#9AA59E" }}>See what the composer writes for a sample lead (Jane Doe · Acme Dental) using the last saved brief. Free while guided mode is new.</div>
                    ) : previewBusy ? (
                      <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>Composing against the sample lead…</div>
                    ) : preview?.kind === "composed" ? (
                      <div data-testid="sample-preview-result">
                        {/* G2: composed email previews carry the subject line too */}
                        {preview.subject ? (
                          <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 14px", fontSize: 13, color: "#0E1512", fontWeight: 700, marginBottom: 7 }} data-testid="sample-preview-subject">{preview.subject}</div>
                        ) : null}
                        <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "11px 14px", fontSize: 13.5, color: "#0E1512", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{preview.body}</div>
                        <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 7 }}>Sample lead: Jane Doe · Acme Dental — every real lead gets its own text.{preview.subject ? " The unsubscribe footer is appended at send time." : ""} {preview.credits} credits per real send (display only for now).</div>
                      </div>
                    ) : preview?.kind === "refused" ? (
                      <div style={{ border: "1px solid rgba(232,196,91,.48)", borderRadius: 11, background: "rgba(232,196,91,.08)", padding: "11px 14px" }} data-testid="sample-preview-refused">
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#9A6B12", marginBottom: 3 }}>⚠ Composer refused — nothing would send</div>
                        <div style={{ fontSize: 12.5, color: "#8A7F6B", lineHeight: 1.5 }}>{preview.reason}{preview.detail ? ` — ${preview.detail}` : ""}. The same check pauses a real lead instead of sending unchecked copy.</div>
                      </div>
                    ) : preview?.kind === "error" ? (
                      <div style={{ fontSize: 12.5, color: "#C9543F" }} data-testid="sample-preview-error">{preview.message}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
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
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
              {editBrief ? (
                <span style={{ fontSize: 12.5, color: "#9AA59E" }}>Bullets steer the AI — the copy itself is written per lead.</span>
              ) : (
                <span title="AI rewrite arrives with the sequence tools — use ✦ Regenerate for a full re-plan" style={{ fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 10, padding: "9px 14px", cursor: "default" }}>✦ Rewrite with AI</span>
              )}
              <span onClick={() => setEditNode(null)} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
              <span onClick={() => void saveEditedStep()} style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 22px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }} data-testid="modal-save">{editBrief ? "Save brief" : "Save step"}</span>
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
    </>
  );
}
