"use client";

/**
 * Agents List (C2.2) — 1:1 port of `Agents List.dc.html` (toolbar, columns,
 * sort, selection, bulk bar, row menu, pagination, filtered-empty vs empty)
 * driven by live agents. Styling uses the prototype's literal values (A12) —
 * that's the acceptance standard, not the token ramp.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AgentListItem } from "@clientforce/core";

const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

const CH: Record<string, { icon: string; label: string; bg: string; fg: string }> = {
  email: { icon: "✉", label: "Email", bg: "rgba(53,232,52,.13)", fg: "#16A82A" },
  sms: { icon: "💬", label: "SMS", bg: "rgba(54,215,237,.16)", fg: "#1192A6" },
  whatsapp: { icon: "🗨", label: "WA", bg: "rgba(208,245,107,.5)", fg: "#6B7A1F" },
  voice: { icon: "☎", label: "Voice", bg: "#ECE7DC", fg: "#0E1512" },
};

/** UI status labels ← Agent.status (mapping logged in the PR plan). */
const UI_STATUS: Record<string, "Running" | "Paused" | "Draft"> = {
  ACTIVE: "Running",
  PAUSED: "Paused",
  DRAFT: "Draft",
};

const ST: Record<string, { sbg: string; sfg: string; sborder: string; sdot: string }> = {
  Running: { sbg: "#D7F5DD", sfg: "#0F7A28", sborder: "none", sdot: "#16A82A" },
  Paused: { sbg: "#fff", sfg: "#5C6B62", sborder: "1.5px solid #CDBFA8", sdot: "#9AA59E" },
  Draft: { sbg: "#F2EEE4", sfg: "#8A7F6B", sborder: "none", sdot: "#C2B79F" },
};
const HE: Record<string, { hfg: string; hdot: string }> = {
  Good: { hfg: "#1192A6", hdot: "#36D7ED" },
  Warn: { hfg: "#C9543F", hdot: "#E0796B" },
};

/**
 * Deterministic per-agent avatar (owner review, PR #33): hash the agent id
 * over the PROTOTYPE'S emoji pool + its four tints — unique-feeling icons
 * like the mock rows, stable per agent, no generic fallback. A render-time
 * bump avoids adjacent duplicates.
 */
const AVATAR_POOL = ["🌱", "🦷", "🎥", "🏢", "🚀", "🛒", "🏠", "💪", "💆", "⚖", "🔧", "📊"];
const TINT_POOL = ["rgba(53,232,52,.16)", "rgba(54,215,237,.16)", "rgba(208,245,107,.3)", "#F2EEE4"];
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface ColDef {
  key: string;
  label: string;
  w: string;
  align: "left" | "right";
  kind: "agent" | "status" | "channels" | "num" | "health";
  sortKey?: string;
  sortable?: boolean;
  fixed?: boolean;
}
const COL_DEFS: ColDef[] = [
  { key: "agent", label: "Agent", w: "minmax(0,1.7fr)", align: "left", kind: "agent", sortKey: "name", sortable: true, fixed: true },
  { key: "status", label: "Status", w: "1fr", align: "left", kind: "status", sortKey: "status", sortable: true, fixed: true },
  { key: "channels", label: "Channels", w: "1.5fr", align: "left", kind: "channels", fixed: true },
  { key: "contacts", label: "Contacts", w: ".85fr", align: "right", kind: "num", sortKey: "contacts", sortable: true, fixed: true },
  { key: "replies", label: "Replies", w: ".78fr", align: "right", kind: "num", sortKey: "replies", sortable: true, fixed: true },
  { key: "qualified", label: "Qualified", w: ".85fr", align: "right", kind: "num", sortKey: "qualified", sortable: true, fixed: true },
  { key: "steps", label: "Steps", w: ".7fr", align: "right", kind: "num", sortKey: "steps", sortable: true },
  { key: "sendsToday", label: "Sends today", w: "1fr", align: "right", kind: "num", sortKey: "sendsToday", sortable: true },
  { key: "bookings", label: "Bookings", w: ".85fr", align: "right", kind: "num", sortKey: "bookings", sortable: true },
  { key: "payments", label: "Payments", w: ".9fr", align: "right", kind: "num" },
  { key: "health", label: "Health", w: ".95fr", align: "left", kind: "health", fixed: true },
];

const dd: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  background: "#fff",
  border: "1px solid #EBE3D6",
  borderRadius: 12,
  boxShadow: "0 16px 44px rgba(0,0,0,.18)",
  overflow: "hidden",
  zIndex: 40,
};
const ddRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "10px 14px",
  cursor: "pointer",
  fontSize: 13.5,
  color: "#0E1512",
  borderBottom: "1px solid #F7F2EA",
};
const filterBtn = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: active ? "rgba(53,232,52,.08)" : "#fff",
  border: `1px solid ${active ? "#9FD8AC" : "#EBE3D6"}`,
  borderRadius: 11,
  padding: "10px 15px",
  fontSize: 14,
  fontWeight: 600,
  color: active ? "#16A82A" : "#5C6B62",
  cursor: "pointer",
});
const bulkBtn = (danger = false): React.CSSProperties => ({
  fontSize: 13,
  fontWeight: 600,
  color: danger ? "#C9543F" : "#0E1512",
  background: "#fff",
  border: `1px solid ${danger ? "#F0CFC8" : "#EBE3D6"}`,
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
});
const checkbox = (on: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  border: `2px solid ${on ? "#16A82A" : "#CDBFA8"}`,
  borderRadius: 5,
  background: on ? "#16A82A" : "transparent",
  color: "#fff",
  fontSize: 11,
  flex: "none",
});

type DDKey = "status" | "channel" | "more" | "cols" | "perPage" | null;

export function AgentsTable({ initial }: { initial: AgentListItem[] }) {
  const router = useRouter();
  const [agents, setAgents] = useState(initial);
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [channelF, setChannelF] = useState("all");
  const [healthF, setHealthF] = useState("all");
  const [open, setOpen] = useState<DDKey>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState(1);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(8);
  const [colsOn, setColsOn] = useState<Record<string, boolean>>({
    steps: false,
    sendsToday: false,
    bookings: false,
    payments: false,
  });
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  // Single-open dropdowns + close on outside click (§0 conventions).
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!(e.target as HTMLElement | null)?.closest("[data-dd]")) {
        setOpen(null);
        setRowMenu(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const rows = useMemo(() => {
    let prevIdx = -1;
    return agents.map((a) => {
      const base = hashCode(a.id);
      let idx = base % AVATAR_POOL.length;
      if (idx === prevIdx) idx = (idx + 1) % AVATAR_POOL.length;
      prevIdx = idx;
      return {
        ...a,
        uiStatus: UI_STATUS[a.status] ?? "Draft",
        emoji: AVATAR_POOL[idx]!,
        avbg: TINT_POOL[base % TINT_POOL.length]!,
      };
    });
  }, [agents]);

  const q = search.trim().toLowerCase();
  let filtered = rows.filter(
    (a) =>
      (statusF === "all" || a.uiStatus === statusF) &&
      (channelF === "all" || a.channels.includes(channelF)) &&
      (healthF === "all" || a.health === healthF) &&
      (!q || `${a.name} ${a.id}`.toLowerCase().includes(q)),
  );
  if (sortKey) {
    const stOrder: Record<string, number> = { Running: 0, Paused: 1, Draft: 2 };
    const sortVal = (a: (typeof rows)[number]): string | number =>
      sortKey === "name"
        ? a.name.toLowerCase()
        : sortKey === "status"
          ? (stOrder[a.uiStatus] ?? 3)
          : ((a as unknown as Record<string, number>)[sortKey] ?? 0);
    filtered = filtered.slice().sort((a, b) => {
      const av = sortVal(a);
      const bv = sortVal(b);
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
  }

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const cur = Math.min(page, pages);
  const start = (cur - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);
  const selIds = Object.keys(sel).filter((k) => sel[k] && rows.some((a) => a.id === k));
  const allOn = pageRows.length > 0 && pageRows.every((a) => sel[a.id]);

  const visible = COL_DEFS.filter((c) => c.fixed || colsOn[c.key]);
  const gridCols = `46px ${visible.map((c) => c.w).join(" ")} 78px`;
  const colCount = ["steps", "sendsToday", "bookings", "payments"].filter((k) => colsOn[k]).length;

  const running = rows.filter((a) => a.uiStatus === "Running").length;
  const totalContacts = rows.reduce((n, a) => n + a.contacts, 0);

  function doSort(key: string) {
    setSortDir((d) => (sortKey === key ? -d : 1));
    setSortKey(key);
  }
  function toggleDD(key: Exclude<DDKey, null>) {
    setOpen((v) => (v === key ? null : key));
    setRowMenu(null);
  }

  async function patchAgents(ids: string[], body: { status?: string; name?: string }, msg: string) {
    setBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/agents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      );
      setAgents((list) =>
        list.map((a) => (ids.includes(a.id) ? { ...a, ...(body.status ? { status: body.status as AgentListItem["status"] } : {}), ...(body.name ? { name: body.name } : {}) } : a)),
      );
      setToast(msg);
    } finally {
      setBusy(false);
      setSel({});
      setRowMenu(null);
      router.refresh();
    }
  }
  async function deleteAgents(ids: string[]) {
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => fetch(`/api/agents/${id}`, { method: "DELETE" })));
      setAgents((list) => list.filter((a) => !ids.includes(a.id)));
      setToast(`${ids.length > 1 ? `${ids.length} agents` : "Agent"} deleted`);
    } finally {
      setBusy(false);
      setSel({});
      setRowMenu(null);
      router.refresh();
    }
  }

  const statusDefs = [
    { id: "all", label: "All statuses" },
    { id: "Running", label: "Running" },
    { id: "Paused", label: "Paused" },
    { id: "Draft", label: "Draft" },
  ];
  const channelDefs = [
    { id: "all", icon: "◆", label: "All channels" },
    { id: "email", icon: "✉", label: "Email" },
    { id: "sms", icon: "💬", label: "SMS" },
    { id: "whatsapp", icon: "🗨", label: "WhatsApp" },
    { id: "voice", icon: "☎", label: "Voice" },
  ];
  const healthDefs = [
    { id: "all", label: "All health" },
    { id: "Good", label: "Good" },
    { id: "Warn", label: "Needs attention" },
  ];

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, letterSpacing: "-.02em", color: "#0E1512" }}>Agents</div>
          <div style={{ fontSize: 15, color: "#5C6B62" }} data-testid="agents-subtitle">
            {rows.length} agents · {running} running · {totalContacts.toLocaleString()} contacts in sequences
          </div>
        </div>
        <a
          href="/agents/new"
          style={{ textDecoration: "none", fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: "#0A0F0C", background: GRAD, borderRadius: 12, padding: "12px 22px", boxShadow: "0 6px 16px rgba(53,232,52,.26)", cursor: "pointer" }}
        >
          + Add agent
        </a>
      </div>

      {/* toolbar / bulk bar */}
      {selIds.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
          <div style={{ flex: "0 0 320px", display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${search ? "#9FD8AC" : "#EBE3D6"}`, borderRadius: 12, padding: "11px 16px" }}>
            <span style={{ color: "#9AA59E" }}>⚲</span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search agents by name or ID…"
              data-testid="agents-search"
              style={{ border: "none", background: "transparent", fontSize: 14, color: "#0E1512", flex: 1, minWidth: 0, padding: 0 }}
            />
            {search ? (
              <span onClick={() => { setSearch(""); setPage(1); }} style={{ color: "#9AA59E", cursor: "pointer", fontSize: 13 }}>
                ✕
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
            <div style={{ position: "relative" }} data-dd>
              <div onClick={() => toggleDD("status")} style={filterBtn(statusF !== "all")} data-testid="filter-status">
                {statusF === "all" ? "Status" : statusDefs.find((d) => d.id === statusF)?.label} <span style={{ color: "#9AA59E", fontSize: 12 }}>⌄</span>
              </div>
              {open === "status" ? (
                <div style={{ ...dd, width: 190 }}>
                  {statusDefs.map((o) => (
                    <div key={o.id} style={ddRow} onClick={() => { setStatusF(o.id); setOpen(null); setPage(1); }}>
                      <span style={{ flex: 1 }}>{o.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B" }}>{o.id === "all" ? rows.length : rows.filter((a) => a.uiStatus === o.id).length}</span>
                      <span style={{ color: "#16A82A", visibility: statusF === o.id ? "visible" : "hidden" }}>✓</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ position: "relative" }} data-dd>
              <div onClick={() => toggleDD("channel")} style={filterBtn(channelF !== "all")}>
                {channelF === "all" ? "Channel" : channelDefs.find((d) => d.id === channelF)?.label} <span style={{ color: "#9AA59E", fontSize: 12 }}>⌄</span>
              </div>
              {open === "channel" ? (
                <div style={{ ...dd, width: 190 }}>
                  {channelDefs.map((o) => (
                    <div key={o.id} style={ddRow} onClick={() => { setChannelF(o.id); setOpen(null); setPage(1); }}>
                      <span style={{ width: 18, textAlign: "center" }}>{o.icon}</span>
                      <span style={{ flex: 1 }}>{o.label}</span>
                      <span style={{ color: "#16A82A", visibility: channelF === o.id ? "visible" : "hidden" }}>✓</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ position: "relative" }} data-dd>
              <div onClick={() => toggleDD("more")} style={filterBtn(healthF !== "all")}>
                ⚙ Health {healthF !== "all" ? <span style={{ fontSize: 11, color: "#9AA59E" }}>· {healthDefs.find((d) => d.id === healthF)?.label}</span> : null} <span style={{ color: "#9AA59E", fontSize: 12 }}>⌄</span>
              </div>
              {open === "more" ? (
                <div style={{ ...dd, width: 180 }}>
                  {healthDefs.map((o) => (
                    <div key={o.id} style={ddRow} onClick={() => { setHealthF(o.id); setOpen(null); setPage(1); }}>
                      <span style={{ flex: 1 }}>{o.label}</span>
                      <span style={{ color: "#16A82A", visibility: healthF === o.id ? "visible" : "hidden" }}>✓</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ width: 1, height: 24, background: "#EBE3D6" }} />
            <div style={{ position: "relative" }} data-dd>
              <div onClick={() => toggleDD("cols")} style={filterBtn(colCount > 0)} data-testid="filter-columns">
                ▦ Columns {colCount > 0 ? <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#16A82A", borderRadius: 100, padding: "0 6px" }}>{colCount}</span> : null} <span style={{ color: "#9AA59E", fontSize: 12 }}>⌄</span>
              </div>
              {open === "cols" ? (
                <div style={{ ...dd, width: 236, padding: 6 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "#9AA59E", padding: "8px 10px 4px" }}>Extra metrics</div>
                  {[
                    { key: "steps", label: "Steps" },
                    { key: "sendsToday", label: "Sends today" },
                    { key: "bookings", label: "Bookings" },
                    { key: "payments", label: "Payments" },
                  ].map((c) => (
                    <div key={c.key} onClick={() => setColsOn((v) => ({ ...v, [c.key]: !v[c.key] }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>
                      <span style={checkbox(!!colsOn[c.key])}>{colsOn[c.key] ? "✓" : ""}</span>
                      <span style={{ fontSize: 13.5, color: "#0E1512", flex: 1 }}>{c.label}</span>
                    </div>
                  ))}
                  <div onClick={() => { setColsOn({ steps: false, sendsToday: false, bookings: false, payments: false }); setOpen(null); }} style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, color: "#5C6B62", padding: 9, marginTop: 4, borderTop: "1px solid #F2EEE4", cursor: "pointer" }}>
                    Reset to default
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, background: "rgba(53,232,52,.08)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 12, padding: "10px 16px" }} data-testid="bulk-bar">
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{selIds.length} selected</span>
          <span onClick={() => setSel({})} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", cursor: "pointer" }}>Clear</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
            <span style={bulkBtn()} onClick={() => patchAgents(selIds, { status: "ACTIVE" }, `${selIds.length} agent${selIds.length > 1 ? "s" : ""} resumed`)}>▶ Resume</span>
            <span style={bulkBtn()} onClick={() => patchAgents(selIds, { status: "PAUSED" }, `${selIds.length} agent${selIds.length > 1 ? "s" : ""} paused`)}>⏸ Pause</span>
            <span style={bulkBtn()} onClick={() => setToast("Duplicate arrives with a later phase")}>⧉ Duplicate</span>
            <span style={bulkBtn()} onClick={() => setToast(`Exporting ${selIds.length} agents…`)}>↥ Export</span>
            <span style={bulkBtn(true)} onClick={() => deleteAgents(selIds)}>🗑 Delete</span>
          </div>
        </div>
      )}

      {/* table card */}
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 18, boxShadow: "0 6px 24px rgba(14,21,18,.05)", opacity: busy ? 0.7 : 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "center", padding: "0 8px", background: "#FBF7F0", borderBottom: "1.5px solid #EBE3D6", borderRadius: "18px 18px 0 0" }}>
          <div
            onClick={() => {
              const ns = { ...sel };
              if (allOn) pageRows.forEach((a) => delete ns[a.id]);
              else pageRows.forEach((a) => (ns[a.id] = true));
              setSel(ns);
            }}
            style={{ padding: "14px 12px", cursor: "pointer" }}
          >
            <span style={checkbox(allOn)}>{allOn ? "✓" : ""}</span>
          </div>
          {visible.map((c) => (
            <div key={c.key} onClick={c.sortable ? () => doSort(c.sortKey!) : undefined} style={{ padding: "14px 12px", fontSize: 12, fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: "#5C6B62", textAlign: c.align, cursor: c.sortable ? "pointer" : "default" }}>
              {c.label} <span style={{ color: "#16A82A" }}>{c.sortable && sortKey === c.sortKey ? (sortDir === 1 ? "↑" : "↓") : ""}</span>
            </div>
          ))}
          <div />
        </div>

        {pageRows.map((a, i) => {
          const on = !!sel[a.id];
          const isRunning = a.uiStatus === "Running";
          const st = ST[a.uiStatus] ?? ST.Draft!;
          const he = HE[a.health] ?? HE.Warn!;
          return (
            <div
              key={a.id}
              data-testid="agent-row"
              // B6: a DRAFT row opens where the work is — the wizard, resumed.
              onClick={() => router.push(a.uiStatus === "Draft" ? `/agents/new?agent=${a.id}` : `/agents/${a.id}`)}
              style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "center", padding: "0 8px", borderTop: "1px solid #F2EEE4", background: on ? "rgba(53,232,52,.05)" : i % 2 === 1 ? "#FCFAF6" : "#fff", cursor: "pointer" }}
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSel((s) => ({ ...s, [a.id]: !s[a.id] }));
                }}
                style={{ padding: "14px 12px", cursor: "pointer" }}
              >
                <span style={checkbox(on)}>{on ? "✓" : ""}</span>
              </div>
              {visible.map((c) => (
                <div key={c.key} style={{ padding: 12, minWidth: 0, textAlign: c.align }}>
                  {c.kind === "agent" ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                      <span style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", background: a.avbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{a.emoji}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 600, fontSize: 14.5, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                        <span style={{ display: "block", fontSize: 12, color: "#9AA59E" }}>ID: {a.id.slice(-6)}</span>
                      </span>
                    </span>
                  ) : c.kind === "status" ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 100, fontSize: 12.5, fontWeight: 600, background: st.sbg, color: st.sfg, border: st.sborder }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.sdot }} />
                      {a.uiStatus}
                    </span>
                  ) : c.kind === "channels" ? (
                    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
                      {a.channels.map((ch) => {
                        const d = CH[ch] ?? CH.email!;
                        return (
                          <span key={ch} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 8, background: d.bg, color: d.fg, fontSize: 12, fontWeight: 600 }}>
                            {d.icon} {d.label}
                          </span>
                        );
                      })}
                    </span>
                  ) : c.kind === "health" ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600, color: he.hfg }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: he.hdot }} />
                      {a.health}
                    </span>
                  ) : (
                    (() => {
                      const val = c.key === "payments" ? 0 : ((a as unknown as Record<string, number>)[c.key] ?? 0);
                      return <span style={{ fontSize: 14.5, fontWeight: c.key === "contacts" ? 600 : 400, color: val === 0 ? "#C2B79F" : "#0E1512" }}>{val === 0 ? "—" : String(val)}</span>;
                    })()
                  )}
                </div>
              ))}
              <div onClick={(e) => e.stopPropagation()} style={{ padding: "12px 8px", display: "flex", justifyContent: "center", alignItems: "center", gap: 4, position: "relative" }} data-dd>
                <span
                  onClick={() => patchAgents([a.id], { status: isRunning ? "PAUSED" : "ACTIVE" }, `Agent ${isRunning ? "paused" : a.uiStatus === "Draft" ? "launched" : "resumed"}`)}
                  title={a.uiStatus === "Draft" ? "Launch" : isRunning ? "Pause" : "Resume"}
                  style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: a.uiStatus === "Draft" ? "#16A82A" : isRunning ? "#C9543F" : "#16A82A", fontSize: 13, cursor: "pointer" }}
                >
                  {a.uiStatus === "Draft" ? "▶" : isRunning ? "⏸" : "▶"}
                </span>
                <span onClick={() => setRowMenu((v) => (v === a.id ? null : a.id))} style={{ width: 30, height: 30, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", fontSize: 18, fontWeight: 700, cursor: "pointer" }} data-testid="row-menu-btn">
                  ⋯
                </span>
                {rowMenu === a.id ? (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 8, width: 188, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.2)", overflow: "hidden", zIndex: 45, padding: 6, textAlign: "left" }}>
                    {[
                      // B6: drafts resume in the wizard with step + entries intact.
                      ...(a.uiStatus === "Draft"
                        ? [{ icon: "✎", label: "Continue setup", danger: false, act: () => router.push(`/agents/new?agent=${a.id}`) }]
                        : []),
                      { icon: "◉", label: "View", danger: false, act: () => router.push(`/agents/${a.id}`) },
                      { icon: "✎", label: "Edit", danger: false, act: () => router.push(`/agents/${a.id}`) },
                      { icon: "⧉", label: "Duplicate", danger: false, act: () => { setRowMenu(null); setToast("Duplicate arrives with a later phase"); } },
                      { icon: "✏", label: "Rename", danger: false, act: () => { const name = window.prompt("Rename agent", a.name); if (name?.trim()) void patchAgents([a.id], { name: name.trim() }, "Agent renamed"); } },
                      { icon: a.uiStatus === "Draft" ? "▶" : isRunning ? "⏸" : "▶", label: a.uiStatus === "Draft" ? "Launch" : isRunning ? "Pause" : "Resume", danger: false, act: () => patchAgents([a.id], { status: isRunning ? "PAUSED" : "ACTIVE" }, `Agent ${isRunning ? "paused" : "resumed"}`) },
                      { icon: "↪", label: "Move to folder", danger: false, act: () => { setRowMenu(null); setToast("Folders arrive with a later phase"); } },
                      { icon: "🗑", label: "Delete", danger: true, act: () => deleteAgents([a.id]) },
                    ].map((m) => (
                      <div key={m.label} onClick={m.act} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 9, cursor: "pointer", fontSize: 13.5, color: m.danger ? "#C9543F" : "#0E1512" }}>
                        <span style={{ width: 18, textAlign: "center" }}>{m.icon}</span>
                        {m.label}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {total === 0 && rows.length > 0 ? (
          <div style={{ padding: "56px 20px", textAlign: "center", borderTop: "1px solid #F2EEE4" }} data-testid="filtered-empty">
            <div style={{ fontSize: 30, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>No agents match</div>
            <div style={{ fontSize: 13, color: "#9AA59E", marginBottom: 14 }}>Try clearing search or filters.</div>
            <span onClick={() => { setSearch(""); setStatusF("all"); setChannelF("all"); setHealthF("all"); setPage(1); }} style={{ fontSize: 13, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>
              Reset filters
            </span>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div style={{ padding: "64px 20px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", borderTop: "1px solid #F2EEE4" }} data-testid="agents-empty">
            <div style={{ width: 90, height: 90, borderRadius: 24, background: "linear-gradient(135deg,rgba(54,215,237,.18),rgba(53,232,52,.18) 55%,rgba(208,245,107,.3))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 42, marginBottom: 18 }}>🤖</div>
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 22, color: "#0E1512", marginBottom: 7 }}>No agents yet</div>
            <div style={{ fontSize: 14.5, color: "#5C6B62", maxWidth: 420, marginBottom: 22 }}>Spin up your first AI agent to find leads, run outreach across every channel, and book calls on autopilot.</div>
            <a href="/agents/new" style={{ textDecoration: "none", fontWeight: 700, fontSize: 15, color: "#0A0F0C", background: GRAD, borderRadius: 12, padding: "13px 24px", boxShadow: "0 6px 16px rgba(53,232,52,.26)", cursor: "pointer" }}>
              + Create your first agent
            </a>
          </div>
        ) : null}

        {total > 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 20px", borderTop: "1px solid #EBE3D6", background: "#FBF7F0", borderRadius: "0 0 18px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "#8A7F6B" }}>
                Showing {start + 1}–{Math.min(start + perPage, total)} of {total} agents
              </span>
              <div style={{ position: "relative" }} data-dd>
                <div onClick={() => toggleDD("perPage")} style={{ display: "flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 9, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, color: "#5C6B62", cursor: "pointer" }}>
                  {perPage} per page <span style={{ color: "#9AA59E", fontSize: 11 }}>⌄</span>
                </div>
                {open === "perPage" ? (
                  <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, width: 150, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", zIndex: 40 }}>
                    {[8, 15, 25, 50].map((n) => (
                      <div key={n} style={{ ...ddRow, padding: "9px 14px", fontSize: 13 }} onClick={() => { setPerPage(n); setOpen(null); setPage(1); }}>
                        <span style={{ flex: 1 }}>{n} per page</span>
                        <span style={{ color: "#16A82A", visibility: perPage === n ? "visible" : "hidden" }}>✓</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: cur > 1 ? "#0E1512" : "#C9CFC9", fontSize: 14, cursor: "pointer" }}>
                ‹
              </span>
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <span key={p} onClick={() => setPage(p)} style={{ minWidth: 32, height: 32, padding: "0 6px", borderRadius: 9, border: `1px solid ${p === cur ? "#0C140F" : "#EBE3D6"}`, background: p === cur ? "#0C140F" : "#fff", color: p === cur ? "#fff" : "#0E1512", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: p === cur ? 700 : 500, cursor: "pointer" }}>
                  {p}
                </span>
              ))}
              <span onClick={() => setPage((p) => Math.min(pages, p + 1))} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: cur < pages ? "#0E1512" : "#C9CFC9", fontSize: 14, cursor: "pointer" }}>
                ›
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {toast ? (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 60, display: "flex", alignItems: "center", gap: 11, background: "#0C140F", color: "#fff", borderRadius: 12, padding: "12px 18px", boxShadow: "0 16px 40px rgba(0,0,0,.3)" }} data-testid="toast">
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#35E834", color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flex: "none" }}>✓</span>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{toast}</span>
          <span onClick={() => setToast("")} style={{ marginLeft: 8, color: "rgba(255,255,255,.5)", cursor: "pointer" }}>✕</span>
        </div>
      ) : null}
    </div>
  );
}
