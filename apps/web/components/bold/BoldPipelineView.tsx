"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentListItem } from "@clientforce/core";
import { goalValueMeta } from "@clientforce/core";
import { buildBoard, type BoardColumn, type BoardEnrollment } from "../../lib/pipeline";
import type { BoldDrawerState } from "./BoldDrawer";
import {
  avTint,
  fetchBoldInbox,
  fetchEnrollments,
  fetchPipelineStages,
  initials,
  money,
  moveEnrollmentStage,
  relTime,
  type BoldEnrollmentRow,
  type PipelineStageRow,
} from "./bold-live";

/**
 * Pipeline tab (B2, prototype `vPipeline`) — board + list over the SHIPPED
 * reads: `GET /pipeline-stages` (the workspace's real stage set — the
 * prototype's four sample columns are its fixture, the stage vocabulary is
 * data) + `GET /enrollments?agentId=` + the inbox threads for per-contact
 * channel/last-touch truth. Stage moves ride `PATCH /enrollments/:id`
 * (optimistic, rolled back on failure) so `lead.stage_changed.v1` publishes
 * on the bus and rules fire for human moves too (DEC-085). Columns group via
 * the pinned `buildBoard` — the overflow column is never a drop target.
 *
 * Value honesty (DEC-105): the agent-level estimate is the ONLY value data
 * (no per-deal amounts exist). Cards/rows at the goal stage or beyond show
 * the estimate; the goal-stage column line reuses the B1 POTENTIAL vocabulary
 * (count × est); earlier columns say "no value yet" (the prototype's own
 * honest literal). Nothing claims "realized" — payment truth is a later wave.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

/** Stage-key tones [ink, tint bg, tint line, bar] — keyed on the seeded
 *  workspace defaults, grey fallback for free-text stages. */
const STAGE_TONES: Record<string, [string, string, string, string]> = {
  new: ["var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)", "var(--cvb-line-strong)"],
  contacted: ["var(--cvb-ink)", "var(--cvb-well)", "var(--cvb-line-ctl)", "var(--cvb-line-strong)"],
  engaged: ["var(--cvb-slate)", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate-line)"],
  interested: ["var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan-line)"],
  booked: ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-mint-line)"],
  won: ["#0e5c2b", "#e4f3e9", "#c3e2cf", "#c3e2cf"],
  lost: ["var(--cvb-danger)", "var(--cvb-danger-bg)", "#f0d5ce", "#f0d5ce"],
};
const FALLBACK_TONE: [string, string, string, string] = [
  "var(--cvb-muted)",
  "var(--cvb-well)",
  "var(--cvb-line-ctl)",
  "var(--cvb-line-strong)",
];
export function stageTone(key: string): [string, string, string, string] {
  return STAGE_TONES[key] ?? FALLBACK_TONE;
}

const CH_CHIP: Record<string, [string, string, string, string]> = {
  email: ["✉", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  sms: ["✆", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  voice: ["☎", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"],
};

/** The goal-terminal stage KEY — same hardcoded key the shipped bookings
 *  derivation counts (`pipelineStage === "booked"`, agents list read). */
const GOAL_STAGE_KEY = "booked";

const BOARD_CARD_CAP = 4;

export function BoldPipelineView({
  agent,
  onOpenDrawer,
  flash,
}: {
  agent: AgentListItem;
  onOpenDrawer: (d: BoldDrawerState) => void;
  flash: (msg: string) => void;
}) {
  const [stages, setStages] = useState<PipelineStageRow[] | null>(null);
  const [rows, setRows] = useState<BoldEnrollmentRow[] | null>(null);
  const [lastTouch, setLastTouch] = useState<Record<string, string>>({});
  const [channelOf, setChannelOf] = useState<Record<string, string>>({});
  const [view, setView] = useState<"board" | "list">("board");
  const [stageF, setStageF] = useState<string>("all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const dragging = useRef(false);
  const movesInFlight = useRef(0);
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    // Never reshuffle mid-drag or while a move PATCH is in flight (legacy rule).
    if (dragging.current || movesInFlight.current > 0) return;
    const seq = ++refreshSeq.current;
    const [st, en, inbox] = await Promise.all([
      fetchPipelineStages(),
      fetchEnrollments(agent.id),
      fetchBoldInbox(agent.id),
    ]);
    // The guard must hold at APPLY time too — an in-flight response landing
    // after a drag started (or superseded by a newer refresh) is stale.
    if (seq !== refreshSeq.current || dragging.current || movesInFlight.current > 0) return;
    if (st) setStages(st);
    if (en) setRows(en);
    if (inbox) {
      // Per-contact truth for the card meta: last-touch = the thread's real
      // lastAt (enrollment.updatedAt moves on any stage write — not a touch),
      // channel = the thread's latest message channel.
      const touch: Record<string, string> = {};
      const ch: Record<string, string> = {};
      for (const t of inbox.threads) {
        touch[t.contactId] = t.lastAt;
        const lastMsg = t.messages[t.messages.length - 1];
        if (lastMsg) ch[t.contactId] = lastMsg.channel;
      }
      setLastTouch(touch);
      setChannelOf(ch);
    }
  }, [agent.id]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const meta = goalValueMeta(agent.goal);
  const est = meta.monetary && agent.valueEstCents != null && agent.valueEstCents > 0 ? agent.valueEstCents : null;
  const goalOrder = useMemo(
    () => stages?.find((s) => s.key === GOAL_STAGE_KEY)?.order ?? null,
    [stages],
  );
  const stageOrder = useMemo(
    () => new Map((stages ?? []).map((s) => [s.key, s.order])),
    [stages],
  );
  /** Value truth per row: the estimate, only at/beyond the goal stage. */
  const valueOf = useCallback(
    (stageKey: string): number | null => {
      if (est == null || goalOrder == null) return null;
      const ord = stageOrder.get(stageKey);
      if (ord == null || ord < goalOrder) return null;
      if (stageKey === "lost") return null;
      return est;
    },
    [est, goalOrder, stageOrder],
  );

  const board: BoardColumn[] = useMemo(() => {
    if (!stages || !rows) return [];
    const withContact = rows.filter((r): r is BoldEnrollmentRow & { contact: NonNullable<BoldEnrollmentRow["contact"]> } => r.contact != null);
    return buildBoard(stages, withContact as BoardEnrollment[]);
  }, [stages, rows]);

  const total = rows?.length ?? 0;

  async function drop(col: BoardColumn) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    dragging.current = false;
    if (!id || col.overflow) return;
    const current = rows?.find((r) => r.id === id);
    if (!current || current.pipelineStage === col.key) return;
    const before = current.pipelineStage;
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, pipelineStage: col.key } : r)) ?? null);
    movesInFlight.current += 1;
    let res;
    try {
      res = await moveEnrollmentStage(id, col.key);
    } finally {
      movesInFlight.current -= 1;
    }
    if (!res.ok) {
      // Roll back only if the row still holds THIS move's optimistic value —
      // a newer move of the same card must not be clobbered.
      setRows(
        (prev) =>
          prev?.map((r) => (r.id === id && r.pipelineStage === col.key ? { ...r, pipelineStage: before } : r)) ?? null,
      );
      flash(res.error);
      return;
    }
    void refresh();
  }

  const openPerson = (c: BoardEnrollment["contact"]) =>
    onOpenDrawer({ t: "person", contact: { id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email } });

  if (!stages || !rows) {
    return (
      <div style={{ padding: "26px 40px 40px" }} data-testid="bold-pipeline">
        <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>LOADING PIPELINE</div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div style={{ padding: "26px 40px 40px", textAlign: "center" }} data-testid="bold-pipeline">
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cvb-muted)", paddingTop: 40 }}>No contacts enrolled yet</div>
        <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 6 }}>
          The board fills as contacts enter this campaign.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "26px 40px 40px" }} data-testid="bold-pipeline">
      {/* view toggle + stage filter pills */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "var(--cvb-well)", borderRadius: 12, padding: 4 }}>
          {(["board", "list"] as const).map((v) => (
            <span
              key={v}
              onClick={() => setView(v)}
              data-testid={`bold-pipe-view-${v}`}
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                padding: "8px 14px",
                borderRadius: 9,
                cursor: "pointer",
                background: view === v ? "var(--cvb-card)" : "transparent",
                color: view === v ? "var(--cvb-ink)" : "var(--cvb-faint)",
              }}
            >
              {v === "board" ? "Board" : "List"}
            </span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {/* Prototype composition: dot + label pills, no counts (the column
            heads carry those); a selected pill toggles back off. */}
        {stages.map((s) => {
          const tone = stageTone(s.key);
          const on = stageF === s.key;
          return (
            <span
              key={s.key}
              onClick={() => setStageF(on ? "all" : s.key)}
              data-testid={`bold-pipe-stage-${s.key}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                fontWeight: 600,
                color: on ? tone[0] : "var(--cvb-faint)",
                background: on ? tone[1] : "var(--cvb-panel)",
                border: `1px solid ${on ? tone[2] : "var(--cvb-line-ctl)"}`,
                borderRadius: 999,
                padding: "6px 11px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone[0] }} />
              {s.label}
            </span>
          );
        })}
      </div>

      {view === "list" ? (
        <ListView
          board={board}
          stageF={stageF}
          est={est}
          valueOf={valueOf}
          lastTouch={lastTouch}
          onOpenPerson={openPerson}
        />
      ) : (
        <div style={{ overflowX: "auto" }} data-testid="bold-pipe-board">
          {/* 126px min fits the 7 seeded stages inside the 1440 canvas with no
              scroll; narrower viewports (or more stages) scroll horizontally. */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${board.length}, minmax(126px, 1fr))`, gap: 12, minWidth: board.length * 138 }}>
            {board.map((col) => {
              const tone = col.overflow ? FALLBACK_TONE : stageTone(col.key);
              const dimmed = stageF !== "all" && col.key !== stageF;
              const val = valueOf(col.key);
              const colValue = col.overflow
                ? null
                : col.key === GOAL_STAGE_KEY && est != null && col.cards.length > 0
                  ? `${money(est * col.cards.length)} potential`
                  : val != null && col.cards.length > 0
                    ? `${money(est! * col.cards.length)} at your estimate`
                    : est != null
                      ? "no value yet"
                      : null;
              const shown = col.cards.slice(0, BOARD_CARD_CAP);
              const more = col.cards.length - shown.length;
              return (
                <div
                  key={col.key}
                  data-testid={`bold-pipe-col-${col.key}`}
                  onDragOver={(e) => {
                    if (col.overflow) return; // free-text stages are real; dropping here would invent one
                    e.preventDefault();
                    setOverCol(col.key);
                  }}
                  onDragLeave={() => setOverCol((v) => (v === col.key ? null : v))}
                  onDrop={() => void drop(col)}
                  style={{
                    opacity: dimmed ? 0.38 : 1,
                    borderRadius: 14,
                    outline: overCol === col.key ? "2px dashed var(--cvb-mint-line)" : "none",
                    outlineOffset: 4,
                    transition: "opacity .18s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 7, padding: "0 3px 6px" }}>
                    <span className="cvb-display" style={{ fontWeight: 900, fontSize: 24, letterSpacing: "-.032em", lineHeight: 1, color: tone[0] }}>
                      {col.cards.length}
                    </span>
                    <span style={{ ...mono, fontSize: 9, letterSpacing: ".12em", color: "var(--cvb-faint)", paddingBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {col.label.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ ...mono, fontSize: 10, color: colValue?.endsWith("potential") ? "var(--cvb-forest)" : "var(--cvb-faint)", padding: "0 3px 12px", minHeight: 25 }}>
                    {colValue ?? " "}
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: tone[3], margin: "0 3px 14px" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {shown.map((card) => {
                      const tint = avTint(card.contact.id);
                      const ch = CH_CHIP[channelOf[card.contact.id] ?? ""] ?? null;
                      const cardVal = valueOf(card.pipelineStage);
                      const touch = lastTouch[card.contact.id];
                      return (
                        <div
                          key={card.id}
                          draggable
                          onDragStart={() => {
                            setDragId(card.id);
                            dragging.current = true;
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverCol(null);
                            dragging.current = false;
                          }}
                          onClick={() => openPerson(card.contact)}
                          data-testid="bold-pipe-card"
                          style={{
                            background: "var(--cvb-panel)",
                            border: "1px solid var(--cvb-line)",
                            borderRadius: 16,
                            padding: 13,
                            cursor: "grab",
                            opacity: dragId === card.id ? 0.45 : 1,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                            <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                              {initials(card.contact)}
                            </span>
                            {ch ? (
                              <span style={{ width: 20, height: 20, borderRadius: 7, flex: "none", background: ch[1], border: `1px solid ${ch[2]}`, color: ch[3], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, marginLeft: "auto" }}>
                                {ch[0]}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: "-.018em", marginTop: 10 }}>
                            {[card.contact.firstName, card.contact.lastName].filter(Boolean).join(" ") || card.contact.email || "A contact"}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 3, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {card.contact.company || card.contact.email || "—"}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
                            {cardVal != null ? <span style={{ ...mono, fontSize: 10, color: "var(--cvb-forest)" }}>{money(cardVal)}</span> : null}
                            <span style={{ flex: 1 }} />
                            <span style={{ ...mono, fontSize: 9, color: "var(--cvb-faint)" }}>{touch ? relTime(touch) : "—"}</span>
                          </div>
                        </div>
                      );
                    })}
                    {more > 0 ? (
                      <span
                        onClick={() => {
                          setView("list");
                          if (!col.overflow) setStageF(col.key);
                        }}
                        style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: "var(--cvb-cyan)", padding: 12, border: "1px dashed var(--cvb-line-hover)", borderRadius: 16, cursor: "pointer" }}
                      >
                        {more} more
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ListView({
  board,
  stageF,
  est,
  valueOf,
  lastTouch,
  onOpenPerson,
}: {
  board: BoardColumn[];
  stageF: string;
  est: number | null;
  valueOf: (stageKey: string) => number | null;
  lastTouch: Record<string, string>;
  onOpenPerson: (c: BoardEnrollment["contact"]) => void;
}) {
  const labelOf = new Map(board.map((c) => [c.key, c.label]));
  const rows = board
    .flatMap((c) => c.cards)
    .filter((r) => stageF === "all" || r.pipelineStage === stageF)
    .sort((a, b) => String(lastTouch[b.contact.id] ?? b.updatedAt ?? "").localeCompare(String(lastTouch[a.contact.id] ?? a.updatedAt ?? "")));
  return (
    <div data-testid="bold-pipe-list">
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px 10px", borderBottom: "1px solid var(--cvb-line-inner)" }}>
        <span style={{ width: 38, flex: "none" }} />
        <span style={{ flex: 1, minWidth: 0, ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>CONTACT</span>
        <span style={{ width: 96, flex: "none", ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>STAGE</span>
        <span style={{ width: 62, flex: "none", ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)", textAlign: "right" }}>VALUE</span>
        <span style={{ width: 66, flex: "none", ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)", textAlign: "right" }}>LAST</span>
      </div>
      {rows.map((r) => {
        const tone = stageTone(r.pipelineStage);
        const tint = avTint(r.contact.id);
        const val = valueOf(r.pipelineStage);
        const touch = lastTouch[r.contact.id];
        return (
          <div
            key={r.id}
            onClick={() => onOpenPerson(r.contact)}
            data-testid="bold-pipe-row"
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 8px", borderBottom: "1px solid var(--cvb-line-2)", cursor: "pointer" }}
          >
            <span style={{ width: 38, height: 38, borderRadius: "50%", flex: "none", background: tint.bg, color: tint.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
              {initials(r.contact)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-.018em" }}>
                {[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.email || "A contact"}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[r.contact.company, r.contact.email].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <span style={{ width: 96, flex: "none" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: tone[0], background: tone[1], border: `1px solid ${tone[2]}`, borderRadius: 999, padding: "3px 9px" }}>
                {labelOf.get(r.pipelineStage) ?? r.pipelineStage}
              </span>
            </span>
            <span style={{ width: 62, flex: "none", ...mono, fontSize: 11, color: val != null ? "var(--cvb-forest)" : "var(--cvb-ghost)", textAlign: "right" }}>
              {val != null ? money(val) : est != null ? "—" : ""}
            </span>
            <span style={{ width: 66, flex: "none", ...mono, fontSize: 10, color: "var(--cvb-faint)", textAlign: "right" }}>
              {touch ? relTime(touch) : "—"}
            </span>
          </div>
        );
      })}
      {rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 14px" }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cvb-muted)" }}>Nothing in this stage</div>
          <div style={{ fontSize: 12, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 5 }}>Try another filter.</div>
        </div>
      ) : null}
    </div>
  );
}
