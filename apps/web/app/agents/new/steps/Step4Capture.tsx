"use client";

/**
 * Step 4 — Enable lead capture (W3-9 + W3-10, prototype anatomy).
 * Master-toggle card · Auto-prospecting card (keyword chips + suggestions,
 * search-parameter dropdowns, signal-source pills) · three inbound assets
 * (On-site widget / Hosted form link / Embed on website) w/ asset pickers ·
 * suggested-automations strip · dark preview panel. Visual only in P1
 * (checkpoints §3): the config persists via draftState, no capture backend.
 *
 * Honesty rails (DEC-073): the Forms/Widget subsystems are nav stubs, so the
 * asset pickers render "No saved … yet" + a create path to the stubs — never
 * fake assets (with none selectable, the proto's widget/embed/form preview
 * panels stay unreachable and are NOT built as dead code); the AP dark panel
 * keeps the anatomy but drops the proto's mock found-leads + "~12/day" line
 * for an honest matches-after-launch body ("· live" → "· on" — nothing is
 * live before launch); keyword suggestions derive from the agent's own
 * distilled context (real data), plus a type-your-own row (flagged addition —
 * the proto's chips are pre-seeded sample state with no input affordance).
 */
import { useState } from "react";
import { AP_NOT_TYPICAL_NOTE, SUGGESTED_AUTOMATIONS, type GoalFit } from "../../../../lib/goal-fit";
import { type CaptureState } from "../shared";

/** Prototype literals — search-parameter defs + option lists (A12). */
const AP_PARAM_DEFS = [
  { key: "location", label: "Location" },
  { key: "industry", label: "Industry" },
  { key: "size", label: "Company size" },
  { key: "rating", label: "Min. rating" },
] as const;
const PARAM_OPTS: Record<string, string[]> = {
  location: ["United States · Canada", "United States only", "United Kingdom", "Australia", "Europe (EU)", "Global"],
  industry: ["Dental & Orthodontics", "Healthcare & Wellness", "Home Services", "Real Estate", "Veterinary", "Med Spa"],
  size: ["1–10 staff", "1–50 staff", "11–50 staff", "51–200 staff", "200+ staff"],
  rating: ["Any rating", "3.0 ★ +", "4.0 ★ +", "4.5 ★ +"],
};
/** Prototype signal-source defs. */
const SIG_DEFS = [
  { key: "api", icon: "🔌", label: "API data" },
  { key: "news", icon: "📰", label: "News" },
  { key: "reviews", icon: "⭐", label: "Reviews" },
  { key: "social", icon: "💬", label: "Social" },
] as const;
/**
 * Prototype inbound-asset defs (copy verbatim). The proto's per-card option
 * lists ("Bottom-right bubble", "Free audit request", …) are sample assets —
 * no Forms/Widget subsystem exists yet, so the picker renders the honest
 * empty state with a create path to the nav stubs instead.
 */
const INBOUND_DEFS = [
  { key: "widget", icon: "🪟", label: "On-site widget", desc: "Embeds the agent as a chatbot — captures, qualifies & books on-site, then routes leads to this campaign.", emptyLabel: "No saved widgets yet", createHref: "/widget", createLabel: "＋ Create new — Agent Widget" },
  { key: "form", icon: "🔗", label: "Hosted form link", desc: "A branded form that captures leads and routes them straight to this campaign.", emptyLabel: "No saved forms yet", createHref: "/forms", createLabel: "＋ Create new — Forms" },
  { key: "embed", icon: "⧉", label: "Embed on website", desc: "An inline form embedded on your site that routes captured leads to this campaign.", emptyLabel: "No saved forms yet", createHref: "/forms", createLabel: "＋ Create new — Forms" },
] as const;

const apLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };

interface Step4Props {
  capture: CaptureState;
  setCapture: React.Dispatch<React.SetStateAction<CaptureState>>;
  goal: string | null;
  goalFit: GoalFit;
  /** W3-9: derived from the agent's own distilled context fields (real data). */
  apSuggestions: string[];
}

export function Step4Capture(props: Step4Props) {
  const { capture, setCapture, goal, goalFit, apSuggestions } = props;
  // single-open dropdown state is step-local (§0: opening one closes others)
  const [openDD, setOpenDD] = useState<string | null>(null);
  const [apAddOpen, setApAddOpen] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [inboundExpanded, setInboundExpanded] = useState<string | null>(null);

  const existingAudience = goalFit === "existing_audience";
  // W3-10: no explicit choice → the goal-fit default (existing-audience OFF);
  // the user's own toggle always overrides and persists.
  const apOn = capture.ap ?? !existingAudience;
  const fitNote = existingAudience ? AP_NOT_TYPICAL_NOTE[goal ?? ""] : undefined;
  const automations = SUGGESTED_AUTOMATIONS[goalFit];
  const addKeyword = (k: string) => {
    const v = k.trim();
    if (!v || capture.apKeywords.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setCapture((c) => ({ ...c, apKeywords: [...c.apKeywords, v].slice(0, 20) }));
    setKeywordInput("");
  };
  const dim: React.CSSProperties = capture.enabled ? {} : { opacity: 0.55, pointerEvents: "none" };

  return (
    <div style={{ maxWidth: 860, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* master toggle */}
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: 20, boxShadow: "0 4px 16px rgba(14,21,18,.04)" }} data-testid="capture-master-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>Enable lead capture</div>
              <div style={{ fontSize: 13, color: "#8A7F6B" }}>Auto-prospect new leads and collect inbound interest into this campaign.</div>
            </div>
            <span onClick={() => setCapture((c) => ({ ...c, enabled: !c.enabled }))} style={{ width: 48, height: 28, borderRadius: 100, background: capture.enabled ? "linear-gradient(135deg,#36D7ED,#35E834 60%,#D0F56B)" : "#E4EAE6", position: "relative", display: "inline-block", flex: "none", cursor: "pointer" }} data-testid="capture-master-toggle">
              <span style={{ position: "absolute", top: 3, ...(capture.enabled ? { right: 3 } : { left: 3 }), width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, ...dim }} data-testid="capture-body-left">
          {/* auto-prospecting */}
          <div style={{ background: "#fff", border: apOn ? "2px solid #35E834" : "1px solid #EBE3D6", borderRadius: 16, padding: 20, boxShadow: "0 4px 16px rgba(14,21,18,.04)" }} data-testid="ap-card">
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(53,232,52,.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flex: "none", color: "#16A82A" }}>⚲</span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>Auto-prospecting</span>
                {/* W3-10: the badge flips for existing-audience goals (designed neutral tint) */}
                {existingAudience ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 7, padding: "2px 8px", whiteSpace: "nowrap" }} data-testid="ap-badge-not-typical">Not typical for this goal</span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 7, padding: "2px 8px" }} data-testid="ap-badge-recommended">Recommended</span>
                )}
              </div>
              <span onClick={() => setCapture((c) => ({ ...c, ap: !apOn }))} style={{ width: 48, height: 28, borderRadius: 100, background: apOn ? "linear-gradient(135deg,#36D7ED,#35E834 60%,#D0F56B)" : "#E4EAE6", position: "relative", display: "inline-block", flex: "none", cursor: "pointer" }} data-testid="ap-toggle">
                <span style={{ position: "absolute", top: 3, ...(apOn ? { right: 3 } : { left: 3 }), width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
              </span>
            </div>
            <div style={{ fontSize: 13, color: "#5C6B62", lineHeight: 1.5, marginBottom: apOn || fitNote ? 16 : 0 }}>Your agent uses live signals to find matching leads and pull them into this campaign on demand.</div>

            {/* W3-10: in-card note — why this goal doesn't usually prospect */}
            {fitNote ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 13px", marginBottom: apOn ? 16 : 0 }} data-testid="ap-fit-note">
                <span style={{ fontSize: 15, flex: "none" }}>{fitNote.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0E1512" }}>{fitNote.title}</div>
                  <div style={{ fontSize: 12, color: "#8A7F6B", lineHeight: 1.45 }}>{fitNote.line}</div>
                </div>
              </div>
            ) : null}

            {/* config collapses whenever AP is off (W3-10) */}
            {apOn ? (
              <div data-testid="ap-config">
                <div style={apLabel}>Keywords</div>
                <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                  {capture.apKeywords.map((k) => (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#0E1512", background: "#F2EEE4", border: "1px solid #EBE3D6", borderRadius: 100, padding: "5px 11px" }} data-testid="ap-keyword-chip">
                      {k} <span onClick={() => setCapture((c) => ({ ...c, apKeywords: c.apKeywords.filter((x) => x !== k) }))} style={{ color: "#9AA59E", cursor: "pointer" }}>✕</span>
                    </span>
                  ))}
                  <span onClick={() => { setApAddOpen((v) => !v); setOpenDD(null); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#16A82A", border: "1.5px dashed #9FD8AC", borderRadius: 100, padding: "5px 11px", cursor: "pointer" }} data-testid="ap-keyword-add">+ Add</span>
                  {apAddOpen ? (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 12px 30px rgba(14,21,18,.16)", zIndex: 18, overflow: "hidden", minWidth: 230 }} data-testid="ap-suggestions">
                      <div style={{ padding: "8px 13px", fontSize: 11, fontWeight: 700, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em" }}>Suggested keywords</div>
                      {apSuggestions.length > 0 ? (
                        apSuggestions.map((sg) => (
                          <div key={sg} onClick={() => { addKeyword(sg); setApAddOpen(false); }} style={{ padding: "9px 13px", fontSize: 13, color: "#0E1512", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }} data-testid="ap-suggestion-row">
                            <span style={{ color: "#16A82A", fontWeight: 700 }}>+</span>{sg}
                          </div>
                        ))
                      ) : (
                        /* honest absence — suggestions come from the agent's distilled context */
                        <div style={{ padding: "9px 13px", fontSize: 12.5, color: "#9AA59E" }} data-testid="ap-suggestions-empty">No suggestions yet — they come from your step-1 knowledge.</div>
                      )}
                      {/* designed addition (flagged): the proto has no free-text affordance */}
                      <input
                        value={keywordInput}
                        maxLength={60}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(keywordInput); setApAddOpen(false); } }}
                        placeholder="Type a keyword and press Enter"
                        style={{ width: "100%", boxSizing: "border-box", height: 38, border: "none", borderTop: "1px solid #F2EEE4", padding: "0 13px", fontSize: 13, color: "#0E1512", outline: "none", fontFamily: "'Hanken Grotesk',sans-serif" }}
                        data-testid="ap-keyword-input"
                      />
                    </div>
                  ) : null}
                </div>

                <div style={apLabel}>Search parameters</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                  {AP_PARAM_DEFS.map((p) => (
                    <div key={p.key} style={{ position: "relative" }}>
                      <div onClick={() => { setOpenDD((v) => (v === p.key ? null : p.key)); setApAddOpen(false); }} style={{ border: "1px solid #EBE3D6", borderRadius: 10, background: "#FBF7F0", padding: "8px 12px", cursor: "pointer" }} data-testid={`ap-param-${p.key}`}>
                        <div style={{ fontSize: 11, color: "#9AA59E", fontWeight: 600, marginBottom: 2 }}>{p.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#0E1512", display: "flex", alignItems: "center" }}>{capture.apParams[p.key]}<span style={{ marginLeft: "auto", color: "#9AA59E" }}>⌄</span></div>
                      </div>
                      {openDD === p.key ? (
                        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, boxShadow: "0 12px 30px rgba(14,21,18,.16)", zIndex: 17, overflow: "hidden" }} data-testid={`ap-param-menu-${p.key}`}>
                          {PARAM_OPTS[p.key]!.map((o) => (
                            <div key={o} onClick={() => { setCapture((c) => ({ ...c, apParams: { ...c.apParams, [p.key]: o } })); setOpenDD(null); }} style={{ padding: "9px 13px", fontSize: 13, color: "#0E1512", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ width: 13, color: "#16A82A", fontSize: 11 }}>{capture.apParams[p.key] === o ? "✓" : ""}</span>{o}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div style={apLabel}>Signal sources</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {SIG_DEFS.map((s) => {
                    const on = !!capture.apSignals[s.key];
                    return (
                      <span key={s.key} onClick={() => setCapture((c) => ({ ...c, apSignals: { ...c.apSignals, [s.key]: !on } }))} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: on ? "#16A82A" : "#9AA59E", background: on ? "rgba(53,232,52,.1)" : "#F2EEE4", border: on ? "1px solid rgba(53,232,52,.3)" : "1px solid #EBE3D6", borderRadius: 100, padding: "6px 12px", cursor: "pointer" }} data-testid={`ap-signal-${s.key}`}>
                        {s.icon} {s.label} <span style={{ fontSize: 11, opacity: 0.7 }}>{on ? "✓" : "+"}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {/* inbound capture */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", marginBottom: 3 }}>Inbound capture</div>
            <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 12 }}>Turn on a channel and pick an asset to collect inbound leads.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {INBOUND_DEFS.map((d) => {
                const on = capture[d.key];
                const expanded = inboundExpanded === d.key;
                return (
                  <div key={d.key} style={{ border: on ? "1.5px solid #9FD8AC" : "1px solid #EBE3D6", background: on ? "rgba(53,232,52,.03)" : "#fff", borderRadius: 14, boxShadow: "0 1px 4px rgba(14,21,18,.04)" }} data-testid={`inbound-${d.key}`}>
                    <div onClick={() => setInboundExpanded((v) => (v === d.key ? null : d.key))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer" }}>
                      <span style={{ width: 38, height: 38, borderRadius: 10, background: "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flex: "none" }}>{d.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0E1512" }}>{d.label}</div>
                        <div style={{ fontSize: 12, color: "#8A7F6B" }}>{d.desc}</div>
                      </div>
                      <span onClick={(e) => { e.stopPropagation(); setCapture((c) => ({ ...c, [d.key]: !on })); if (!on) setInboundExpanded(d.key); }} style={{ width: 42, height: 24, borderRadius: 100, background: on ? "linear-gradient(135deg,#36D7ED,#35E834)" : "#E4EAE6", position: "relative", display: "inline-block", flex: "none", cursor: "pointer" }} data-testid={`inbound-${d.key}-toggle`}>
                        <span style={{ position: "absolute", top: 3, ...(on ? { right: 3 } : { left: 3 }), width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
                      </span>
                      <span style={{ color: "#C2B79F", fontSize: 16, flex: "none" }}>{expanded ? "⌄" : "›"}</span>
                    </div>
                    {expanded ? (
                      <div style={{ padding: "0 16px 16px" }}>
                        <div style={{ position: "relative" }}>
                          <div onClick={() => { setOpenDD((v) => (v === `asset-${d.key}` ? null : `asset-${d.key}`)); setApAddOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#9AA59E", background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 10, padding: "10px 13px", cursor: "pointer" }} data-testid={`inbound-${d.key}-select`}>
                            Select an asset…<span style={{ marginLeft: "auto", color: "#9AA59E" }}>⌄</span>
                          </div>
                          {openDD === `asset-${d.key}` ? (
                            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, boxShadow: "0 12px 30px rgba(14,21,18,.16)", zIndex: 15, overflow: "hidden" }} data-testid={`inbound-${d.key}-menu`}>
                              {/* honest absence — no Forms/Widget subsystem exists yet (nav stubs only) */}
                              <div style={{ padding: "10px 13px", fontSize: 12.5, color: "#9AA59E" }} data-testid={`inbound-${d.key}-empty`}>{d.emptyLabel} — create one and it appears here.</div>
                              <a href={d.createHref} style={{ display: "block", padding: "9px 13px", fontSize: 13, fontWeight: 600, color: "#16A82A", borderTop: "1px solid #F2EEE4", cursor: "pointer", textDecoration: "none" }} data-testid={`inbound-${d.key}-create`}>{d.createLabel}</a>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* W3-10: suggested automations — STATIC templates matched to the goal;
              CTAs deep-link to the nav stubs (no connector calls, no fake
              "connected" states). Designed strip — no prototype anchor. */}
          <div data-testid="suggested-automations">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>Suggested automations</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {automations.map((a) => (
                <a key={a.title} href={a.href} style={{ border: "1.5px dashed #D8CFBE", borderRadius: 13, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, background: "#fff", textDecoration: "none" }} data-testid="suggested-automation-card">
                  <span style={{ width: 34, height: 34, borderRadius: 9, background: "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flex: "none" }}>{a.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#5C6B62" }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: "#9AA59E" }}>{a.desc}</div>
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "#16A82A", flex: "none" }}>{a.cta}</span>
                </a>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 13, color: "#9AA59E" }}>This step is optional — you can skip it and add lead capture later.</div>
        </div>
      </div>

      {/* right column — preview panel */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, ...dim }} data-testid="capture-preview-col">
        {apOn ? (
          <div style={{ background: "#0C140F", borderRadius: 18, padding: 22 }} data-testid="ap-preview-panel">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#35E834", boxShadow: "0 0 0 4px rgba(53,232,52,.2)", flex: "none" }} />
              {/* honest wording: nothing is live before launch (proto says "· live") */}
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#7FE8A0" }}>Auto-prospecting · on</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {SIG_DEFS.filter((s) => capture.apSignals[s.key]).map((s) => (
                <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#CFF8D6", background: "rgba(53,232,52,.12)", border: "1px solid rgba(53,232,52,.25)", borderRadius: 100, padding: "5px 10px" }} data-testid="ap-live-signal">
                  {s.icon} {s.label}
                </span>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden" }}>
              {/* honest body — the proto's found-leads rows are mock data; matches
                  can only exist after launch (designed absence, DEC-073) */}
              <div style={{ padding: "16px 14px" }} data-testid="ap-preview-empty">
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Matches appear after launch</div>
                <div style={{ fontSize: 12, color: "#5C6B62", lineHeight: 1.5 }}>Your agent starts prospecting from these signals the moment it goes live — matched leads land in this campaign automatically.</div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ border: "1.5px dashed #D8CFBE", borderRadius: 18, padding: "30px 24px", textAlign: "center", background: "#FBF7F0" }} data-testid="capture-preview-empty">
            <div style={{ fontSize: 30, marginBottom: 10, opacity: 0.5 }}>👁</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#5C6B62", marginBottom: 3 }}>Nothing to preview yet</div>
            <div style={{ fontSize: 12.5, color: "#9AA59E", lineHeight: 1.5 }}>Turn on auto-prospecting or pick an inbound asset to see it previewed here.</div>
          </div>
        )}
      </div>
    </div>
  );
}
