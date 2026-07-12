"use client";

/**
 * Steps tab (checkpoints §4) — the persisted CampaignGraph, read-only (editing
 * stays in the wizard, noted in PROGRESS). Per-step counts + outcome badges
 * come from the F1 rollup (`GET /agents/:id/outcomes`, DEC-068) — one source
 * for the stats span, the badge, and the regen prompt. (The pre-F1 Message
 * groupBy never attributed replies — INBOUND rows carry no stepNodeId; the
 * rollup's last-sent-step attribution supersedes it.) The prototype's
 * sequence cards carry no stat chips — §0 convention addition, flagged.
 */
import { useState } from "react";
import { GUIDED_EMAIL_CREDITS, GUIDED_SMS_CREDITS, type CampaignOutcomes, type GraphNode } from "@clientforce/core";
import { OutcomeBadge } from "../../../../../components/OutcomeBadge";
import type { AgentViewData } from "./AgentView";
import { cf, intentTint } from "./shared";
import { mainPath, mainSteps, strategyStepsOf } from "../../../../../lib/graph-path";

type StepNode = Extract<GraphNode, { type: "step" }>;

/** G1/G2 sample-preview display states (a refusal is a designed state). */
type PreviewState =
  | { kind: "composed"; subject?: string; body: string; credits: number }
  | { kind: "refused"; reason: string; detail: string }
  | { kind: "error"; message: string };

export function StepsTab({ view, outcomes }: { view: AgentViewData | null; outcomes: CampaignOutcomes | null }) {
  // G3 (DEC-075): clicking a guided step opens its brief READ-ONLY — the
  // same drawer anatomy the wizard edits in; editing stays in campaign
  // setup (W3-4 owns the sequence editor). Scripted steps stay inert.
  const [briefNode, setBriefNode] = useState<StepNode | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  async function sampleCompose() {
    if (!view || !briefNode || previewBusy) return;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const res = await cf("planner/compose-preview", {
        method: "POST",
        body: JSON.stringify({ agentId: view.agent.id, stepNodeId: briefNode.id }),
      });
      if (res.composed) {
        setPreview({
          kind: "composed",
          ...(res.composed.subject ? { subject: res.composed.subject } : {}),
          body: res.composed.body,
          credits: res.credits ?? (briefNode.channel === "sms" ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS),
        });
      } else if (res.refused) {
        setPreview({ kind: "refused", reason: res.refused.reason, detail: res.refused.detail ?? "" });
      }
    } catch {
      setPreview({ kind: "error", message: "Preview isn't available right now — AI composing may not be configured for this environment yet." });
    }
    setPreviewBusy(false);
  }
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
  const w = view.guardrails?.sendingWindow;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = w ? `${dayNames[(w.days[0] ?? 1) - 1]}–${dayNames[(w.days[w.days.length - 1] ?? 5) - 1]}` : "Mon–Fri";

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", paddingLeft: 48 }} data-testid="steps">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: "#0E1512" }}>Main sequence</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#9AA59E" }}> · {steps.length} steps · Email</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 15px" }}>
          🕐 {days} · {w ? `${w.start}–${w.end}` : "9:00–17:00"} · {w?.timezone ?? "UTC"} ⌄
        </span>
      </div>

      {mainPath(graph).map((n) => {
        if (n.type === "delay") {
          return (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 4px 26px" }}>
              <span style={{ width: 2, height: 32, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "5px 14px" }} data-testid="step-delay">⏱ Wait {n.amount} {n.amount === 1 ? n.unit.replace(/s$/, "") : n.unit}</span>
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
              <div onClick={guided ? () => { setBriefNode(n); setPreview(null); } : undefined} style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "15px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)", ...(guided ? { cursor: "pointer" } : {}) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#8A7F6B" }}>Step {idx}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: n.channel === "sms" ? "rgba(54,215,237,.14)" : "rgba(53,232,52,.13)", color: n.channel === "sms" ? "#1192A6" : "#16A82A" }} data-testid="step-channel-chip">{n.channel === "sms" ? "SMS" : "Email"}</span>
                  {/* G1 (DEC-070) / G2 (DEC-071): guided step = brief card — objective
                      + bullets, composed per lead at send time; per-channel credits
                      display-only (Q-020). */}
                  {guided ? (
                    <>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 7, padding: "3px 9px" }} data-testid="step-guided-tag">✦ Composed at send</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 7, padding: "3px 9px" }} data-testid="step-guided-credits">{n.channel === "sms" ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS} credits / send</span>
                    </>
                  ) : null}
                  {/* F1 (DEC-068): outcome badge — none renders nothing (honest absence) */}
                  <OutcomeBadge step={o} />
                  {/* live counts (checkpoints §4 wiring; no prototype anchor — §0 convention) */}
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#9AA59E" }} data-testid="step-stats">
                    {sent > 0 ? `${sent} sent · ${replies} repl${replies === 1 ? "y" : "ies"}` : "0 sent"}
                  </span>
                  {/* G3 (DEC-075): the read-only brief opens on click — an honest
                      "view", never the wizard's "✎ Edit". */}
                  {guided ? <span style={{ fontSize: 12, fontWeight: 600, color: "#1192A6", flex: "none" }} data-testid="step-view-brief">View brief ›</span> : null}
                </div>
                {guided ? (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#0E1512", marginBottom: 5 }}>{n.brief!.objective}</div>
                    {/* G2: the email brief's subject direction — a hint, never copy */}
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
      {/* M1b (DEC-068): reply-strategy steps — grouped under the branch they
          belong to, labeled by intent (designed grouping, flagged). */}
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
                  </div>
                  <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{sNode.content.body}</div>
                </div>
              </div>
            );
          })}
        </>
      ) : null}
      <div style={{ fontSize: 12, color: "#9AA59E", marginTop: 16, paddingLeft: 48 }}>
        Graph v{view.graphVersion ?? "—"} · {view.graphSource === "MANUAL" ? "manually edited" : "AI-planned"} — editing lives in the Create Agent wizard this phase.
      </div>

      {/* G3 (DEC-075): READ-ONLY brief drawer — the wizard drawer's anatomy
          with display values instead of inputs; the sample preview composes
          the SAVED brief through the real checks (free, Q-020). Editing stays
          in campaign setup — a launched agent's honest note replaces any
          dead button (W3-4 owns the sequence editor). */}
      {briefNode?.brief ? (() => {
        const b = briefNode.brief!;
        const sms = briefNode.channel === "sms";
        const stepNo = steps.indexOf(briefNode) + 1;
        const briefSent = outcomes?.steps.find((s) => s.stepNodeId === briefNode.id)?.sent ?? view.perStep[briefNode.id]?.sent ?? 0;
        const isDraft = view.agent.status === "DRAFT";
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
                    <span onClick={() => void sampleCompose()} style={{ fontSize: 12.5, fontWeight: 700, color: previewBusy ? "#9AA59E" : "#0A0F0C", background: previewBusy ? "#ECE7DC" : "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)", borderRadius: 9, padding: "7px 14px", cursor: previewBusy ? "default" : "pointer" }} data-testid="brief-viewer-preview-run">{previewBusy ? "Composing…" : "Compose sample"}</span>
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
                  <span style={{ fontSize: 12.5, color: "#9AA59E" }} data-testid="brief-viewer-readonly-note">Read-only — briefs are edited in campaign setup; editing a launched sequence arrives with the sequence editor.</span>
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
