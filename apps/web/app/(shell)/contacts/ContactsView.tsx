"use client";

/**
 * Contacts screen (C2.5, checkpoints §5) — ported from `Contacts.dc.html`.
 * The A10 segment chips are QUERIES over live derived rows (`deriveStatus`),
 * never stored stage values. A4: 5s polling; drawer timeline polls while open.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { EmptyState } from "@clientforce/ui";

const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

const cf = (path: string, init?: RequestInit) =>
  fetch(`/api/cf/${path}`, { headers: { "Content-Type": "application/json" }, ...init }).then(
    async (r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    },
  );

export interface ContactRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  source: string | null;
  createdAt: string;
  stage: string | null;
  enrollmentStatus: string | null;
  agentName?: string | null;
  replied: boolean;
  unsub: boolean;
  lastActivity: string | null;
}
interface TimelineEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

/** Add-a-contact drawer field styles (prototype literals). */
const addLbl: CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 };
const addInp: CSSProperties = { width: "100%", boxSizing: "border-box", height: 44, borderRadius: 10, background: "#fff", border: "1px solid #EBE3D6", padding: "0 13px", fontSize: 14, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" };

/** A10 derivation — the single source for chips, pills and filters. */
export function deriveStatus(c: ContactRow): "New" | "Replied" | "Qualified" | "Booked" | "Unsubscribed" {
  if (c.unsub) return "Unsubscribed";
  if (c.stage === "booked") return "Booked";
  if (c.stage === "interested") return "Qualified";
  if (c.replied) return "Replied";
  return "New";
}

/** Prototype `ST` pill map. */
const ST: Record<string, { sbg: string; sfg: string }> = {
  New: { sbg: "#F2EEE4", sfg: "#8A7F6B" },
  Replied: { sbg: "rgba(54,215,237,.16)", sfg: "#1192A6" },
  Qualified: { sbg: "rgba(53,232,52,.14)", sfg: "#16A82A" },
  Booked: { sbg: "#D7F5DD", sfg: "#0F7A28" },
  Unsubscribed: { sbg: "rgba(224,121,107,.16)", sfg: "#C9543F" },
};

const SEGMENTS = [
  { id: "all", label: "All" },
  { id: "New", label: "New" },
  { id: "Replied", label: "Replied" },
  { id: "Qualified", label: "Qualified" },
  { id: "Booked", label: "Booked" },
  { id: "Unsubscribed", label: "Unsub" },
] as const;

const AV_TINTS = ["rgba(53,232,52,.16)", "rgba(54,215,237,.16)", "rgba(208,245,107,.3)", "#F2EEE4"];
const avTint = (key: string) => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AV_TINTS[Math.abs(h) % AV_TINTS.length]!;
};
const initials = (c: ContactRow) => {
  const a = (c.firstName ?? "").trim()[0] ?? "";
  const b = (c.lastName ?? "").trim()[0] ?? "";
  return (a + b || (c.email ?? "?").slice(0, 2)).toUpperCase();
};
const fullName = (c: ContactRow) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown";
const timeAgo = (iso: string | null) => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "Yesterday";
  return `${Math.floor(s / 86400)} days ago`;
};

/** Drawer timeline row treatment per live event type. */
const EVENT_ROW: Record<string, { icon: string; bg: string; fg: string; label: (p: Record<string, unknown>) => string }> = {
  "lead.enrolled.v1": { icon: "+", bg: "#F2EEE4", fg: "#8A7F6B", label: () => "Enrolled in a sequence" },
  "email.sent.v1": { icon: "✉", bg: "#F2EEE4", fg: "#8A7F6B", label: (p) => `Step email sent${p.subject ? ` — “${String(p.subject)}”` : ""}` },
  "email.delivered.v1": { icon: "✓", bg: "#F2EEE4", fg: "#8A7F6B", label: () => "Email delivered" },
  "email.opened.v1": { icon: "◔", bg: "#F2EEE4", fg: "#8A7F6B", label: (p) => `Opened${p.subject ? ` “${String(p.subject)}”` : " an email"}` },
  "email.clicked.v1": { icon: "🔗", bg: "rgba(54,215,237,.16)", fg: "#1192A6", label: () => "Clicked a link" },
  "email.replied.v1": { icon: "↩", bg: "rgba(54,215,237,.16)", fg: "#1192A6", label: (p) => `Replied${p.intent ? ` — classified “${String(p.intent)}”` : ""}` },
  "email.bounced.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F", label: () => "Email hard-bounced" },
  "lead.stage_changed.v1": { icon: "↪", bg: "rgba(53,232,52,.14)", fg: "#16A82A", label: (p) => `Moved to ${String(p.toStage ?? "a new stage")}${p.manual ? " by you" : ""}` },
  "lead.unsubscribed.v1": { icon: "⊘", bg: "rgba(224,121,107,.16)", fg: "#C9543F", label: () => "Unsubscribed from all sequences" },
};

const MOVE_OPTIONS = [
  { icon: "✦", label: "Mark as qualified", stage: "interested", color: "#0E1512" },
  { icon: "📅", label: "Mark as booked", stage: "booked", color: "#0E1512" },
  { icon: "⊘", label: "Unsubscribe", stage: "__unsub__", color: "#C9543F" },
];

export function ContactsView() {
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [error, setError] = useState(false);
  const [seg, setSeg] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusDD, setStatusDD] = useState(false);
  const [agentFilter, setAgentFilter] = useState("all");
  const [agentDD, setAgentDD] = useState(false);
  const [moreDD, setMoreDD] = useState(false);
  const [toggles, setToggles] = useState({ repliedOnly: false, bookedOnly: false, subscribedOnly: false });
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"name" | "company" | "status" | null>(null);
  const [sortDir, setSortDir] = useState(1);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [perPageDD, setPerPageDD] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [moveDD, setMoveDD] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", company: "", phone: "", title: "" });
  // 36-2: 3-step CSV wizard (Upload → Map → Review → Done), client-side parse.
  const [csvStep, setCsvStep] = useState(0);
  const [csvFile, setCsvFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [csvMap, setCsvMap] = useState<string[]>([]);
  const [csvDone, setCsvDone] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = (await cf("contacts/view")) as ContactRow[];
      setRows(res);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  // A4: 5s polling
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const drawer = useMemo(() => (rows ?? []).find((r) => r.id === drawerId) ?? null, [rows, drawerId]);

  // drawer timeline polls while open (A4)
  useEffect(() => {
    if (!drawer) return;
    setTimeline(null);
    const load = async () => {
      const res = await cf(`contacts/${drawer.id}/timeline`).catch(() => null);
      if (res) setTimeline(res.events as TimelineEvent[]);
    };
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [drawer]);

  const agents = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.agentName).filter(Boolean))] as string[],
    [rows],
  );

  // prototype filter pipeline: status(seg) → agent → source → toggles → search → sort → paginate
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (rows ?? []).filter((c) => {
      const st = deriveStatus(c);
      if (seg !== "all" && st !== seg) return false;
      if (agentFilter !== "all" && c.agentName !== agentFilter) return false;
      if (sourceFilter !== "all" && c.source !== sourceFilter) return false;
      if (toggles.repliedOnly && !["Replied", "Qualified", "Booked"].includes(st)) return false;
      if (toggles.bookedOnly && st !== "Booked") return false;
      if (toggles.subscribedOnly && st === "Unsubscribed") return false;
      if (q && !`${fullName(c)} ${c.email ?? ""} ${c.company ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortKey) {
      const order: Record<string, number> = { New: 0, Replied: 1, Qualified: 2, Booked: 3, Unsubscribed: 4 };
      list = [...list].sort((a, b) => {
        const va = sortKey === "status" ? order[deriveStatus(a)]! : (sortKey === "name" ? fullName(a) : a.company ?? "").toLowerCase();
        const vb = sortKey === "status" ? order[deriveStatus(b)]! : (sortKey === "name" ? fullName(b) : b.company ?? "").toLowerCase();
        return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
      });
    }
    return list;
  }, [rows, seg, agentFilter, sourceFilter, toggles, search, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const start = (Math.min(page, pages) - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0 };
    for (const s of SEGMENTS) if (s.id !== "all") c[s.id] = (rows ?? []).filter((r) => deriveStatus(r) === s.id).length;
    return c;
  }, [rows]);
  const selected = Object.keys(sel).filter((k) => sel[k]);
  const allOn = pageRows.length > 0 && pageRows.every((r) => sel[r.id]);
  const moreActive = sourceFilter !== "all" || Object.values(toggles).some(Boolean);
  const moreCount = (sourceFilter !== "all" ? 1 : 0) + Object.values(toggles).filter(Boolean).length;

  async function bulkUnsubscribe(ids: string[]) {
    if (ids.length === 0) return;
    await cf("contacts/unsubscribe", { method: "POST", body: JSON.stringify({ contactIds: ids }) }).catch(() => {});
    setSel({});
    setMoveDD(false);
    void refresh();
  }
  async function moveStage(c: ContactRow, stage: string) {
    setMoveDD(false);
    if (stage === "__unsub__") return bulkUnsubscribe([c.id]);
    // stage moves ride the contact's latest enrollment (API resolves it)
    await cf(`contacts/${c.id}/move`, { method: "POST", body: JSON.stringify({ stage }) }).catch(() => {});
    void refresh();
  }
  async function createContact() {
    if (!/.+@.+\..+/.test(form.email) || !form.firstName.trim()) return;
    await cf("contacts", { method: "POST", body: JSON.stringify(form) }).catch(() => {});
    setAddOpen(false);
    setForm({ firstName: "", lastName: "", email: "", company: "", phone: "", title: "" });
    void refresh();
  }

  /** CSV wizard helpers — parse client-side, POST per mapped row. */
  const CSV_FIELDS = ["First name", "Last name", "Email", "Company", "Phone", "Title", "Skip this column"] as const;
  const CSV_FIELD_KEY: Record<string, string> = { "First name": "firstName", "Last name": "lastName", Email: "email", Company: "company", Phone: "phone", Title: "title" };
  function autoMatch(header: string): string {
    const h = header.toLowerCase().replace(/[^a-z]/g, "");
    if (h.includes("first")) return "First name";
    if (h.includes("last") || h === "surname") return "Last name";
    if (h.includes("email") || h.includes("mail")) return "Email";
    if (h.includes("company") || h.includes("org")) return "Company";
    if (h.includes("phone") || h.includes("tel")) return "Phone";
    if (h.includes("title") || h.includes("role")) return "Title";
    return "Skip this column";
  }
  function loadCsv(name: string, text: string) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const headers = lines[0]!.split(",").map((v) => v.trim());
    const rows = lines.slice(1).map((l) => l.split(",").map((v) => v.trim()));
    setCsvFile({ name, headers, rows });
    setCsvMap(headers.map(autoMatch));
  }
  const csvParsed = useMemo(() => {
    if (!csvFile) return null;
    const emailIdx = csvMap.findIndex((m) => m === "Email");
    const existing = new Set((rows ?? []).map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
    const unsubEmails = new Set((rows ?? []).filter((r) => r.unsub).map((r) => (r.email ?? "").toLowerCase()));
    const valid = csvFile.rows.filter((r) => emailIdx >= 0 && /.+@.+\..+/.test(r[emailIdx] ?? ""));
    const dupes = valid.filter((r) => existing.has((r[emailIdx] ?? "").toLowerCase()));
    const suppressed = valid.filter((r) => unsubEmails.has((r[emailIdx] ?? "").toLowerCase()));
    // Prototype semantics (round-2 fix): detected duplicates are SKIPPED —
    // only fresh rows import; the button and done-count follow newCount.
    const fresh = valid.filter((r) => !existing.has((r[emailIdx] ?? "").toLowerCase()));
    return {
      newCount: fresh.length,
      dupes: dupes.length,
      suppressed: suppressed.length,
      mapped: csvMap.filter((m) => m !== "Skip this column").length,
      valid,
      fresh,
      emailIdx,
    };
  }, [csvFile, csvMap, rows]);
  async function runImport() {
    if (!csvFile || !csvParsed) return;
    let created = 0;
    for (const r of csvParsed.fresh) {
      const payload: Record<string, string> = {};
      csvMap.forEach((m, i) => {
        const key = CSV_FIELD_KEY[m];
        if (key && r[i]) payload[key] = r[i]!;
      });
      if (!payload.email) continue;
      const ok = await cf("contacts", { method: "POST", body: JSON.stringify(payload) }).then(() => true).catch(() => false);
      if (ok) created += 1;
    }
    setCsvDone(created);
    setCsvStep(3);
    void refresh();
  }
  function closeImport() {
    setImportOpen(false);
    setCsvStep(0);
    setCsvFile(null);
    setCsvMap([]);
    setCsvDone(0);
  }


  const sortArrow = (key: string) => (sortKey === key ? (sortDir === 1 ? "↑" : "↓") : "");
  const clickSort = (key: "name" | "company" | "status") => {
    if (sortKey === key) setSortDir((d) => -d);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };
  const trigger = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, background: active ? "rgba(53,232,52,.08)" : "#fff",
    border: `1px solid ${active ? "#9FD8AC" : "#EBE3D6"}`, borderRadius: 11, padding: "10px 14px",
    fontSize: 14, fontWeight: 600, color: active ? "#16A82A" : "#5C6B62", cursor: "pointer", position: "relative",
  });
  const menuShell: React.CSSProperties = {
    position: "absolute", top: "calc(100% + 6px)", right: 0, background: "#fff",
    border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", zIndex: 25, overflow: "hidden",
  };

  const st = drawer ? deriveStatus(drawer) : null;

  return (
    // prototype renders at the browser-default line-height, not the app's 1.5
    <div style={{ display: "flex", minWidth: 0, flex: 1, lineHeight: "normal" }}>
      {/* lists rail — prototype composition; lists have no model yet (flagged in plan) */}
      <div style={{ width: 226, flex: "none", background: "#F4F0E7", borderRight: "1px solid #EBE3D6", padding: "22px 14px", display: "flex", flexDirection: "column", minWidth: 0, boxSizing: "border-box" }} data-testid="lists-rail">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", marginBottom: 12 }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "#8A7F6B", flex: 1 }}>Lists</span>
          <span title="Saved lists arrive with a later phase" style={{ width: 24, height: 24, borderRadius: 7, background: "#fff", border: "1px solid #EBE3D6", color: "#16A82A", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: "default" }}>＋</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10, marginBottom: 3, background: "linear-gradient(135deg,rgba(54,215,237,.16),rgba(53,232,52,.16))" }}>
          <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>☺</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1512", flex: 1 }}>All contacts</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16A82A" }}>{rows?.length ?? 0}</span>
        </div>
        <div style={{ height: 1, background: "#E6E0D4", margin: "8px 6px" }} />
        <div title="Saved lists arrive with a later phase" style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 11px", borderRadius: 10, marginTop: 8, border: "1.5px dashed #D8CFBE", color: "#8A7F6B", cursor: "default" }}>
          <span style={{ fontSize: 15 }}>＋</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>New list</span>
        </div>
      </div>

      {/* main */}
      <div style={{ flex: 1, background: "#FBF7F0", minWidth: 0, padding: "24px 28px 30px", boxSizing: "border-box" }}>
        {/* page header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: "-.02em", color: "#0E1512" }}>All contacts</span>
            </div>
            <div style={{ fontSize: 14, color: "#5C6B62" }} data-testid="scope-sub">
              {rows ? `${rows.length} contacts · ${counts.Qualified ?? 0} qualified · ${counts.Booked ?? 0} booked` : "…"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
            <a href="/lead-finder" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "#16A82A", background: "rgba(53,232,52,.08)", border: "1px solid #9FD8AC", borderRadius: 12, padding: "11px 18px" }}>⚲ Find leads</a>
            <span onClick={() => setImportOpen(true)} style={{ fontSize: 14, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 18px", cursor: "pointer" }} data-testid="import-csv">↥ Import CSV</span>
            <span onClick={() => setAddOpen(true)} style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: "#0A0F0C", background: GRAD, borderRadius: 12, padding: "12px 22px", boxShadow: "0 6px 16px rgba(53,232,52,.26)", cursor: "pointer" }} data-testid="add-contact">+ Add contact</span>
          </div>
        </div>

        {/* segment tabs — A10 queries */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #EBE3D6", marginBottom: 14, overflowX: "auto" }} data-testid="segments">
          {SEGMENTS.map((s) => {
            const on = seg === s.id;
            return (
              <span key={s.id} onClick={() => { setSeg(s.id); setPage(1); }} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: on ? 700 : 600, color: on ? "#0E1512" : "#8A7F6B", padding: "11px 15px", borderBottom: `2px solid ${on ? "#16A82A" : "transparent"}`, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }} data-testid={`seg-${s.id}`}>
                {s.label}
                <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#16A82A" : "#8A7F6B", background: on ? "rgba(53,232,52,.14)" : "#F2EEE4", borderRadius: 100, padding: "1px 8px" }}>{counts[s.id] ?? 0}</span>
              </span>
            );
          })}
        </div>

        {/* toolbar / bulk bar */}
        {selected.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, background: "rgba(53,232,52,.08)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 12, padding: "10px 16px" }} data-testid="bulk-bar">
            <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{selected.length} selected</span>
            <span onClick={() => setSel({})} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", cursor: "pointer" }}>Clear</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 9 }}>
              <span title="Sequence enrollment lives on the agent's Leads tab" style={{ fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "8px 14px", cursor: "default" }}>+ Add to sequence</span>
              <span
                onClick={() => {
                  const list = filtered.filter((r) => sel[r.id]);
                  const rowsCsv = [["email", "firstName", "lastName", "company", "status"], ...list.map((c) => [c.email ?? "", c.firstName ?? "", c.lastName ?? "", c.company ?? "", deriveStatus(c)])];
                  const blob = new Blob([rowsCsv.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "contacts.csv";
                  a.click();
                }}
                style={{ fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "8px 14px", cursor: "pointer" }}
              >↥ Export</span>
              <span onClick={() => void bulkUnsubscribe(selected)} style={{ fontSize: 13, fontWeight: 600, color: "#C9543F", background: "#fff", border: "1px solid #F0CFC8", borderRadius: 10, padding: "8px 14px", cursor: "pointer" }} data-testid="bulk-unsub">⊘ Unsubscribe</span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 14 }}>
            <div style={{ flex: "0 0 320px", display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${search ? "#9FD8AC" : "#EBE3D6"}`, borderRadius: 12, padding: "11px 16px", boxSizing: "border-box" }}>
              <span style={{ color: "#9AA59E" }}>⚲</span>
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by name, email or company…" style={{ border: "none", background: "transparent", fontSize: 14, color: "#0E1512", flex: 1, minWidth: 0, outline: "none", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="contacts-search" />
              {search ? <span onClick={() => setSearch("")} style={{ color: "#9AA59E", fontSize: 13, cursor: "pointer" }}>✕</span> : null}
            </div>
            <div style={{ display: "flex", gap: 9, flex: "none" }}>
              <div style={{ position: "relative" }}>
                <span onClick={() => { setStatusDD((v) => !v); setAgentDD(false); setMoreDD(false); }} style={trigger(seg !== "all")} data-testid="status-filter">
                  {seg === "all" ? "Status" : SEGMENTS.find((s) => s.id === seg)?.label}<span style={{ color: "#9AA59E", fontSize: 12 }}>⌄</span>
                </span>
                {statusDD ? (
                  <div style={{ ...menuShell, width: 200 }}>
                    {[{ id: "all", label: "All statuses" }, ...SEGMENTS.slice(1)].map((o) => (
                      <div key={o.id} onClick={() => { setSeg(o.id); setPage(1); setStatusDD(false); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", fontSize: 13.5, color: "#0E1512", borderBottom: "1px solid #F7F2EA", cursor: "pointer" }}>
                        <span style={{ flex: 1 }}>{o.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B" }}>{o.id === "all" ? rows?.length ?? 0 : counts[o.id] ?? 0}</span>
                        <span style={{ color: "#16A82A", visibility: seg === o.id ? "visible" : "hidden" }}>✓</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div style={{ position: "relative" }}>
                <span onClick={() => { setAgentDD((v) => !v); setStatusDD(false); setMoreDD(false); }} style={trigger(agentFilter !== "all")} data-testid="agent-filter">
                  {agentFilter === "all" ? "Agent" : agentFilter.length > 16 ? `${agentFilter.slice(0, 15)}…` : agentFilter}<span style={{ color: "#9AA59E", fontSize: 12 }}>⌄</span>
                </span>
                {agentDD ? (
                  <div style={{ ...menuShell, width: 236 }}>
                    {["all", ...agents].map((a) => (
                      <div key={a} onClick={() => { setAgentFilter(a); setPage(1); setAgentDD(false); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", fontSize: 13.5, color: "#0E1512", borderBottom: "1px solid #F7F2EA", cursor: "pointer" }}>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a === "all" ? "All agents" : a}</span>
                        <span style={{ color: "#16A82A", visibility: agentFilter === a ? "visible" : "hidden" }}>✓</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div style={{ position: "relative" }}>
                <span onClick={() => { setMoreDD((v) => !v); setStatusDD(false); setAgentDD(false); }} style={trigger(moreActive)} data-testid="filters">
                  ⚙ Filters
                  {moreActive ? <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#16A82A", borderRadius: 100, padding: "0 6px" }}>{moreCount}</span> : null}
                  <span style={{ color: "#9AA59E", fontSize: 12 }}>⌄</span>
                </span>
                {moreDD ? (
                  <div style={{ ...menuShell, width: 268, padding: 6 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "#9AA59E", padding: "8px 10px 4px" }}>Source</div>
                    {["all", ...Array.from(new Set((rows ?? []).map((r) => r.source).filter((x): x is string => !!x)))].map((o) => (
                      <div key={o} onClick={() => { setSourceFilter(o); setPage(1); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 8, fontSize: 13.5, color: "#0E1512", cursor: "pointer" }} data-testid={`source-${o}`}>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o === "all" ? "All sources" : o}</span>
                        <span style={{ color: "#16A82A", visibility: sourceFilter === o ? "visible" : "hidden" }}>✓</span>
                      </div>
                    ))}
                    <div style={{ height: 1, background: "#F2EEE4", margin: "6px 4px" }} />
                    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "#9AA59E", padding: "6px 10px 4px" }}>Quick toggles</div>
                    {(
                      [
                        { key: "repliedOnly" as const, label: "Replied or further" },
                        { key: "bookedOnly" as const, label: "Booked only" },
                        { key: "subscribedOnly" as const, label: "Hide unsubscribed" },
                      ]
                    ).map((t) => {
                      const on = toggles[t.key];
                      return (
                        <div key={t.key} onClick={() => { setToggles((v) => ({ ...v, [t.key]: !v[t.key] })); setPage(1); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer" }} data-testid={`toggle-${t.key}`}>
                          <span style={{ fontSize: 13.5, color: "#0E1512", flex: 1 }}>{t.label}</span>
                          <span style={{ width: 38, height: 22, borderRadius: 100, background: on ? GRAD : "#D8CFBE", position: "relative", flex: "none" }}>
                            <span style={{ position: "absolute", top: 3, ...(on ? { right: 3 } : { left: 3 }), width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
                          </span>
                        </div>
                      );
                    })}
                    <div onClick={() => { setToggles({ repliedOnly: false, bookedOnly: false, subscribedOnly: false }); setAgentFilter("all"); setSourceFilter("all"); setSeg("all"); setSearch(""); setPage(1); setMoreDD(false); }} style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, color: "#C9543F", padding: 9, marginTop: 4, borderTop: "1px solid #F2EEE4", cursor: "pointer" }}>Reset all filters</div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* table */}
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 18, boxShadow: "0 6px 24px rgba(14,21,18,.05)", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "46px minmax(0,1.9fr) 1.2fr .95fr 1.15fr .85fr .95fr 44px", alignItems: "center", padding: "0 8px", background: "#FBF7F0", borderBottom: "1.5px solid #EBE3D6" }}>
            <div style={{ padding: "13px 12px" }}>
              <span onClick={() => setSel(allOn ? {} : Object.fromEntries(pageRows.map((r) => [r.id, true])))} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, border: `2px solid ${allOn ? "#16A82A" : "#CDBFA8"}`, background: allOn ? "#16A82A" : "transparent", color: "#fff", fontSize: 11, cursor: "pointer", boxSizing: "border-box" }} data-testid="select-all">{allOn ? "✓" : ""}</span>
            </div>
            {(
              [
                { label: "Contact", key: "name" as const },
                { label: "Company", key: "company" as const },
                { label: "Status", key: "status" as const },
                { label: "Agent", key: null },
                { label: "List", key: null },
                { label: "Last activity", key: null },
              ]
            ).map((h) => (
              <div key={h.label} onClick={() => h.key && clickSort(h.key)} style={{ padding: "13px 12px", fontSize: 12, fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: "#5C6B62", cursor: h.key ? "pointer" : "default" }} data-testid={h.key ? `sort-${h.key}` : undefined}>
                {h.label} {h.key ? <span style={{ color: "#16A82A" }}>{sortArrow(h.key)}</span> : null}
              </div>
            ))}
            <div />
          </div>

          {rows === null && !error ? (
            <div data-testid="contacts-skeleton">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "14px 20px", borderTop: i ? "1px solid #F2EEE4" : "none" }}>
                  <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#F2EEE4", flex: "none" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, width: "35%", background: "#F2EEE4", borderRadius: 6, marginBottom: 7 }} />
                    <div style={{ height: 10, width: "55%", background: "#F7F2EA", borderRadius: 6 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div style={{ padding: "48px 20px", textAlign: "center" }} data-testid="contacts-error">
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 4 }}>Couldn&apos;t load contacts</div>
              <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 14 }}>Something went wrong talking to the API — your data is safe.</div>
              <button type="button" onClick={() => void refresh()} style={{ background: GRAD, border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}>Retry</button>
            </div>
          ) : (rows?.length ?? 0) === 0 ? (
            <div data-testid="contacts-true-empty">
              {/* 36-4/DEC-022: the shared 90px radius-24 gradient tile (sparkles). */}
              <EmptyState
                kind="empty"
                title="No contacts yet"
                body="Import a CSV or add your first contact to get started."
                actions={
                  <>
                    <span onClick={() => setImportOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>↥ Import CSV</span>
                    <span onClick={() => setAddOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 10, padding: "9px 16px", boxShadow: "0 5px 14px rgba(53,232,52,.24)", cursor: "pointer" }}>+ Add contact</span>
                  </>
                }
              />
            </div>
          ) : filtered.length === 0 ? (
            <div data-testid="contacts-filtered-empty">
              {/* 36-3/DEC-021: filtered-empty carries SECONDARY actions only. */}
              <EmptyState
                kind="filtered"
                title="No contacts match"
                body="Try clearing filters, or find fresh leads to add."
                actions={
                  <>
                    <span onClick={() => { setToggles({ repliedOnly: false, bookedOnly: false, subscribedOnly: false }); setAgentFilter("all"); setSourceFilter("all"); setSeg("all"); setSearch(""); setPage(1); }} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>Reset filters</span>
                    <a href="/lead-finder" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px" }}>⚲ Find leads</a>
                  </>
                }
              />
            </div>
          ) : (
            pageRows.map((c, i) => {
              const status = deriveStatus(c);
              const pill = ST[status]!;
              const on = Boolean(sel[c.id]);
              return (
                <div key={c.id} onClick={() => setDrawerId(c.id)} style={{ display: "grid", gridTemplateColumns: "46px minmax(0,1.9fr) 1.2fr .95fr 1.15fr .85fr .95fr 44px", alignItems: "center", padding: "0 8px", borderTop: "1px solid #F2EEE4", background: on ? "rgba(53,232,52,.05)" : i % 2 === 1 ? "#FCFAF6" : "#fff", cursor: "pointer" }} data-testid="contact-row">
                  <div style={{ padding: "14px 12px" }} onClick={(e) => e.stopPropagation()}>
                    <span onClick={() => setSel((s) => ({ ...s, [c.id]: !s[c.id] }))} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, border: `2px solid ${on ? "#16A82A" : "#CDBFA8"}`, background: on ? "#16A82A" : "transparent", color: "#fff", fontSize: 11, cursor: "pointer", boxSizing: "border-box" }} data-testid="contact-check">{on ? "✓" : ""}</span>
                  </div>
                  <div style={{ padding: "11px 12px", display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                    <span style={{ width: 36, height: 36, borderRadius: "50%", flex: "none", background: avTint(c.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#0A0F0C" }}>{initials(c)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 14.5, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fullName(c)}</span>
                      <span style={{ display: "block", fontSize: 12.5, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</span>
                    </span>
                  </div>
                  <div style={{ padding: "11px 12px", fontSize: 14, color: "#3B463F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.company ?? "—"}</div>
                  <div style={{ padding: "11px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 100, fontSize: 12.5, fontWeight: 600, background: pill.sbg, color: pill.sfg, whiteSpace: "nowrap" }} data-testid="status-pill">{status}</span>
                  </div>
                  <div style={{ padding: "11px 12px", fontSize: 13.5, color: "#5C6B62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.agentName ?? "—"}</div>
                  <div style={{ padding: "11px 12px", fontSize: 12.5, color: "#5C6B62" }}>—</div>
                  <div style={{ padding: "11px 12px", fontSize: 13.5, color: "#5C6B62" }}>{timeAgo(c.lastActivity)}</div>
                  <div style={{ padding: "11px 8px", display: "flex", justifyContent: "center" }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, color: "#9AA59E", fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>⋯</span>
                  </div>
                </div>
              );
            })
          )}

          {/* pagination footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 20px", borderTop: "1px solid #EBE3D6", background: "#FBF7F0" }} data-testid="pagination">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "#8A7F6B" }}>
                {filtered.length === 0 ? "No contacts" : `Showing ${start + 1}–${Math.min(start + perPage, filtered.length)} of ${filtered.length}`}
              </span>
              <div style={{ position: "relative" }}>
                <span onClick={() => setPerPageDD((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 9, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, color: "#5C6B62", cursor: "pointer" }} data-testid="per-page">{perPage} per page <span style={{ color: "#9AA59E", fontSize: 11 }}>⌄</span></span>
                {perPageDD ? (
                  <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, width: 150, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, boxShadow: "0 16px 44px rgba(0,0,0,.18)", zIndex: 25, overflow: "hidden" }}>
                    {[10, 25, 50, 100].map((n) => (
                      <div key={n} onClick={() => { setPerPage(n); setPage(1); setPerPageDD(false); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", fontSize: 13, color: "#0E1512", cursor: "pointer" }}>
                        <span style={{ flex: 1 }}>{n} per page</span>
                        <span style={{ color: "#16A82A", visibility: perPage === n ? "visible" : "hidden" }}>✓</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <span onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", color: page > 1 ? "#0E1512" : "#C9CFC9", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxSizing: "border-box" }}>‹</span>
              {Array.from({ length: pages }, (_, i) => i + 1)
                .filter((p) => pages <= 7 || Math.abs(p - page) <= 2 || p === 1 || p === pages)
                .map((p) => (
                  <span key={p} onClick={() => setPage(p)} style={{ minWidth: 32, height: 32, padding: "0 6px", borderRadius: 9, border: `1px solid ${p === page ? "#0C140F" : "#EBE3D6"}`, background: p === page ? "#0C140F" : "#fff", color: p === page ? "#fff" : "#0E1512", fontWeight: p === page ? 700 : 500, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxSizing: "border-box" }}>{p}</span>
                ))}
              <span onClick={() => setPage((p) => Math.min(pages, p + 1))} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", color: page < pages ? "#0E1512" : "#C9CFC9", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxSizing: "border-box" }}>›</span>
            </div>
          </div>
        </div>

        {/* contact drawer — 450px (prototype literal), live timeline */}
        {drawer ? (
          <div onClick={() => setDrawerId(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.4)", zIndex: 60 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 450, maxWidth: "100%", background: "#FBF7F0", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column" }} data-testid="contact-drawer">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "20px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6", flex: "none" }}>
                <span style={{ width: 46, height: 46, borderRadius: "50%", flex: "none", background: avTint(drawer.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#0A0F0C" }}>{initials(drawer)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: "#0E1512" }}>{fullName(drawer)}</div>
                  <div style={{ fontSize: 13, color: "#9AA59E" }}>{drawer.email}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", padding: "4px 11px", borderRadius: 100, fontSize: 12, fontWeight: 600, background: ST[st!]!.sbg, color: ST[st!]!.sfg }} data-testid="drawer-pill">{st}</span>
                  </div>
                </div>
                <span onClick={() => setDrawerId(null)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", color: "#9AA59E", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none" }}>✕</span>
              </div>
              <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "18px 22px" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                  <a href="/agents" style={{ textDecoration: "none", flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: 10, boxShadow: "0 5px 14px rgba(53,232,52,.24)" }}>✉ Email</a>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span onClick={() => setMoveDD((v) => !v)} style={{ display: "block", textAlign: "center", fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: 10, cursor: "pointer" }} data-testid="contact-move">↪ Move ▾</span>
                    {moveDD ? (
                      <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 230, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.2)", zIndex: 30, overflow: "hidden" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "#9AA59E", padding: "10px 14px 6px" }}>Move to</div>
                        {MOVE_OPTIONS.map((m) => {
                          const current =
                            (m.stage === "interested" && st === "Qualified") ||
                            (m.stage === "booked" && st === "Booked") ||
                            (m.stage === "__unsub__" && st === "Unsubscribed");
                          return (
                            <div key={m.label} onClick={() => void moveStage(drawer, m.stage)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", fontSize: 13.5, color: m.color, borderTop: "1px solid #F7F2EA", cursor: "pointer" }}>
                              <span style={{ width: 18, textAlign: "center" }}>{m.icon}</span>
                              <span style={{ flex: 1 }}>{m.label}</span>
                              <span style={{ color: "#16A82A", visibility: current ? "visible" : "hidden" }}>✓</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* live stats — Opens/Replies from Event rows; AI Score omitted (DEC-038a) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 18 }} data-testid="drawer-stats">
                  {[
                    { label: "Opens", value: (timeline ?? []).filter((e) => e.type === "email.opened.v1").length },
                    { label: "Replies", value: (timeline ?? []).filter((e) => e.type === "email.replied.v1").length },
                  ].map((s) => (
                    <div key={s.label} style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: 12, textAlign: "center" }}>
                      <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 20, color: "#0E1512" }}>{s.value}</div>
                      <div style={{ fontSize: 11.5, color: "#9AA59E" }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Details</div>
                <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden", marginBottom: 18 }}>
                  {[
                    ["Company", drawer.company ?? "—"],
                    ["Title", drawer.title ?? "—"],
                    ["Phone", drawer.phone ?? "—"],
                    ["Source", drawer.source ?? "—"],
                    ["Agent", drawer.agentName ?? "—"],
                    ["Added", new Date(drawer.createdAt).toLocaleDateString()],
                  ].map(([k, v], i) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px", borderTop: i ? "1px solid #F2EEE4" : "none" }}>
                      <span style={{ fontSize: 13, color: "#9AA59E", width: 92, flex: "none" }}>{k}</span>
                      <span style={{ fontSize: 13.5, color: "#0E1512", fontWeight: 600, flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>Activity</div>
                {timeline === null ? (
                  <div style={{ fontSize: 13, color: "#9AA59E" }}>Loading activity…</div>
                ) : timeline.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#9AA59E" }} data-testid="drawer-timeline-empty">No activity yet.</div>
                ) : (
                  <div data-testid="drawer-timeline">
                    {timeline.map((e, i) => {
                      const row = EVENT_ROW[e.type] ?? { icon: "•", bg: "#F2EEE4", fg: "#8A7F6B", label: () => e.type };
                      return (
                        <div key={e.id} style={{ display: "flex", gap: 12, paddingBottom: 14 }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <span style={{ width: 28, height: 28, borderRadius: 8, background: row.bg, color: row.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flex: "none" }}>{row.icon}</span>
                            {i < timeline.length - 1 ? <span style={{ flex: 1, width: 2, background: "#EBE3D6", marginTop: 4 }} /> : null}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, color: "#0E1512", lineHeight: 1.4 }}>{row.label((e.payload ?? {}) as Record<string, unknown>)}</div>
                            <div style={{ fontSize: 12, color: "#9AA59E", marginTop: 2 }}>{timeAgo(e.occurredAt)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* 36-1: Add-a-contact — 484px right drawer per Contacts.dc.html:379.
            Omissions logged in DEC-044: STATUS picker (A10 conflict), LIST
            select (lists inert), CUSTOM FIELDS (no model), LOCATION (no field). */}
        {addOpen ? (
          <div onClick={() => setAddOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.4)", zIndex: 60 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 484, maxWidth: "100%", background: "#FBF7F0", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column" }} data-testid="add-modal">
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6", flex: "none" }}>
                <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Add a contact</span>
                <span onClick={() => setAddOpen(false)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "20px 22px" }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 13 }}>
                  <div style={{ flex: 1 }}>
                    <label style={addLbl}>First name *</label>
                    <input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="Jane" style={addInp} data-testid="form-firstName" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={addLbl}>Last name</label>
                    <input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="Doe" style={addInp} data-testid="form-lastName" />
                  </div>
                </div>
                <div style={{ marginBottom: 13 }}>
                  <label style={addLbl}>Email *</label>
                  <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@clinic.com" style={{ ...addInp, borderColor: form.email && !/.+@.+\..+/.test(form.email) ? "#E0A99E" : "#EBE3D6" }} data-testid="form-email" />
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 13 }}>
                  <div style={{ flex: 1 }}>
                    <label style={addLbl}>Company</label>
                    <input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder="Clinic name" style={addInp} data-testid="form-company" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={addLbl}>Phone</label>
                    <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+1 …" style={addInp} data-testid="form-phone" />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 13 }}>
                  <div style={{ flex: 1 }}>
                    <label style={addLbl}>Title</label>
                    <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Owner" style={addInp} data-testid="form-title" />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
                {(() => {
                  const valid = form.firstName.trim() && /.+@.+\..+/.test(form.email);
                  return (
                    <>
                      <span style={{ fontSize: 13, color: valid ? "#16A82A" : "#9AA59E", flex: 1 }}>{valid ? "Ready to create" : "First name & a valid email required"}</span>
                      <span onClick={() => setAddOpen(false)} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 16px", cursor: "pointer" }}>Cancel</span>
                      <span onClick={() => void createContact()} style={{ fontSize: 14, fontWeight: 700, color: valid ? "#0A0F0C" : "#9AA59E", background: valid ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 20px", cursor: valid ? "pointer" : "not-allowed", boxShadow: valid ? "0 6px 16px rgba(53,232,52,.26)" : "none" }} data-testid="create-contact">Create contact</span>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : null}

        {/* 36-2: Import contacts from CSV — the prototype's 3-step wizard.
            Add-to-list select omitted (lists inert — DEC-044). */}
        {importOpen ? (
          <div onClick={closeImport} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 36, zIndex: 60 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 540, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid="import-modal">
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(53,232,52,.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#16A82A" }}>⬆</span>
                <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Import contacts from CSV</span>
                <span onClick={closeImport} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
              </div>
              {csvStep < 3 ? (
                <>
                  <div style={{ padding: "16px 22px 0" }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      {[0, 1, 2].map((n) => (
                        <span key={n} style={{ flex: 1, height: 5, borderRadius: 100, background: n <= csvStep ? "#16A82A" : "#E4EAE6" }} />
                      ))}
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".04em", marginTop: 9, textTransform: "uppercase" }}>Step {Math.min(csvStep + 1, 3)} of 3</div>
                  </div>
                  <div style={{ padding: "16px 22px 20px" }}>
                    {csvStep === 0 ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 14 }}>Upload your file</div>
                        <label style={{ display: "block", border: "1.5px dashed #9FD8AC", borderRadius: 13, padding: "30px 20px", textAlign: "center", background: "rgba(53,232,52,.04)", cursor: "pointer" }} data-testid="csv-dropzone">
                          <input type="file" accept=".csv,text/csv" style={{ display: "none" }} data-testid="csv-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => loadCsv(f.name, t)); e.target.value = ""; }} />
                          <div style={{ fontSize: 28, marginBottom: 9 }}>📄</div>
                          <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Drop your CSV here or browse</div>
                          <div style={{ fontSize: 12.5, color: "#9AA59E" }}>.csv up to 50 MB · first row should be column headers</div>
                        </label>
                        {csvFile ? (
                          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "11px 14px" }} data-testid="csv-file-row">
                            <span style={{ width: 32, height: 32, borderRadius: 8, background: "#D7F5DD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#16A82A", flex: "none" }}>✓</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>{csvFile.name}</div>
                              <div style={{ fontSize: 11.5, color: "#9AA59E" }}>{csvFile.rows.length} rows · {csvFile.headers.length} columns detected</div>
                            </div>
                            <span onClick={() => { setCsvFile(null); setCsvMap([]); }} style={{ color: "#9AA59E", cursor: "pointer" }}>✕</span>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {csvStep === 1 && csvFile ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Map your columns</div>
                        <div style={{ fontSize: 13, color: "#9AA59E", marginBottom: 14 }}>We matched these automatically — adjust any that look off.</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 22px 1.1fr", gap: 8, paddingBottom: 7, borderBottom: "1px solid #EBE3D6", marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em" }}>CSV column</span>
                          <span />
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em" }}>Maps to</span>
                        </div>
                        {csvFile.headers.map((h, i) => (
                          <div key={h + i} style={{ display: "grid", gridTemplateColumns: "1fr 22px 1.1fr", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F2EEE4" }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0E1512", fontFamily: "monospace" }}>{h}</div>
                              <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{csvFile.rows[0]?.[i] ?? ""}</div>
                            </div>
                            <span style={{ color: "#C2B79F", textAlign: "center", fontSize: 12 }}>→</span>
                            <select value={csvMap[i]} onChange={(e) => setCsvMap((m) => m.map((v, j) => (j === i ? e.target.value : v)))} style={{ border: "1px solid #EBE3D6", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, fontWeight: 600, color: csvMap[i] === "Skip this column" ? "#9AA59E" : "#0E1512", background: "#FBF7F0", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid={`csv-map-${i}`}>
                              {CSV_FIELDS.map((f) => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </>
                    ) : null}
                    {csvStep === 2 && csvParsed ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Review import</div>
                        <div style={{ fontSize: 13, color: "#9AA59E", marginBottom: 16 }}>Here&apos;s what we&apos;ll add to your contacts.</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                          {[
                            { value: String(csvParsed.newCount), label: "New contacts", fg: "#16A82A" },
                            { value: String(csvParsed.dupes), label: "Duplicates skipped", fg: "#1192A6" },
                            { value: String(csvParsed.suppressed), label: "On suppression list", fg: "#8A7F6B" },
                            { value: String(csvParsed.mapped), label: "Columns mapped", fg: "#0E1512" },
                          ].map((st2) => (
                            <div key={st2.label} style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "14px 16px" }}>
                              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 24, fontWeight: 800, color: st2.fg, lineHeight: 1, marginBottom: 4 }}>{st2.value}</div>
                              <div style={{ fontSize: 12, color: "#8A7F6B" }}>{st2.label}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(53,232,52,.06)", border: "1px solid rgba(53,232,52,.22)", borderRadius: 11, padding: "11px 14px" }}>
                          <span style={{ color: "#16A82A" }}>✓</span>
                          <span style={{ fontSize: 12.5, color: "#16A82A", fontWeight: 600 }}>All contacts checked against your suppression list.</span>
                        </div>
                      </>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                    {csvStep === 0 ? (
                      <span onClick={closeImport} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
                    ) : (
                      <span onClick={() => setCsvStep((v) => Math.max(0, v - 1))} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>‹ Back</span>
                    )}
                    {(() => {
                      const canGo = csvStep === 0 ? Boolean(csvFile) : csvStep === 1 ? csvMap.includes("Email") : (csvParsed?.newCount ?? 0) > 0;
                      const label = csvStep === 2 ? `Import ${csvParsed?.newCount ?? 0} contact${(csvParsed?.newCount ?? 0) === 1 ? "" : "s"}` : "Continue";
                      return (
                        <span onClick={() => { if (!canGo) return; if (csvStep === 2) void runImport(); else setCsvStep((v) => v + 1); }} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: canGo ? "#0A0F0C" : "#9AA59E", background: canGo ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 22px", cursor: canGo ? "pointer" : "not-allowed", boxShadow: canGo ? "0 6px 16px rgba(53,232,52,.26)" : "none" }} data-testid="import-save">{label}</span>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ padding: "34px 28px", textAlign: "center" }} data-testid="csv-done">
                    <div style={{ width: 60, height: 60, borderRadius: "50%", background: "#D7F5DD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#16A82A", margin: "0 auto 18px" }}>✓</div>
                    <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, color: "#0E1512", marginBottom: 6 }}>{csvDone} contact{csvDone === 1 ? "" : "s"} imported</div>
                    <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, maxWidth: 380, margin: "0 auto" }}>They&apos;re ready to enroll in a campaign.</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                    <span onClick={closeImport} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 24px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}>Done</span>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
