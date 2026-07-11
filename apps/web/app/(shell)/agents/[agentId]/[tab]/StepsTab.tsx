"use client";

/**
 * Steps tab (checkpoints §4) — the persisted CampaignGraph, read-only (editing
 * stays in the wizard, noted in PROGRESS). Per-step sent/reply counts come
 * from live Message rows (checkpoints requirement; the prototype's sequence
 * cards carry no stat chips — §0 convention addition, flagged).
 */
import type { AgentViewData } from "./AgentView";
import { intentTint } from "./shared";
import { mainPath, mainSteps, strategyStepsOf } from "../../../../../lib/graph-path";

export function StepsTab({ view }: { view: AgentViewData | null }) {
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
  // M1b (DEC-066): the tab lists the MAIN PATH — reply-strategy steps render
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
          const stats = view.perStep[n.id];
          return (
            <div key={n.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }} data-testid="step-card">
              {/* P2.1 (DEC-061, §3/§4 amendment): ChannelChip anatomy — sms steps
                  reuse the same card with channel-true icon + chip tint. */}
              <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", background: n.channel === "sms" ? "rgba(54,215,237,.16)" : "rgba(53,232,52,.16)", color: n.channel === "sms" ? "#1192A6" : "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>{n.channel === "sms" ? "💬" : "✉"}</span>
              <div style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "15px 18px", boxShadow: "0 4px 16px rgba(14,21,18,.04)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#8A7F6B" }}>Step {idx}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 10px", background: n.channel === "sms" ? "rgba(54,215,237,.14)" : "rgba(53,232,52,.13)", color: n.channel === "sms" ? "#1192A6" : "#16A82A" }} data-testid="step-channel-chip">{n.channel === "sms" ? "SMS" : "Email"}</span>
                  {/* live counts (checkpoints §4 wiring; no prototype anchor — §0 convention) */}
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#9AA59E" }} data-testid="step-stats">
                    {stats ? `${stats.sent} sent · ${stats.replies} repl${stats.replies === 1 ? "y" : "ies"}` : "0 sent"}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#0E1512", marginBottom: 4 }}>{n.channel === "sms" ? "SMS message" : n.content.subject}</div>
                <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.content.body}</div>
              </div>
            </div>
          );
        }
        if (n.type === "branch") {
          return (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0 4px 26px" }}>
              <span style={{ width: 2, height: 24, background: "#D8CFBE", marginLeft: 17, flex: "none" }} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid rgba(54,215,237,.4)", borderRadius: 100, background: "rgba(54,215,237,.08)", padding: "5px 14px", fontSize: 12.5, fontWeight: 600, color: "#1192A6" }} data-testid="step-branch">
                {/* M1b (DEC-066): vocabulary labels, verbatim fallback for unknown intents */}
                ⎇ on reply → {n.cases.map((c) => (c.when === "default" ? "default" : intentTint(c.when.intent).label)).join(" · ")}
              </span>
            </div>
          );
        }
        return null;
      })}
      {/* M1b (DEC-066): reply-strategy steps — grouped under the branch they
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
    </div>
  );
}
