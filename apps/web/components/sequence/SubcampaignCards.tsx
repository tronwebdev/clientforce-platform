"use client";

/**
 * Sub-campaign canon cards (W2, PR #94 — Campaign View canon). ONE
 * presentational section for BOTH hosts (wizard step-2 Branches view ·
 * agent-view Steps tab), the StepEditorDrawer precedent: host deltas ride
 * props only — the ✦ AI chip (wizard in-session provenance only), the
 * expansion slot (Steps-tab inline chain editing) and the callbacks.
 * Anatomy: divider ("↳ N sub-campaigns based on contact behaviour" + 1px
 * line), 2-col grid of cards (trigger chip · title = SubcampaignNode.ref ·
 * dark step pills · "N steps · D days" meta · "Edit ›"), then the dashed
 * "Add a sub-campaign" card.
 */
import { useState } from "react";
import type { GraphNode, StepNode } from "@clientforce/core";

export interface SubcampaignCardData {
  /** The SubcampaignNode's id (rules target it; expansion keys on it). */
  id: string;
  /** Owner-facing branch name — `SubcampaignNode.ref`. */
  name: string;
  /** Trigger chip text from the matching CampaignRule; null → "Rule pending" (honest absence). */
  chip: string | null;
  /**
   * "✦ AI" chip — IN-SESSION provenance only (the wizard knows what it just
   * built). The dashboard never sets this: provenance isn't persisted by the
   * API, so rendering the canon chip there would be silent fakery — the chip
   * awaits persisted provenance (recorded as a DEC note).
   */
  ai?: boolean;
  /** Step pill texts, in chain order. */
  pills: string[];
  stepCount: number;
  days: number;
}

/** A chain step's pill/preview text — subject, else body, else the brief. */
export function stepPillText(n: StepNode): string {
  const raw =
    (n.mode === "guided" && n.brief ? n.brief.objective : n.content.subject?.trim() || n.content.body?.trim()) ?? "";
  const text = raw.replace(/\s+/g, " ").trim() || (n.channel === "sms" ? "SMS" : "Email");
  return text.length > 26 ? `${text.slice(0, 25)}…` : text;
}

/** "N steps · D days" inputs, computed from the container chain. */
export function chainMeta(chain: GraphNode[]): { steps: StepNode[]; days: number } {
  const steps = chain.filter((n): n is StepNode => n.type === "step");
  const days = Math.round(
    chain.reduce(
      (acc, n) =>
        n.type === "delay"
          ? acc + (n.unit === "days" ? n.amount : n.unit === "hours" ? n.amount / 24 : n.amount / 1440)
          : acc,
      0,
    ),
  );
  return { steps, days };
}

export function SubcampaignSection({
  cards,
  expandedId,
  expanded,
  onEdit,
  onAdd,
}: {
  cards: SubcampaignCardData[];
  /** Steps-tab inline chain editing: the card whose chain renders below. */
  expandedId?: string | null;
  /** Host-rendered expansion (chain rows + add-step), under the grid. */
  expanded?: React.ReactNode;
  onEdit?: (id: string) => void;
  onAdd: () => void;
}) {
  const [addHover, setAddHover] = useState(false);
  return (
    <div data-testid="subcampaigns">
      {cards.length > 0 ? (
        <>
          {/* Campaign View canon divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 12px" }} data-testid="subcampaigns-divider">
            <span style={{ fontSize: 12, fontWeight: 600, color: "#9AA59E", flex: "none" }}>
              ↳ {cards.length} sub-campaign{cards.length === 1 ? "" : "s"} based on contact behaviour
            </span>
            <span style={{ flex: 1, height: 1, background: "#EBE3D6" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {cards.map((c) => (
              <div key={c.id} style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, padding: "13px 15px", boxShadow: "0 4px 16px rgba(14,21,18,.04)", minWidth: 0, ...(expandedId === c.id ? { borderColor: "#9FD8AC" } : {}) }} data-testid="subcampaign-card">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  {c.chip !== null ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(54,215,237,.4)", borderRadius: 100, background: "rgba(54,215,237,.08)", padding: "3px 10px", fontSize: 11.5, fontWeight: 600, color: "#1192A6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="subcampaign-trigger-chip">{c.chip}</span>
                  ) : (
                    /* No enabled rule row matches this container — honest absence. */
                    <span style={{ borderRadius: 100, background: "#F2EEE4", padding: "3px 10px", fontSize: 11.5, fontWeight: 600, color: "#8A7F6B", whiteSpace: "nowrap" }} data-testid="subcampaign-trigger-chip">Rule pending</span>
                  )}
                  {c.ai ? (
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 100, padding: "2px 7px", flex: "none" }} data-testid="subcampaign-ai-chip">✦ AI</span>
                  ) : null}
                  {onEdit ? (
                    <span onClick={() => onEdit(c.id)} style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: "#16A82A", cursor: "pointer", flex: "none", whiteSpace: "nowrap" }} data-testid="subcampaign-edit">Edit ›</span>
                  ) : null}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                {c.pills.length > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, overflowX: "auto", paddingBottom: 2, marginBottom: 7 }}>
                    {c.pills.map((p, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, flex: "none" }}>
                        {/* proto p.bg dark pill — #0E1512 per canon */}
                        <span style={{ background: "#0E1512", color: "#fff", borderRadius: 9, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>{p}</span>
                        {i < c.pills.length - 1 ? <span style={{ color: "#C2B79F", fontSize: 10 }}>→</span> : null}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 7 }}>No steps yet</div>
                )}
                <div style={{ fontSize: 12, color: "#9AA59E" }} data-testid="subcampaign-meta">
                  {c.stepCount} step{c.stepCount === 1 ? "" : "s"} · {c.days} day{c.days === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {expanded}
      {/* LIVE add card (replaces the W3-4 honest-absence card — R1's trigger
          vocabulary shipped, so the pick is real now). */}
      <div
        onClick={onAdd}
        onMouseEnter={() => setAddHover(true)}
        onMouseLeave={() => setAddHover(false)}
        style={{ display: "flex", alignItems: "center", gap: 12, border: `1.5px dashed ${addHover ? "#9FD8AC" : "#D8CFBE"}`, borderRadius: 13, background: addHover ? "rgba(53,232,52,.04)" : "transparent", padding: "13px 16px", marginTop: 12, cursor: "pointer" }}
        data-testid="add-subcampaign"
      >
        <span style={{ width: 34, height: 34, borderRadius: 10, background: "#F2EEE4", color: "#5C6B62", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, flex: "none" }}>+</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#5C6B62" }}>Add a sub-campaign</div>
          <div style={{ fontSize: 12, color: "#9AA59E", marginTop: 2 }}>Create a branch triggered by a specific contact behaviour or rule.</div>
        </div>
        <span style={{ color: "#C2B79F", fontSize: 15, flex: "none" }}>›</span>
      </div>
    </div>
  );
}
