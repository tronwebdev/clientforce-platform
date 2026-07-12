"use client";

/**
 * Inbox tab (checkpoints §4) — intent chips ARE the P1.7 classifications
 * (prototype `inboxCatDefs`, DEC-034 label set) with live counts; 380px thread
 * list + reading pane rendering real Message bodies. A4: 5s polling.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { cf, GRAD, INBOX_CATS, intentTint, avTint, initials, timeAgo } from "./shared";

interface ThreadMessage {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  channel?: string;
  subject: string | null;
  body: string;
  intent: string | null;
  sentAt: string;
  /** G3 (DEC-075): present ONLY when the send boundary recorded guided
   *  compose provenance (Message.meta mode/composerVersion, G1/G2) —
   *  absent provenance renders unmarked, never inferred. */
  composed?: { composerVersion: string | null };
}
export interface Thread {
  contactId: string;
  /** P2.1 (DEC-061): channels present in the thread ("email" | "sms"). */
  channels?: string[];
  contact: { id: string; firstName: string | null; lastName: string | null; company: string | null; email: string | null } | null;
  intent: string | null;
  unread: boolean;
  done: boolean;
  lastAt: string;
  preview: string;
  messageCount: number;
  messages: ThreadMessage[];
}

const CHANNEL_OPTIONS = [
  { id: "all", icon: "◎", label: "All channels" },
  { id: "email", icon: "✉", label: "Email" },
  { id: "sms", icon: "💬", label: "SMS" },
  { id: "whatsapp", icon: "🗨", label: "WhatsApp" },
];

/** C2.9 (DEC-059): `goalLabel` = the campaign goal's terminal wording — the
 *  booked category chip/tint renders it instead of the single-goal-era
 *  "Meeting booked" (a promote_offer agent reads "Purchase made").
 *  M1b (DEC-068): chips filter intent SETS (a legacy `question` thread and an
 *  `info_request` thread share the "Question" chip); an unknown intent value
 *  renders VERBATIM in the neutral tint — never "Unclassified", never a crash. */
export function InboxTab({ agentId, goalLabel }: { agentId: string; goalLabel?: string }) {
  const cats = INBOX_CATS.map((c) => (c.id === "booked" && goalLabel ? { ...c, label: goalLabel } : c));
  const tintFor = (intent: string) => {
    const t = intentTint(intent);
    return intent === "booked" && goalLabel ? { ...t, label: goalLabel } : t;
  };
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [cat, setCat] = useState("all");
  const [channel, setChannel] = useState("all");
  const [channelDD, setChannelDD] = useState(false);
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [sortDD, setSortDD] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await cf(`agents/${agentId}/inbox`).catch(() => null);
    if (res) setThreads(res.threads as Thread[]);
  }, [agentId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: threads?.length ?? 0 };
    for (const catDef of INBOX_CATS) {
      if (catDef.id === "all") continue;
      c[catDef.id] = (threads ?? []).filter((t) => t.intent && catDef.intents.includes(t.intent)).length;
    }
    return c;
  }, [threads]);

  const catIntents = useMemo(
    () => new Set(INBOX_CATS.find((c) => c.id === cat)?.intents ?? []),
    [cat],
  );
  const visible = useMemo(() => {
    let list = (threads ?? []).filter((t) => cat === "all" || (t.intent ? catIntents.has(t.intent) : false));
    // P2.1 (DEC-061, §4 amendment): the channel filter is FUNCTIONAL — a
    // thread matches when any of its messages used the channel.
    if (channel !== "all") list = list.filter((t) => (t.channels ?? ["email"]).includes(channel));
    list = [...list].sort((a, b) =>
      sort === "newest"
        ? b.lastAt.localeCompare(a.lastAt)
        : sort === "oldest"
          ? a.lastAt.localeCompare(b.lastAt)
          : (a.contact?.firstName ?? "").localeCompare(b.contact?.firstName ?? ""),
    );
    return list;
  }, [threads, cat, catIntents, channel, sort]);

  const sel = useMemo(
    () => visible.find((t) => t.contactId === selId) ?? visible[0] ?? null,
    [visible, selId],
  );

  async function markDone() {
    if (!sel) return;
    const lastInbound = [...sel.messages].reverse().find((m) => m.direction === "INBOUND");
    if (!lastInbound) return;
    await cf(`messages/${lastInbound.id}/done`, { method: "PATCH", body: JSON.stringify({ done: !sel.done }) }).catch(() => {});
    void refresh();
  }

  const heading = cat === "all" ? "All conversations" : cats.find((c) => c.id === cat)?.label ?? "All";
  const sortLabel = sort === "newest" ? "Newest first" : sort === "oldest" ? "Oldest first" : "Name A–Z";
  const chOpt = CHANNEL_OPTIONS.find((o) => o.id === channel)!;

  return (
    <>
      {/* category chips + channel filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1, minWidth: 0, paddingBottom: 2 }}>
          {cats.map((c) => {
            const on = cat === c.id;
            return (
              <span key={c.id} onClick={() => { setCat(c.id); setSelId(null); }} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 100, fontSize: 13, fontWeight: on ? 700 : 600, color: on ? "#0A0F0C" : "#5C6B62", background: on ? GRAD : "#fff", border: `1px solid ${on ? "transparent" : "#EBE3D6"}`, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }} data-testid={`cat-${c.id}`}>
                {c.label}
                <span style={{ fontSize: 11, fontWeight: 700, color: on ? "#0A0F0C" : "#8A7F6B", background: on ? "rgba(10,15,12,.14)" : "#F2EEE4", borderRadius: 100, padding: "1px 7px" }}>{counts[c.id] ?? 0}</span>
              </span>
            );
          })}
        </div>
        <div style={{ position: "relative", flex: "none" }}>
          <span onClick={() => setChannelDD((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 14px", cursor: "pointer" }} data-testid="channel-filter">
            <span style={{ fontSize: 13 }}>{chOpt.icon}</span>{chOpt.label}<span style={{ color: "#9AA59E", fontSize: 11, marginLeft: 2 }}>▾</span>
          </span>
          {channelDD ? (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 214, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", zIndex: 20 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#9AA59E", padding: "10px 14px 6px" }}>Filter by channel</div>
              {CHANNEL_OPTIONS.map((o) => (
                <div key={o.id} onClick={() => { setChannel(o.id); setChannelDD(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", fontSize: 13.5, color: "#0E1512", borderTop: "1px solid #F7F2EA" }}>
                  <span style={{ width: 22, textAlign: "center" }}>{o.icon}</span>
                  <span style={{ flex: 1 }}>{o.label}</span>
                  <span style={{ color: "#16A82A", visibility: channel === o.id ? "visible" : "hidden" }}>✓</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #F2EEE4", background: "#FBF7F0", padding: "9px 14px", fontSize: 11.5, color: "#8A7F6B", display: "flex", alignItems: "center", gap: 7 }}>☎ Phone calls live in the <strong style={{ color: "#5C6B62" }}>Calls</strong> tab</div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, height: 602 }}>
        {/* list pane */}
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid #F2EEE4" }}>
            <span style={{ display: "inline-block", width: 18, height: 18, border: "2px solid #CDBFA8", borderRadius: 5, flex: "none" }} />
            <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15, color: "#0E1512", flex: 1 }}>{heading} <span style={{ color: "#9AA59E", fontWeight: 600 }}>· {visible.length}</span></span>
            <div style={{ position: "relative", flex: "none" }}>
              <span onClick={() => setSortDD((v) => !v)} style={{ fontSize: 13, color: "#5C6B62", fontWeight: 600, border: "1px solid #EBE3D6", borderRadius: 9, padding: "5px 11px", cursor: "pointer", whiteSpace: "nowrap" }} data-testid="sort">{sortLabel} ⌄</span>
              {sortDD ? (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 184, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", zIndex: 20 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#9AA59E", padding: "10px 14px 6px" }}>Sort by</div>
                  {(["newest", "oldest", "name"] as const).map((s) => (
                    <div key={s} onClick={() => { setSort(s); setSortDD(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", cursor: "pointer", fontSize: 13.5, color: "#0E1512", borderTop: "1px solid #F7F2EA" }}>
                      <span style={{ flex: 1 }}>{s === "newest" ? "Newest first" : s === "oldest" ? "Oldest first" : "Name A–Z"}</span>
                      <span style={{ color: "#16A82A", visibility: sort === s ? "visible" : "hidden" }}>✓</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <span style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E" }}>⚲</span>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {threads === null ? (
              <div data-testid="inbox-skeleton">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ display: "flex", gap: 11, padding: "12px 16px", borderBottom: "1px solid #F7F2EA" }}>
                    <span style={{ width: 38, height: 38, borderRadius: "50%", background: "#F2EEE4", flex: "none" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 12, width: "55%", background: "#F2EEE4", borderRadius: 6, marginBottom: 7 }} />
                      <div style={{ height: 10, width: "80%", background: "#F7F2EA", borderRadius: 6 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <div style={{ padding: "48px 20px", textAlign: "center", color: "#9AA59E", fontSize: 13.5 }} data-testid="inbox-empty">
                {threads.length === 0 ? "No replies yet" : "No conversations match this filter."}
              </div>
            ) : (
              visible.map((t) => {
                const on = sel?.contactId === t.contactId;
                const tint = t.intent ? tintFor(t.intent) : null;
                const hasSms = (t.channels ?? []).includes("sms");
                const name = [t.contact?.firstName, t.contact?.lastName].filter(Boolean).join(" ") || t.contact?.email || "Unknown";
                return (
                  <div key={t.contactId} onClick={() => setSelId(t.contactId)} style={{ display: "flex", gap: 11, padding: "12px 16px", borderLeft: `3px solid ${on ? "#35E834" : "transparent"}`, background: on ? "#FBF7F0" : "transparent", cursor: "pointer", borderBottom: "1px solid #F7F2EA", opacity: t.done ? 0.55 : 1 }} data-testid="thread-row">
                    <span style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", background: avTint(t.contactId), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#0A0F0C", position: "relative" }}>
                      {initials(t.contact?.firstName, t.contact?.lastName, t.contact?.email)}
                      <span style={{ position: "absolute", bottom: -2, right: -3, width: 18, height: 18, borderRadius: "50%", background: hasSms ? "rgba(54,215,237,.9)" : "rgba(53,232,52,.9)", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#0A0F0C" }}>{hasSms ? "💬" : "✉"}</span>
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 14, fontWeight: t.unread ? 700 : 600, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{name}</span>
                        {t.unread ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#35E834", flex: "none" }} data-testid="unread-dot" /> : null}
                        <span style={{ fontSize: 12, color: "#9AA59E", flex: "none" }}>{timeAgo(t.lastAt)}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: tint?.fg ?? "#8A7F6B", background: tint?.bg ?? "#F2EEE4", borderRadius: 6, padding: "2px 7px" }}>{tint?.label ?? "Unclassified"}</span>
                        {hasSms ? <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 6, padding: "2px 7px" }} data-testid="thread-sms-chip">SMS</span> : null}
                        <span style={{ fontSize: 12, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.contact?.company ?? ""}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.preview}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* reading pane */}
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!sel ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", fontSize: 13.5 }}>Select a conversation</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 20px", borderBottom: "1px solid #F2EEE4" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16.5, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel.messages[0]?.subject ?? "(no subject)"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    {/* P2.1: channel-true chips — one per channel in the thread */}
                    {((sel.channels?.length ? sel.channels : ["email"])).map((c) => (
                      <span key={c} style={{ fontSize: 11.5, fontWeight: 700, color: c === "sms" ? "#1192A6" : "#16A82A", background: c === "sms" ? "rgba(54,215,237,.14)" : "rgba(53,232,52,.13)", borderRadius: 6, padding: "2px 9px" }}>{c === "sms" ? "💬 SMS" : "✉ Email"}</span>
                    ))}
                    {sel.intent && tintFor(sel.intent) ? (
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: tintFor(sel.intent)!.fg, background: tintFor(sel.intent)!.bg, borderRadius: 100, padding: "3px 10px" }}>{tintFor(sel.intent)!.label}</span>
                    ) : null}
                    <span style={{ fontSize: 13, color: "#9AA59E" }}>with {[sel.contact?.firstName, sel.contact?.lastName].filter(Boolean).join(" ") || sel.contact?.email}</span>
                  </div>
                </div>
                <span onClick={() => void markDone()} style={{ fontSize: 13, color: sel.done ? "#8A7F6B" : "#16A82A", fontWeight: 600, border: `1px solid ${sel.done ? "#EBE3D6" : "#9FD8AC"}`, background: sel.done ? "#fff" : "rgba(53,232,52,.06)", borderRadius: 9, padding: "7px 13px", cursor: "pointer", flex: "none" }} data-testid="mark-done">
                  {sel.done ? "↩ Reopen" : "✓ Mark done"}
                </span>
                <div style={{ position: "relative", flex: "none" }}>
                  <span onClick={() => setMenuOpen((v) => !v)} style={{ width: 34, height: 34, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", fontSize: 18, fontWeight: 700, cursor: "pointer" }} data-testid="thread-menu">⋯</span>
                  {menuOpen ? (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 214, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.2)", overflow: "hidden", zIndex: 25, padding: 6 }} data-testid="thread-menu-open">
                      {[
                        { icon: "☺", label: "Open lead", act: () => { window.location.href = `/agents/${agentId}/leads`; } },
                        { icon: "✉", label: "Copy email address", act: () => { void navigator.clipboard?.writeText(sel.contact?.email ?? ""); setMenuOpen(false); } },
                        { icon: "✓", label: sel.done ? "Reopen conversation" : "Mark done", act: () => { void markDone(); setMenuOpen(false); } },
                      ].map((a) => (
                        <div key={a.label} onClick={a.act} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 11px", borderRadius: 9, cursor: "pointer", fontSize: 13.5, color: "#0E1512" }}>
                          <span style={{ width: 18, textAlign: "center" }}>{a.icon}</span>{a.label}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: 20, background: "#FCFAF6" }} data-testid="thread-view">
                {sel.messages.map((m) => {
                  const inbound = m.direction === "INBOUND";
                  return (
                    <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: inbound ? "flex-start" : "flex-end", marginBottom: 16 }}>
                      <div style={{ maxWidth: "80%", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5, justifyContent: inbound ? "flex-start" : "flex-end" }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: inbound ? "#0E1512" : "#16A82A" }}>{inbound ? [sel.contact?.firstName, sel.contact?.lastName].filter(Boolean).join(" ") || sel.contact?.email : "Agent"}</span>
                          {/* G3 (DEC-075): guided compose provenance from the send
                              boundary's meta — scripted/template messages carry no
                              provenance and stay unmarked. */}
                          {m.composed ? (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 6, padding: "2px 7px" }} data-testid="msg-composed-tag">✦ Composed</span>
                          ) : null}
                          <span style={{ fontSize: 11.5, color: "#9AA59E" }}>{timeAgo(m.sentAt)}</span>
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.55, color: "#243029", background: inbound ? "#fff" : "rgba(53,232,52,.08)", border: `1px solid ${inbound ? "#EBE3D6" : "rgba(53,232,52,.25)"}`, borderRadius: inbound ? "4px 14px 14px 14px" : "14px 4px 14px 14px", padding: "12px 15px", whiteSpace: "pre-wrap" }}>{m.body}</div>
                        {m.composed ? (
                          <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 4, textAlign: "right" }} data-testid="msg-composed-line">composed from brief · checked against your rails</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* composer — visual per prototype; reply-send is a later unit */}
              <div style={{ borderTop: "1px solid #F2EEE4", padding: "13px 20px 15px", background: "#fff" }}>
                <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "13px 15px", boxShadow: "0 2px 8px rgba(14,21,18,.04)" }}>
                  <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 8 }}>Reply to {sel.contact?.email}</div>
                  <div style={{ fontSize: 14, color: "#B7BDB6", lineHeight: 1.5, marginBottom: 13 }}>Write a reply…<span style={{ display: "inline-block", width: 2, height: 17, background: "#35E834", verticalAlign: "middle", marginLeft: 2 }} /></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {["B", "I", "🔗", "📎", "☺"].map((c) => (
                      <span key={c} style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", color: "#5C6B62", fontSize: 14, background: "#F2EEE4" }}>{c}</span>
                    ))}
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 8, padding: "6px 11px", marginLeft: 4 }}>✦ AI reply</span>
                    <div title="Reply sending arrives with a later unit" style={{ marginLeft: "auto", display: "flex", alignItems: "stretch", borderRadius: 11, overflow: "hidden", boxShadow: "0 6px 16px rgba(53,232,52,.26)", opacity: 0.85 }}>
                      <span style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: "#0A0F0C", background: GRAD, padding: "11px 22px" }}>Reply</span>
                      <span style={{ fontSize: 13, color: "#0A0F0C", background: "#35E834", padding: "11px 12px", borderLeft: "1px solid rgba(10,15,12,.18)" }}>⌄</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
