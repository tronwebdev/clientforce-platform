"use client";

import type { CampaignGraph, EffectiveCreditPrices, GraphNode, StepNode } from "@clientforce/core";
import { GUIDED_EMAIL_CREDITS, GUIDED_SMS_CREDITS, mainPath } from "@clientforce/core";
import { branchWhenLabel } from "../../../lib/intents";

/**
 * The ONE Bold sequence-line renderer (B2 canon, extracted for B2.5): the
 * vertical node line — step/delay/branch rows with DAY math and the per-step
 * credit chip (DEC-106 resolved prices; guided = the shipped compose
 * credits). BoldPlanView mounts it interactively (node click → sheet); the
 * create flow mounts it as the read-only plan preview. Never fork this line.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

/** Channel tile tones [glyph, bg, line, ink] + display labels. */
export const CH_TILE: Record<string, [string, string, string, string]> = {
  email: ["✉", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  sms: ["✆", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  whatsapp: ["◍", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  voice: ["☎", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"],
  linkedin: ["◫", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"],
};
export const CH_LABEL: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  voice: "Call",
  linkedin: "LinkedIn",
};

/** Per-step credit cost from the resolved price table (scripted) or the
 *  shipped compose credits (guided). null = no price data → no chip. */
export function stepCredits(step: StepNode, prices: EffectiveCreditPrices | null): number | null {
  if (step.mode === "guided") return step.channel === "sms" ? GUIDED_SMS_CREDITS : GUIDED_EMAIL_CREDITS;
  const action =
    step.channel === "sms"
      ? "sms_segment"
      : step.channel === "whatsapp"
        ? "whatsapp_msg"
        : step.channel === "voice"
          ? "voice_minute"
          : step.channel === "email"
            ? "email_send"
            : null;
  if (!action || !prices) return null;
  return prices.effective[action] ?? null;
}

export function delayInDays(n: { unit: string; amount: number }): number {
  return n.unit === "days" ? n.amount : n.unit === "hours" ? n.amount / 24 : n.amount / 1440;
}

export interface SequenceNodeRow {
  node: GraphNode;
  day: number;
}

/** Main-path rows with the DAY counter advanced by delays. */
export function sequenceRows(graph: CampaignGraph): SequenceNodeRow[] {
  let day = 1;
  return mainPath(graph).map((n) => {
    const row = { node: n, day: Math.max(1, Math.round(day)) };
    if (n.type === "delay") day += delayInDays(n);
    return row;
  });
}

export function BoldSequenceList({
  graph,
  prices,
  onNodeClick,
}: {
  graph: CampaignGraph;
  prices: EffectiveCreditPrices | null;
  /** Present → step/delay rows are clickable (the plan tab's sheets). */
  onNodeClick?: (node: GraphNode) => void;
}) {
  const rows = sequenceRows(graph);
  return (
    <>
      {rows.map(({ node: n, day: d }, i) => {
        const last = i === rows.length - 1;
        const clickable = onNodeClick != null && (n.type === "step" || n.type === "delay");
        const rowStyle = { display: "flex", gap: 18, cursor: clickable ? "pointer" : "default" } as const;
        const onClick = clickable ? () => onNodeClick(n) : undefined;
        if (n.type === "step") {
          const tile = CH_TILE[n.channel] ?? CH_TILE.email!;
          const credits = stepCredits(n, prices);
          const title = n.content.subject?.trim() || CH_LABEL[n.channel] || n.channel;
          const body =
            n.mode === "guided"
              ? `Guided — Ada composes from the brief at send time. ${n.brief?.objective ?? ""}`.trim()
              : (n.content.body ?? "").trim() || "No copy yet.";
          return (
            <div key={n.id} onClick={onClick} data-testid={`bold-plan-node-${n.id}`} style={rowStyle}>
              <div style={{ width: 40, flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ width: 40, height: 40, borderRadius: 14, flex: "none", background: tile[1], border: `1px solid ${tile[2]}`, color: tile[3], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
                  {tile[0]}
                </span>
                <span style={{ width: 2, flex: 1, background: "var(--cvb-line-inner)", minHeight: last ? 0 : 26 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 26 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span className="cvb-display" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em" }}>{title}</span>
                  <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".12em", color: "var(--cvb-faint)" }}>
                    {/* sms prices are PER SEGMENT — never claim per send. */}
                    DAY {d}
                    {credits != null ? ` · ${credits} CREDIT${credits === 1 ? "" : "S"} / ${n.channel === "sms" && n.mode !== "guided" ? "SEGMENT" : "SEND"}` : ""}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 6, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                  {body}
                </div>
              </div>
            </div>
          );
        }
        if (n.type === "delay") {
          return (
            <div key={n.id} onClick={onClick} data-testid={`bold-plan-node-${n.id}`} style={rowStyle}>
              <div style={{ width: 40, flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ width: 40, height: 40, borderRadius: 14, flex: "none", background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", color: "var(--cvb-faint)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
                  ◷
                </span>
                <span style={{ width: 2, flex: 1, background: "var(--cvb-line-inner)", minHeight: last ? 0 : 26 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 26 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span className="cvb-display" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em" }}>Wait</span>
                  <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".12em", color: "var(--cvb-faint)" }}>
                    {n.amount} {n.unit.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          );
        }
        if (n.type === "branch") {
          return (
            <div key={n.id} data-testid={`bold-plan-node-${n.id}`} style={{ display: "flex", gap: 18 }}>
              <div style={{ width: 40, flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ width: 40, height: 40, borderRadius: 14, flex: "none", background: "var(--cvb-amber-bg)", border: "1px solid var(--cvb-amber-line)", color: "var(--cvb-amber)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
                  ⎇
                </span>
                <span style={{ width: 2, flex: 1, background: "var(--cvb-line-inner)", minHeight: last ? 0 : 26 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 26 }}>
                <div className="cvb-display" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em" }}>
                  {n.on === "reply" ? "When they reply" : `On ${n.on.replace(/_/g, " ")}`}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 6 }}>
                  {n.cases.map((c) => branchWhenLabel(c.when)).join(" · ")}
                </div>
              </div>
            </div>
          );
        }
        if (n.type === "end") return null;
        return (
          <div key={n.id} style={{ display: "flex", gap: 18 }} data-testid={`bold-plan-node-${n.id}`}>
            <div style={{ width: 40, flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ width: 40, height: 40, borderRadius: 14, flex: "none", background: "var(--cvb-slate-tint)", border: "1px solid var(--cvb-slate-line)", color: "var(--cvb-slate)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
                ◇
              </span>
              <span style={{ width: 2, flex: 1, background: "var(--cvb-line-inner)", minHeight: last ? 0 : 26 }} />
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 26 }}>
              <div className="cvb-display" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-.028em" }}>
                {n.type === "subcampaign" ? n.ref : n.type}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
