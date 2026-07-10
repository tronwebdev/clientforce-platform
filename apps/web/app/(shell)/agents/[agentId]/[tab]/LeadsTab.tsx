"use client";

/**
 * Leads tab (checkpoints §4) — grid `44px 1.9fr 1.3fr 1.1fr 1.05fr .7fr .9fr`,
 * 512px scroll region, search + source filter + export + add, bulk bar, and
 * the 460px lead drawer with the LIVE activity timeline (own §8 pair).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContactListDto } from "@clientforce/core";
import { AddToListMenu } from "@clientforce/ui";
import type { AgentViewData } from "./AgentView";
import { cf, GRAD, avTint, initials, intentTint, timeAgo } from "./shared";

interface Lead {
  id: string; // enrollmentId
  pipelineStage: string;
  status: string;
  currentNode: string | null;
  createdAt: string;
  updatedAt: string;
  /** P1.6 run-audit json; C2.8 (49-3) adds `origin` — enrollment provenance. */
  meta?: { origin?: { kind: "manual" | "csv" | "list"; listName?: string } };
  contact: { id: string; email: string | null; firstName: string | null; lastName: string | null; company: string | null };
}

/** 49-3: ORIGINATED FROM renders the enrollment's provenance, never a default. */
function originCell(l: Lead): { icon: string; label: string } {
  const o = l.meta?.origin;
  if (o?.kind === "list") return { icon: "≣", label: `List · ${o.listName ?? "a list"}` };
  if (o?.kind === "csv") return { icon: "⬆", label: "CSV import" };
  return { icon: "✎", label: "Manual" };
}
interface TimelineEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

/** Stage pill map (prototype `leadST`) keyed by live enrollment state. */
const STAGE_PILL: Record<string, { label: string; bg: string; fg: string }> = {
  active: { label: "In sequence", bg: "rgba(54,215,237,.14)", fg: "#1192A6" },
  replied: { label: "Replied", bg: "rgba(208,245,107,.4)", fg: "#6E7A12" },
  interested: { label: "Interested", bg: "#D7F5DD", fg: "#0F7A28" },
  // C2.9: the booked LABEL is goal-dynamic (resolved in-component); this
  // entry keeps the tint — the label here is the legacy fallback only.
  booked: { label: "Meeting booked", bg: "rgba(53,232,52,.16)", fg: "#16A82A" },
  unsub: { label: "Unsubscribed", bg: "rgba(224,121,107,.16)", fg: "#C9543F" },
  suppressed: { label: "Suppressed", bg: "#ECE7DC", fg: "#8A7F6B" },
  bounced: { label: "Bounced", bg: "rgba(224,121,107,.12)", fg: "#C9543F" },
  // M1b (DEC-066): a not_interested reply closes the enrollment as stage
  // `lost` — designed pill, no prototype anchor (flagged); NOT unsubscribed.
  lost: { label: "Closed", bg: "#ECE7DC", fg: "#5C6B62" },
};

function pillKey(l: Lead): string {
  if (l.status === "UNSUBSCRIBED") return "unsub";
  if (l.status === "BLOCKED") return "suppressed";
  if (l.pipelineStage === "interested") return "interested";
  if (l.pipelineStage === "booked") return "booked";
  if (l.pipelineStage === "replied") return "replied";
  if (l.pipelineStage === "lost") return "lost";
  return "active";
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "In sequence" },
  { id: "replied", label: "Replied" },
  { id: "interested", label: "Interested" },
  { id: "booked", label: "Booked" },
  { id: "lost", label: "Closed" },
  { id: "unsub", label: "Unsubscribed" },
  { id: "suppressed", label: "Suppressed" },
];

/** Timeline row treatment per live event type (prototype `ldTimeline` anatomy). */
const EVENT_ROW: Record<string, { icon: string; bg: string; fg: string; label: (p: Record<string, unknown>) => string }> = {
  "lead.enrolled.v1": { icon: "+", bg: "#F2EEE4", fg: "#8A7F6B", label: () => "Enrolled in the sequence" },
  "email.sent.v1": { icon: "✉", bg: "#F2EEE4", fg: "#8A7F6B", label: (p) => `Step email sent${p.subject ? ` — “${String(p.subject)}”` : ""}` },
  "email.delivered.v1": { icon: "✓", bg: "#F2EEE4", fg: "#8A7F6B", label: () => "Email delivered" },
  "email.opened.v1": { icon: "◔", bg: "#F2EEE4", fg: "#8A7F6B", label: (p) => `Opened${p.subject ? ` “${String(p.subject)}”` : ""}` },
  "email.clicked.v1": { icon: "🔗", bg: "rgba(54,215,237,.16)", fg: "#1192A6", label: () => "Clicked a link" },
  // M1b (DEC-066): the classified intent renders through the vocabulary
  // (verbatim fallback) — the raw enum slug never surfaces (DEC-057 rule).
  "email.replied.v1": { icon: "↩", bg: "rgba(54,215,237,.16)", fg: "#1192A6", label: (p) => `Replied${p.intent ? ` — classified “${intentTint(String(p.intent)).label}”` : ""}` },
  "email.bounced.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F", label: () => "Email hard-bounced" },
  "email.spam_reported.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F", label: () => "Marked as spam" },
  // C2.9: goal-completion events carry the campaign's terminal label — it
  // renders verbatim; older events fall back to the raw stages.
  "lead.stage_changed.v1": { icon: "✦", bg: "rgba(53,232,52,.14)", fg: "#16A82A", label: (p) => (p.label ? `Stage changed — ${String(p.label)}` : `Stage changed${p.fromStage ? ` — ${String(p.fromStage)} → ${String(p.toStage)}` : ""}`) },
  "lead.unsubscribed.v1": { icon: "⊘", bg: "rgba(224,121,107,.16)", fg: "#C9543F", label: () => "Unsubscribed from all sequences" },
  // P2.1 (DEC-061): sms timeline rows — same anatomy, channel-true copy.
  "sms.sent.v1": { icon: "✆", bg: "#F2EEE4", fg: "#8A7F6B", label: () => "Step SMS sent" },
  "sms.delivered.v1": { icon: "✓", bg: "#F2EEE4", fg: "#8A7F6B", label: () => "SMS delivered" },
  "sms.failed.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F", label: (p) => `SMS failed${p.reason ? ` — ${String(p.reason)}` : ""}` },
  "sms.replied.v1": { icon: "💬", bg: "rgba(54,215,237,.16)", fg: "#1192A6", label: (p) => `Replied by SMS${p.intent ? ` — classified “${intentTint(String(p.intent)).label}”` : ""}` },
  "sms.opted_out.v1": { icon: "⊘", bg: "rgba(224,121,107,.16)", fg: "#C9543F", label: () => "Replied STOP — suppressed for SMS" },

  // C2.8 (49-1): membership events render human — the slug never surfaces raw.
  "list.member.added.v1": { icon: "≣", bg: "rgba(53,232,52,.14)", fg: "#16A82A", label: (p) => `Added to ${String(p.listName ?? "a list")}` },
  "list.member.removed.v1": { icon: "≣", bg: "#F2EEE4", fg: "#8A7F6B", label: (p) => `Removed from ${String(p.listName ?? "a list")}` },
};

/** C2.9: the goal-completion move follows the agent goal's short pill. */
const moveOptions = (goalPill: string) => [
  { icon: "💬", label: "Interested — book a call", stage: "interested", color: "#0E1512" },
  { icon: "📅", label: `Mark as ${goalPill.toLowerCase()}`, stage: "booked", color: "#0E1512" },
  { icon: "⏱", label: "Back to sequence", stage: "new", color: "#0E1512" },
];

export function LeadsTab({ agentId, view, onChanged }: { agentId: string; view: AgentViewData | null; onChanged: () => Promise<void> | void }) {
  // C2.9 (DEC-059): this tab is single-agent — every booked-stage surface
  // (pill, filter option, Mark-as move) uses THIS campaign goal's wording.
  const goalLabel = view?.agent.goalLabel ?? "Meeting booked";
  const goalPill = view?.agent.goalPill ?? "Booked";
  const stagePill = (key: string) => {
    const t = STAGE_PILL[key] ?? STAGE_PILL.active!;
    return key === "booked" ? { ...t, label: goalLabel } : t;
  };
  const filters = FILTERS.map((f) => (f.id === "booked" ? { ...f, label: goalPill } : f));
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [filterDD, setFilterDD] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [moveDD, setMoveDD] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  // C2.8: the ONE Add-to-list menu, mounted on this bulk bar + the lead drawer
  // (unification rule — §5's v4 anatomy is the fidelity source).
  const [lists, setLists] = useState<ContactListDto[]>([]);
  const [bulkListDD, setBulkListDD] = useState(false);
  const [drawerListDD, setDrawerListDD] = useState(false);
  const [contactLists, setContactLists] = useState<Record<string, { id: string; name: string }[]>>({});
  const [toastMsg, setToastMsg] = useState("");

  const refresh = useCallback(async () => {
    const res = await cf(`enrollments?agentId=${agentId}`).catch(() => null);
    if (res) setLeads(res as Lead[]);
  }, [agentId]);

  const refreshLists = useCallback(async () => {
    const [l, view] = await Promise.all([
      cf("lists").catch(() => null),
      cf("contacts/view").catch(() => null),
    ]);
    if (l) setLists((l as ContactListDto[]).filter((x) => !x.archived));
    if (view) {
      setContactLists(
        Object.fromEntries(
          ((view as { rows: { id: string; lists?: { id: string; name: string }[] }[] }).rows ?? []).map((c) => [c.id, c.lists ?? []]),
        ),
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshLists();
  }, [refresh, refreshLists]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListErr, setNewListErr] = useState<string | null>(null);
  const [newListIds, setNewListIds] = useState<string[]>([]);

  function openNewList(contactIds: string[]) {
    setBulkListDD(false);
    setDrawerListDD(false);
    setNewListIds(contactIds);
    setNewListName("");
    setNewListErr(null);
    setNewListOpen(true);
  }

  async function createList() {
    const name = newListName.trim();
    if (!name) return;
    try {
      await cf("lists", { method: "POST", body: JSON.stringify({ name, contactIds: newListIds }) });
      setNewListOpen(false);
      setChecked({});
      setToastMsg(
        newListIds.length > 0
          ? `Created “${name}” with ${newListIds.length} lead${newListIds.length === 1 ? "" : "s"}.`
          : `Created “${name}”.`,
      );
      void refreshLists();
    } catch (err) {
      const status = err instanceof Error ? /:\s*(\d+)$/.exec(err.message)?.[1] : null;
      setNewListErr(
        status === "409" ? `A list named “${name}” already exists.` : "Couldn't create the list — try again.",
      );
    }
  }

  async function addLeadsToList(listId: string, contactIds: string[]) {
    setBulkListDD(false);
    setDrawerListDD(false);
    try {
      const res = (await cf(`lists/${listId}/members`, {
        method: "POST",
        body: JSON.stringify({ contactIds }),
      })) as { added: number };
      const name = lists.find((l) => l.id === listId)?.name ?? "list";
      setToastMsg(
        res.added === 0
          ? `Already in “${name}” — nothing to add.`
          : `Added ${res.added} lead${res.added === 1 ? "" : "s"} to “${name}”.`,
      );
      void refreshLists();
    } catch {
      setToastMsg("Couldn't add to that list — try again.");
    }
  }

  const open = useMemo(() => (leads ?? []).find((l) => l.id === openId) ?? null, [leads, openId]);

  // A4: 5s polling on the open drawer's timeline.
  useEffect(() => {
    if (!open) return;
    setTimeline(null);
    const load = async () => {
      const res = await cf(`agents/${agentId}/events?contactId=${open.contact.id}`).catch(() => null);
      if (res) setTimeline(res.events as TimelineEvent[]);
    };
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [open, agentId]);

  const stepTotal = view?.graph ? view.graph.nodes.filter((n) => n.type === "step").length : 0;
  const stepIndex = useCallback(
    (l: Lead) => {
      if (!view?.graph || !l.currentNode) return null;
      const steps = view.graph.nodes.filter((n) => n.type === "step").map((n) => n.id);
      const i = steps.indexOf(l.currentNode);
      return i >= 0 ? i + 1 : null;
    },
    [view?.graph],
  );

  const visible = useMemo(() => {
    let list = leads ?? [];
    if (filter !== "all") list = list.filter((l) => pillKey(l) === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((l) =>
        [l.contact.firstName, l.contact.lastName, l.contact.email, l.contact.company]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }, [leads, filter, search]);

  const selected = Object.keys(checked).filter((k) => checked[k]);
  const allChecked = visible.length > 0 && visible.every((l) => checked[l.id]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads?.length ?? 0 };
    for (const f of FILTERS) if (f.id !== "all") c[f.id] = (leads ?? []).filter((l) => pillKey(l) === f.id).length;
    return c;
  }, [leads]);

  async function moveStage(enrollmentId: string, stage: string) {
    await cf(`enrollments/${enrollmentId}`, { method: "PATCH", body: JSON.stringify({ pipelineStage: stage }) }).catch(() => {});
    setMoveDD(false);
    await refresh();
    void onChanged();
  }

  function exportCsv(list: Lead[]) {
    const rows = [["email", "firstName", "lastName", "company", "stage", "status"]];
    for (const l of list) rows.push([l.contact.email ?? "", l.contact.firstName ?? "", l.contact.lastName ?? "", l.contact.company ?? "", l.pipelineStage, l.status]);
    const blob = new Blob([rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "leads.csv";
    a.click();
  }

  const filterLabel = FILTERS.find((f) => f.id === filter)?.label ?? "All";

  return (
    <>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <div style={{ position: "relative" }}>
            <span onClick={() => setFilterDD((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 13.5, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 15px", cursor: "pointer" }} data-testid="leads-filter">
              Status: <strong style={{ fontWeight: 700 }}>{filterLabel}</strong>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "1px 7px" }}>{counts[filter] ?? 0}</span>
              <span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span>
            </span>
            {filterDD ? (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 244, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", zIndex: 20 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#9AA59E", padding: "10px 14px 6px" }}>Filter by status</div>
                {filters.map((f) => (
                  <div key={f.id} onClick={() => { setFilter(f.id); setFilterDD(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: filter === f.id ? 700 : 500, color: "#0E1512", borderTop: "1px solid #F7F2EA", background: filter === f.id ? "rgba(53,232,52,.06)" : "transparent", cursor: "pointer" }}>
                    <span style={{ flex: 1 }}>{f.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "1px 7px" }}>{counts[f.id] ?? 0}</span>
                    <span style={{ color: "#16A82A", visibility: filter === f.id ? "visible" : "hidden" }}>✓</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div style={{ flex: "0 0 260px", display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 16px" }}>
            <span style={{ color: "#9AA59E" }}>⚲</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads…" style={{ border: "none", outline: "none", fontSize: 14, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif", flex: 1, minWidth: 0, background: "transparent" }} data-testid="leads-search" />
            {search ? <span onClick={() => setSearch("")} style={{ color: "#9AA59E", fontSize: 13, cursor: "pointer" }}>✕</span> : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span onClick={() => exportCsv(visible)} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 15px", cursor: "pointer" }} data-testid="leads-export">⬆ Export</span>
          <a href="/contacts" style={{ textDecoration: "none", fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 14, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 18px", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }} data-testid="leads-add">+ Add leads</a>
        </div>
      </div>

      {/* bulk bar */}
      {selected.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#0C140F", borderRadius: 12, padding: "10px 16px", marginBottom: 12 }} data-testid="bulk-bar">
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#fff" }}>{selected.length} selected</span>
          <span onClick={() => exportCsv(visible.filter((l) => checked[l.id]))} style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "rgba(255,255,255,.1)", borderRadius: 9, padding: "7px 13px", cursor: "pointer" }}>Export</span>
          {/* C2.8: the ONE Add-to-list menu (v4 §5 anatomy) on the Leads bulk bar */}
          <div style={{ position: "relative" }}>
            <span onClick={() => setBulkListDD((v) => !v)} style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "rgba(255,255,255,.1)", borderRadius: 9, padding: "7px 13px", cursor: "pointer" }} data-testid="leads-bulk-add-to-list">≣ Add to list</span>
            {bulkListDD ? (
              <AddToListMenu
                header={`Add ${selected.length} to list`}
                options={lists.map((l) => ({ id: l.id, name: l.name, count: l.memberCount }))}
                showCounts
                newListLabel="New list from selection"
                onPick={(listId) => { void addLeadsToList(listId, visible.filter((l) => checked[l.id]).map((l) => l.contact.id)); setChecked({}); }}
                onNewList={() => openNewList(visible.filter((l) => checked[l.id]).map((l) => l.contact.id))}
                testid="leads-bulk-list-menu"
              />
            ) : null}
          </div>
          <span onClick={() => { for (const id of selected) void moveStage(id, "interested"); setChecked({}); }} style={{ fontSize: 13, fontWeight: 600, color: "#0A0F0C", background: "#7FE8A0", borderRadius: 9, padding: "7px 13px", cursor: "pointer" }}>Mark interested</span>
          <span onClick={() => setChecked({})} style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,.6)", cursor: "pointer" }}>Clear</span>
        </div>
      ) : null}

      {/* table */}
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "44px 1.9fr 1.3fr 1.1fr 1.05fr .7fr .9fr", alignItems: "center", padding: "0 8px", background: "#FBF7F0", borderBottom: "1.5px solid #EBE3D6" }}>
          <div style={{ padding: "13px 12px" }}>
            <span onClick={() => setChecked(allChecked ? {} : Object.fromEntries(visible.map((l) => [l.id, true])))} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, border: `2px solid ${allChecked ? "#35E834" : "#CDBFA8"}`, background: allChecked ? "linear-gradient(135deg,#36D7ED,#35E834)" : "transparent", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer" }} data-testid="select-all">{allChecked ? "✓" : ""}</span>
          </div>
          {["Lead", "Company", "Originated from", "Status", "Step", "Last"].map((h) => (
            <div key={h} style={{ padding: "13px 12px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".02em", color: "#5C6B62" }}>{h}</div>
          ))}
        </div>
        <div style={{ maxHeight: 512, overflowY: "auto" }}>
          {leads === null ? (
            <div data-testid="leads-skeleton">
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
          ) : visible.length === 0 ? (
            <div style={{ padding: "46px 20px", textAlign: "center", color: "#9AA59E", fontSize: 13.5 }} data-testid="leads-empty">
              {(leads?.length ?? 0) === 0 ? "No leads enrolled yet — launch the agent or add leads to begin." : "No leads match your filters."}
            </div>
          ) : (
            visible.map((l, i) => {
              const pill = stagePill(pillKey(l));
              const isChecked = Boolean(checked[l.id]);
              const step = stepIndex(l);
              const name = [l.contact.firstName, l.contact.lastName].filter(Boolean).join(" ") || l.contact.email || "Unknown";
              return (
                <div key={l.id} onClick={() => setOpenId(l.id)} style={{ display: "grid", gridTemplateColumns: "44px 1.9fr 1.3fr 1.1fr 1.05fr .7fr .9fr", alignItems: "center", padding: "0 8px", borderTop: "1px solid #F2EEE4", background: isChecked ? "rgba(53,232,52,.06)" : i % 2 === 1 ? "#FCFAF6" : "#fff", cursor: "pointer" }} data-testid="lead-row">
                  <div style={{ padding: "11px 12px" }} onClick={(e) => e.stopPropagation()}>
                    <span onClick={() => setChecked((c) => ({ ...c, [l.id]: !c[l.id] }))} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, border: `2px solid ${isChecked ? "#35E834" : "#CDBFA8"}`, background: isChecked ? "linear-gradient(135deg,#36D7ED,#35E834)" : "transparent", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer" }} data-testid="lead-check">{isChecked ? "✓" : ""}</span>
                  </div>
                  <div style={{ padding: "11px 12px", display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                    <span style={{ width: 36, height: 36, borderRadius: "50%", flex: "none", background: avTint(l.contact.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#0A0F0C" }}>{initials(l.contact.firstName, l.contact.lastName, l.contact.email)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 14, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                      <span style={{ display: "block", fontSize: 12.5, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.contact.email}</span>
                    </span>
                  </div>
                  <div style={{ padding: "11px 12px", fontSize: 14, color: "#3B463F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.contact.company ?? "—"}</div>
                  <div style={{ padding: "11px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#5C6B62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="lead-origin"><span style={{ fontSize: 13, flex: "none" }}>{originCell(l).icon}</span>{originCell(l).label}</span>
                  </div>
                  <div style={{ padding: "11px 12px" }}>
                    <span style={{ display: "inline-block", padding: "5px 11px", borderRadius: 100, fontSize: 12, fontWeight: 600, background: pill.bg, color: pill.fg }}>{pill.label}</span>
                  </div>
                  <div style={{ padding: "11px 12px", fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{step ? `${step} / ${stepTotal}` : "—"}</div>
                  <div style={{ padding: "11px 12px", fontSize: 13, color: "#9AA59E" }}>{timeAgo(l.updatedAt)}</div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* lead drawer — 460px, live activity timeline */}
      {open ? (
        <div onClick={() => setOpenId(null)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.45)", zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 460, background: "#FBF7F0", boxShadow: "-24px 0 70px rgba(0,0,0,.32)", display: "flex", flexDirection: "column" }} data-testid="lead-drawer">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "20px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6" }}>
              <span style={{ width: 46, height: 46, borderRadius: "50%", flex: "none", background: avTint(open.contact.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#0A0F0C" }}>{initials(open.contact.firstName, open.contact.lastName, open.contact.email)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: "#0E1512" }}>{[open.contact.firstName, open.contact.lastName].filter(Boolean).join(" ") || open.contact.email}</div>
                <div style={{ fontSize: 13, color: "#9AA59E" }}>{open.contact.email}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7 }}>
                  <span style={{ display: "inline-flex", padding: "4px 11px", borderRadius: 100, fontSize: 12, fontWeight: 600, background: stagePill(pillKey(open)).bg, color: stagePill(pillKey(open)).fg }}>{stagePill(pillKey(open)).label}</span>
                  <span style={{ fontSize: 12, color: "#9AA59E" }}>{stepIndex(open) ? `Step ${stepIndex(open)} of ${stepTotal}` : ""}</span>
                </div>
              </div>
              <span onClick={() => setOpenId(null)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }}>✕</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "18px 22px" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                <a href={`/agents/${agentId}/inbox`} style={{ textDecoration: "none", flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: 10, boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}>✉ Message</a>
                <div style={{ position: "relative", flex: 1 }}>
                  <span onClick={() => setMoveDD((v) => !v)} style={{ display: "block", textAlign: "center", fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: 10, cursor: "pointer" }} data-testid="lead-move">↪ Move ▾</span>
                  {moveDD ? (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 240, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", zIndex: 20 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#9AA59E", padding: "10px 14px 6px" }}>Move to</div>
                      {moveOptions(goalPill).map((m) => (
                        <div key={m.stage} onClick={() => void moveStage(open.id, m.stage)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontSize: 13.5, color: m.color, borderTop: "1px solid #F7F2EA", cursor: "pointer" }}>
                          <span style={{ width: 20, textAlign: "center" }}>{m.icon}</span>
                          <span style={{ flex: 1 }}>{m.label}</span>
                          <span style={{ color: "#16A82A", visibility: open.pipelineStage === m.stage ? "visible" : "hidden" }}>✓</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              {/* C2.8: List row + the ONE menu (v4 §5 anatomy — unification rule) */}
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, overflow: "visible", marginBottom: 18 }} data-testid="lead-list-row">
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px" }}>
                  <span style={{ fontSize: 13, color: "#9AA59E", flex: "none", width: 92 }}>List</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#0E1512", fontWeight: 600, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="lead-list-value">
                    {(contactLists[open.contact.id] ?? []).length > 0
                      ? `${contactLists[open.contact.id]![0]!.name}${contactLists[open.contact.id]!.length > 1 ? ` +${contactLists[open.contact.id]!.length - 1}` : ""}`
                      : "—"}
                  </span>
                  <div style={{ position: "relative", flex: "none" }}>
                    <span onClick={() => setDrawerListDD((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.08)", border: "1px solid #9FD8AC", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }} data-testid="lead-add-to-list">＋ Add to list</span>
                    {drawerListDD ? (
                      <AddToListMenu
                        header="Add to list"
                        options={lists.map((l) => ({ id: l.id, name: l.name, current: (contactLists[open.contact.id] ?? []).some((m) => m.id === l.id) }))}
                        newListLabel="New list"
                        onPick={(listId) => void addLeadsToList(listId, [open.contact.id])}
                        onNewList={() => openNewList([open.contact.id])}
                        testid="lead-list-menu"
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              {/* stat tiles — live Opens/Replies from Event rows; the prototype's
                  AI "Score" tile is omitted (no live metric, DEC-038a rule) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 18 }} data-testid="lead-stats">
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
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#8A7F6B", marginBottom: 10 }}>Details</div>
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, marginBottom: 18 }}>
                {[
                  ["Company", open.contact.company ?? "—"],
                  ["Current step", stepIndex(open) ? `Step ${stepIndex(open)} of ${stepTotal}` : "—"],
                  ["Campaign", view?.campaign?.name ?? "—"],
                  ["Enrolled", new Date(open.createdAt).toLocaleDateString()],
                ].map(([k, v], i) => (
                  <div key={k} style={{ display: "flex", gap: 12, padding: "11px 15px", borderTop: i ? "1px solid #F2EEE4" : "none" }}>
                    <span style={{ fontSize: 13, color: "#9AA59E", width: 96, flex: "none" }}>{k}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", textAlign: "right", flex: 1 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#8A7F6B", marginBottom: 10 }}>Activity</div>
              {timeline === null ? (
                <div style={{ fontSize: 13, color: "#9AA59E" }} data-testid="timeline-skeleton">Loading activity…</div>
              ) : timeline.length === 0 ? (
                <div style={{ fontSize: 13, color: "#9AA59E" }} data-testid="timeline-empty">No activity yet.</div>
              ) : (
                <div data-testid="timeline">
                  {timeline.map((e, i) => {
                    const row = EVENT_ROW[e.type] ?? { icon: "•", bg: "#F2EEE4", fg: "#8A7F6B", label: () => e.type };
                    return (
                      <div key={e.id} style={{ display: "flex", gap: 12, paddingBottom: 14 }} data-testid="timeline-row">
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
            <div style={{ borderTop: "1px solid #EBE3D6", background: "#fff", padding: "14px 22px", display: "flex", alignItems: "center", gap: 10 }}>
              <span onClick={() => void moveStage(open.id, "unsubscribed")} style={{ fontSize: 13, fontWeight: 700, color: "#C9543F", cursor: "pointer" }}>Unsubscribe</span>
              <a href="/contacts" style={{ textDecoration: "none", marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 18px" }}>Open full record ›</a>
            </div>
          </div>
        </div>
      ) : null}

      {/* C2.8: New-list modal (same prototype anatomy as Contacts) */}
      {newListOpen ? (
        <div onClick={() => setNewListOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 36, zIndex: 70 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid="leads-new-list-modal">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
              <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Create a list</span>
              <span onClick={() => setNewListOpen(false)} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
            </div>
            <div style={{ padding: "20px 22px" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7 }}>List name</label>
              <input value={newListName} onChange={(e) => { setNewListName(e.target.value); setNewListErr(null); }} onKeyDown={(e) => { if (e.key === "Enter") void createList(); }} placeholder="e.g. Q4 webinar signups" autoFocus style={{ width: "100%", boxSizing: "border-box", height: 46, borderRadius: 11, background: "#FBF7F0", border: `1px solid ${newListErr ? "#E0A99E" : "#EBE3D6"}`, padding: "0 14px", fontSize: 14.5, color: "#0E1512", marginBottom: 6, fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="leads-new-list-name" />
              <div style={{ fontSize: 12.5, color: newListErr ? "#C9543F" : "#9AA59E" }}>
                {newListErr ?? (newListIds.length > 0 ? `${newListIds.length} lead${newListIds.length === 1 ? "" : "s"} will be added to it.` : "Group contacts for targeting — a contact can be in many lists.")}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderTop: "1px solid #EBE3D6" }}>
              <span onClick={() => setNewListOpen(false)} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 16px", cursor: "pointer" }}>Cancel</span>
              <span onClick={() => void createList()} style={{ fontSize: 14, fontWeight: 700, color: newListName.trim() ? "#0A0F0C" : "#9AA59E", background: newListName.trim() ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 20px", cursor: newListName.trim() ? "pointer" : "not-allowed" }} data-testid="leads-new-list-create">Create list</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* §0 toast */}
      {toastMsg ? (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 71, display: "flex", alignItems: "center", gap: 11, background: "#0C140F", color: "#fff", borderRadius: 12, padding: "12px 16px", boxShadow: "0 16px 40px rgba(0,0,0,.3)" }} data-testid="leads-toast">
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#35E834", color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flex: "none" }}>✓</span>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{toastMsg}</span>
          <span onClick={() => setToastMsg("")} style={{ marginLeft: 8, color: "rgba(255,255,255,.5)", cursor: "pointer" }}>✕</span>
        </div>
      ) : null}
    </>
  );
}
