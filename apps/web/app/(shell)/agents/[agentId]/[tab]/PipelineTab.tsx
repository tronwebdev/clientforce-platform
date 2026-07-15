"use client";

/**
 * P5 W3 (DEC-085): the Pipeline tab — a stage-column board over the EXISTING
 * `PipelineStage` data (owner-directed via Q-024; a DESIGNED ADDITION, §0-
 * flagged: no prototype models a board, so the anatomy is §0 atoms — white
 * column cards on the warm canvas, hairline borders, status-pill idiom).
 * Drag a card between stage columns → the standard manual move
 * (`PATCH /enrollments/:id`) → `lead.stage_changed.v1` on the BUS, so the
 * campaign rules listening to it (e.g. meeting_booked) fire for human moves.
 * Native HTML5 drag — no new dependency. Honest states: per-column empties
 * render light (a column with no leads is normal), the whole-board empty is
 * the designed EmptyState, and the out-of-set "Other stages" overflow column
 * is read-only (its keys aren't stages — dropping there would invent one).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@clientforce/ui";
import {
  buildBoard,
  contactName,
  OVERFLOW_KEY,
  type BoardColumn,
  type BoardEnrollment,
  type StageRow,
} from "../../../../../lib/pipeline";
import { cf } from "./shared";

const HANKEN = "'Hanken Grotesk',sans-serif";
const BRICO = "'Bricolage Grotesque',sans-serif";

export function PipelineTab({ agentId, onChanged }: { agentId: string; onChanged?: () => void | Promise<void> }) {
  const [stages, setStages] = useState<StageRow[] | null>(null);
  const [enrollments, setEnrollments] = useState<BoardEnrollment[] | null>(null);
  const [error, setError] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const dragging = useRef(false);

  const refresh = useCallback(async () => {
    if (dragging.current) return; // don't reshuffle mid-drag
    try {
      const [st, en] = await Promise.all([
        cf("pipeline-stages") as Promise<StageRow[]>,
        cf(`enrollments?agentId=${agentId}`) as Promise<BoardEnrollment[]>,
      ]);
      setStages(st);
      setEnrollments(en);
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

  async function drop(col: BoardColumn) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    dragging.current = false;
    if (!id || col.overflow) return;
    const current = enrollments?.find((e) => e.id === id);
    if (!current || current.pipelineStage === col.key) return;
    // optimistic move; the poll + onChanged reconcile
    setEnrollments((prev) => prev?.map((e) => (e.id === id ? { ...e, pipelineStage: col.key } : e)) ?? null);
    try {
      await cf(`enrollments/${id}`, { method: "PATCH", body: JSON.stringify({ pipelineStage: col.key }) });
      await onChanged?.();
    } catch {
      setEnrollments((prev) => prev?.map((e) => (e.id === id ? { ...e, pipelineStage: current.pipelineStage } : e)) ?? null);
    }
  }

  if (error) {
    return (
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: "48px 20px", textAlign: "center" }} data-testid="pipeline-error">
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 4 }}>Couldn&apos;t load the pipeline</div>
        <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 14 }}>Something went wrong talking to the API — your data is safe.</div>
        <button type="button" onClick={() => void refresh()} style={{ background: "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", fontFamily: HANKEN }}>Retry</button>
      </div>
    );
  }
  if (stages === null || enrollments === null) {
    return (
      <div style={{ display: "flex", gap: 12 }} data-testid="pipeline-skeleton">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: 12, minHeight: 220 }}>
            <div style={{ height: 12, width: "55%", background: "#F2EEE4", borderRadius: 6, marginBottom: 12 }} />
            <div style={{ height: 54, background: "#F7F2EA", borderRadius: 10, marginBottom: 8 }} />
            <div style={{ height: 54, background: "#F7F2EA", borderRadius: 10 }} />
          </div>
        ))}
      </div>
    );
  }
  if (enrollments.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16 }} data-testid="pipeline-empty">
        <EmptyState
          kind="empty"
          title="No leads in the pipeline yet"
          body="Enroll contacts and every lead lands here — drag a card between stages to move it; automations that listen to stage changes fire on the move."
        />
      </div>
    );
  }

  const board = buildBoard(stages, enrollments);
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto", paddingBottom: 6 }} data-testid="pipeline-board">
      {board.map((col) => (
        <div
          key={col.key}
          onDragOver={(e) => {
            if (col.overflow) return;
            e.preventDefault();
            setOverCol(col.key);
          }}
          onDragLeave={() => setOverCol((v) => (v === col.key ? null : v))}
          onDrop={() => void drop(col)}
          style={{
            flex: "1 0 168px",
            minWidth: 168,
            background: "#fff",
            border: `1px ${col.overflow ? "dashed" : "solid"} ${overCol === col.key && dragId ? "#16A82A" : "#EBE3D6"}`,
            borderRadius: 14,
            boxShadow: "0 4px 16px rgba(14,21,18,.04)",
            display: "flex",
            flexDirection: "column",
            maxHeight: 664,
          }}
          data-testid={`pipeline-col-${col.key}`}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px", borderBottom: "1px solid #F2EEE4" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "#5C6B62", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={col.overflow ? "Stages outside the workspace set — moves land via automations or the API" : undefined}>
              {col.label}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "1px 8px" }}>{col.cards.length}</span>
          </div>
          <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
            {col.cards.length === 0 ? (
              <div style={{ fontSize: 12, color: "#B7BDB6", textAlign: "center", padding: "18px 6px", border: "1px dashed #F2EEE4", borderRadius: 10 }} data-testid="pipeline-col-empty">
                No leads here
              </div>
            ) : (
              col.cards.map((e) => (
                <div
                  key={e.id}
                  draggable
                  onDragStart={() => {
                    setDragId(e.id);
                    dragging.current = true;
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                    dragging.current = false;
                  }}
                  style={{
                    background: "#FBF7F0",
                    border: "1px solid #EBE3D6",
                    borderRadius: 10,
                    padding: "9px 11px",
                    cursor: "grab",
                    opacity: dragId === e.id ? 0.45 : 1,
                  }}
                  data-testid="pipeline-card"
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", fontFamily: BRICO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contactName(e.contact)}</div>
                  <div style={{ fontSize: 11.5, color: "#8A7F6B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.contact.company ?? e.contact.email ?? "—"}</div>
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: e.status === "ACTIVE" ? "#0F7A28" : "#8A7F6B", background: e.status === "ACTIVE" ? "#D7F5DD" : "#F2EEE4", borderRadius: 100, padding: "1px 7px" }}>{e.status.toLowerCase()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export { OVERFLOW_KEY };
