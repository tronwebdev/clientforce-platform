"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentListItem, ContactListDto } from "@clientforce/core";
import { calendarSystemRow } from "../../app/(shell)/agents/[agentId]/[tab]/InboxTab";
import { intentTint } from "../../lib/intents";
import type { BoldDrawerState } from "./BoldDrawer";
import { stageTone } from "./BoldPipelineView";
import {
  addContactsToList,
  avTint,
  fetchBoldInbox,
  fetchLists,
  fetchPipelineStages,
  fetchWorkspaceInbox,
  initials,
  moveEnrollmentStage,
  relTime,
  setMessageDone,
  type BoldInboxThread,
  type PipelineStageRow,
} from "./bold-live";

/**
 * The inbox (B2 campaign scope · B3a workspace scope — §4.5 "same component,
 * different scope", DEC-112). Campaign inbox (B2, prototype `vInbox`) — three dropdown pickers (the
 * ruling: chip rows rejected) with LIVE counts, thread list, and the reading
 * pane, all over the shipped `GET /agents/:id/inbox` read (threads keyed by
 * contactId; contacts with no inbound never appear; unsubscribe threads live
 * in Contacts — DEC-034). Actions are the ones that EXIST: move (the
 * bus-publishing enrollment PATCH — DEC-085), mark handled / reopen
 * (`PATCH /messages/:id/done` on the last inbound), add to list, open the
 * person peek. Reply sending, Ada reply drafts, assign and snooze have NO
 * shipped backend — they render as honest absence, never as canned UI
 * (Q-070/Q-071; the Q-066 precedent). Site-agent provenance pills wait for
 * data that does not exist yet (Q-072).
 *
 * TYPE rows without a data source (Web chat · Client messages) stay visible
 * but disabled with the wave that brings them — filed, never silently
 * dropped (the B0 "3 elsewhere" ruling).
 *
 * Workspace scope (B3a) adds exactly what §4.5 names: the workspace-wide
 * CAMPAIGN selector (a fourth picker, ahead of TYPE) and campaign attribution
 * per thread — threads come from `GET /inbox` (the same server-side builder,
 * keyed per campaign+contact, so one contact in two campaigns is two
 * threads). Every triage action is the same shipped write.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

const CH_CHIP: Record<string, [string, string, string, string]> = {
  email: ["✉", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  sms: ["✆", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  voice: ["☎", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"],
};

/** System-row tones by event family — wording stays the ONE pinned map
 *  (`calendarSystemRow`); the colors are skin, so Bold re-tones them. */
function systemTone(type: string): [string, string, string] {
  if (type === "calendar.canceled.v1") return ["var(--cvb-danger)", "var(--cvb-danger-bg)", "#f0d5ce"];
  if (type === "calendar.rescheduled.v1") return ["var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)"];
  return ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"];
}

type TypeF = "all" | "email" | "sms" | "voice";
type StatusF = "all" | "needs" | "booked" | "handled";
type SortF = "new" | "wait" | "unread";

const lastInboundOf = (t: BoldInboxThread) =>
  [...t.messages].reverse().find((m) => m.direction === "INBOUND") ?? null;

export type BoldInboxScope =
  | { kind: "campaign"; agent: AgentListItem }
  | { kind: "workspace"; focusContactId?: string | null };

/** Thread identity — campaign-qualified in workspace scope (one contact in
 *  two campaigns is two threads). */
const keyOf = (t: BoldInboxThread) => (t.campaign ? `${t.campaign.id}:${t.contactId}` : t.contactId);

export function BoldInboxView({
  scope,
  onOpenDrawer,
  flash,
  onThreadCount,
}: {
  scope: BoldInboxScope;
  onOpenDrawer: (d: BoldDrawerState) => void;
  flash: (msg: string) => void;
  /** Workspace scope reports its live conversation count for the eyebrow. */
  onThreadCount?: (n: number) => void;
}) {
  const [threads, setThreads] = useState<BoldInboxThread[] | null>(null);
  const [stages, setStages] = useState<PipelineStageRow[]>([]);
  const [lists, setLists] = useState<ContactListDto[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const focusContactId = scope.kind === "workspace" ? (scope.focusContactId ?? null) : null;
  const [typeF, setTypeF] = useState<TypeF>("all");
  const [statusF, setStatusF] = useState<StatusF>("all");
  const [sortF, setSortF] = useState<SortF>("new");
  const [campF, setCampF] = useState<string>("all");
  const [openPicker, setOpenPicker] = useState<"camp" | "type" | "status" | "sort" | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const agentId = scope.kind === "campaign" ? scope.agent.id : null;
  const refresh = useCallback(async () => {
    const res = agentId ? await fetchBoldInbox(agentId) : await fetchWorkspaceInbox();
    if (res) {
      setThreads(res.threads);
      onThreadCount?.(res.threads.length);
    }
  }, [agentId, onThreadCount]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    void fetchPipelineStages().then((s) => setStages(s ?? []));
    void fetchLists().then((l) => setLists((l ?? []).filter((x) => !x.archived)));
  }, []);

  const all = useMemo(() => threads ?? [], [threads]);
  const isStatus = useCallback((t: BoldInboxThread, f: StatusF) => {
    if (f === "needs") return t.unread && !t.done;
    if (f === "booked") return t.stage === "booked";
    if (f === "handled") return t.done;
    return true;
  }, []);
  const hasChannel = (t: BoldInboxThread, ch: string) => (t.channels ?? ["email"]).includes(ch);

  const shown = useMemo(() => {
    const rows = all.filter(
      (t) =>
        (campF === "all" || t.campaign?.id === campF) &&
        (typeF === "all" || hasChannel(t, typeF)) &&
        isStatus(t, statusF),
    );
    return rows.sort((a, b) => {
      if (sortF === "wait") return a.lastAt.localeCompare(b.lastAt);
      if (sortF === "unread" && a.unread !== b.unread) return a.unread ? -1 : 1;
      return b.lastAt.localeCompare(a.lastAt);
    });
  }, [all, campF, typeF, statusF, sortF, isStatus]);

  const sel = shown.find((t) => keyOf(t) === selId) ?? all.find((t) => keyOf(t) === selId) ?? shown[0] ?? null;

  // PIN the selection. Without a pinned id the pane target silently follows
  // list reordering under the 5s poll while action menus stay open — a
  // Move/Handled/+List click would then hit the WRONG contact. The id pins on
  // first load and re-pins only when a filter excludes the current thread.
  useEffect(() => {
    if (shown.length > 0 && !shown.some((t) => keyOf(t) === selId)) {
      // A drawer "Message" hand-off lands on that contact's newest thread.
      const focused = focusContactId ? shown.find((t) => t.contactId === focusContactId) : null;
      setSelId(keyOf(focused ?? shown[0]!));
    }
  }, [shown, selId, focusContactId]);
  // Any change of pane target closes the popovers that act on it.
  const selKey = sel ? keyOf(sel) : null;
  useEffect(() => {
    setMoveOpen(false);
    setListOpen(false);
  }, [selKey]);

  if (threads === null) {
    return (
      <div style={{ padding: "26px 40px 40px" }} data-testid="bold-inbox">
        <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>LOADING INBOX</div>
      </div>
    );
  }

  /* --------------------------------------------------- picker vocab + counts */

  const typeRows: Array<{ key: TypeF | "web" | "portal"; dot: string; label: string; count: number | null; why?: string }> = [
    { key: "all", dot: "var(--cvb-faint)", label: "All", count: all.length },
    { key: "email", dot: "var(--cvb-forest)", label: "Email", count: all.filter((t) => hasChannel(t, "email")).length },
    { key: "sms", dot: "var(--cvb-cyan)", label: "SMS", count: all.filter((t) => hasChannel(t, "sms")).length },
    { key: "web", dot: "var(--cvb-ghost)", label: "Web chat", count: null, why: "Coming soon" },
    { key: "voice", dot: "var(--cvb-slate)", label: "Calls", count: all.filter((t) => hasChannel(t, "voice")).length },
    { key: "portal", dot: "var(--cvb-ghost)", label: "Client messages", count: null, why: "Coming soon" },
  ];
  const statusRows: Array<{ key: StatusF; dot: string; label: string; count: number }> = [
    { key: "all", dot: "var(--cvb-faint)", label: "All", count: all.length },
    { key: "needs", dot: "var(--cvb-dot-amber)", label: "Needs reply", count: all.filter((t) => isStatus(t, "needs")).length },
    { key: "booked", dot: "var(--cvb-forest)", label: "Booked", count: all.filter((t) => isStatus(t, "booked")).length },
    { key: "handled", dot: "var(--cvb-ghost)", label: "Handled", count: all.filter((t) => isStatus(t, "handled")).length },
  ];
  const sortRows: Array<{ key: SortF; label: string }> = [
    { key: "new", label: "Newest first" },
    { key: "wait", label: "Waiting longest" },
    { key: "unread", label: "Unread first" },
  ];

  // B3a: the workspace-wide selector — distinct campaigns present in the
  // thread world, live counts, campaign attribution's filter.
  const campRefs = [...new Map(all.filter((t) => t.campaign).map((t) => [t.campaign!.id, t.campaign!])).values()];
  const campPicker =
    scope.kind === "workspace"
      ? [
          {
            k: "CAMPAIGN",
            id: "camp" as const,
            v: campF === "all" ? "All campaigns" : (campRefs.find((c) => c.id === campF)?.agentName ?? "All campaigns"),
            rows: [
              {
                id: "camp-all",
                dot: "var(--cvb-faint)",
                label: "All campaigns",
                count: all.length as number | null,
                selected: campF === "all",
                disabled: false,
                why: undefined as string | undefined,
                go: () => {
                  setCampF("all");
                  setOpenPicker(null);
                },
              },
              ...campRefs.map((c) => ({
                id: `camp-${c.id}`,
                dot: "var(--cvb-forest)",
                label: c.agentName,
                count: all.filter((t) => t.campaign?.id === c.id).length as number | null,
                selected: campF === c.id,
                disabled: false,
                why: undefined as string | undefined,
                go: () => {
                  setCampF(c.id);
                  setOpenPicker(null);
                },
              })),
            ],
          },
        ]
      : [];

  const pickers = [
    ...campPicker,
    {
      k: "TYPE",
      id: "type" as const,
      v: typeRows.find((r) => r.key === typeF)?.label ?? "All",
      rows: typeRows.map((r) => ({
        id: `type-${r.key}`,
        dot: r.dot,
        label: r.label,
        count: r.count,
        selected: r.key === typeF,
        disabled: r.count === null,
        why: r.why,
        go: () => {
          if (r.count === null) return;
          setTypeF(r.key as TypeF);
          setOpenPicker(null);
        },
      })),
    },
    {
      k: "STATUS",
      id: "status" as const,
      v: statusRows.find((r) => r.key === statusF)?.label ?? "All",
      rows: statusRows.map((r) => ({
        id: `status-${r.key}`,
        dot: r.dot,
        label: r.label,
        count: r.count as number | null,
        selected: r.key === statusF,
        disabled: false,
        why: undefined as string | undefined,
        go: () => {
          setStatusF(r.key);
          setOpenPicker(null);
        },
      })),
    },
    {
      // "Highest value" from the prototype's sort set is absent: no per-thread
      // value data exists (the estimate is agent-level) — honest absence.
      k: "SORT",
      id: "sort" as const,
      v: sortRows.find((r) => r.key === sortF)?.label ?? "Newest first",
      rows: sortRows.map((r) => ({
        id: `sort-${r.key}`,
        dot: "var(--cvb-faint)",
        label: r.label,
        count: null as number | null,
        selected: r.key === sortF,
        disabled: false,
        why: undefined as string | undefined,
        go: () => {
          setSortF(r.key);
          setOpenPicker(null);
        },
      })),
    },
  ];

  /* ------------------------------------------------------------ pane actions */

  const selLastInbound = sel ? lastInboundOf(sel) : null;
  async function toggleDone() {
    if (!sel || !selLastInbound) return;
    const res = await setMessageDone(selLastInbound.id, !sel.done);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash(sel.done ? "Reopened" : "Marked handled");
    void refresh();
  }
  async function move(stageKey: string, label: string) {
    setMoveOpen(false);
    if (!sel?.enrollmentId || sel.stage === stageKey) return;
    const res = await moveEnrollmentStage(sel.enrollmentId, stageKey);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash(`Moved to ${label}`);
    void refresh();
  }
  async function addToList(list: ContactListDto) {
    setListOpen(false);
    if (!sel) return;
    const res = await addContactsToList(list.id, [sel.contactId]);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    const added = (res.body as { added?: number } | null)?.added ?? 0;
    flash(added === 0 ? `Already in “${list.name}” — nothing to add.` : `Added to “${list.name}”.`);
  }

  const selName = sel
    ? [sel.contact?.firstName, sel.contact?.lastName].filter(Boolean).join(" ") || sel.contact?.email || "A contact"
    : "";
  const selStage = sel?.stage ? stages.find((s) => s.key === sel.stage) : null;
  const moveTone = sel?.stage ? stageTone(sel.stage) : null;

  const paneItems = sel
    ? [
        ...sel.messages.map((m) => ({ key: `m-${m.id}`, at: m.sentAt, msg: m, ev: null as null | BoldInboxThread["events"][number] })),
        ...(sel.events ?? [])
          .filter((e) => calendarSystemRow(e.type, (e.payload ?? {}) as Record<string, unknown>) !== null)
          .map((e) => ({ key: `e-${e.id}`, at: e.occurredAt, msg: null as null | BoldInboxThread["messages"][number], ev: e })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];

  return (
    <div style={{ display: "flex", minHeight: 0, flexWrap: "wrap" }} data-testid="bold-inbox">
      {/* ------------------------------------------------------- thread list */}
      <div style={{ width: 290, flex: "none", borderRight: "1px solid var(--cvb-line-inner)", padding: "24px 18px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {pickers.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <div
                onClick={() => setOpenPicker((v) => (v === p.id ? null : p.id))}
                data-testid={`bold-inbox-picker-${p.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 11px",
                  borderRadius: 11,
                  border: `1px solid ${openPicker === p.id ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                  background: openPicker === p.id ? "var(--cvb-panel)" : "var(--cvb-card)",
                  cursor: "pointer",
                }}
              >
                <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".13em", color: "var(--cvb-faint)", flex: "none" }}>{p.k}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, letterSpacing: "-.016em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.v}</span>
                <span style={{ fontSize: 10, color: "var(--cvb-faint)", flex: "none" }}>{openPicker === p.id ? "⌃" : "⌄"}</span>
              </div>
              {openPicker === p.id ? (
                <div style={{ position: "absolute", left: 0, right: 0, top: "100%", marginTop: 5, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: 5, zIndex: 4, boxShadow: "var(--cvb-shadow-card)" }}>
                  {p.rows.map((o) => (
                    <div
                      key={o.id}
                      data-testid={`bold-inbox-opt-${o.id}`}
                      onClick={o.go}
                      title={o.why}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "9px 10px",
                        borderRadius: 9,
                        cursor: o.disabled ? "default" : "pointer",
                        background: o.selected ? "var(--cvb-well)" : "transparent",
                        opacity: o.disabled ? 0.55 : 1,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: o.dot }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: o.selected ? 700 : 500 }}>{o.label}</span>
                      {o.disabled && o.why ? (
                        <span style={{ fontSize: 9.5, color: "var(--cvb-faint)", textAlign: "right", maxWidth: 110, lineHeight: 1.3 }}>{o.why}</span>
                      ) : (
                        <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", flex: "none" }}>{o.count ?? "—"}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {shown.map((t) => {
          const tint = avTint(t.contactId);
          const lastMsg = t.messages[t.messages.length - 1];
          const ch = CH_CHIP[lastMsg?.channel ?? "email"] ?? CH_CHIP.email!;
          const name = [t.contact?.firstName, t.contact?.lastName].filter(Boolean).join(" ") || t.contact?.email || "A contact";
          const active = sel != null && keyOf(sel) === keyOf(t);
          return (
            <div
              key={keyOf(t)}
              onClick={() => setSelId(keyOf(t))}
              data-testid={`bold-inbox-thread-${t.contactId}`}
              style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px 12px", borderRadius: 16, cursor: "pointer", background: active ? "var(--cvb-hover)" : "transparent", marginBottom: 4 }}
            >
              <span style={{ width: 40, height: 40, borderRadius: "50%", flex: "none", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                {initials(t.contact)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: t.unread ? 800 : 600, fontSize: 13.5, letterSpacing: "-.018em", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                  <span style={{ width: 18, height: 18, borderRadius: 6, flex: "none", background: ch[1], border: `1px solid ${ch[2]}`, color: ch[3], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5 }}>{ch[0]}</span>
                </div>
                {/* Prototype row line 2: short wait time · the REAL last-message
                    snippet (owner ruling, B3a review — the snippet is never
                    crowded out). Campaign attribution gets its own line in
                    workspace scope (§4.5). */}
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {relTime(t.lastAt).replace(" ago", "")} · {t.preview}
                </div>
                {scope.kind === "workspace" && t.campaign ? (
                  <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-ghost)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.campaign.agentName}
                  </div>
                ) : null}
              </div>
              {t.unread ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cvb-forest)", flex: "none" }} /> : null}
            </div>
          );
        })}
        {shown.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 14px" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cvb-muted)" }}>Nothing on this filter</div>
            <div style={{ fontSize: 12, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 5 }}>Try another one.</div>
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------------ reading pane */}
      <div data-testid="bold-inbox-pane" style={{ flex: 1, minWidth: 280, padding: "26px 32px", display: "flex", flexDirection: "column" }}>
        {sel ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 22, borderBottom: "1px solid var(--cvb-line-2)", flexWrap: "wrap" }}>
              <span
                onClick={() => sel.contact && onOpenDrawer({ t: "person", contact: sel.contact })}
                style={{ width: 48, height: 48, borderRadius: "50%", flex: "none", background: avTint(sel.contactId).bg, color: avTint(sel.contactId).fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, cursor: "pointer" }}
              >
                {initials(sel.contact)}
              </span>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="cvb-display" style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.028em" }} data-testid="bold-inbox-sel-name">{selName}</div>
                  {scope.kind === "workspace" && sel.campaign ? (
                    <span
                      data-testid="bold-inbox-sel-camp"
                      style={{ fontSize: 9.5, fontWeight: 600, color: "var(--cvb-muted)", background: "var(--cvb-well)", border: "1px solid var(--cvb-line-2)", borderRadius: 999, padding: "2px 8px", flex: "none" }}
                    >
                      {sel.campaign.agentName}
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 3 }}>
                  {[sel.contact?.company, sel.contact?.email].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div style={{ position: "relative", flex: "none" }}>
                <span
                  onClick={() => sel.enrollmentId && setMoveOpen((v) => !v)}
                  data-testid="bold-inbox-move"
                  title={sel.enrollmentId ? undefined : "Not enrolled in this campaign"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12,
                    fontWeight: 700,
                    color: moveTone ? moveTone[0] : "var(--cvb-muted)",
                    background: moveTone ? moveTone[1] : "var(--cvb-well)",
                    border: `1px solid ${moveTone ? moveTone[2] : "var(--cvb-line-ctl)"}`,
                    borderRadius: 11,
                    padding: "10px 13px",
                    cursor: sel.enrollmentId ? "pointer" : "default",
                    opacity: sel.enrollmentId ? 1 : 0.55,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: moveTone ? moveTone[0] : "var(--cvb-faint)" }} />
                  {selStage?.label ?? sel.stage ?? "No stage"}
                  <span style={{ fontSize: 9, color: "var(--cvb-faint)" }}>⌄</span>
                </span>
                {moveOpen ? (
                  <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 5, width: 186, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: 5, zIndex: 5, boxShadow: "var(--cvb-shadow-card)" }}>
                    {stages.map((g) => {
                      const tone = stageTone(g.key);
                      const on = sel.stage === g.key;
                      return (
                        <div
                          key={g.key}
                          data-testid={`bold-inbox-move-${g.key}`}
                          onClick={() => void move(g.key, g.label)}
                          style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, cursor: "pointer", background: on ? "var(--cvb-well)" : "transparent" }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: tone[0] }} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: on ? 700 : 500 }}>{g.label}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div style={{ position: "relative", flex: "none" }}>
                <span
                  onClick={() => setListOpen((v) => !v)}
                  data-testid="bold-inbox-addlist"
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--cvb-muted)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 13px", cursor: "pointer" }}
                >
                  + List
                </span>
                {listOpen ? (
                  <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 5, width: 200, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: 5, zIndex: 5, boxShadow: "var(--cvb-shadow-card)" }}>
                    {lists.map((l) => (
                      <div key={l.id} onClick={() => void addToList(l)} style={{ padding: "9px 10px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}>
                        {l.name}
                        <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginLeft: 6 }}>{l.memberCount}</span>
                      </div>
                    ))}
                    {lists.length === 0 ? <div style={{ padding: "9px 10px", fontSize: 12, color: "var(--cvb-faint)" }}>No lists yet.</div> : null}
                  </div>
                ) : null}
              </div>
              <span
                onClick={() => sel.contact && onOpenDrawer({ t: "person", contact: sel.contact })}
                data-testid="bold-inbox-profile"
                style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-cyan)", cursor: "pointer", flex: "none" }}
              >
                Profile
              </span>
            </div>

            <div style={{ flex: 1, padding: "24px 0", display: "flex", flexDirection: "column", gap: 14 }}>
              {paneItems.map((it) => {
                if (it.ev) {
                  const row = calendarSystemRow(it.ev.type, (it.ev.payload ?? {}) as Record<string, unknown>)!;
                  const tone = systemTone(it.ev.type);
                  return (
                    <div key={it.key} style={{ alignSelf: "center", display: "flex", alignItems: "center", gap: 8, background: tone[1], border: `1px solid ${tone[2]}`, borderRadius: 999, padding: "6px 14px" }}>
                      <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".02em", color: tone[0] }}>{row.text}</span>
                    </div>
                  );
                }
                const m = it.msg!;
                const ours = m.direction === "OUTBOUND";
                const meta = [
                  relTime(m.sentAt),
                  m.channel,
                  ours && m.composed ? "✦ guided" : null,
                  !ours && m.intent ? intentTint(m.intent).label : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div key={it.key} style={{ alignSelf: ours ? "flex-end" : "flex-start", maxWidth: "78%" }}>
                    <div
                      style={{
                        background: ours ? "var(--cvb-forest)" : "var(--cvb-panel)",
                        border: `1px solid ${ours ? "var(--cvb-forest)" : "var(--cvb-line)"}`,
                        color: ours ? "var(--cvb-card)" : "var(--cvb-ink)",
                        borderRadius: ours ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                        padding: "14px 17px",
                        fontSize: 14,
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {m.body ?? ""}
                    </div>
                    <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 6, padding: "0 4px", textAlign: ours ? "right" : "left" }}>{meta}</div>
                  </div>
                );
              })}
            </div>

            {/* triage strip — the actions that exist; reply-send has no shipped
                path (send boundary) and Ada reply drafts have no engine, so
                neither renders as live UI (Q-070/Q-071). */}
            {sel.done ? (
              <div data-testid="bold-inbox-donebar" style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 18, padding: "16px 18px" }}>
                <span style={{ color: "var(--cvb-forest)", fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--cvb-forest)", flex: 1 }}>Handled.</span>
                <span onClick={() => void toggleDone()} data-testid="bold-inbox-done" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-cyan)", cursor: "pointer" }}>
                  Reopen
                </span>
              </div>
            ) : (
              <div data-testid="bold-inbox-donebar" style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 18, padding: "14px 18px", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, color: "var(--cvb-faint)", flex: 1, minWidth: 160, lineHeight: 1.5 }}>
                  Replies aren’t sendable from the console yet — for now this inbox is read and triage.
                </span>
                <span
                  onClick={() => void toggleDone()}
                  data-testid="bold-inbox-done"
                  style={{ fontSize: 12.5, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 11, padding: "10px 16px", cursor: "pointer", flex: "none" }}
                >
                  ✓ Mark handled
                </span>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cvb-muted)" }}>No conversations yet</div>
            <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 6 }}>
              Replies land here as contacts answer.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
