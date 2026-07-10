"use client";

/**
 * Settings tab (checkpoints §4) — Channels & senders (live SenderConnections),
 * sending schedule + volume limits writing the A8 Guardrails schema, Tracking
 * & compliance rows (A8 literals locked), the M1a Strategy section (selected
 * arc display + strategy notes + never-say — designed state, no prototype
 * anchor, DEC-064), danger zone, the 500px sender drawer and the 460px volume
 * modal. Email-only phase: phone/WhatsApp cards omitted (DEC-038 precedent).
 *
 * Guardrails saves COMPOSE over the server's parsed guardrails and override
 * only the edited subset — the previous rebuild-from-tab-state write silently
 * dropped `goalLabel` (and would drop `dailyCap.sms`/`consent`/`strategy`);
 * DEC-064 carry-along fix.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NEVER_SAY_MAX, selectStrategy, STRATEGY_NOTES_MAX } from "@clientforce/core";
import type { AgentViewData } from "./AgentView";
import { cf, GRAD } from "./shared";

interface Sender {
  id: string;
  fromEmail: string;
  fromName: string | null;
  status: string;
  dailyLimit: number;
  sentToday: number;
  domainAuthStatus: Record<string, unknown> | null;
  warmupState: Record<string, unknown> | null;
  createdAt: string;
}

function authPasses(s: Sender): number {
  const auth = (s.domainAuthStatus ?? {}) as Record<string, { pass?: boolean } | boolean | undefined>;
  return ["spf", "dkim", "dmarc"].filter((k) => {
    const v = auth[k];
    return v === true || (typeof v === "object" && v?.pass === true);
  }).length;
}

export function SettingsTab({ agentId, view, onChanged }: { agentId: string; view: AgentViewData | null; onChanged: () => Promise<void> | void }) {
  const router = useRouter();
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [drawer, setDrawer] = useState<Sender | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [dailyCap, setDailyCap] = useState(200);
  const [days, setDays] = useState([true, true, true, true, true, false, false]);
  const [tracking, setTracking] = useState({ open: true, link: true });
  // M1a strategy rider (DEC-064) — hydrated from the server's parsed guardrails.
  const [notes, setNotes] = useState("");
  const [neverSay, setNeverSay] = useState<string[]>([]);
  const [neverSayInput, setNeverSayInput] = useState("");

  const refresh = useCallback(async () => {
    const res = await cf("senders").catch(() => null);
    if (res) setSenders(res as Sender[]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const g = view?.guardrails;
    if (!g) return;
    setDailyCap(g.dailyCap.email);
    setDays([1, 2, 3, 4, 5, 6, 7].map((d) => g.sendingWindow.days.includes(d)));
    setTracking({ open: g.tracking?.openTracking ?? true, link: g.tracking?.linkTracking ?? true });
    setNotes(g.strategy?.strategyNotes ?? "");
    setNeverSay(g.strategy?.neverSay ?? []);
  }, [view?.guardrails]);

  async function saveGuardrails(next: {
    cap?: number;
    days?: boolean[];
    tracking?: { open: boolean; link: boolean };
    strategy?: { notes?: string; neverSay?: string[] };
  }) {
    const g = view?.guardrails;
    const t = next.tracking ?? tracking;
    const outNotes = (next.strategy?.notes ?? notes).trim();
    const outNever = next.strategy?.neverSay ?? neverSay;
    const strategy =
      outNotes || outNever.length > 0
        ? {
            ...(outNotes ? { strategyNotes: outNotes } : {}),
            ...(outNever.length > 0 ? { neverSay: outNever } : {}),
          }
        : undefined;
    await cf(`agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({
        guardrails: {
          sendingWindow: {
            days: (next.days ?? days).flatMap((on, i) => (on ? [i + 1] : [])),
            start: g?.sendingWindow.start ?? "09:00",
            end: g?.sendingWindow.end ?? "17:00",
            timezone: g?.sendingWindow.timezone ?? "UTC",
          },
          // Preserve everything this tab doesn't render (sms cap, consent,
          // goalLabel) — a Settings edit must never erase another surface's write.
          dailyCap: { email: next.cap ?? dailyCap, ...(g?.dailyCap.sms != null ? { sms: g.dailyCap.sms } : {}) },
          consent: g?.consent ?? null,
          tracking: { openTracking: t.open, linkTracking: t.link },
          ...(g?.goalLabel ? { goalLabel: g.goalLabel } : {}),
          ...(strategy ? { strategy } : {}),
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      }),
    }).catch(() => {});
    void onChanged();
  }

  function addNeverSay() {
    const term = neverSayInput.trim();
    if (!term || neverSay.length >= NEVER_SAY_MAX) return;
    if (neverSay.some((x) => x.toLowerCase() === term.toLowerCase())) {
      setNeverSayInput("");
      return;
    }
    const next = [...neverSay, term.slice(0, 80)];
    setNeverSay(next);
    setNeverSayInput("");
    void saveGuardrails({ strategy: { neverSay: next } });
  }

  function removeNeverSay(term: string) {
    const next = neverSay.filter((x) => x !== term);
    setNeverSay(next);
    void saveGuardrails({ strategy: { neverSay: next } });
  }

  const g = view?.guardrails;
  const label: React.CSSProperties = { fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "#16A82A" };
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", overflow: "hidden" };

  return (
    <div style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 16 }} data-testid="settings">
      <div style={label}>Channels &amp; senders</div>

      {/* email senders */}
      <div style={card} data-testid="settings-senders">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px" }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512", flex: 1 }}>Email senders <span style={{ fontSize: 13, fontWeight: 600, color: "#9AA59E" }}>· {senders?.length ?? 0} connected</span></span>
          <span title="Senders are provisioned per workspace (P1.5)" style={{ fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 10, padding: "8px 14px", cursor: "default" }}>＋ Add sender</span>
        </div>
        {senders === null ? (
          <div style={{ borderTop: "1px solid #F2EEE4", padding: "14px 18px" }} data-testid="senders-skeleton">
            <div style={{ height: 12, width: "40%", background: "#F2EEE4", borderRadius: 6 }} />
          </div>
        ) : senders.length === 0 ? (
          <div style={{ borderTop: "1px solid #F2EEE4", padding: "20px 18px", fontSize: 13, color: "#9AA59E" }} data-testid="senders-empty">No sender connected yet.</div>
        ) : (
          senders.map((s) => {
            const passes = authPasses(s);
            const healthy = passes === 3;
            const active = s.status === "ACTIVE";
            return (
              <div key={s.id} style={{ borderTop: "1px solid #F2EEE4", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }} data-testid="settings-sender-row">
                <span style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: "rgba(208,245,107,.4)", color: "#6B7A1F", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 16 }}>f</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{s.fromEmail}</div>
                  <div style={{ fontSize: 12, color: "#9AA59E" }}>Clientforce Mailer · {s.sentToday} / {s.dailyLimit} sent today</div>
                </div>
                <div style={{ textAlign: "right", marginRight: 6 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 17, color: healthy ? "#16A82A" : "#E8C45B" }}>{passes}/3</div>
                  <div style={{ fontSize: 10.5, color: "#8A7F6B" }}>auth</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: active ? "#0F7A28" : "#9A6B12", background: active ? "#D7F5DD" : "#FBEFD2", borderRadius: 7, padding: "5px 10px", flex: "none" }}>{active ? "Active" : s.status}</span>
                <span onClick={() => setDrawer(s)} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", border: "1px solid #EBE3D6", borderRadius: 10, padding: "8px 14px", cursor: "pointer", flex: "none" }} data-testid="sender-manage">Manage</span>
              </div>
            );
          })
        )}
      </div>

      <div style={{ ...label, marginTop: 8 }}>Sending behavior</div>

      {/* schedule */}
      <div style={{ ...card, padding: "18px 20px" }} data-testid="settings-schedule">
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512" }}>Sending schedule</div>
        <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 2, marginBottom: 16 }}>The agent only sends inside this window — replies are handled 24/7.</div>
        <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
          <div style={{ flex: 1.4 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 6 }}>Timezone</label>
            <div style={{ height: 44, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", fontSize: 14, color: "#0E1512" }}>{g?.sendingWindow.timezone ?? "UTC"}<span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span></div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 6 }}>Sending window</label>
            <div onClick={() => setVolumeOpen(true)} style={{ height: 44, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", fontSize: 14, color: "#0E1512", cursor: "pointer" }}>{g ? `${g.sendingWindow.start} – ${g.sendingWindow.end}` : "09:00 – 17:00"}<span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span></div>
          </div>
        </div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 8 }}>Sending days</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
            const on = days[i];
            return (
              <span key={d} onClick={() => { const next = days.map((v, j) => (j === i ? !v : v)); setDays(next); void saveGuardrails({ days: next }); }} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, padding: "9px 0", borderRadius: 10, background: on ? GRAD : "#FBF7F0", color: on ? "#0A0F0C" : "#9AA59E", border: `1px solid ${on ? "transparent" : "#EBE3D6"}`, cursor: "pointer" }} data-testid={`settings-day-${d}`}>{d}</span>
            );
          })}
        </div>
      </div>

      {/* volume limits */}
      <div style={{ ...card, padding: "18px 20px" }} data-testid="settings-volume">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512" }}>Volume &amp; deliverability limits</div>
            <div style={{ fontSize: 12.5, color: "#9AA59E", marginTop: 2 }}>Daily caps protect your sender reputation across channels.</div>
          </div>
          <span onClick={() => setVolumeOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 10, padding: "8px 14px", cursor: "pointer", flex: "none" }} data-testid="edit-limits">Edit limits</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
          <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "13px 15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>✉</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#0E1512", flex: 1 }}>Email / day</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#0E1512", fontVariantNumeric: "tabular-nums" }}>{view?.sentToday ?? 0} / {dailyCap}</span>
            </div>
            <div style={{ height: 6, borderRadius: 100, background: "#EBE3D6", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, Math.round(((view?.sentToday ?? 0) / Math.max(1, dailyCap)) * 100))}%`, background: "#35E834" }} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...label, marginTop: 8 }}>Tracking &amp; compliance</div>

      <div style={{ ...card, padding: "8px 20px 14px" }} data-testid="settings-tracking">
        {(
          [
            { key: "open" as const, label: "Open tracking", desc: "Track when a prospect opens an email." },
            { key: "link" as const, label: "Link tracking", desc: "Track clicks on links in your emails." },
          ]
        ).map((t) => (
          <div key={t.key} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "13px 0", borderTop: "1px solid #F2EEE4", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{t.label}</div>
              <div style={{ fontSize: 13, color: "#9AA59E" }}>{t.desc}</div>
            </div>
            <span onClick={() => { const nextT = { ...tracking, [t.key]: !tracking[t.key] }; setTracking(nextT); void saveGuardrails({ tracking: nextT }); }} style={{ width: 44, height: 26, borderRadius: 100, background: tracking[t.key] ? GRAD : "#D8CFBE", position: "relative", display: "inline-block", cursor: "pointer", flex: "none" }} data-testid={`toggle-${t.key}`}>
              <span style={{ position: "absolute", top: 3, ...(tracking[t.key] ? { right: 3 } : { left: 3 }), width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
            </span>
          </div>
        ))}
        {(
          [
            { label: "Unsubscribe footer", desc: "Append a one-click unsubscribe link to emails." },
            { label: "Suppression check", desc: "Never message suppressed or opted-out contacts." },
          ]
        ).map((t) => (
          <div key={t.label} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "13px 0", borderTop: "1px solid #F2EEE4", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{t.label}</div>
              <div style={{ fontSize: 13, color: "#9AA59E" }}>{t.desc}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#0F7A28", background: "#D7F5DD", borderRadius: 7, padding: "5px 10px", flex: "none" }}>🔒 Required</span>
          </div>
        ))}
      </div>

      <div style={{ ...label, marginTop: 8 }}>Strategy</div>

      {/* M1a (DEC-064) — designed section, no prototype anchor (§0 card/label
          conventions; flagged in the fidelity log). Arc is DISPLAY: derived
          from goal + business category at creation, never stored. */}
      <div style={{ ...card, padding: "18px 20px" }} data-testid="settings-strategy">
        {(() => {
          const s = selectStrategy(view?.agent.goal, view?.agent.category);
          return (
            <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }} data-testid="strategy-arc">
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#9AA59E", marginBottom: 6 }}>Selling arc</div>
              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15, color: "#0E1512" }}>{s.arc.label}</div>
              <div style={{ fontSize: 13, color: "#5C6B62", marginTop: 4, lineHeight: 1.45 }}>{s.arc.description}</div>
              <div style={{ fontSize: 12, color: "#9AA59E", marginTop: 8 }}>Derived from your goal and business category ({s.category}) at creation.</div>
            </div>
          );
        })()}

        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", marginBottom: 6 }}>Strategy notes</label>
        <textarea
          value={notes}
          maxLength={STRATEGY_NOTES_MAX}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if ((view?.guardrails?.strategy?.strategyNotes ?? "") !== notes.trim()) void saveGuardrails({}); }}
          placeholder="Anything the AI should know about how you sell — positioning, what's worked before, who signs off…"
          rows={3}
          style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#0E1512", fontFamily: "inherit", lineHeight: 1.5, outline: "none" }}
          data-testid="strategy-notes"
        />
        <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{notes.length}/{STRATEGY_NOTES_MAX}</div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9AA59E", margin: "10px 0 4px" }}>Never say</label>
        <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 8 }}>Words or phrases the AI must never use — generated sequences are checked and repaired automatically.</div>
        {neverSay.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {neverSay.map((term) => (
              <span key={term} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 100, padding: "6px 8px 6px 13px" }} data-testid="neversay-chip">
                {term}
                <span onClick={() => removeNeverSay(term)} style={{ width: 18, height: 18, borderRadius: "50%", background: "#EBE3D6", color: "#5C6B62", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, cursor: "pointer" }} data-testid="neversay-remove">✕</span>
              </span>
            ))}
          </div>
        ) : null}
        {neverSay.length < NEVER_SAY_MAX ? (
          <input
            value={neverSayInput}
            maxLength={80}
            onChange={(e) => setNeverSayInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNeverSay(); } }}
            placeholder="Type a word or phrase and press Enter"
            style={{ width: "100%", boxSizing: "border-box", height: 40, borderRadius: 11, background: "#FBF7F0", border: "1px solid #EBE3D6", padding: "0 14px", fontSize: 14, color: "#0E1512", outline: "none" }}
            data-testid="neversay-input"
          />
        ) : (
          <div style={{ fontSize: 12.5, color: "#9A6B12", background: "#FBEFD2", borderRadius: 9, padding: "8px 12px" }} data-testid="neversay-cap">{NEVER_SAY_MAX} of {NEVER_SAY_MAX} — remove one to add another.</div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#8A7F6B", background: "rgba(53,232,52,.07)", borderRadius: 10, padding: "10px 13px", marginTop: 14 }} data-testid="strategy-footnote">
          <span style={{ fontSize: 13 }}>ⓘ</span>
          <span>Changes apply the next time the sequence is generated and to newly enrolled contacts — messages already scheduled for contacts in flight aren&apos;t rewritten.</span>
        </div>
      </div>

      {/* danger zone */}
      <div style={{ background: "#FFFBFA", border: "1px solid #F0CFC8", borderRadius: 16, padding: "20px 22px" }} data-testid="danger-zone">
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#C9543F", marginBottom: 6 }}>Danger zone</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ fontSize: 14, color: "#5C6B62" }}>Archive pauses sending &amp; hides the agent. Delete is permanent.</div>
        <div style={{ display: "flex", gap: 10, flex: "none" }}>
          <span onClick={() => { void cf(`agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }).then(() => router.push("/agents")).catch(() => {}); }} style={{ fontSize: 13, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }} data-testid="archive">Archive</span>
          <span onClick={() => { if (window.confirm("Delete this agent permanently? This cannot be undone.")) void cf(`agents/${agentId}`, { method: "DELETE" }).then(() => router.push("/agents")).catch(() => {}); }} style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "#C9543F", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }} data-testid="delete">Delete</span>
        </div>
        </div>
      </div>

      {/* sender detail drawer — 500px (Campaign View anatomy; the full domain-auth
          drawer belongs to C2.6's Settings screen prototype) */}
      {drawer ? (
        <div onClick={() => setDrawer(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.45)", zIndex: 65 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 500, background: "#FBF7F0", boxShadow: "-28px 0 70px rgba(0,0,0,.30)", display: "flex", flexDirection: "column" }} data-testid="sender-drawer">
            <div style={{ background: "#fff", padding: "18px 22px", borderBottom: "1px solid #EBE3D6", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Sender details</span>
              <span onClick={() => setDrawer(null)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 46, height: 46, borderRadius: 12, flex: "none", background: "rgba(208,245,107,.4)", color: "#6B7A1F", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 18 }}>f</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drawer.fromEmail}</div>
                  <div style={{ fontSize: 12.5, color: "#9AA59E" }}>Clientforce Mailer · {drawer.fromName ?? "—"}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: drawer.status === "ACTIVE" ? "#0F7A28" : "#9A6B12", background: drawer.status === "ACTIVE" ? "#D7F5DD" : "#FBEFD2", borderRadius: 100, padding: "4px 11px" }}>{drawer.status === "ACTIVE" ? "Active" : drawer.status}</span>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "16px 18px" }} data-testid="sender-health">
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#9AA59E", marginBottom: 12 }}>Sending health</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
                  <span style={{ width: 58, height: 58, borderRadius: "50%", border: `4px solid ${authPasses(drawer) === 3 ? "#16A82A" : "#E8C45B"}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: authPasses(drawer) === 3 ? "#16A82A" : "#E8C45B", flex: "none" }}>{authPasses(drawer)}/3</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: authPasses(drawer) === 3 ? "#16A82A" : "#E8C45B" }}>{authPasses(drawer) === 3 ? "Auth checks pass" : "DNS needs attention"}</div>
                    <div style={{ fontSize: 12, color: "#9AA59E" }}>SPF · DKIM · DMARC</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 24, fontWeight: 800, color: "#0E1512" }}>{drawer.sentToday}</div>
                    <div style={{ fontSize: 11, color: "#9AA59E" }}>sends today</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#5C6B62" }}>Daily limit</span>
                  <span style={{ fontSize: 12, color: "#9AA59E" }}>{drawer.sentToday} / {drawer.dailyLimit}</span>
                </div>
                <div style={{ height: 7, borderRadius: 100, background: "#F2EEE4", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, Math.round((drawer.sentToday / Math.max(1, drawer.dailyLimit)) * 100))}%`, background: authPasses(drawer) === 3 ? "#16A82A" : "#E8C45B" }} />
                </div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "16px 18px" }} data-testid="sender-warmup">
                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#9AA59E", flex: 1 }}>Warm-up</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: drawer.warmupState ? "#9A6B12" : "#0F7A28", background: drawer.warmupState ? "#FBEFD2" : "#D7F5DD", borderRadius: 100, padding: "4px 11px" }}>{drawer.warmupState ? "In progress" : "Not needed"}</span>
                </div>
                <div style={{ fontSize: 13.5, color: "#5C6B62" }}>{drawer.warmupState ? "Managed warm-up is ramping this sender's volume." : "This managed sender sends at full volume."}</div>
              </div>
            </div>
            <div style={{ background: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #EBE3D6" }}>
              <span title="Test sends run from Settings → Channels (P1.5)" style={{ fontSize: 13.5, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 15px", cursor: "default" }}>Send test</span>
              <span title="Pausing senders arrives with C2.6 Settings" style={{ marginLeft: "auto", fontSize: 13.5, fontWeight: 700, color: "#C9543F", background: "rgba(224,121,107,.12)", borderRadius: 11, padding: "9px 15px", cursor: "default" }}>Pause sender</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* volume modal — 460px radius 18, 26px round steppers in pill track */}
      {volumeOpen ? (
        <div onClick={() => setVolumeOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.45)", zIndex: 65, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "100%", background: "#FBF7F0", borderRadius: 18, boxShadow: "0 30px 80px rgba(0,0,0,.32)", overflow: "hidden" }} data-testid="volume-modal">
            <div style={{ background: "#fff", padding: "18px 22px", borderBottom: "1px solid #EBE3D6", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512" }}>Daily sending limits</div>
                <div style={{ fontSize: 12.5, color: "#9AA59E" }}>Adjust caps per channel to protect deliverability.</div>
              </div>
              <span onClick={() => setVolumeOpen(false)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
            </div>
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, padding: "13px 15px" }}>
                <span style={{ fontSize: 16 }}>✉</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#0E1512", flex: 1 }}>Email</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 100, padding: "4px 6px" }}>
                  <button type="button" onClick={() => setDailyCap((v) => Math.max(10, v - 10))} style={{ width: 26, height: 26, borderRadius: "50%", background: "#fff", border: "1px solid #EBE3D6", color: "#5C6B62", fontSize: 16, fontWeight: 700, cursor: "pointer" }} data-testid="cap-minus">−</button>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#0E1512", minWidth: 46, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{dailyCap}</span>
                  <button type="button" onClick={() => setDailyCap((v) => v + 10)} style={{ width: 26, height: 26, borderRadius: "50%", background: "#fff", border: "1px solid #EBE3D6", color: "#5C6B62", fontSize: 16, fontWeight: 700, cursor: "pointer" }} data-testid="cap-plus">+</button>
                </span>
              </div>
            </div>
            <div style={{ background: "#fff", padding: "14px 22px", display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #EBE3D6" }}>
              <span onClick={() => setVolumeOpen(false)} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
              <span onClick={() => { void saveGuardrails({ cap: dailyCap }); setVolumeOpen(false); }} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 22px", boxShadow: "0 6px 16px rgba(53,232,52,.26)", cursor: "pointer" }} data-testid="save-limits">Save limits</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
