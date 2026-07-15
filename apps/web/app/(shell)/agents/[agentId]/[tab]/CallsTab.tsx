"use client";

/**
 * Calls tab (P3.1, DEC-078) — the Campaign View canon's Calls surface goes
 * live: outcome filter chips + "☎ Start AI call", the 380px call-list /
 * detail split, outcome pills, and the transcript thread read from real
 * Message(channel:"voice") rows.
 *
 * Honest deviations from the prototype (fidelity-logged, DEC-078):
 * - Outcome vocabulary is the REAL deterministic set (D4: completed /
 *   no_answer / busy / failed / canceled) — the prototype's Booked/
 *   Interested/Voicemail need call tools + voicemail detection (Q-022).
 * - The recording player renders only when a recording exists; recording is
 *   OFF by default (owner lock), so the transcript is the record.
 * - The ✦ AI summary card needs a summarizer no unit has shipped — absent.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { avTint, cf, GRAD, initials, timeAgo } from "./shared";

interface CallRow {
  id: string;
  contactId: string;
  contactName: string;
  company: string | null;
  direction: string;
  status: string;
  outcome: string | null;
  durationSec: number | null;
  startedAt: string;
}

interface TranscriptRow {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  body: string;
  sentAt: string;
}

interface CallDetail {
  call: { id: string; status: string; outcome: string | null; durationSec: number | null; startedAt: string; meta: Record<string, unknown> | null };
  contact: { id: string; firstName: string | null; lastName: string | null; company: string | null } | null;
  transcript: TranscriptRow[];
}

interface DialableContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
}

/** The prototype's callOut pill styles, keyed by the REAL outcome set (D4). */
const OUTCOME_STYLE: Record<string, { label: string; fg: string; bg: string; accent: string }> = {
  completed: { label: "Completed", fg: "#0F7A28", bg: "#D7F5DD", accent: "#35E834" },
  no_answer: { label: "No answer", fg: "#8A7F6B", bg: "#F2EEE4", accent: "transparent" },
  busy: { label: "Busy", fg: "#8A6D1A", bg: "rgba(232,196,91,.22)", accent: "transparent" },
  canceled: { label: "Canceled", fg: "#8A7F6B", bg: "#F2EEE4", accent: "transparent" },
  failed: { label: "Failed", fg: "#C9543F", bg: "rgba(224,121,107,.16)", accent: "transparent" },
};
const PENDING_STYLE = { label: "In progress", fg: "#1192A6", bg: "rgba(54,215,237,.14)", accent: "transparent" };

const outcomeStyle = (c: Pick<CallRow, "outcome">) =>
  (c.outcome && OUTCOME_STYLE[c.outcome]) || PENDING_STYLE;

const fmtDuration = (sec: number | null): string => {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const CAT_DEFS = [
  { id: "all", label: "All calls" },
  { id: "completed", label: "Completed" },
  { id: "no_answer", label: "No answer" },
  { id: "busy", label: "Busy" },
  { id: "failed", label: "Failed" },
] as const;

export default function CallsTab({ agentId }: { agentId: string }) {
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  const [error, setError] = useState(false);
  const [cat, setCat] = useState<string>("all");
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [dialOpen, setDialOpen] = useState(false);
  const [contacts, setContacts] = useState<DialableContact[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = (await cf(`agents/${agentId}/calls`)) as { calls: CallRow[] };
      setCalls(data.calls);
      setError(false);
    } catch {
      setError(true);
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000); // A4: 5s polling
    return () => clearInterval(t);
  }, [refresh]);

  const visible = useMemo(
    () => (calls ?? []).filter((c) => cat === "all" || (c.outcome ?? "pending") === cat),
    [calls, cat],
  );
  const sel = visible.find((c) => c.id === selId) ?? visible[0] ?? null;

  useEffect(() => {
    if (!sel) {
      setDetail(null);
      return;
    }
    let live = true;
    void cf(`calls/${sel.id}`).then(
      (d) => live && setDetail(d as CallDetail),
      () => live && setDetail(null),
    );
    return () => {
      live = false;
    };
  }, [sel?.id, sel?.status, sel?.outcome]);

  const openDial = async () => {
    setDialOpen(true);
    if (!contacts) {
      try {
        const data = (await cf("contacts/view")) as { rows: DialableContact[] };
        setContacts((data.rows ?? []).filter((c) => c.phone));
      } catch {
        setContacts([]);
      }
    }
  };

  const dial = async (contactId: string) => {
    setDialOpen(false);
    setNotice("Dialing…");
    try {
      await cf(`agents/${agentId}/calls`, { method: "POST", body: JSON.stringify({ contactId }) });
      setNotice(null);
      void refresh();
    } catch (err) {
      // Typed refusals surface here AND land as call.refused.v1 Logs rows.
      const msg = err instanceof Error ? err.message : "Call refused";
      setNotice(`Call refused — see the Logs tab (${msg})`);
      setTimeout(() => setNotice(null), 6000);
    }
  };

  if (error) {
    return (
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: "48px 20px", textAlign: "center" }} data-testid="calls-error">
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 4 }}>Couldn&apos;t load calls</div>
        <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 14 }}>Check your connection and try again.</div>
        <button type="button" onClick={() => void refresh()} style={{ background: GRAD, border: "none", borderRadius: 11, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}>Retry</button>
      </div>
    );
  }

  const counts: Record<string, number> = { all: (calls ?? []).length };
  for (const c of calls ?? []) {
    const key = c.outcome ?? "pending";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const connected = (calls ?? []).filter((c) => (c.durationSec ?? 0) > 0).length;
  const connectRate = (calls ?? []).length > 0 ? `${Math.round((connected / (calls ?? []).length) * 100)}%` : "—";

  return (
    <div data-testid="calls-tab">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1, minWidth: 0, paddingBottom: 2 }}>
          {CAT_DEFS.map((c) => {
            const on = cat === c.id;
            return (
              <span
                key={c.id}
                onClick={() => setCat(c.id)}
                data-testid={`call-cat-${c.id}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 100, fontSize: 13, fontWeight: on ? 700 : 600, color: on ? "#0A0F0C" : "#5C6B62", background: on ? GRAD : "#fff", border: `1px solid ${on ? "transparent" : "#EBE3D6"}`, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}
              >
                {c.label}
                <span style={{ fontSize: 11, fontWeight: 700, color: on ? "#0A3D16" : "#8A7F6B", background: on ? "rgba(255,255,255,.45)" : "#F2EEE4", borderRadius: 100, padding: "1px 7px" }}>{counts[c.id] ?? 0}</span>
              </span>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void openDial()}
          data-testid="start-ai-call"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#0A0F0C", background: GRAD, border: "none", borderRadius: 11, padding: "9px 16px", boxShadow: "0 6px 16px rgba(53,232,52,.26)", flex: "none", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}
        >
          ☎ Start AI call
        </button>
      </div>

      {notice ? (
        <div data-testid="dial-notice" style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: "#8A6D1A", background: "rgba(232,196,91,.18)", border: "1px solid rgba(232,196,91,.4)", borderRadius: 10, padding: "9px 14px" }}>{notice}</div>
      ) : null}

      {dialOpen ? (
        <div data-testid="dial-flyout" style={{ marginBottom: 12, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, boxShadow: "0 10px 28px rgba(14,21,18,.1)", padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512", flex: 1 }}>Who should the agent call?</span>
            <button type="button" onClick={() => setDialOpen(false)} style={{ border: "none", background: "none", fontSize: 14, color: "#8A7F6B", cursor: "pointer" }}>✕</button>
          </div>
          {contacts === null ? (
            <div style={{ fontSize: 13, color: "#8A7F6B" }}>Loading contacts…</div>
          ) : contacts.length === 0 ? (
            <div style={{ fontSize: 13, color: "#8A7F6B" }}>No contacts with a phone number yet — add phones in Contacts first.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {contacts.map((c) => (
                <button key={c.id} type="button" onClick={() => void dial(c.id)} data-testid={`dial-contact-${c.id}`} style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: "none", border: "none", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", flex: "none", background: avTint(c.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#0E1512" }}>{initials(c.firstName, c.lastName)}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", flex: 1 }}>{[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || "Unknown"}</span>
                  <span style={{ fontSize: 12, color: "#9AA59E" }}>{c.company ?? ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {calls === null ? (
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: 20 }} data-testid="calls-skeleton">
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ height: 56, borderRadius: 10, background: "#F7F2EA", marginBottom: 10, animation: "pulse 1.4s ease-in-out infinite" }} />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", padding: "64px 20px", textAlign: "center" }} data-testid="calls-empty">
          <div style={{ fontSize: 30, marginBottom: 12 }}>☎</div>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20, color: "#0E1512", marginBottom: 6 }}>No calls yet</div>
          <div style={{ fontSize: 13.5, color: "#8A7F6B", maxWidth: 420, margin: "0 auto" }}>Start an AI call to a contact with a phone number — the transcript and outcome land here.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, height: 602 }}>
          {/* CALL LIST */}
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid #F2EEE4" }}>
              <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15, color: "#0E1512", flex: 1 }}>
                Call history <span style={{ color: "#9AA59E", fontWeight: 600 }}>· {visible.length}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1192A6" }}>{connectRate} connect</span>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {visible.map((c) => {
                const o = outcomeStyle(c);
                const isSel = sel?.id === c.id;
                return (
                  <div key={c.id} onClick={() => setSelId(c.id)} data-testid={`call-row-${c.id}`} style={{ display: "flex", gap: 11, padding: "13px 16px", borderLeft: `3px solid ${isSel ? "#35E834" : o.accent}`, background: isSel ? "rgba(53,232,52,.07)" : "#fff", cursor: "pointer", borderBottom: "1px solid #F7F2EA" }}>
                    <span style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", background: avTint(c.contactId), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#0E1512" }}>{initials(...c.contactName.split(" ") as [string, string])}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 14, fontWeight: isSel ? 700 : 600, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{c.contactName}</span>
                        <span style={{ fontSize: 12, color: "#9AA59E", flex: "none" }}>{timeAgo(c.startedAt)}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: "#9AA59E" }}>↗ AI outbound</span>
                        <span style={{ fontSize: 11, color: "#C2B79F" }}>·</span>
                        <span style={{ fontSize: 11, color: "#9AA59E", fontVariantNumeric: "tabular-nums" }}>{fmtDuration(c.durationSec)}</span>
                      </div>
                      <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700, color: o.fg, background: o.bg, borderRadius: 6, padding: "2px 8px" }} data-testid="call-outcome-pill">{o.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CALL DETAIL */}
          <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", display: "flex", flexDirection: "column", overflow: "hidden" }} data-testid="call-detail">
            {sel && detail ? (
              <>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #F2EEE4", display: "flex", alignItems: "center", gap: 13 }}>
                  <span style={{ width: 42, height: 42, borderRadius: "50%", flex: "none", background: avTint(sel.contactId), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{initials(detail.contact?.firstName, detail.contact?.lastName)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16.5, color: "#0E1512" }}>{sel.contactName}</div>
                    <div style={{ fontSize: 12.5, color: "#9AA59E" }}>{[sel.company, fmtDuration(sel.durationSec)].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: outcomeStyle(sel).fg, background: outcomeStyle(sel).bg, borderRadius: 7, padding: "5px 11px" }}>{outcomeStyle(sel).label}</span>
                </div>
                {/* Recording player: OFF by default (owner lock) — the transcript is the record. */}
                <div style={{ overflowY: "auto", flex: 1, padding: "18px 20px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>Transcript</div>
                  {detail.transcript.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#8A7F6B" }} data-testid="transcript-empty">
                      {sel.status === "QUEUED" || sel.status === "IN_PROGRESS" ? "The transcript lands here when the call ends." : "No transcript — the call never connected."}
                    </div>
                  ) : (
                    detail.transcript.map((t) => (
                      <div key={t.id} style={{ display: "flex", gap: 11, marginBottom: 14 }} data-testid="transcript-turn">
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: t.direction === "OUTBOUND" ? "#16A82A" : "#1192A6", flex: "none", width: 54, paddingTop: 2 }}>{t.direction === "OUTBOUND" ? "Agent" : detail.contact?.firstName || "Lead"}</span>
                        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "#3B463F", flex: 1 }}>{t.body}</div>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ borderTop: "1px solid #F2EEE4", padding: "13px 20px", display: "flex", alignItems: "center", gap: 10, background: "#FBFAF7" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#5C6B62", border: "1px solid #EBE3D6", background: "#fff", borderRadius: 10, padding: "9px 14px" }}>✎ Add note</span>
                  <button type="button" onClick={() => void dial(sel.contactId)} data-testid="call-again" style={{ fontSize: 13, fontWeight: 600, color: "#5C6B62", border: "1px solid #EBE3D6", background: "#fff", borderRadius: 10, padding: "9px 14px", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}>↻ Call again</button>
                  <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 10, padding: "9px 16px", boxShadow: "0 5px 14px rgba(53,232,52,.24)" }}>📅 Book follow-up</span>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#8A7F6B" }}>Select a call to see its transcript.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
