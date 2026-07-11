"use client";

import { useState } from "react";
import { BUSINESS_CATEGORIES, goalTerminalLabel } from "@clientforce/core";
import { GOALS, GRAD, ING_PILL, SRC_ICON, SRC_KIND_LABEL, inp, type AddMode, type Citation, type ContextField, type Gap, type KnowledgeSource } from "../shared";

const CATEGORIES = BUSINESS_CATEGORIES;

/* ── step 1 (goal + knowledge + citations + gaps + method) ────────────────── */
export function Step1(props: {
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
