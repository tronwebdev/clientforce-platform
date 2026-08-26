"use client";

import { useState } from "react";
import type { AgentListItem } from "@clientforce/core";
import { goalSentence, goalValueMeta } from "@clientforce/core";
import { money } from "./bold-live";

/**
 * The all-campaigns page (B1, prototype `vCamps`) — live AgentListItem rows.
 * Ada's inline proposal rows (amber spine · "Ada's idea" pill · Start) have
 * NO shipped source (Q-066): the composition waits for B2.6, the suggested-
 * campaigns wave, rather than rendering canned AI as live. "New campaign"
 * opens the B2.5 Bold creation flow (DEC-108) — one create path, in Bold.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

const STATUS_PILL: Record<string, [string, string, string, string]> = {
  ACTIVE: ["Live", "var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"],
  PAUSED: ["Paused", "var(--cvb-amber)", "var(--cvb-amber-bg)", "var(--cvb-amber-line)"],
  DRAFT: ["Draft", "var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)"],
};
const CH_TONES: Record<string, [string, string, string, string]> = {
  email: ["✉", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  sms: ["✆", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  voice: ["☎", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"],
  call: ["☎", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"],
  whatsapp: ["◍", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
};

export function BoldCampaignsView({
  agents,
  suggestions,
  onSelect,
  onNew,
  onStartSuggestion,
  onDismissSuggestion,
}: {
  agents: AgentListItem[];
  /** B2.6 (DEC-110): non-dismissed Ada-suggested drafts — their own rows. */
  suggestions: AgentListItem[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onStartSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
}) {
  const [filter, setFilter] = useState("All");
  const filters = ["All", "Live", "Needs you", "Drafts"];
  const suggested = new Set(suggestions.map((g) => g.id));
  const shown = agents.filter((a) => {
    if (suggested.has(a.id)) return false; // suggested drafts render above
    if (filter === "Live") return a.status === "ACTIVE";
    if (filter === "Drafts") return a.status === "DRAFT";
    if (filter === "Needs you") return a.status === "PAUSED" || a.health === "Warn";
    return true;
  });

  return (
    <div style={{ padding: "26px 40px 40px" }} data-testid="bold-camps-page">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 4, background: "var(--cvb-well)", borderRadius: 12, padding: 4 }}>
          {filters.map((f) => (
            <span
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                padding: "8px 14px",
                borderRadius: 9,
                cursor: "pointer",
                background: filter === f ? "var(--cvb-card)" : "transparent",
                color: filter === f ? "var(--cvb-ink)" : "var(--cvb-faint)",
              }}
            >
              {f}
            </span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span
          onClick={onNew}
          data-testid="bold-new-campaign"
          style={{ fontSize: 12.5, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 12, padding: "11px 17px", cursor: "pointer" }}
        >
          New campaign
        </span>
      </div>

      {suggestions.map((g) => (
        <div
          key={g.id}
          onClick={() => onStartSuggestion(g.id)}
          data-testid={`bold-sugg-row-${g.id}`}
          style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 4px", borderBottom: "1px solid var(--cvb-line-2)", cursor: "pointer", flexWrap: "wrap" }}
        >
          <span style={{ width: 4, height: 44, borderRadius: 2, background: "var(--cvb-dot-amber)", flex: "none" }} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="cvb-display" style={{ fontWeight: 900, fontSize: 17, letterSpacing: "-.028em" }}>{g.name}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "2px 8px" }}>
                ✦ Ada's idea
              </span>
            </div>
            {/* The reason is a data-derived count line, never invented narrative. */}
            <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>{g.suggestion?.reason}</div>
          </div>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onStartSuggestion(g.id);
            }}
            style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 10, padding: "8px 14px", cursor: "pointer", flex: "none" }}
          >
            Start
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onDismissSuggestion(g.id);
            }}
            title="Not now"
            style={{ fontSize: 12, color: "var(--cvb-ghost)", cursor: "pointer", flex: "none", padding: "8px 6px" }}
          >
            ✕
          </span>
        </div>
      ))}
      {shown.map((a) => {
        const meta = goalValueMeta(a.goal);
        const st = STATUS_PILL[a.status] ?? STATUS_PILL.DRAFT!;
        const monetary = meta.monetary && a.valueEstCents != null && a.valueEstCents > 0;
        const hero =
          meta.heroMode === "money" && monetary && a.bookings > 0
            ? money(a.valueEstCents! * a.bookings)
            : a.bookings > 0
              ? String(a.bookings)
              : "—";
        const heroL = a.bookings > 0 ? a.goalPill.toUpperCase() : a.status === "DRAFT" ? "NOT STARTED" : "NO RESULTS YET";
        const pct = a.valueGoalUnits ? Math.min(100, Math.round((a.bookings / a.valueGoalUnits) * 100)) : null;
        return (
          <div
            key={a.id}
            onClick={() => onSelect(a.id)}
            data-testid={`bold-camprow-${a.id}`}
            style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 4px", borderBottom: "1px solid var(--cvb-line-2)", cursor: "pointer", flexWrap: "wrap" }}
          >
            <span style={{ width: 4, height: 44, borderRadius: 2, background: st[1], flex: "none" }} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="cvb-display" style={{ fontWeight: 900, fontSize: 17, letterSpacing: "-.028em" }}>{a.name}</span>
                {a.goalMet ? (
                  <span style={{ ...mono, fontSize: 8.5, fontWeight: 600, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "1px 6px" }}>
                    ✓ GOAL MET
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>
                {meta.kindLabel} · {goalSentence(a.goal, a.goalSummary)}
              </div>
            </div>
            <div style={{ width: 108, flex: "none" }}>
              <div className="cvb-display" style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.03em", color: a.bookings > 0 ? "var(--cvb-forest)" : "var(--cvb-faint)" }}>{hero}</div>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--cvb-faint)", marginTop: 3 }}>{heroL}</div>
            </div>
            <div style={{ width: 118, flex: "none" }}>
              <div style={{ height: 5, borderRadius: 3, background: "var(--cvb-line-inner)", overflow: "hidden" }}>
                <span style={{ display: "block", height: 5, width: `${pct ?? 0}%`, background: pct ? "var(--cvb-gradient-mark)" : "var(--cvb-line-ctl)", borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 6 }}>{pct != null ? `${pct}% of goal` : "no target set"}</div>
            </div>
            <div style={{ display: "flex", gap: 5, flex: "none" }}>
              {a.channels.map((ch) => {
                const t = CH_TONES[ch] ?? CH_TONES.email!;
                return (
                  <span key={ch} title={ch} style={{ width: 22, height: 22, borderRadius: 7, background: t[1], border: `1px solid ${t[2]}`, color: t[3], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>
                    {t[0]}
                  </span>
                );
              })}
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: st[1], background: st[2], border: `1px solid ${st[3]}`, borderRadius: 999, padding: "4px 10px", flex: "none" }}>{st[0]}</span>
            <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", width: 62, flex: "none", textAlign: "right" }}>
              {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
        );
      })}
      {shown.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cvb-muted)" }}>No campaigns match that filter</div>
          <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 6 }}>Try another one.</div>
        </div>
      ) : null}
    </div>
  );
}
