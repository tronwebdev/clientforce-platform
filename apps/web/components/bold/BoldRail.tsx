"use client";

import type { CSSProperties } from "react";
import type { Me } from "../../lib/types";
import {
  FIXTURE_ALWAYS_ON,
  FIXTURE_CAMPAIGNS,
  FIXTURE_CORE,
  type BoldSuggestionFixture,
} from "./bold-data";

const DOT_COLOR: Record<string, string> = {
  forest: "var(--cvb-forest)",
  amber: "var(--cvb-dot-amber)",
  faint: "var(--cvb-faint)",
};

const mono: CSSProperties = { fontFamily: "var(--cvb-font-mono)" };

interface BoldRailProps {
  me: Me;
  open: boolean;
  surface: string;
  camp: string;
  suggestions: BoldSuggestionFixture[];
  onFocus: () => void;
  onOpenRail: () => void;
  onOpenWsPicker: () => void;
  onSelectCampaign: (key: string) => void;
  onAllCampaigns: () => void;
  onSelectSurface: (key: "chatbot" | "rcp" | "wssettings" | "credits") => void;
  onStartSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
}

/**
 * The 228px rail — four blocks in fixed order (ADDENDUM_4_BOLD §2):
 * workspace card → CAMPAIGNS → ALWAYS ON / INBOUND → ICP + credits (pinned).
 * Collapsed state renders the slim icon column (the console mark, ruling).
 */
export function BoldRail(props: BoldRailProps) {
  const { me } = props;
  const wsName = me.activeWorkspace?.name ?? "Workspace";
  const wsIndex = Math.max(
    0,
    me.memberships.findIndex((m) => m.workspaceId === me.activeWorkspace?.id),
  );
  const campCount = FIXTURE_CAMPAIGNS.length;

  return (
    <div className="cvb-rail-wrap" data-open={props.open ? "true" : "false"} data-testid="bold-rail">
      <div className="cvb-rail" aria-hidden={!props.open}>
        {/* Block 1 — workspace card (a real selector, not decoration) + focus capsule. */}
        <div className="cvb-ws-row">
          <div
            data-tour="ws"
            data-testid="bold-ws-card"
            className="cvb-ws-card"
            onClick={props.onOpenWsPicker}
          >
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
            {/* The prototype's amber cross-workspace needs badge ("3 elsewhere")
                is NOT fixtured here: it would sit beside REAL workspace names it
                contradicts — the exact one-flag-coherence defect ADDENDUM_4 §7.5
                warns about. It lands with real needs data (B1+). */}
          </div>
          <span
            className="cvb-capsule"
            role="button"
            title="Focus — collapse the rail"
            data-testid="bold-focus-capsule"
            onClick={props.onFocus}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--cvb-forest)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 17l-5-5 5-5" />
              <path d="M18 17l-5-5 5-5" opacity=".4" />
            </svg>
          </span>
        </div>

        <div className="cvb-rail-mid">
          {/* Block 2 — CAMPAIGNS (B0 fixture rows; B1 wires the live list). */}
          <div data-tour="camps" className="cvb-rail-camps">
            <div className="cvb-rail-eyebrow">
              <span style={{ flex: 1 }}>CAMPAIGNS · {campCount}</span>
              <span
                onClick={props.onAllCampaigns}
                style={{ fontFamily: "var(--cvb-font-ui)", fontSize: 11, fontWeight: 700, color: "var(--cvb-cyan)", cursor: "pointer", letterSpacing: 0 }}
              >
                All
              </span>
            </div>
            <div className="cvb-rail-camps-list" data-testid="bold-camps-list">
              {FIXTURE_CAMPAIGNS.map((c) => {
                const active = props.surface === "campaign" && props.camp === c.key;
                return (
                  <div
                    key={c.key}
                    className="cvb-camp-row"
                    data-active={active ? "true" : "false"}
                    data-testid={`bold-camp-${c.key}`}
                    onClick={() => props.onSelectCampaign(c.key)}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: DOT_COLOR[c.dot], flex: "none" }} />
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
                      {c.name}
                    </span>
                    {c.isSuggested ? <span style={{ color: "var(--cvb-forest)", fontSize: 10, flex: "none" }}>✦</span> : null}
                    {c.goalMet ? (
                      <span style={{ ...mono, fontSize: 9.5, color: "var(--cvb-forest)", border: "1px solid var(--cvb-forest)", borderRadius: 999, padding: "1px 6px", flex: "none" }}>
                        ✓
                      </span>
                    ) : null}
                    <span style={{ ...mono, fontSize: 10.5, color: active ? "var(--cvb-forest)" : "var(--cvb-muted)", flex: "none" }}>{c.value}</span>
                  </div>
                );
              })}
            </div>
          </div>

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
                    {FIXTURE_ALWAYS_ON.siteAgent.busy ? (
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--cvb-forest)", flex: "none", animation: "cvb-pulse 2s ease-in-out infinite" }} />
                    ) : null}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--cvb-faint)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {FIXTURE_ALWAYS_ON.siteAgent.sub}
                  </div>
                </div>
                <span style={{ ...mono, fontSize: 10.5, color: "var(--cvb-forest)", flex: "none" }}>{FIXTURE_ALWAYS_ON.siteAgent.value}</span>
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

          {/* ✦ ADA SUGGESTS — muted block, one suggestion at a time (prototype). */}
          {props.suggestions.length > 0 ? (
            <div data-tour="sugg" style={{ flex: "none" }} data-testid="bold-sugg-block">
              <div className="cvb-rail-eyebrow" style={{ padding: "0 4px 8px", color: "var(--cvb-faint-2)" }}>
                <span style={{ flex: 1 }}>✦ ADA SUGGESTS</span>
                <span
                  onClick={props.onAllCampaigns}
                  style={{ fontFamily: "var(--cvb-font-ui)", fontSize: 10, fontWeight: 600, color: "var(--cvb-faint-2)", cursor: "pointer", letterSpacing: 0 }}
                >
                  {props.suggestions.length} →
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {props.suggestions.slice(0, 1).map((g) => (
                  <div key={g.id} className="cvb-sugg-row" title={g.value} onClick={() => props.onStartSuggestion(g.id)}>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "var(--cvb-muted)",
                        letterSpacing: "-.012em",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {g.name}
                    </div>
                    <span
                      className="cvb-sugg-start"
                      title="Start it"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onStartSuggestion(g.id);
                      }}
                    >
                      Start
                    </span>
                    <span
                      title="Not now"
                      style={{ fontSize: 10.5, color: "var(--cvb-ghost)", cursor: "pointer", flex: "none" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onDismissSuggestion(g.id);
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
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
                  {FIXTURE_CORE.name}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--cvb-faint)", marginTop: 2 }}>{FIXTURE_CORE.sector}</div>
              </div>
              <span style={{ fontSize: 12, color: "var(--cvb-faint)", flex: "none" }}>→</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 11 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "3px 9px" }}>
                {FIXTURE_CORE.facts}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cvb-amber)", background: "var(--cvb-amber-bg)", border: "1px solid var(--cvb-amber-line)", borderRadius: 999, padding: "3px 9px" }}>
                {FIXTURE_CORE.gaps}
              </span>
            </div>
          </div>
          <div className="cvb-core-credits">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>CREDITS</div>
                <span className="cvb-display" style={{ fontWeight: 900, fontSize: 22, letterSpacing: "-.03em", lineHeight: 1, display: "block", marginTop: 4 }}>
                  {FIXTURE_CORE.credits}
                </span>
              </div>
              <button type="button" className="cvb-topup" onClick={() => props.onSelectSurface("credits")}>
                Top up
              </button>
            </div>
            <div className="cvb-credit-bar">
              <span style={{ width: `${FIXTURE_CORE.creditPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Collapsed icon column. */}
      <div className="cvb-rail-slim" data-testid="bold-rail-slim" aria-hidden={props.open}>
        <div className="cvb-rail-slim-card" title="All campaigns — expand" onClick={props.onOpenRail}>
          <img src="/bold/mark.svg" alt="" style={{ width: 22, height: 22, display: "block" }} />
          <span style={{ color: "var(--cvb-faint)", fontSize: 11 }}>»</span>
          <span style={{ ...mono, fontSize: 10, fontWeight: 600, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "2px 7px" }}>
            {campCount}
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
