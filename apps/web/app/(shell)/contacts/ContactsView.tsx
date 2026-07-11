"use client";

/**
 * Contacts screen (C2.5, checkpoints §5) — ported from `Contacts.dc.html`.
 * The A10 segment chips are QUERIES over live derived rows (`deriveStatus`),
 * never stored stage values. A4: 5s polling; drawer timeline polls while open.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  importContactRowSchema,
  slugifyFieldLabel,
  workspaceGoalPill,
  type ContactFieldDefDto,
  type ContactListDto,
  type ImportContactRow,
  type ImportContactsResult,
} from "@clientforce/core";
import { AddToListMenu, EmptyState, listGlyph } from "@clientforce/ui";
import { intentTint } from "../../../lib/intents";

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
  custom?: Record<string, string>;
  /** C2.8: active-list memberships (addedAt order — first = primary). */
  lists?: { id: string; name: string }[];
  /** C2.9: the completing campaign's terminal wording (per-row pills/chips). */
  goal?: { key: string; label: string; pill: string } | null;
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
  "email.replied.v1": { icon: "↩", bg: "rgba(54,215,237,.16)", fg: "#1192A6", label: (p) => `Replied${p.intent ? ` — classified “${intentTint(String(p.intent)).label}”` : ""}` },
  "email.bounced.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F", label: () => "Email hard-bounced" },
  // C2.9: goal-completion events carry the campaign's terminal label — render
  // it verbatim; older events fall back to the raw stage.
  "lead.stage_changed.v1": { icon: "↪", bg: "rgba(53,232,52,.14)", fg: "#16A82A", label: (p) => `Moved to ${String(p.label ?? p.toStage ?? "a new stage")}${p.manual ? " by you" : ""}` },
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

/** 40-1: a CSV header becomes a HUMAN label ("practice_type" -> "Practice type");
 *  the raw slug lives only in the def key / token ({{custom.practice_type}}). */
const humanizeHeader = (h: string) => h.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());

/** 40-2: the two designed create failures get distinct copy (409 vs 422). */
const fieldCreateFailureCopy = (err: unknown) => {
  const status = err instanceof Error ? /:\s*(\d+)$/.exec(err.message)?.[1] : null;
  return status === "422"
    ? "This workspace has reached its 30-field limit — archive a field to add another."
    : "Couldn't create that field — it may already exist.";
};

/** C2.9: the goal-completion row's wording follows the workspace pill. */
const moveOptions = (wsPill: string) => [
  { icon: "✦", label: "Mark as qualified", stage: "interested", color: "#0E1512" },
  { icon: "📅", label: `Mark as ${wsPill.toLowerCase()}`, stage: "booked", color: "#0E1512" },
  { icon: "⊘", label: "Unsubscribe", stage: "__unsub__", color: "#C9543F" },
];

export function ContactsView() {
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  // C2.9: distinct goals of ACTIVE agents — workspace-level labels show the
  // shared goal's pill iff there is exactly one, else "Goal met" (DEC-059).
  const [activeGoalKeys, setActiveGoalKeys] = useState<string[]>([]);
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
  // C2.7: detail-drawer inline custom-value edit (values only, defs untouched).
  const [detailEdit, setDetailEdit] = useState<{ key: string; value: string } | null>(null);
  const [moveDD, setMoveDD] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", company: "", phone: "", title: "" });
  // C2.7: add-drawer custom values + the admin inline-create state.
  const [formCustom, setFormCustom] = useState<Record<string, string>>({});
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [addFieldLabel, setAddFieldLabel] = useState("");
  const [creatingField, setCreatingField] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // 36-2: 3-step CSV wizard (Upload → Map → Review → Done), client-side parse.
  const [csvStep, setCsvStep] = useState(0);
  const [csvFile, setCsvFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [csvMap, setCsvMap] = useState<string[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [mapDD, setMapDD] = useState<number | null>(null);
  // IMP-1/IMP-2 (owner bug round 2026-07-08): the Review tiles are SNAPSHOTTED
  // when the user enters the Review step — never recomputed while the 5s poll
  // refreshes `rows` — and execution has real states: button disables, a
  // progress bar tracks chunks, and the done modal shows the SERVER's counts.
  const [reviewSnap, setReviewSnap] = useState<{
    newCount: number; dupes: number; suppressed: number; mapped: number;
    createCount: number; valid: string[][]; emailIdx: number;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProg, setImportProg] = useState<{ done: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<ImportContactsResult | null>(null);
  /** Rows sent to the server this run — retry pulls failed indexes from here. */
  const sentRowsRef = useRef<ImportContactRow[]>([]);
  /** DEC-058: closing mid-import continues in the background + completion toast. */
  const bgCloseRef = useRef(false);

  // C2.8: contact lists — the rail scopes the table (the rail IS the filter),
  // the ONE Add-to-list menu mounts on the bulk bar + detail drawer, and the
  // New-list modal optionally assigns (selection / single contact) on create.
  const [lists, setLists] = useState<ContactListDto[] | null>(null);
  // §0 toast — same treatment as the wizard/Settings (dark pill, green ✓, ✕).
  const [toastMsg, setToastMsg] = useState("");
  const [activeList, setActiveList] = useState<string | null>(null);
  const [bulkListDD, setBulkListDD] = useState(false);
  const [drawerListDD, setDrawerListDD] = useState(false);
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListErr, setNewListErr] = useState<string | null>(null);
  /** What the created list assigns: "sel" = bulk selection, contactId, or nothing. */
  const [newListAssign, setNewListAssign] = useState<"sel" | string | null>(null);
  const [csvListId, setCsvListId] = useState<string>("");
  const [csvListDD, setCsvListDD] = useState(false);
  const [formListId, setFormListId] = useState<string>("");
  const [formListDD, setFormListDD] = useState(false);

  // C2.7: workspace custom-field defs + the caller's role (create = admin-only).
  const [fieldDefs, setFieldDefs] = useState<ContactFieldDefDto[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const activeDefs = useMemo(() => fieldDefs.filter((d) => !d.archived), [fieldDefs]);
  const wsPill = useMemo(() => workspaceGoalPill(activeGoalKeys), [activeGoalKeys]);
  /** C2.9: the segment list with the goal-dynamic terminal tab (id stays "Booked"). */
  const segments = useMemo(
    () => SEGMENTS.map((sg) => (sg.id === "Booked" ? { ...sg, label: wsPill } : sg)),
    [wsPill],
  );
  const refreshDefs = useCallback(
    () => cf("contact-fields").then((d: ContactFieldDefDto[]) => setFieldDefs(d)).catch(() => {}),
    [],
  );
  useEffect(() => {
    void refreshDefs();
    void cf("me")
      .then((m: { role?: string }) => setIsAdmin(m.role === "OWNER" || m.role === "ADMIN"))
      .catch(() => {});
  }, [refreshDefs]);

  const refresh = useCallback(async () => {
    try {
      const res = (await cf(
        `contacts/view${activeList ? `?listId=${activeList}` : ""}`,
      )) as { rows: ContactRow[]; activeGoalKeys: string[] };
      setRows(res.rows);
      setActiveGoalKeys(res.activeGoalKeys);
      setError(false);
    } catch {
      setError(true);
    }
  }, [activeList]);

  // C2.8: rail lists (real counts) ride the same 5s poll as the rows.
  const refreshLists = useCallback(
    () => cf("lists").then((l: ContactListDto[]) => setLists(l)).catch(() => {}),
    [],
  );

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // A4: 5s polling
  useEffect(() => {
    void refresh();
    void refreshLists();
    const t = setInterval(() => {
      void refresh();
      void refreshLists();
    }, 5000);
    return () => clearInterval(t);
  }, [refresh, refreshLists]);

  const drawer = useMemo(() => (rows ?? []).find((r) => r.id === drawerId) ?? null, [rows, drawerId]);

  // drawer timeline polls while open (A4)
  // C2.7: leave any in-progress inline edit behind when switching contacts
  // (keyed on the id — the drawer OBJECT identity changes every 5s poll).
  useEffect(() => {
    setDetailEdit(null);
  }, [drawerId]);

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

  // ── C2.8: list mutations (every failure surfaces — B5 rule) ──────────────
  const activeLists = useMemo(() => (lists ?? []).filter((l) => !l.archived), [lists]);
  const activeListRow = useMemo(
    () => (activeList ? (lists ?? []).find((l) => l.id === activeList) ?? null : null),
    [lists, activeList],
  );

  async function addToList(listId: string, contactIds: string[], clearSel: boolean) {
    setBulkListDD(false);
    setDrawerListDD(false);
    try {
      const res = (await cf(`lists/${listId}/members`, {
        method: "POST",
        body: JSON.stringify({ contactIds }),
      })) as { added: number; skipped: number };
      const name = (lists ?? []).find((l) => l.id === listId)?.name ?? "list";
      setToastMsg(
        res.added === 0
          ? `Already in “${name}” — nothing to add.`
          : `Added ${res.added} contact${res.added === 1 ? "" : "s"} to “${name}”.`,
      );
      if (clearSel) setSel({});
      void refresh();
      void refreshLists();
    } catch {
      setToastMsg("Couldn't add to that list — try again.");
    }
  }

  function openNewList(assign: "sel" | string | null) {
    setBulkListDD(false);
    setDrawerListDD(false);
    setNewListAssign(assign);
    setNewListName("");
    setNewListErr(null);
    setNewListOpen(true);
  }

  async function createList() {
    const name = newListName.trim();
    if (!name) return;
    const contactIds = newListAssign === "sel" ? selected : newListAssign ? [newListAssign] : [];
    try {
      await cf("lists", { method: "POST", body: JSON.stringify({ name, contactIds }) });
      setNewListOpen(false);
      setToastMsg(
        contactIds.length > 0
          ? `Created “${name}” with ${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}.`
          : `Created “${name}”.`,
      );
      if (newListAssign === "sel") setSel({});
      void refresh();
      void refreshLists();
    } catch (err) {
      const status = err instanceof Error ? /:\s*(\d+)$/.exec(err.message)?.[1] : null;
      setNewListErr(
        status === "409"
          ? `A list named “${name}” already exists.`
          : "Couldn't create the list — try again.",
      );
    }
  }
  async function saveDetailEdit(contactId: string) {
    if (!detailEdit) return;
    const value = detailEdit.value.trim();
    // prototype semantics: a blanked value keeps the prior one (exit only).
    if (value === "") {
      setDetailEdit(null);
      return;
    }
    await cf(`contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify({ custom: { [detailEdit.key]: value } }),
    }).catch(() => {});
    setDetailEdit(null);
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
    const custom = Object.fromEntries(Object.entries(formCustom).filter(([, v]) => v.trim() !== ""));
    const created = (await cf("contacts", {
      method: "POST",
      body: JSON.stringify({ ...form, ...(Object.keys(custom).length ? { custom } : {}) }),
    }).catch(() => null)) as { id: string } | null;
    // C2.8: add-drawer LIST select — attach on create.
    if (created && formListId) {
      await cf(`lists/${formListId}/members`, {
        method: "POST",
        body: JSON.stringify({ contactIds: [created.id] }),
      }).catch(() => setToastMsg("Contact created, but adding to the list failed."));
      void refreshLists();
    }
    setAddOpen(false);
    setForm({ firstName: "", lastName: "", email: "", company: "", phone: "", title: "" });
    setFormCustom({});
    setFormListId("");
    void refresh();
  }

  // C2.7: inline field create from the add drawer (admin-only affordance).
  async function createFieldInline() {
    const label = addFieldLabel.trim();
    if (!label || creatingField) return;
    setCreatingField(true);
    try {
      await cf("contact-fields", { method: "POST", body: JSON.stringify({ label, origin: "manual" }) });
      await refreshDefs();
      setAddFieldLabel("");
      setAddFieldOpen(false);
      // plan §UI-1: after create, focus the new def's value input.
      const key = slugifyFieldLabel(label);
      setTimeout(() => document.querySelector<HTMLInputElement>(`[data-testid='custom-input-${key}']`)?.focus(), 60);
    } catch (err) {
      setFieldError(fieldCreateFailureCopy(err));
    } finally {
      setCreatingField(false);
    }
  }

  /** CSV wizard helpers — parse client-side, POST per mapped row.
   *  C2.7 map targets: standard labels · `custom:<key>` (existing def) ·
   *  `__create__` (admin: new TEXT def from the column header) · skip. */
  const CSV_FIELDS = ["First name", "Last name", "Email", "Company", "Phone", "Title", "Skip this column"] as const;
  const CSV_FIELD_KEY: Record<string, string> = { "First name": "firstName", "Last name": "lastName", Email: "email", Company: "company", Phone: "phone", Title: "title" };
  const CSV_CREATE = "__create__";
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
  /** IMP-2: Review stats compute ONCE, on entering the Review step — the tiles
   *  render this snapshot, so the 5s poll can no longer make counters climb.
   *  Dupes/suppressed here are the client's ESTIMATE for the preview; the done
   *  modal shows the server's authoritative counts (the server re-dedupes
   *  transactionally, so a stale estimate can never skip a legitimate row). */
  function snapReview() {
    if (!csvFile) return;
    const emailIdx = csvMap.findIndex((m) => m === "Email");
    const existing = new Set((rows ?? []).map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
    const unsubEmails = new Set((rows ?? []).filter((r) => r.unsub).map((r) => (r.email ?? "").toLowerCase()));
    const valid = csvFile.rows.filter((r) => emailIdx >= 0 && /.+@.+\..+/.test(r[emailIdx] ?? ""));
    const dupes = valid.filter((r) => existing.has((r[emailIdx] ?? "").toLowerCase()));
    const suppressed = valid.filter((r) => unsubEmails.has((r[emailIdx] ?? "").toLowerCase()));
    setReviewSnap({
      newCount: valid.length - dupes.length,
      dupes: dupes.length,
      suppressed: suppressed.length,
      mapped: csvMap.filter((m) => m !== "Skip this column").length,
      createCount: csvMap.filter((m) => m === CSV_CREATE).length,
      valid,
      emailIdx,
    });
  }
  /** IMP-3: chunk size for the bulk endpoint — small enough that the progress
   *  bar moves on an owner-sized (tens of rows) file, well under the server's
   *  IMPORT_CHUNK_MAX. Each chunk is one transactional POST /contacts/import. */
  const CLIENT_CHUNK = 25;
  async function runImport() {
    if (!csvFile || !reviewSnap || importing) return;
    setCsvError(null);
    // C2.7: create the new defs FIRST — a def-create failure aborts before any
    // contact posts, so no row can land referencing a field that doesn't exist.
    // (Def CREATION stays this admin-gated client pre-step; the bulk endpoint
    // takes custom VALUES only — flagged in the PR plan.)
    const customKeyByCol = new Map<number, string>();
    for (let i = 0; i < csvMap.length; i += 1) {
      const m = csvMap[i]!;
      if (m.startsWith("custom:")) customKeyByCol.set(i, m.slice(7));
      else if (m === CSV_CREATE) {
        try {
          const def = (await cf("contact-fields", {
            method: "POST",
            body: JSON.stringify({ label: humanizeHeader(csvFile.headers[i] ?? ""), origin: "csv_import" }),
          })) as ContactFieldDefDto;
          customKeyByCol.set(i, def.key);
        } catch (err) {
          setCsvError(`${fieldCreateFailureCopy(err)} The import was not started.`);
          return;
        }
      }
    }
    if (customKeyByCol.size > 0) void refreshDefs();
    // Build payload rows from the SNAPSHOT — every valid row goes to the
    // server; the server decides duplicates (workspace + within-batch), so the
    // client never mis-skips a row off stale data (IMP-2).
    const rowsToSend: ImportContactRow[] = [];
    const prefailed: ImportContactsResult["failed"] = [];
    for (const r of reviewSnap.valid) {
      const payload: Record<string, unknown> = {};
      const custom: Record<string, string> = {};
      csvMap.forEach((m, i) => {
        const key = CSV_FIELD_KEY[m];
        if (key && r[i]) payload[key] = r[i]!;
        const ck = customKeyByCol.get(i);
        if (ck && r[i]) custom[ck] = r[i]!;
      });
      if (Object.keys(custom).length) payload.custom = custom;
      const parsed = importContactRowSchema.safeParse(payload);
      // index -1 = not sendable; these can't be retried, only reported.
      if (!parsed.success) prefailed.push({ index: -1, email: String(payload.email ?? "(no email)"), reason: "Invalid email address — not imported" });
      else rowsToSend.push(parsed.data);
    }
    await executeImport(rowsToSend, prefailed, { created: 0, skippedDuplicates: 0, suppressed: 0 });
  }
  /** Runs the chunk loop; used by both the first run and "Retry failed". Local
   *  variables + refs only — closing the modal mid-run must not disturb it. */
  async function executeImport(
    rowsToSend: ImportContactRow[],
    prefailed: ImportContactsResult["failed"],
    base: { created: number; skippedDuplicates: number; suppressed: number },
  ) {
    const listId = csvListId; // capture — closeImport() may reset the state mid-run
    bgCloseRef.current = false;
    sentRowsRef.current = rowsToSend;
    setImporting(true);
    setImportProg({ done: 0, total: rowsToSend.length });
    const agg: ImportContactsResult = { ...base, failed: [...prefailed] };
    for (let start = 0; start < rowsToSend.length; start += CLIENT_CHUNK) {
      const chunk = rowsToSend.slice(start, start + CLIENT_CHUNK);
      try {
        const res = (await cf("contacts/import", {
          method: "POST",
          body: JSON.stringify({ rows: chunk, ...(listId ? { listId } : {}) }),
        })) as ImportContactsResult;
        agg.created += res.created;
        agg.skippedDuplicates += res.skippedDuplicates;
        agg.suppressed += res.suppressed;
        agg.failed.push(...res.failed.map((f) => ({ ...f, index: start + f.index })));
      } catch {
        // The chunk is one transaction — a failed call imported none of it.
        chunk.forEach((row, i) => agg.failed.push({ index: start + i, email: row.email, reason: "Network error — row not imported" }));
      }
      setImportProg({ done: Math.min(start + chunk.length, rowsToSend.length), total: rowsToSend.length });
    }
    setImporting(false);
    setImportResult(agg);
    void refresh();
    void refreshLists();
    if (bgCloseRef.current) {
      // DEC-058: the modal was closed mid-run — finish silently, then confirm.
      const fails = agg.failed.length;
      setToastMsg(`Imported ${agg.created} contact${agg.created === 1 ? "" : "s"}${agg.skippedDuplicates ? ` · ${agg.skippedDuplicates} duplicate${agg.skippedDuplicates === 1 ? "" : "s"} skipped` : ""}${fails ? ` · ${fails} failed` : ""}`);
      setImportProg(null);
      setImportResult(null);
    } else {
      setCsvStep(3);
    }
  }
  /** Error-summary "Retry N failed" — re-runs ONLY the failed rows (IMP-1);
   *  already-created rows are never resent, and the server would skip them as
   *  duplicates even if they were. */
  async function retryFailed() {
    if (!importResult || importing) return;
    const retryRows = importResult.failed.filter((f) => f.index >= 0).map((f) => sentRowsRef.current[f.index]).filter((r): r is ImportContactRow => Boolean(r));
    const keepFailed = importResult.failed.filter((f) => f.index < 0);
    if (retryRows.length === 0) return;
    await executeImport(retryRows, keepFailed, {
      created: importResult.created,
      skippedDuplicates: importResult.skippedDuplicates,
      suppressed: importResult.suppressed,
    });
  }
  function closeImport() {
    setImportOpen(false);
    setCsvStep(0);
    setCsvFile(null);
    setCsvMap([]);
    setCsvError(null);
    setCsvListId("");
    setCsvListDD(false);
    setReviewSnap(null);
    if (importing) {
      // DEC-058: continue in the background; the chunk loop only reads locals
      // and refs, so resetting the wizard state above is safe. Completion
      // lands as a toast instead of the done modal.
      bgCloseRef.current = true;
      return;
    }
    setImportProg(null);
    setImportResult(null);
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
      {/* C2.8: lists rail — LIVE ContactList rows with real counts; clicking a
          list scopes the table (the rail IS the list filter). Archived lists
          are absent (membership preserved). */}
      <div style={{ width: 226, flex: "none", background: "#F4F0E7", borderRight: "1px solid #EBE3D6", padding: "22px 14px", display: "flex", flexDirection: "column", minWidth: 0, boxSizing: "border-box" }} data-testid="lists-rail">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", marginBottom: 12 }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "#8A7F6B", flex: 1 }}>Lists</span>
          <span onClick={() => openNewList(null)} style={{ width: 24, height: 24, borderRadius: 7, background: "#fff", border: "1px solid #EBE3D6", color: "#16A82A", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} data-testid="rail-new-list">＋</span>
        </div>
        <div onClick={() => { setActiveList(null); setPage(1); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10, marginBottom: 3, cursor: "pointer", background: activeList === null ? "linear-gradient(135deg,rgba(54,215,237,.16),rgba(53,232,52,.16))" : "transparent" }} data-testid="rail-all">
          <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>☺</span>
          <span style={{ fontSize: 14, fontWeight: activeList === null ? 700 : 600, color: activeList === null ? "#0E1512" : "#3B463F", flex: 1 }}>All contacts</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: activeList === null ? "#16A82A" : "#9AA59E" }}>{activeList === null ? rows?.length ?? 0 : ""}</span>
        </div>
        <div style={{ height: 1, background: "#E6E0D4", margin: "8px 6px" }} />
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, margin: "0 -4px", padding: "0 4px" }}>
          {activeLists.map((l) => {
            const on = activeList === l.id;
            const glyph = listGlyph(l.name);
            return (
              <div key={l.id} onClick={() => { setActiveList(on ? null : l.id); setPage(1); setSel({}); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10, marginBottom: 3, cursor: "pointer", background: on ? "linear-gradient(135deg,rgba(54,215,237,.16),rgba(53,232,52,.16))" : "transparent" }} data-testid={`rail-list-${l.id}`}>
                <span style={{ width: 24, height: 24, borderRadius: 7, flex: "none", background: glyph.iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{glyph.icon}</span>
                <span style={{ fontSize: 13.5, fontWeight: on ? 700 : 600, color: on ? "#0E1512" : "#3B463F", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: on ? "#16A82A" : "#9AA59E" }}>{l.memberCount}</span>
              </div>
            );
          })}
        </div>
        <div onClick={() => openNewList(null)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#9FD8AC"; e.currentTarget.style.color = "#16A82A"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#D8CFBE"; e.currentTarget.style.color = "#8A7F6B"; }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 11px", borderRadius: 10, marginTop: 8, border: "1.5px dashed #D8CFBE", color: "#8A7F6B", cursor: "pointer" }} data-testid="rail-new-list-row">
          <span style={{ fontSize: 15 }}>＋</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>New list</span>
        </div>
      </div>

      {/* main */}
      <div style={{ flex: 1, background: "#FBF7F0", minWidth: 0, padding: "24px 28px 30px", boxSizing: "border-box" }}>
        {/* page header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            {/* C2.8: list-scoped header — name + green LIST badge + member line */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: "-.02em", color: "#0E1512" }} data-testid="scope-title">{activeListRow ? activeListRow.name : "All contacts"}</span>
              {activeListRow ? (
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "#0F7A28", background: "rgba(53,232,52,.14)", border: "1px solid rgba(53,232,52,.35)", borderRadius: 7, padding: "3px 8px" }} data-testid="scope-badge">LIST</span>
              ) : null}
            </div>
            <div style={{ fontSize: 14, color: "#5C6B62" }} data-testid="scope-sub">
              {rows
                ? activeListRow
                  ? `${rows.length} contact${rows.length === 1 ? "" : "s"} in this list`
                  : `${rows.length} contacts · ${counts.Qualified ?? 0} qualified · ${counts.Booked ?? 0} ${wsPill.toLowerCase()}`
                : "…"}
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
          {segments.map((s) => {
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
              {/* C2.8: the v4 bulk add-to-list menu — the ONE menu component */}
              <div style={{ position: "relative" }}>
                <span onClick={() => setBulkListDD((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#0E1512", background: bulkListDD ? "rgba(53,232,52,.08)" : "#fff", border: `1px solid ${bulkListDD ? "#9FD8AC" : "#EBE3D6"}`, borderRadius: 10, padding: "8px 14px", cursor: "pointer" }} data-testid="bulk-add-to-list">≣ Add to list <span style={{ color: "#9AA59E", fontSize: 11 }}>⌄</span></span>
                {bulkListDD ? (
                  <AddToListMenu
                    header={`Add ${selected.length} to list`}
                    options={activeLists.map((l) => ({ id: l.id, name: l.name, count: l.memberCount }))}
                    showCounts
                    newListLabel="New list from selection"
                    onPick={(listId) => void addToList(listId, selected, true)}
                    onNewList={() => openNewList("sel")}
                    testid="bulk-list-menu"
                  />
                ) : null}
              </div>
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
                  {seg === "all" ? "Status" : segments.find((s) => s.id === seg)?.label}<span style={{ color: "#9AA59E", fontSize: 12 }}>⌄</span>
                </span>
                {statusDD ? (
                  <div style={{ ...menuShell, width: 200 }}>
                    {[{ id: "all", label: "All statuses" }, ...segments.slice(1)].map((o) => (
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
                        { key: "bookedOnly" as const, label: `${wsPill} only` },
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
              // C2.9: per-ROW terminal pills show the completing campaign's
              // wording; every other status keeps the A10 name.
              const pillLabel = status === "Booked" ? c.goal?.pill ?? wsPill : status;
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
                    <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 100, fontSize: 12.5, fontWeight: 600, background: pill.sbg, color: pill.sfg, whiteSpace: "nowrap" }} data-testid="status-pill">{pillLabel}</span>
                  </div>
                  <div style={{ padding: "11px 12px", fontSize: 13.5, color: "#5C6B62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.agentName ?? "—"}</div>
                  {/* C2.8: LIST column — primary list; "+N" when in multiple */}
                  <div style={{ padding: "11px 12px", fontSize: 12.5, color: "#5C6B62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="list-cell">
                    {c.lists && c.lists.length > 0 ? (
                      <>
                        {c.lists[0]!.name}
                        {c.lists.length > 1 ? <span style={{ color: "#9AA59E", fontWeight: 700 }}> +{c.lists.length - 1}</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
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
                    <span style={{ display: "inline-flex", padding: "4px 11px", borderRadius: 100, fontSize: 12, fontWeight: 600, background: ST[st!]!.sbg, color: ST[st!]!.sfg }} data-testid="drawer-pill">{st === "Booked" ? drawer.goal?.pill ?? wsPill : st}</span>
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
                        {moveOptions(wsPill).map((m) => {
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

                {/* C2.8: List row atop DETAILS (v4) — current list + the ONE menu */}
                <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, overflow: "visible", marginBottom: 18 }} data-testid="drawer-list-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px" }}>
                    <span style={{ fontSize: 13, color: "#9AA59E", flex: "none", width: 92 }}>List</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#0E1512", fontWeight: 600, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="drawer-list-value">
                      {drawer.lists && drawer.lists.length > 0
                        ? `${drawer.lists[0]!.name}${drawer.lists.length > 1 ? ` +${drawer.lists.length - 1}` : ""}`
                        : "—"}
                    </span>
                    <div style={{ position: "relative", flex: "none" }}>
                      <span onClick={() => setDrawerListDD((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.08)", border: "1px solid #9FD8AC", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }} data-testid="drawer-add-to-list">＋ Add to list</span>
                      {drawerListDD ? (
                        <AddToListMenu
                          header="Add to list"
                          options={activeLists.map((l) => ({ id: l.id, name: l.name, current: (drawer.lists ?? []).some((m) => m.id === l.id) }))}
                          newListLabel="New list"
                          onPick={(listId) => void addToList(listId, [drawer.id], false)}
                          onNewList={() => openNewList(drawer.id)}
                          testid="drawer-list-menu"
                        />
                      ) : null}
                    </div>
                  </div>
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

                {/* C2.7 — custom-field rows (v3 Contacts.dc.html:258): teal 120px
                    labels, click-to-edit value (persistent ✎, green ✓ saves via
                    PATCH /contacts/:id). Rows = ACTIVE defs holding a value. */}
                {(() => {
                  const customRows = activeDefs
                    .map((d) => ({ def: d, value: drawer.custom?.[d.key] }))
                    .filter((r): r is { def: ContactFieldDefDto; value: string } => typeof r.value === "string" && r.value !== "");
                  if (customRows.length === 0) return null;
                  return (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Custom fields</div>
                      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden", marginBottom: 18 }} data-testid="drawer-custom">
                        {customRows.map(({ def, value }, i) => {
                          const editing = detailEdit?.key === def.key;
                          return (
                            <div key={def.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 15px", borderTop: i ? "1px solid #F2EEE4" : "none", minHeight: 30 }}>
                              <span style={{ fontSize: 13, color: "#1192A6", flex: "none", width: 120, fontWeight: 600 }}>{def.label}</span>
                              {!editing ? (
                                <span onClick={() => setDetailEdit({ key: def.key, value })} title="Edit value" style={{ fontSize: 13.5, color: "#0E1512", fontWeight: 600, flex: 1, textAlign: "right", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7 }} data-testid={`drawer-custom-${def.key}`}>
                                  {value} <span style={{ fontSize: 11, color: "#C2B79F" }}>✎</span>
                                </span>
                              ) : (
                                <>
                                  <input
                                    autoFocus
                                    value={detailEdit.value}
                                    onChange={(e) => setDetailEdit({ key: def.key, value: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === "Enter") void saveDetailEdit(drawer.id); }}
                                    style={{ flex: 1, minWidth: 0, height: 32, borderRadius: 8, background: "#FBF7F0", border: "1px solid #35E834", padding: "0 10px", fontSize: 13, fontWeight: 600, color: "#0E1512", textAlign: "right", outline: "none", boxSizing: "border-box", fontFamily: "'Hanken Grotesk',sans-serif" }}
                                    data-testid="drawer-custom-input"
                                  />
                                  <span onClick={() => void saveDetailEdit(drawer.id)} style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(53,232,52,.14)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, cursor: "pointer", flex: "none" }} data-testid="drawer-custom-save">✓</span>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}

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
                  {/* C2.8: LIST select — active per the plan (DEC-044 waiver closed) */}
                  <div style={{ flex: 1, position: "relative" }}>
                    <label style={addLbl}>List</label>
                    <div onClick={() => setFormListDD((v) => !v)} style={{ ...addInp, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} data-testid="form-list">
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: formListId ? "#0E1512" : "#9AA59E" }}>
                        {formListId ? activeLists.find((l) => l.id === formListId)?.name ?? "No list" : "No list"}
                      </span>
                      <span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span>
                    </div>
                    {formListDD ? (
                      <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", zIndex: 30, maxHeight: 212, overflowY: "auto" }} data-testid="form-list-menu">
                        <div onClick={() => { setFormListId(""); setFormListDD(false); }} style={{ padding: "9px 14px", fontSize: 13.5, color: "#5C6B62", cursor: "pointer" }}>No list</div>
                        {activeLists.map((l) => (
                          <div key={l.id} onClick={() => { setFormListId(l.id); setFormListDD(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, color: "#0E1512", cursor: "pointer", background: formListId === l.id ? "rgba(53,232,52,.07)" : "#fff" }} data-testid={`form-list-opt-${l.id}`}>
                            <span style={{ width: 24, height: 24, borderRadius: 7, flex: "none", background: listGlyph(l.name).iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{listGlyph(l.name).icon}</span>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                            {formListId === l.id ? <span style={{ color: "#16A82A" }}>✓</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* C2.7 — CUSTOM FIELDS block (v3 Contacts.dc.html:440). Def inputs
                    render for everyone; the create affordances are admin-only
                    (plan decision 2 — the prototype's ADMIN pill is decorative). */}
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10, marginTop: 4 }} data-testid="custom-fields-block">
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", flex: 1 }}>Custom fields</span>
                  {isAdmin ? (
                    <span onClick={() => { setAddFieldOpen(true); setFieldError(null); }} title="Creates a workspace-wide field — admins only" style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer" }} data-testid="add-field">
                      ＋ Add field <span style={{ fontSize: 10, fontWeight: 800, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "2px 7px", verticalAlign: 1 }}>ADMIN</span>
                    </span>
                  ) : null}
                </div>
                {activeDefs.length > 0 ? (
                  <div style={{ display: "flex", gap: 12, marginBottom: 13, flexWrap: "wrap" }}>
                    {activeDefs.map((d) => (
                      <div key={d.id} style={{ flex: 1, minWidth: "calc(50% - 6px)" }}>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#1192A6", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>{d.label}</label>
                        <input value={formCustom[d.key] ?? ""} onChange={(e) => setFormCustom((v) => ({ ...v, [d.key]: e.target.value }))} placeholder={d.label === "Industry" ? "e.g. Dental" : d.label === "Plan" ? "e.g. Growth" : "Value"} style={addInp} data-testid={`custom-input-${d.key}`} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {addFieldOpen ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }} data-testid="add-field-row">
                    <input
                      autoFocus
                      value={addFieldLabel}
                      onChange={(e) => setAddFieldLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void createFieldInline(); }}
                      placeholder="New field name"
                      style={{ flex: "0 0 150px", height: 40, borderRadius: 10, background: "#fff", border: "1px solid #EBE3D6", padding: "0 12px", fontSize: 13, color: "#0E1512", boxSizing: "border-box", fontFamily: "'Hanken Grotesk',sans-serif" }}
                      data-testid="add-field-name"
                    />
                    <span onClick={() => void createFieldInline()} style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: addFieldLabel.trim() ? "#16A82A" : "#9AA59E", cursor: addFieldLabel.trim() ? "pointer" : "default" }} data-testid="add-field-save">
                      {creatingField ? "Creating…" : "＋ Create field"}
                    </span>
                    <span onClick={() => { setAddFieldOpen(false); setAddFieldLabel(""); setFieldError(null); }} style={{ width: 34, height: 34, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#C9543F", fontSize: 14, cursor: "pointer", flex: "none" }}>✕</span>
                  </div>
                ) : null}
                {fieldError ? <div style={{ fontSize: 12, color: "#C9543F", marginBottom: 8 }} data-testid="field-error">{fieldError}</div> : null}
                {isAdmin && !addFieldOpen && activeDefs.length === 0 ? (
                  <div onClick={() => setAddFieldOpen(true)} style={{ border: "1.5px dashed #D8CFBE", borderRadius: 11, padding: 14, textAlign: "center", fontSize: 13, color: "#9AA59E", cursor: "pointer", marginBottom: 16 }} data-testid="add-field-empty-cta">
                    ＋ New field for this workspace (e.g. Source URL) · Admin
                  </div>
                ) : null}
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
                        {csvFile.headers.map((h, i) => {
                          // C2.7 (v3 Contacts.dc.html:327): custom "Maps to" dropdown —
                          // Standard fields / Custom fields sections, admin create row,
                          // teal picked-new state (#1192A6 text / #9AD6E4 border).
                          const picked = csvMap[i] ?? "Skip this column";
                          const isSkip = picked === "Skip this column";
                          const isNew = picked === CSV_CREATE;
                          const title = humanizeHeader(h);
                          const display = isNew ? `＋ ${title} · new field` : picked.startsWith("custom:") ? (fieldDefs.find((d) => d.key === picked.slice(7))?.label ?? picked.slice(7)) : picked;
                          const pick = (v: string) => { setCsvMap((m) => m.map((x, j) => (j === i ? v : x))); setMapDD(null); };
                          return (
                            <div key={h + i} style={{ display: "grid", gridTemplateColumns: "1fr 22px 1.1fr", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F2EEE4" }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0E1512", fontFamily: "monospace" }}>{h}</div>
                                <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{csvFile.rows[0]?.[i] ?? ""}</div>
                              </div>
                              <span style={{ color: "#C2B79F", textAlign: "center", fontSize: 12 }}>→</span>
                              <div style={{ position: "relative" }}>
                                <div onClick={() => setMapDD((v) => (v === i ? null : i))} style={{ border: `1px solid ${isNew ? "#9AD6E4" : "#EBE3D6"}`, borderRadius: 9, padding: "8px 11px", fontSize: 12.5, fontWeight: 600, color: isSkip ? "#9AA59E" : isNew ? "#1192A6" : "#0E1512", background: "#FBF7F0", display: "flex", alignItems: "center", cursor: "pointer" }} data-testid={`csv-map-${i}`}>
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
                                  <span style={{ marginLeft: "auto", color: "#9AA59E", paddingLeft: 6 }}>⌄</span>
                                </div>
                                {mapDD === i ? (
                                  <div style={{ position: "absolute", top: "calc(100% + 5px)", right: 0, width: 224, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", zIndex: 8 }} data-testid="csv-map-dd">
                                    <div style={{ maxHeight: 196, overflowY: "auto" }}>
                                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#9AA59E", padding: "9px 13px 4px" }}>Standard fields</div>
                                      {CSV_FIELDS.filter((f) => f !== "Skip this column").map((f) => (
                                        <div key={f} onClick={() => pick(f)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#0E1512" }}>
                                          <span style={{ flex: 1 }}>{f}</span>
                                          <span style={{ color: "#16A82A", visibility: picked === f ? "visible" : "hidden" }}>✓</span>
                                        </div>
                                      ))}
                                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#1192A6", padding: "9px 13px 4px", borderTop: "1px solid #F2EEE4" }}>Custom fields</div>
                                      {activeDefs.map((d) => (
                                        <div key={d.id} onClick={() => pick(`custom:${d.key}`)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#0E1512" }} data-testid={`csv-map-custom-${d.key}`}>
                                          <span style={{ flex: 1 }}>{d.label}</span>
                                          <span style={{ color: "#16A82A", visibility: picked === `custom:${d.key}` ? "visible" : "hidden" }}>✓</span>
                                        </div>
                                      ))}
                                    </div>
                                    {isAdmin ? (
                                      <div onClick={() => pick(CSV_CREATE)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 13px", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#16A82A", borderTop: "1px solid #EBE3D6" }} data-testid="csv-map-create">
                                        <span style={{ flex: 1 }}>＋ Create field “{title}”</span>
                                        <span style={{ fontSize: 9, fontWeight: 800, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "2px 6px" }}>ADMIN</span>
                                      </div>
                                    ) : null}
                                    <div onClick={() => pick("Skip this column")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#9AA59E", borderTop: "1px solid #F2EEE4" }}>
                                      <span style={{ flex: 1 }}>Skip this column</span>
                                      <span style={{ color: "#16A82A", visibility: isSkip ? "visible" : "hidden" }}>✓</span>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : null}
                    {csvStep === 2 && reviewSnap ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Review import</div>
                        <div style={{ fontSize: 13, color: "#9AA59E", marginBottom: 16 }}>Here&apos;s what we&apos;ll add to your contacts.</div>
                        {/* C2.8: step-3 "Add to list" select — existing list or none */}
                        <div style={{ marginBottom: 14, position: "relative" }}>
                          <label style={addLbl}>Add to list</label>
                          <div onClick={() => { if (importing) return; setCsvListDD((v) => !v); }} style={{ ...addInp, background: "#FBF7F0", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.6 : 1 }} data-testid="csv-list">
                            <span style={{ color: csvListId ? "#0E1512" : "#9AA59E" }}>
                              {csvListId ? activeLists.find((l) => l.id === csvListId)?.name ?? "No list (all contacts)" : "No list (all contacts)"}
                            </span>
                            <span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span>
                          </div>
                          {csvListDD ? (
                            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", zIndex: 30, maxHeight: 212, overflowY: "auto" }} data-testid="csv-list-menu">
                              <div onClick={() => { setCsvListId(""); setCsvListDD(false); }} style={{ padding: "9px 14px", fontSize: 13.5, color: "#5C6B62", cursor: "pointer" }}>No list (all contacts)</div>
                              {activeLists.map((l) => (
                                <div key={l.id} onClick={() => { setCsvListId(l.id); setCsvListDD(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, color: "#0E1512", cursor: "pointer", background: csvListId === l.id ? "rgba(53,232,52,.07)" : "#fff" }} data-testid={`csv-list-opt-${l.id}`}>
                                  <span style={{ width: 24, height: 24, borderRadius: 7, flex: "none", background: listGlyph(l.name).iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{listGlyph(l.name).icon}</span>
                                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                                  {csvListId === l.id ? <span style={{ color: "#16A82A" }}>✓</span> : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                          {[
                            { value: String(reviewSnap.newCount), label: "New contacts", fg: "#16A82A" },
                            { value: String(reviewSnap.dupes), label: "Duplicates skipped", fg: "#1192A6" },
                            { value: String(reviewSnap.suppressed), label: "On suppression list", fg: "#8A7F6B" },
                            { value: String(reviewSnap.mapped), label: "Columns mapped", fg: "#0E1512" },
                          ].map((st2) => (
                            <div key={st2.label} style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "14px 16px" }}>
                              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 24, fontWeight: 800, color: st2.fg, lineHeight: 1, marginBottom: 4 }}>{st2.value}</div>
                              <div style={{ fontSize: 12, color: "#8A7F6B" }}>{st2.label}</div>
                            </div>
                          ))}
                        </div>
                        {/* C2.7: created-field note — the prototype's review has no
                            created-fields tile (4 tiles only); this teal note row makes
                            the create visible without inventing a fifth tile (flagged). */}
                        {reviewSnap.createCount > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(54,215,237,.06)", border: "1px solid rgba(54,215,237,.28)", borderRadius: 11, padding: "11px 14px", marginBottom: 10 }} data-testid="csv-create-note">
                            <span style={{ color: "#1192A6" }}>＋</span>
                            <span style={{ fontSize: 12.5, color: "#1192A6", fontWeight: 600 }}>
                              {reviewSnap.createCount} new custom field{reviewSnap.createCount === 1 ? "" : "s"} will be created: {csvFile!.headers.filter((_, i) => csvMap[i] === CSV_CREATE).map(humanizeHeader).join(", ")}
                            </span>
                          </div>
                        ) : null}
                        {csvError ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(224,121,107,.08)", border: "1px solid rgba(224,121,107,.3)", borderRadius: 11, padding: "11px 14px", marginBottom: 10 }} data-testid="csv-error">
                            <span style={{ color: "#C9543F" }}>⚠</span>
                            <span style={{ fontSize: 12.5, color: "#C9543F", fontWeight: 600 }}>{csvError}</span>
                          </div>
                        ) : null}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(53,232,52,.06)", border: "1px solid rgba(53,232,52,.22)", borderRadius: 11, padding: "11px 14px" }}>
                          <span style={{ color: "#16A82A" }}>✓</span>
                          <span style={{ fontSize: 12.5, color: "#16A82A", fontWeight: 600 }}>All contacts checked against your suppression list.</span>
                        </div>
                        {/* IMP-1: in-flight state — progress over chunks, not
                            re-derived stats; the tiles above stay frozen. */}
                        {importing && importProg ? (
                          <div style={{ marginTop: 12 }} data-testid="import-progress">
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512" }}>Importing… {importProg.done} of {importProg.total}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#8A7F6B" }}>{importProg.total > 0 ? Math.round((importProg.done / importProg.total) * 100) : 0}%</span>
                            </div>
                            <div style={{ height: 8, borderRadius: 100, background: "#E4EAE6", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${importProg.total > 0 ? (importProg.done / importProg.total) * 100 : 0}%`, borderRadius: 100, background: GRAD, transition: "width .3s ease" }} data-testid="import-progress-bar" />
                            </div>
                            <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 7 }}>You can close this window — the import keeps running and we&apos;ll confirm when it&apos;s done.</div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                    {csvStep === 0 ? (
                      <span onClick={closeImport} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
                    ) : (
                      <span onClick={() => { if (importing) return; setCsvStep((v) => Math.max(0, v - 1)); }} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.5 : 1 }}>‹ Back</span>
                    )}
                    {(() => {
                      // IMP-1: the primary disables the moment the import starts
                      // — a second click can no longer race a poll refresh into
                      // duplicate contacts. IMP-2: snapshot happens on 1 → 2.
                      const canGo = !importing && (csvStep === 0 ? Boolean(csvFile) : csvStep === 1 ? csvMap.includes("Email") : (reviewSnap?.newCount ?? 0) > 0);
                      const label = importing ? "Importing…" : csvStep === 2 ? `Import ${reviewSnap?.newCount ?? 0} contact${(reviewSnap?.newCount ?? 0) === 1 ? "" : "s"}` : "Continue";
                      return (
                        <span onClick={() => { if (!canGo) return; if (csvStep === 2) void runImport(); else { if (csvStep === 1) snapReview(); setCsvStep((v) => v + 1); } }} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: canGo ? "#0A0F0C" : "#9AA59E", background: canGo ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 22px", cursor: canGo ? "pointer" : "not-allowed", boxShadow: canGo ? "0 6px 16px rgba(53,232,52,.26)" : "none" }} data-testid="import-save">{label}</span>
                      );
                    })()}
                  </div>
                </>
              ) : (
                // IMP-1: the done modal reports the SERVER's counts — created /
                // duplicates / suppressed / failed — never a client-side tally.
                // failed > 0 lands the error-summary variant with per-row
                // reasons and "Retry N failed" (failed rows only re-run).
                (() => {
                  const res = importResult ?? { created: 0, skippedDuplicates: 0, suppressed: 0, failed: [] };
                  const retryable = res.failed.filter((f) => f.index >= 0).length;
                  const hasFails = res.failed.length > 0;
                  const tiles = [
                    { value: String(res.created), label: "Imported", fg: "#16A82A" },
                    { value: String(res.skippedDuplicates), label: "Duplicates skipped", fg: "#1192A6" },
                    { value: String(res.suppressed), label: "On suppression list", fg: "#8A7F6B" },
                    { value: String(res.failed.length), label: "Failed", fg: hasFails ? "#C9543F" : "#0E1512" },
                  ];
                  return (
                    <>
                      <div style={{ padding: "30px 28px 22px", textAlign: "center" }} data-testid={hasFails ? "csv-error-summary" : "csv-done"}>
                        <div style={{ width: 60, height: 60, borderRadius: "50%", background: hasFails ? "rgba(224,121,107,.14)" : "#D7F5DD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: hasFails ? "#C9543F" : "#16A82A", margin: "0 auto 18px" }}>{hasFails ? "⚠" : "✓"}</div>
                        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, color: "#0E1512", marginBottom: 6 }}>
                          {hasFails ? `${res.created} imported · ${res.failed.length} failed` : `${res.created} contact${res.created === 1 ? "" : "s"} imported`}
                        </div>
                        <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, maxWidth: 380, margin: "0 auto 18px" }}>
                          {hasFails ? "The rows below didn't import. You can retry just those rows." : "They're ready to enroll in a campaign."}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, textAlign: "left" }}>
                          {tiles.map((t) => (
                            <div key={t.label} style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "12px 13px" }}>
                              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 20, fontWeight: 800, color: t.fg, lineHeight: 1, marginBottom: 4 }}>{t.value}</div>
                              <div style={{ fontSize: 11, color: "#8A7F6B" }}>{t.label}</div>
                            </div>
                          ))}
                        </div>
                        {hasFails ? (
                          <div style={{ marginTop: 12, maxHeight: 168, overflowY: "auto", border: "1px solid rgba(224,121,107,.3)", borderRadius: 11, textAlign: "left" }} data-testid="csv-failed-rows">
                            {res.failed.map((f, i) => (
                              <div key={`${f.email}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "9px 13px", borderTop: i === 0 ? "none" : "1px solid #F3EEE4" }}>
                                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0E1512", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{f.email}</span>
                                <span style={{ fontSize: 12, color: "#C9543F", minWidth: 0 }}>{f.reason}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                        {hasFails ? (
                          <span onClick={closeImport} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Close</span>
                        ) : null}
                        {hasFails && retryable > 0 ? (
                          <span onClick={() => { if (!importing) void retryFailed(); }} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: importing ? "#9AA59E" : "#0A0F0C", background: importing ? "#ECE7DC" : GRAD, borderRadius: 11, padding: "10px 24px", cursor: importing ? "not-allowed" : "pointer", boxShadow: importing ? "none" : "0 6px 16px rgba(53,232,52,.26)" }} data-testid="csv-retry-failed">
                            {importing && importProg ? `Retrying… ${importProg.done} of ${importProg.total}` : `Retry ${retryable} failed`}
                          </span>
                        ) : (
                          <span onClick={closeImport} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 24px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}>Done</span>
                        )}
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        ) : null}

        {/* C2.8: New-list modal (prototype anatomy) — creates via POST /lists;
            optionally assigns the bulk selection / a single contact on create. */}
        {newListOpen ? (
          <div onClick={() => setNewListOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 36, zIndex: 70 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid="new-list-modal">
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
                <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Create a list</span>
                <span onClick={() => setNewListOpen(false)} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
              </div>
              <div style={{ padding: "20px 22px" }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7 }}>List name</label>
                <input
                  value={newListName}
                  onChange={(e) => { setNewListName(e.target.value); setNewListErr(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void createList(); }}
                  placeholder="e.g. Q4 webinar signups"
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", height: 46, borderRadius: 11, background: "#FBF7F0", border: `1px solid ${newListErr ? "#E0A99E" : "#EBE3D6"}`, padding: "0 14px", fontSize: 14.5, color: "#0E1512", marginBottom: 6, fontFamily: "'Hanken Grotesk',sans-serif" }}
                  data-testid="new-list-name"
                />
                <div style={{ fontSize: 12.5, color: newListErr ? "#C9543F" : "#9AA59E" }} data-testid="new-list-hint">
                  {newListErr ??
                    (newListAssign === "sel"
                      ? `The ${selected.length} selected contact${selected.length === 1 ? "" : "s"} will be added to it.`
                      : newListAssign
                        ? "This contact will be added to it."
                        : "Group contacts for targeting — a contact can be in many lists.")}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderTop: "1px solid #EBE3D6" }}>
                <span onClick={() => setNewListOpen(false)} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 16px", cursor: "pointer" }}>Cancel</span>
                <span onClick={() => void createList()} style={{ fontSize: 14, fontWeight: 700, color: newListName.trim() ? "#0A0F0C" : "#9AA59E", background: newListName.trim() ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 20px", cursor: newListName.trim() ? "pointer" : "not-allowed", boxShadow: newListName.trim() ? "0 6px 16px rgba(53,232,52,.26)" : "none" }} data-testid="new-list-create">Create list</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* §0 toast — dark pill, green ✓ dot, dismiss ✕ */}
        {toastMsg ? (
          <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 71, display: "flex", alignItems: "center", gap: 11, background: "#0C140F", color: "#fff", borderRadius: 12, padding: "12px 16px", boxShadow: "0 16px 40px rgba(0,0,0,.3)" }} data-testid="toast">
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#35E834", color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flex: "none" }}>✓</span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{toastMsg}</span>
            <span onClick={() => setToastMsg("")} style={{ marginLeft: 8, color: "rgba(255,255,255,.5)", cursor: "pointer" }}>✕</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
