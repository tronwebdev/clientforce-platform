"use client";

/**
 * B4 (DEC-124): the Site agent surface — the prototype's `chatbot` page on
 * the REAL widget spine (WID2: Widget row, public session rail, capture
 * flow). The one-flag rule (kickoff §B4) holds by construction: eyebrow,
 * banner, card and controls all read the SAME overview truth the rail and
 * dock render — installed = the widget row with its public credential
 * exists; busy = a visitor conversation touched the last five minutes.
 *
 * Honest scope: ONE real widget per workspace renders as one card (the
 * prototype's extra assistants are fixtures — nothing fake renders here);
 * the flow toggles and the DEC-120(2) consent ask are REAL controls the
 * serving rail reads; accent + name write to the design the panel renders.
 * The guided build, page-placement rules and the answers board have no
 * engine yet — deferred in plain words (Q-091/Q-092/Q-093).
 */
import { useCallback, useEffect, useState } from "react";
import {
  ensureWidget,
  fetchWidgetOverview,
  fetchWidgets,
  patchWidget,
  type WidgetOverview,
  type WidgetRow,
} from "./bold-live";

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

const FLOW_LABELS: ReadonlyArray<readonly [string, string, string]> = [
  ["askQuestion", "Answer questions", "From your business facts only — no source, no answer."],
  ["scheduleCallback", "Schedule a callback", "Collects a number and a good time; the call is yours."],
  ["bookVisit", "Book a visit", "Arrives with the booking engine — off until it can complete."],
  ["liveCallback", "Call me now", "Arrives with the live-call bridge — off until it can complete."],
  ["instantProposal", "Instant estimate", "Arrives with proposals — off until it can complete."],
  ["liveVoice", "Live voice", "Arrives with the voice bridge — off until it can complete."],
];
const SERVABLE = new Set(["askQuestion", "scheduleCallback"]);

const ACCENTS = ["#146B33", "#0E7D93", "#5B4A8A", "#101613"];

export function BoldSiteAgentView({ flash }: { flash?: (msg: string) => void }) {
  const [overview, setOverview] = useState<WidgetOverview | null>(null);
  const [widget, setWidget] = useState<WidgetRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyBtn, setBusyBtn] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [ov, list] = await Promise.all([fetchWidgetOverview(), fetchWidgets()]);
    setOverview(ov);
    setWidget(list?.widgets?.[0] ?? null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const installed = Boolean(widget?.publicId);
  const busy = overview?.busy ?? false;
  const chats = overview?.chats30d ?? 0;
  const booked = overview?.booked30d ?? 0;

  async function addToSite() {
    if (busyBtn) return;
    setBusyBtn(true);
    try {
      const res = await ensureWidget();
      if (!res.ok) {
        flash?.(res.error || "Could not set the site agent up.");
        return;
      }
      flash?.("Your site agent exists — paste the snippet below and she answers.");
      await load();
    } finally {
      setBusyBtn(false);
    }
  }

  async function patch(body: Parameters<typeof patchWidget>[1], note: string) {
    if (!widget) return;
    const res = await patchWidget(widget.id, body);
    if (!res.ok) {
      flash?.(res.error || "That change did not save.");
      return;
    }
    setWidget(res.body as WidgetRow);
    flash?.(note);
  }

  const accent = (widget?.design?.accent as string | undefined) ?? ACCENTS[0]!;
  const agentName = (widget?.design?.agentName as string | undefined) ?? "Front desk";
  const snippet = widget?.publicId
    ? `<script src="https://cdn.clientforce.co/widget.js" data-widget-id="${widget.publicId}" async></script>`
    : "";

  return (
    <div data-testid="bold-siteagent" style={{ padding: "26px 40px 40px", maxWidth: 980 }}>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>
        {installed ? "INBOUND CHANNEL · ON YOUR SITE" : "INBOUND CHANNEL · NOT INSTALLED"}
      </div>
      <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-.028em", marginTop: 4, marginBottom: 16 }}>
        Site agent
      </div>

      {!loaded ? (
        <div style={{ fontSize: 12.5, color: "var(--cvb-faint)" }}>Reading the widget…</div>
      ) : !installed ? (
        <div
          data-testid="bold-siteagent-banner"
          style={{ display: "flex", alignItems: "center", gap: 13, background: "var(--cvb-amber-bg, #FDFBF4)", border: "1px solid var(--cvb-amber-line, #EFE6CF)", borderRadius: 15, padding: "14px 16px", marginBottom: 18 }}
        >
          <span style={{ width: 34, height: 34, borderRadius: 11, flex: "none", display: "grid", placeItems: "center", background: "#F7EFDA", border: "1px solid #EAD9A8", color: "var(--cvb-amber, #8A6D1A)", fontWeight: 800 }}>
            !
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>She is not on your site yet</div>
            <div style={{ fontSize: 12, color: "var(--cvb-amber, #7A6220)", lineHeight: 1.45, marginTop: 2 }}>
              Visitors arrive and leave unanswered. Setting her up takes one line of code.
            </div>
          </div>
          <span
            onClick={() => void addToSite()}
            data-testid="bold-siteagent-add"
            style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-amber, #8A6D1A)", borderRadius: 10, padding: "9px 14px", cursor: "pointer", flex: "none", opacity: busyBtn ? 0.6 : 1 }}
          >
            Set her up
          </span>
        </div>
      ) : (
        <div
          data-testid="bold-siteagent-strip"
          style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 13, padding: "11px 14px", marginBottom: 18 }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--cvb-forest)", flex: "none", animation: busy ? "cvb-pulse 2s ease-in-out infinite" : undefined }} />
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>
            {chats > 0 ? "Answering on your site" : "Ready on your site"}
          </span>
          <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", flex: 1, minWidth: 0 }}>
            {chats > 0
              ? `${chats} conversation${chats === 1 ? "" : "s"} · ${booked} booked in the last 30 days${busy ? " · chatting now" : ""}`
              : "no conversations yet — the snippet below goes before </body>"}
          </span>
        </div>
      )}

      {installed && widget ? (
        <>
          {/* The one real assistant — never the prototype's fixture trio. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(236px, 1fr))", gap: 12, marginBottom: 20 }}>
            <div data-testid="bold-siteagent-card" style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 18, overflow: "hidden" }}>
              <div style={{ height: 96, background: `linear-gradient(150deg, ${accent}, #0A0F14)`, position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: 12, ...mono, fontSize: 8.5, letterSpacing: ".14em", color: "rgba(255,255,255,.72)" }}>
                  SITE WIDGET
                </span>
                {busy ? (
                  <span style={{ position: "absolute", right: 12, top: 12, fontSize: 9.5, fontWeight: 700, color: "#D6FBD2", background: "rgba(53,232,52,.16)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 999, padding: "2px 8px" }}>
                    LIVE
                  </span>
                ) : null}
              </div>
              <div style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800 }}>{agentName}</div>
                <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 4 }}>
                  {chats} chats · {booked} booked · last 30 days
                </div>
              </div>
            </div>
            <div
              data-testid="bold-siteagent-build-deferred"
              style={{ border: "1px dashed var(--cvb-line-ctl)", borderRadius: 18, display: "grid", placeItems: "center", padding: 18, color: "var(--cvb-faint)", fontSize: 12.5, textAlign: "center", lineHeight: 1.5 }}
            >
              More assistants arrive with the guided build — Ada will set one up from a sentence.
            </div>
          </div>

          {/* WHAT SHE MAY DO — the REAL flow toggles the serving rail reads,
              plus the DEC-120(2) consent ask. */}
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 10 }}>
            WHAT SHE MAY DO
          </div>
          <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
            {FLOW_LABELS.map(([key, label, sub], i) => {
              const servable = SERVABLE.has(key);
              const on = servable && (widget.flows?.[key] ?? true);
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", borderBottom: i === FLOW_LABELS.length - 1 ? "none" : "1px solid var(--cvb-line-inner)", opacity: servable ? 1 : 0.62 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
                  </div>
                  {servable ? (
                    <span
                      onClick={() => void patch({ flows: { [key]: !on } }, on ? `${label} — off.` : `${label} — on.`)}
                      data-testid={`bold-siteagent-flow-${key}`}
                      role="switch"
                      aria-checked={on}
                      style={{ width: 42, height: 24, borderRadius: 13, flex: "none", background: on ? "var(--cvb-forest)" : "var(--cvb-scrollbar)", position: "relative", cursor: "pointer" }}
                    >
                      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(16,22,19,.2)", transition: "left .15s ease" }} />
                    </span>
                  ) : (
                    <span style={{ ...mono, fontSize: 9, color: "var(--cvb-ghost)", flex: "none" }}>NOT YET</span>
                  )}
                </div>
              );
            })}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", borderTop: "1px solid var(--cvb-line-inner)", background: "var(--cvb-well)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Ask visitors if we may call them</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2, lineHeight: 1.45 }}>
                  Off by default. When on, the callback form adds one box — “You can call me about
                  this.” A tick lets Ada call them; left unticked nothing changes.
                </div>
              </div>
              <span
                onClick={() =>
                  void patch(
                    { consentAsk: !widget.consentAsk },
                    widget.consentAsk ? "Consent ask off." : "Consent ask on — a tick lets Ada call.",
                  )
                }
                data-testid="bold-siteagent-consentask"
                role="switch"
                aria-checked={widget.consentAsk}
                style={{ width: 42, height: 24, borderRadius: 13, flex: "none", background: widget.consentAsk ? "var(--cvb-forest)" : "var(--cvb-scrollbar)", position: "relative", cursor: "pointer" }}
              >
                <span style={{ position: "absolute", top: 3, left: widget.consentAsk ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(16,22,19,.2)", transition: "left .15s ease" }} />
              </span>
            </div>
          </div>

          {/* HOW IT LOOKS — accent writes to the design the panel renders. */}
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 10 }}>
            HOW IT LOOKS
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            {ACCENTS.map((c) => (
              <span
                key={c}
                onClick={() => void patch({ design: { accent: c } }, "Accent updated.")}
                data-testid={`bold-siteagent-accent-${c.slice(1)}`}
                style={{ width: 30, height: 30, borderRadius: 10, background: c, cursor: "pointer", border: accent === c ? "2px solid var(--cvb-ink)" : "2px solid transparent" }}
              />
            ))}
            <span style={{ fontSize: 11.5, color: "var(--cvb-faint)" }}>The panel header wears this color.</span>
          </div>

          {/* EMBED — the real snippet with the real credential. */}
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 10 }}>
            PASTE THIS BEFORE &lt;/body&gt;
          </div>
          <div data-testid="bold-siteagent-embed" style={{ background: "#0C1512", borderRadius: 14, padding: "13px 15px", marginBottom: 8 }}>
            <code style={{ ...mono, fontSize: 11, color: "#D6FBD2", wordBreak: "break-all", lineHeight: 1.6 }}>{snippet}</code>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              onClick={() => {
                void navigator.clipboard?.writeText(snippet).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              data-testid="bold-siteagent-copy"
              style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 10, padding: "8px 13px", cursor: "pointer" }}
            >
              {copied ? "Copied ✓" : "Copy the snippet"}
            </span>
            <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)" }}>
              The script address goes live with the hosting step — until then, serve the built
              widget bundle yourself.
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
