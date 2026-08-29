"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { AgentListItem, MeNeedsResponse } from "@clientforce/core";
import { goalValueMeta } from "@clientforce/core";
import type { Me } from "../../lib/types";
import { fetchCoreSummary, money, type CoreSummary } from "./bold-live";
import { FIXTURE_ALWAYS_ON } from "./bold-data";

const mono: CSSProperties = { fontFamily: "var(--cvb-font-mono)" };

interface BoldRailProps {
  /** B4 (DEC-124): the one-flag widget truth (null while loading). */
  widgetOverview?: import("./bold-live").WidgetOverview | null;
  me: Me;
  open: boolean;
  agents: AgentListItem[];
  /** B2.6 (DEC-110): non-dismissed Ada-suggested drafts — the ✦ block's rows.
   *  They render THERE, not in the campaigns list (no double rows). */
  suggestions: AgentListItem[];
  onStartSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
  activeCampId: string | null;
  needs: MeNeedsResponse | null;
  onFocus: () => void;
  onOpenRail: () => void;
  onOpenWsPicker: () => void;
  onSelectCampaign: (id: string) => void;
  onAllCampaigns: () => void;
  onSelectSurface: (key: "chatbot" | "rcp" | "wssettings" | "credits") => void;
}

/** Rail campaign-row live value: `8/12` with a target, money when est set,
 *  the bare completion count otherwise, `—` before anything happened. */
function railValue(a: AgentListItem): string {
  if (a.valueGoalUnits) return `${a.bookings}/${a.valueGoalUnits}`;
  const meta = goalValueMeta(a.goal);
  if (meta.monetary && a.valueEstCents && a.bookings > 0) return money(a.valueEstCents * a.bookings);
  return a.bookings > 0 ? String(a.bookings) : "—";
}

/**
 * The 228px rail — four blocks in fixed order (ADDENDUM_4_BOLD §2). B1: the
 * CAMPAIGNS block reads live AgentListItem rows and the workspace card's
 * amber pill reads real cross-workspace needs (GET /me/needs). Ada's
 * suggestion block waits for a real proposal source (Q-066). ALWAYS ON and
 * the core card stay clearly-marked fixture until B4/B7.
 */
export function BoldRail(props: BoldRailProps) {
  const { me, needs, suggestions } = props;
  // Suggested drafts live in the ✦ block below, never as campaign rows.
  const agents = props.agents.filter((a) => !suggestions.some((g) => g.id === a.id));
  const wsName = me.activeWorkspace?.name ?? "Workspace";
  // B7 (DEC-132): the core card goes LIVE — facts/gaps/credits are queries
  // now (the B0 fixture is retired); nulls render as quiet dashes, never a
  // canned number.
  const [core, setCore] = useState<CoreSummary | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchCoreSummary(props.agents).then((s) => {
      if (alive) setCore(s);
    });
    return () => {
      alive = false;
    };
    // Keyed on the campaign COUNT deliberately: a re-fetch per row identity
    // change would hammer the gap reports for no new information.
    // eslint-disable-next-line
  }, [props.agents.length, me.activeWorkspace?.id]);
  const sectorLine = core
    ? [core.vertical ? core.vertical.charAt(0).toUpperCase() + core.vertical.slice(1) : null, core.location]
        .filter(Boolean)
        .join(" · ") || "Your business, in her hands"
    : "…";
  const creditPct =
    core?.balance != null && core.monthStartBalance != null && core.monthStartBalance > 0
      ? Math.max(0, Math.min(100, Math.round((core.balance / core.monthStartBalance) * 100)))
      : null;
  const wsIndex = Math.max(
    0,
    me.memberships.findIndex((m) => m.workspaceId === me.activeWorkspace?.id),
  );
  const topElsewhere = needs?.elsewhere[0] ?? null;

  return (
    <div className="cvb-rail-wrap" data-open={props.open ? "true" : "false"} data-testid="bold-rail">
      <div className="cvb-rail" aria-hidden={!props.open}>
        {/* Block 1 — workspace card (a real selector, not decoration) + focus capsule. */}
        <div className="cvb-ws-row">
          <div data-tour="ws" data-testid="bold-ws-card" className="cvb-ws-card" onClick={props.onOpenWsPicker}>
            {/* Brand mark — mirrored from packages/theme/assets/mark.svg. */}
            <img src="/bold/mark.svg" alt="" style={{ width: 28, height: 28 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  data-testid="bold-ws-name"
                  style={{
                    fontWeight: 800,
                    fontSize: 13.5,
                    letterSpacing: "-.022em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {wsName}
                </span>
                <span style={{ fontSize: 9, color: "var(--cvb-faint)", flex: "none" }}>▾</span>
              </div>
              <div
                style={{
                  ...mono,
                  fontSize: 10,
                  letterSpacing: ".13em",
                  color: "var(--cvb-faint)",
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                WORKSPACE · {wsIndex + 1} OF {me.memberships.length}
              </div>
            </div>
            {/* B1: the cross-workspace needs pill, on REAL data (owner-filed on
                the B0 review). Hidden when nothing waits elsewhere. */}
            {needs && needs.totalElsewhere > 0 ? (
              <span
                data-testid="bold-ws-needs"
                title={topElsewhere ? `${topElsewhere.name} has ${topElsewhere.repliesWaiting} repl${topElsewhere.repliesWaiting === 1 ? "y" : "ies"} waiting` : ""}
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "var(--cvb-amber)",
                  background: "var(--cvb-amber-bg)",
                  border: "1px solid var(--cvb-amber-line)",
                  borderRadius: 999,
                  padding: "3px 7px",
                  flex: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {needs.totalElsewhere} elsewhere
              </span>
            ) : null}
          </div>
          <span className="cvb-capsule" role="button" title="Focus — collapse the rail" data-testid="bold-focus-capsule" onClick={props.onFocus}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--cvb-forest)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 17l-5-5 5-5" />
              <path d="M18 17l-5-5 5-5" opacity=".4" />
            </svg>
          </span>
        </div>

        <div className="cvb-rail-mid">
          {/* Block 2 — CAMPAIGNS, live (B1). */}
          <div data-tour="camps" className="cvb-rail-camps">
            <div className="cvb-rail-eyebrow">
              <span style={{ flex: 1 }}>CAMPAIGNS · {agents.length}</span>
              <span
                onClick={props.onAllCampaigns}
                style={{ fontFamily: "var(--cvb-font-ui)", fontSize: 11, fontWeight: 700, color: "var(--cvb-cyan)", cursor: "pointer", letterSpacing: 0 }}
              >
                All
              </span>
            </div>
            <div className="cvb-rail-camps-list" data-testid="bold-camps-list">
              {agents.map((a) => {
                const active = props.activeCampId === a.id;
                const dot =
                  a.status === "ACTIVE" ? "var(--cvb-forest)" : a.status === "PAUSED" ? "var(--cvb-dot-amber)" : "var(--cvb-faint)";
                return (
                  <div
                    key={a.id}
                    className="cvb-camp-row"
                    data-active={active ? "true" : "false"}
                    data-testid={`bold-camp-${a.id}`}
                    onClick={() => props.onSelectCampaign(a.id)}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flex: "none" }} />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontWeight: active ? 700 : 500,
                        letterSpacing: "-.012em",
                        color: active ? "var(--cvb-ink)" : "var(--cvb-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.name}
                    </span>
                    {a.goalMet ? (
                      <span
                        title={`${a.goalPill} — goal met`}
                        style={{ ...mono, fontSize: 9.5, color: "var(--cvb-forest)", border: "1px solid var(--cvb-forest)", borderRadius: 999, padding: "1px 6px", flex: "none" }}
                      >
                        ✓
                      </span>
                    ) : null}
                    <span style={{ ...mono, fontSize: 10.5, color: active ? "var(--cvb-forest)" : "var(--cvb-muted)", flex: "none" }}>{railValue(a)}</span>
                  </div>
                );
              })}
              {agents.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", padding: "10px 13px", lineHeight: 1.5 }}>
                  No campaigns yet.
                </div>
              ) : null}
            </div>
          </div>

          {/* Block 2.5 — ✦ ADA SUGGESTS (B2.6, Q-066 closed): REAL suggested
              drafts from the deterministic sweep. Start opens the create flow
              on the draft; ✕ dismisses (the signal never re-suggests). */}
          {suggestions.length > 0 ? (
            <div data-tour="sugg" style={{ flex: "none" }} data-testid="bold-suggests">
              <div className="cvb-rail-eyebrow" style={{ padding: "0 4px 8px" }}>
                <span style={{ flex: 1, color: "var(--cvb-faint-2)" }}>✦ ADA SUGGESTS</span>
                <span onClick={props.onAllCampaigns} style={{ fontSize: 10, fontWeight: 600, color: "var(--cvb-faint-2)", cursor: "pointer" }}>
                  {suggestions.length} →
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {suggestions.map((g) => (
                  <div
                    key={g.id}
                    onClick={() => props.onStartSuggestion(g.id)}
                    data-testid={`bold-sugg-${g.id}`}
                    title={g.suggestion?.reason ?? undefined}
                    style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-soft)", borderRadius: 11, padding: "8px 10px", cursor: "pointer" }}
                  >
                    <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: "var(--cvb-muted)", letterSpacing: "-.012em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {g.name}
                    </div>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onStartSuggestion(g.id);
                      }}
                      title="Start it"
                      data-testid={`bold-sugg-start-${g.id}`}
                      style={{ fontSize: 10, fontWeight: 700, color: "var(--cvb-muted)", background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 8, padding: "4px 8px", cursor: "pointer", flex: "none" }}
                    >
                      Start
                    </span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onDismissSuggestion(g.id);
                      }}
                      title="Not now"
                      data-testid={`bold-sugg-dismiss-${g.id}`}
                      style={{ fontSize: 10.5, color: "var(--cvb-ghost)", cursor: "pointer", flex: "none" }}
                    >
                      ✕
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Block 3 — ALWAYS ON / INBOUND (B4 wires the one-flag truth). */}
          <div style={{ flex: "none" }}>
            <div className="cvb-rail-eyebrow" style={{ padding: "0 4px 8px" }}>
              <span style={{ flex: 1 }}>ALWAYS ON</span>
              <span style={{ fontSize: 9.5, color: "var(--cvb-faint-2)" }}>INBOUND</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="cvb-alwayson-row" data-testid="bold-alwayson-siteagent" onClick={() => props.onSelectSurface("chatbot")}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    flex: "none",
                    background: "var(--cvb-cyan-tint)",
                    border: "1px solid var(--cvb-cyan-line)",
                    color: "var(--cvb-cyan)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                  }}
                >
                  ◈
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-.012em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      Site agent
                    </span>
                    {props.widgetOverview?.busy ? (
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--cvb-forest)", flex: "none", animation: "cvb-pulse 2s ease-in-out infinite" }} />
                    ) : null}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--cvb-faint)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {props.widgetOverview
                      ? props.widgetOverview.installed
                        ? props.widgetOverview.busy
                          ? `${props.widgetOverview.busyCount} chatting now · ${props.widgetOverview.booked30d} booked this month`
                          : `${props.widgetOverview.chats30d} chats · ${props.widgetOverview.booked30d} booked this month`
                        : "Not on your site — no traffic answered"
                      : "…"}
                  </div>
                </div>
              </div>
              <div className="cvb-alwayson-row" data-testid="bold-alwayson-receptionist" onClick={() => props.onSelectSurface("rcp")}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    flex: "none",
                    background: "var(--cvb-well)",
                    border: "1px solid var(--cvb-line-ctl)",
                    color: "var(--cvb-faint)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                  }}
                >
                  ☎
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-.012em", color: "var(--cvb-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Receptionist
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--cvb-faint-2)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {FIXTURE_ALWAYS_ON.receptionist.sub}
                  </div>
                </div>
                <span style={{ ...mono, fontSize: 10.5, color: "var(--cvb-faint)", flex: "none" }}>{FIXTURE_ALWAYS_ON.receptionist.value}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Block 4 — ICP + credits card, pinned bottom (B7 wires live reads). */}
        <div data-tour="core" className="cvb-core-card" data-testid="bold-core-card">
          <div className="cvb-core-top" onClick={() => props.onSelectSurface("wssettings")}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 10,
                  flex: "none",
                  background: "var(--cvb-gradient-mark)",
                  color: "var(--cvb-card)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 13,
                }}
              >
                {wsName.charAt(0).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: "-.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Business core
                </div>
                <div style={{ fontSize: 10.5, color: "var(--cvb-faint)", marginTop: 2 }}>{sectorLine}</div>
              </div>
              <span style={{ fontSize: 12, color: "var(--cvb-faint)", flex: "none" }}>→</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 11 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "3px 9px" }}>
                {core ? `${core.facts} fact${core.facts === 1 ? "" : "s"}` : "…"}
              </span>
              {core && core.gaps === 0 ? (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "3px 9px" }}>
                  No gaps
                </span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cvb-amber)", background: "var(--cvb-amber-bg)", border: "1px solid var(--cvb-amber-line)", borderRadius: 999, padding: "3px 9px" }}>
                  {core ? `${core.gaps} gap${core.gaps === 1 ? "" : "s"}` : "…"}
                </span>
              )}
            </div>
          </div>
          <div className="cvb-core-credits">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>CREDITS</div>
                <span className="cvb-display" data-testid="bold-rail-credits" style={{ fontWeight: 900, fontSize: 22, letterSpacing: "-.03em", lineHeight: 1, display: "block", marginTop: 4 }}>
                  {core?.balance != null ? core.balance.toLocaleString("en-US") : "—"}
                </span>
              </div>
              <button type="button" className="cvb-topup" onClick={() => props.onSelectSurface("credits")}>
                Top up
              </button>
            </div>
            {creditPct != null ? (
              <div className="cvb-credit-bar" title="What is left of what the month started with">
                <span style={{ width: `${creditPct}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Collapsed icon column. */}
      <div className="cvb-rail-slim" data-testid="bold-rail-slim" aria-hidden={props.open}>
        <div className="cvb-rail-slim-card" title="All campaigns — expand" onClick={props.onOpenRail}>
          <img src="/bold/mark.svg" alt="" style={{ width: 22, height: 22, display: "block" }} />
          <span style={{ color: "var(--cvb-faint)", fontSize: 11 }}>»</span>
          <span style={{ ...mono, fontSize: 10, fontWeight: 600, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "2px 7px" }}>
            {agents.length}
          </span>
          <span style={{ ...mono, writingMode: "vertical-rl", fontSize: 9, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>CAMPAIGNS</span>
        </div>
        <span style={{ flex: 1 }} />
        <div className="cvb-rail-slim-biz" title={`${wsName} — business core`} onClick={props.onOpenRail}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 11,
              background: "var(--cvb-gradient-mark)",
              color: "var(--cvb-card)",
              fontSize: 10,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {wsName.charAt(0).toUpperCase()}
          </span>
        </div>
      </div>
    </div>
  );
}
