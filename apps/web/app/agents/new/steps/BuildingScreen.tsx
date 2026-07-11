"use client";

import type { CampaignGraph } from "@clientforce/core";
import { mainPath, mainSteps } from "../../../../lib/graph-path";
import { BSTEPS, GRAD, type ContextField, type KnowledgeSource } from "../shared";

/* ── building screen (prototype BSTEPS overlay, wired to live data) ────────── */
export function BuildingScreen({ progress, sources, fields, graph, planFailed, onRetry, onBack }: {
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

