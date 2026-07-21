"use client";

/**
 * Automation detail drawer (R1-UI W1, DEC-088) — the canon 480px right
 * drawer: trigger block · Only-if list · action cards · Recent runs
 * (LEDGER-sourced: `automation.rule.run.v1` Event rows via
 * GET /automations/:id/runs — what fired, when, on whom, outcome; raw rows,
 * verbatim statuses, no invented aggregate) · Delete / Close / Edit.
 * A delete refused by the API (live `run_automation` referrers → 422)
 * renders its `detail` VERBATIM in the inline error strip — loud, never a
 * stuck busy state (the #88/#94 error-handling precedent).
 */
import { useCallback, useEffect, useState } from "react";
import type { AutomationListRow, AutomationRunRow } from "../../../lib/types";
import { CfError } from "../../../components/sequence/shared";
import { TRIGGER_ICONS, triggerChip } from "../../../lib/triggers";
import { actionChip, ACTION_ICONS } from "../../../lib/actions";
import { cf, conditionText, relTime, statusOf } from "./AutomationsView";

const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

const SECTION: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
const CONNECTOR = (
  <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
    <span style={{ width: 2, height: 16, background: "#D8CFBE" }} />
  </div>
);

/** Run-row treatment per status — fired green ✓; everything else renders its
 *  typed status honestly (skipped_conflict · refused_depth · error). */
const RUN_STYLE: Record<string, { icon: string; bg: string; fg: string }> = {
  fired: { icon: "✓", bg: "rgba(53,232,52,.14)", fg: "#16A82A" },
  skipped_conflict: { icon: "⏭", bg: "#F2EEE4", fg: "#8A7F6B" },
  refused_depth: { icon: "↯", bg: "rgba(232,196,91,.2)", fg: "#A87B16" },
  error: { icon: "!", bg: "rgba(224,121,107,.14)", fg: "#C9543F" },
};

function runText(run: AutomationRunRow): string {
  const who = run.contactLabel ? ` for ${run.contactLabel}` : "";
  switch (run.status) {
    case "fired":
      return `Ran${who}`;
    case "skipped_conflict":
      return `Skipped${who} — an earlier rule already handled it`;
    case "refused_depth":
      return `Refused${who} — automation chain too deep`;
    case "error":
      return `Failed${who}${run.detail ? ` — ${run.detail}` : ""}`;
    default:
      // Verbatim fallback (the C2.9 rule): an unknown status renders itself.
      return `${run.status}${who}`;
  }
}

export function AutomationDrawer({
  row,
  automationNames,
  canManage,
  onClose,
  onToggle,
  onDeleted,
  flash,
}: {
  row: AutomationListRow;
  automationNames: Record<string, string>;
  canManage: boolean;
  onClose: () => void;
  onToggle: () => void;
  onDeleted: () => void;
  flash: (text: string, error?: boolean) => void;
}) {
  const [runs, setRuns] = useState<AutomationRunRow[] | null>(null);
  const [runsError, setRunsError] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchRuns = useCallback(async () => {
    try {
      setRuns((await cf(`automations/${row.id}/runs`)) as AutomationRunRow[]);
      setRunsError(false);
    } catch {
      setRunsError(true);
    }
  }, [row.id]);

  // Poll while open (the Contacts timeline precedent) — runs land async.
  useEffect(() => {
    void fetchRuns();
    const t = setInterval(() => void fetchRuns(), 5000);
    return () => clearInterval(t);
  }, [fetchRuns]);

  const remove = useCallback(async () => {
    if (busy || !canManage) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await cf(`automations/${row.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof CfError && err.detail ? err.detail : "Couldn't delete — try again");
    } finally {
      setBusy(false);
    }
  }, [busy, canManage, onDeleted, row.id]);

  const st = statusOf(row);
  const on = st === "Active";
  const icon = row.trigger ? TRIGGER_ICONS[row.trigger.kind] : "⚠";

  return (
    <div data-testid="automation-drawer" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.4)", zIndex: 40 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "100%", background: "#FBF7F0", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column", fontFamily: "'Hanken Grotesk',sans-serif" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 13, padding: "20px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6", flex: "none" }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, flex: "none", background: row.invalid ? "rgba(224,121,107,.14)" : "rgba(54,215,237,.16)", color: row.invalid ? "#C9543F" : "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: "#0E1512" }}>{row.name}</div>
            <div style={{ fontSize: 12.5, color: "#9AA59E" }}>
              {row.runs} run{row.runs === 1 ? "" : "s"} · last {relTime(row.lastRunAt)}
            </div>
          </div>
          <span
            data-testid="drawer-toggle"
            onClick={onToggle}
            style={{ width: 42, height: 24, borderRadius: 100, background: on ? GRAD : "#E4EAE6", position: "relative", display: "inline-block", flex: "none", cursor: row.invalid || !canManage ? "not-allowed" : "pointer", marginTop: 4, opacity: row.invalid ? 0.4 : 1 }}
          >
            <span style={{ position: "absolute", top: 3, [on ? "right" : "left"]: 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
          </span>
          <span onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", flex: "none" }}>✕</span>
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "20px 22px" }}>
          <div style={{ ...SECTION, color: "#1192A6" }}>When this happens</div>
          {row.trigger ? (
            <div style={{ background: "#fff", border: "1px solid rgba(54,215,237,.4)", borderRadius: 13, padding: "14px 16px", display: "flex", alignItems: "center", gap: 11 }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, flex: "none", background: "rgba(54,215,237,.16)", color: "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{icon}</span>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: "#0E1512" }}>{triggerChip(row.trigger)}</span>
            </div>
          ) : (
            <div style={{ background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 13, padding: "14px 16px", fontSize: 13.5, color: "#C9543F" }}>
              This rule's trigger couldn't be read — it never fires. Delete it or recreate it.
            </div>
          )}

          {row.conditions.length > 0 && (
            <>
              {CONNECTOR}
              <div style={{ ...SECTION, color: "#8A7F6B" }}>Only if</div>
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden" }}>
                {row.conditions.map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderTop: i === 0 ? "none" : "1px solid #F2EEE4" }}>
                    <span style={{ color: "#8A7F6B", fontSize: 13 }}>◆</span>
                    <span style={{ fontSize: 13.5, color: "#3B463F" }}>{conditionText(c)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {CONNECTOR}
          <div style={{ ...SECTION, color: "#16A82A" }}>Then do this</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
            {row.actions.map((a, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid rgba(53,232,52,.35)", borderRadius: 13, padding: "14px 16px", display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, flex: "none", background: "rgba(53,232,52,.14)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{ACTION_ICONS[a.kind]}</span>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: "#0E1512", flex: 1 }}>{actionChip(a, automationNames)}</span>
              </div>
            ))}
            {row.actions.length === 0 && (
              <div style={{ background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 13, padding: "12px 16px", fontSize: 13.5, color: "#C9543F" }}>
                This rule's actions couldn't be read — it never fires.
              </div>
            )}
            {/* W1: editing lands with the W2 builder — inert per honest absence. */}
            <div aria-disabled="true" title="The builder lands in W2 of this PR" style={{ border: "1.5px dashed #9FD8AC", borderRadius: 13, padding: 12, textAlign: "center", fontSize: 13.5, fontWeight: 600, color: "#16A82A", cursor: "not-allowed", opacity: 0.55 }}>
              + Add an action
            </div>
          </div>

          <div style={{ ...SECTION, color: "#8A7F6B", margin: "18px 0 10px" }}>Recent runs</div>
          {runsError && (
            <div style={{ fontSize: 13, color: "#C9543F", padding: "9px 0" }}>Couldn't load run history — retrying.</div>
          )}
          {runs !== null && runs.length === 0 && !runsError && (
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: "1px solid #F2EEE4" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, flex: "none", background: "#F2EEE4", color: "#9AA59E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>○</span>
              <span style={{ fontSize: 13, color: "#0E1512", flex: 1 }}>
                {row.enabled ? "No runs yet — fires when its trigger next happens" : "No runs yet — enable to start"}
              </span>
              <span style={{ fontSize: 12, color: "#9AA59E", flex: "none" }}>—</span>
            </div>
          )}
          {(runs ?? []).map((run) => {
            const s = RUN_STYLE[run.status] ?? { icon: "•", bg: "#F2EEE4", fg: "#5C6B62" };
            return (
              <div key={run.id} data-testid="run-row" style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: "1px solid #F2EEE4" }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, flex: "none", background: s.bg, color: s.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{s.icon}</span>
                <span style={{ fontSize: 13, color: "#0E1512", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{runText(run)}</span>
                <span style={{ fontSize: 12, color: "#9AA59E", flex: "none" }}>{relTime(run.occurredAt)}</span>
              </div>
            );
          })}
        </div>

        {deleteError && (
          <div data-testid="delete-error" style={{ margin: "0 22px 10px", background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#C9543F" }}>
            {deleteError}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
          <span
            data-testid="drawer-delete"
            onClick={() => void remove()}
            style={{ fontSize: 14, fontWeight: 600, color: "#C9543F", background: "#fff", border: "1px solid #F0CFC8", borderRadius: 11, padding: "10px 18px", cursor: canManage && !busy ? "pointer" : "not-allowed", opacity: canManage ? 1 : 0.5 }}
          >
            {busy ? "Deleting…" : "Delete"}
          </span>
          <span onClick={onClose} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Close</span>
          <span aria-disabled="true" title="The builder lands in W2 of this PR" style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 20px", cursor: "not-allowed", opacity: 0.6, boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}>
            ✎ Edit automation
          </span>
        </div>
      </div>
    </div>
  );
}
