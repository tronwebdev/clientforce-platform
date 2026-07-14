"use client";

/**
 * Step/brief editor drawer (W3-4, DEC-076 — extracted verbatim from the
 * wizard's Step2Sequence so the agent-view Steps tab reuses the SAME
 * component, never a fork). §3 (amended): 560px right drawer w/ STEP header,
 * deterministic deliverability rows, PERSONALIZATION token chips; G1/G2
 * brief editor with the real sample-compose panel. Host deltas ride props:
 * `onDelete` (dashboard delete-step, designed addition — no prototype
 * anchor) and `liveNotice` (the DEC-076 versioning sentence on launched
 * agents). All literals and testids are unchanged from the wizard.
 */
import {
  BRIEF_MUST_SAY_MAX,
  BRIEF_NEVER_SAY_MAX,
  BRIEF_SUBJECT_HINT_MAX,
  BRIEF_TALKING_POINTS_MAX,
  BRIEF_TALKING_POINTS_MIN,
  GUIDED_EMAIL_CREDITS,
  GUIDED_SMS_CREDITS,
} from "@clientforce/core";
import type { ContactFieldDefDto, GraphNode } from "@clientforce/core";
import { intentTint } from "../../lib/intents";
import { GRAD, LIVE_GRAPH_NOTICE, type BriefDraft, type PreviewState } from "./shared";

/** Personalization chips — the REAL merge-token set (P1.5 `renderTokens`);
 *  the prototype's `{{calendarLink}}` is omitted until a booking-link token exists. */
export const TOKENS = ["{{firstName}}", "{{lastName}}", "{{company}}", "{{senderName}}"];

/** Deterministic deliverability rows (owner review, PR #34): subject length,
 *  reading level, read time, links, "free" count — the AI-only score/verdict
 *  and spam-risk rows are omitted, never faked. */
export function emailChecks(subject: string, body: string) {
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

export interface StepEditorDrawerProps {
  editNode: GraphNode | null;
  editStepIndex: number;
  editStrategyIntent: string | null;
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
  fieldDefs: ContactFieldDefDto[];
  customTokenKey: string | null;
  setCustomTokenKey: React.Dispatch<React.SetStateAction<string | null>>;
  customFallback: string;
  setCustomFallback: React.Dispatch<React.SetStateAction<string>>;
  insertCustomToken: () => void;
  sampleCompose: () => Promise<void>;
  onClose: () => void;
  onSave: () => Promise<void>;
  /** W3-4: dashboard delete-step (designed addition — canon has no delete). */
  onDelete?: () => void;
  /** W3-4 (DEC-076): render the live-graph versioning notice (launched agents). */
  liveNotice?: boolean;
}

export function StepEditorDrawer(props: StepEditorDrawerProps) {
  const {
    editNode, editStepIndex, editStrategyIntent,
    editSubject, setEditSubject, editBody, setEditBody, editBrief, setEditBrief,
    briefPointInput, setBriefPointInput, briefMustInput, setBriefMustInput, briefNeverInput, setBriefNeverInput,
    previewBusy, preview, fieldDefs, customTokenKey, setCustomTokenKey, customFallback, setCustomFallback,
    insertCustomToken, sampleCompose, onClose, onSave, onDelete, liveNotice,
  } = props;
  if (!editNode || editNode.type !== "step") return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.4)", zIndex: 60 }}>
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
          <span onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }}>✕</span>
        </div>

        {/* W3-4 (DEC-076): the honest versioning line on a launched agent's graph */}
        {liveNotice ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#5C6B62", background: "#FBF7F0", borderBottom: "1px solid #EBE3D6", padding: "10px 22px", flex: "none" }} data-testid="live-graph-notice">
            <span style={{ flex: "none" }}>⏱</span>
            <span>{LIVE_GRAPH_NOTICE}</span>
          </div>
        ) : null}

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
          {/* W3-4: delete-step — designed addition (canon has no delete; the
              sub-campaign drawer's red footer action is the anatomy). */}
          {onDelete ? (
            <span onClick={onDelete} style={{ fontSize: 13, fontWeight: 700, color: "#C9543F", cursor: "pointer", whiteSpace: "nowrap" }} data-testid="step-delete">Delete step</span>
          ) : null}
          <span onClick={onClose} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
          <span onClick={() => void onSave()} style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 22px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }} data-testid="modal-save">{editBrief ? "Save brief" : "Save step"}</span>
        </div>
      </div>
    </div>
  );
}
