"use client";

/**
 * Agent view (C2.4, checkpoints §4) — record header + 8-tab bar ported from
 * `Campaign View.dc.html`; 5 tabs wired (inbox·steps·leads·settings·logs),
 * 3 inert-but-visible (calls·preview·stats). A4: 5s polling on Inbox/Logs and
 * the open lead drawer. Prototype literals bind composition; values are live.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CampaignGraph } from "@clientforce/core";
import { InboxTab } from "./InboxTab";
import { LeadsTab } from "./LeadsTab";
import { LogsTab } from "./LogsTab";
import { SettingsTab } from "./SettingsTab";
import { StepsTab } from "./StepsTab";
import { cf, GRAD, GOAL_EMOJI, TABS } from "./shared";

export interface AgentViewData {
  agent: { id: string; name: string; goal: string; status: string; createdAt: string };
  campaign: { id: string; name: string } | null;
  graph: CampaignGraph | null;
  graphVersion: number | null;
  graphSource: string | null;
  sentToday: number;
  dailyCap: number | null;
  guardrails: {
    sendingWindow: { days: number[]; start: string; end: string; timezone: string };
    dailyCap: { email: number };
    unsubscribeFooter: true;
    suppressionCheck: true;
  } | null;
  perStep: Record<string, { sent: number; replies: number }>;
  eventCounts: Record<string, number>;
}

export function AgentView({ agentId, tab }: { agentId: string; tab: string }) {
  const router = useRouter();
  const [view, setView] = useState<AgentViewData | null>(null);
  const [error, setError] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const refresh = useCallback(async () => {
    try {
      const v = (await cf(`agents/${agentId}/view`)) as AgentViewData;
      setView(v);
      setError(false);
    } catch {
      setError(true);
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = view?.agent.status === "ACTIVE";

  async function toggleStatus() {
    if (!view) return;
    await cf(`agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: active ? "PAUSED" : "ACTIVE" }),
    }).catch(() => {});
    void refresh();
  }

  async function saveName() {
    const name = nameDraft.trim();
    setRenaming(false);
    if (!view || !name || name === view.agent.name) return;
    await cf(`agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ name }) }).catch(() => {});
    void refresh();
  }

  const emoji = useMemo(() => GOAL_EMOJI[view?.agent.goal ?? ""] ?? "🌱", [view?.agent.goal]);

  return (
    <div style={{ padding: "24px 26px 26px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* record header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
        <a href="/agents" style={{ textDecoration: "none", width: 36, height: 36, borderRadius: 10, background: "#fff", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#5C6B62", fontSize: 18, flex: "none" }}>‹</a>
        <span style={{ width: 46, height: 46, borderRadius: 13, flex: "none", background: "rgba(53,232,52,.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{emoji}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {renaming ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(e) => e.key === "Enter" && void saveName()}
                style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 24, letterSpacing: "-.02em", color: "#0E1512", border: "1px solid #EBE3D6", borderRadius: 8, padding: "0 8px", background: "#fff" }}
                data-testid="rename-input"
              />
            ) : (
              <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 24, letterSpacing: "-.02em", color: "#0E1512" }} data-testid="agent-name">{view?.agent.name ?? "…"}</span>
            )}
            <span onClick={() => { setNameDraft(view?.agent.name ?? ""); setRenaming(true); }} style={{ color: "#9AA59E", fontSize: 15, cursor: "pointer" }} data-testid="rename">✎</span>
          </div>
          <div style={{ fontSize: 13, color: "#9AA59E" }}>
            Agent ID: {agentId.slice(-4)} · Outbound · Email
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "8px 14px" }} data-testid="daily-sends">
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#8A7F6B" }}>Daily sends</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{view?.sentToday ?? 0} / {view?.dailyCap ?? "—"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: active ? "#16A82A" : "#8A7F6B" }}>{active ? "Active" : view?.agent.status === "PAUSED" ? "Paused" : "Draft"}</span>
            <span onClick={() => void toggleStatus()} style={{ width: 44, height: 26, borderRadius: 100, background: active ? "linear-gradient(135deg,#36D7ED,#35E834 60%,#D0F56B)" : "#D8CFBE", position: "relative", display: "inline-block", cursor: "pointer" }} data-testid="status-toggle">
              <span style={{ position: "absolute", top: 3, ...(active ? { right: 3 } : { left: 3 }), width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
            </span>
          </div>
        </div>
      </div>

      {/* tab bar — active = brand gradient (prototype; checkpoints §4 "ink fill" was stale) */}
      <div style={{ display: "flex", gap: 4, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: 5, marginBottom: 18 }} data-testid="tab-bar">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <div
              key={t.id}
              onClick={() => router.push(`/agents/${agentId}/${t.id}`)}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 6px", borderRadius: 10, fontSize: 13.5, cursor: "pointer", fontWeight: on ? 700 : 500, color: on ? "#0A0F0C" : "#5C6B62", background: on ? GRAD : "transparent", whiteSpace: "nowrap" }}
              data-testid={`tab-${t.id}`}
            >
              <span style={{ fontSize: 14 }}>{t.icon}</span>{t.label}
            </div>
          );
        })}
      </div>

      <div style={{ minHeight: 664 }}>
        {error ? (
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: "48px 20px", textAlign: "center" }} data-testid="view-error">
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 4 }}>Couldn&apos;t load this agent</div>
            <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 14 }}>Check your connection and try again.</div>
            <button type="button" onClick={() => void refresh()} style={{ background: GRAD, border: "none", borderRadius: 11, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}>Retry</button>
          </div>
        ) : tab === "inbox" ? (
          <InboxTab agentId={agentId} />
        ) : tab === "steps" ? (
          <StepsTab view={view} />
        ) : tab === "leads" ? (
          <LeadsTab agentId={agentId} view={view} onChanged={refresh} />
        ) : tab === "settings" ? (
          <SettingsTab agentId={agentId} view={view} onChanged={refresh} />
        ) : tab === "logs" ? (
          <LogsTab agentId={agentId} />
        ) : (
          <InertTab tab={tab} />
        )}
      </div>
    </div>
  );
}

/** Calls/Preview/Stats — visible, disabled-with-reason (§4: never deleted). */
function InertTab({ tab }: { tab: string }) {
  const copy: Record<string, { icon: string; title: string; body: string }> = {
    calls: { icon: "☎", title: "Calls arrive with the voice channel", body: "AI voice calls, transcripts and outcomes land here when the voice channel ships — your email sequence keeps running meanwhile." },
    preview: { icon: "◉", title: "Preview arrives with a later phase", body: "A live render of every step as the lead sees it." },
    stats: { icon: "▤", title: "Stats arrive with a later phase", body: "Deliverability, reply and booking analytics across the sequence." },
  };
  const c = copy[tab]!;
  return (
    <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", padding: "64px 20px", textAlign: "center" }} data-testid={`inert-${tab}`}>
      <div style={{ fontSize: 30, marginBottom: 12 }}>{c.icon}</div>
      <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20, color: "#0E1512", marginBottom: 6 }}>{c.title}</div>
      <div style={{ fontSize: 13.5, color: "#8A7F6B", maxWidth: 420, margin: "0 auto" }}>{c.body}</div>
    </div>
  );
}
