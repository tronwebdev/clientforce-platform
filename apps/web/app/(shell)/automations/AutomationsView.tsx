"use client";

/**
 * Automations list (R1-UI W1, DEC-088) — ported from `Automations.dc.html`:
 * segment tabs (All · Active · Paused — the canon Drafts tab is OMITTED, no
 * draft state exists in the rule model, Q-logged), When→Then summary cards
 * (trigger chip · condition chip · action chips · runs · status pill ·
 * enable toggle), honest empty state, 480px detail drawer.
 *
 * The cards RENDER the engine's typed vocabulary via the display maps
 * (`lib/triggers.ts` · `lib/actions.ts`) — never a parallel enum. A row whose
 * stored Json fails the core unions renders the HONEST error state (the B6
 * live-resolution stance; the engine skips it loudly too) — designed
 * addition, flagged: the prototype models no error state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutomationListRow, Role } from "../../../lib/types";
import { CfError } from "../../../components/sequence/shared";
import { triggerChip, TRIGGER_ICONS, triggerLabel } from "../../../lib/triggers";
import { actionChip, ACTION_ICONS } from "../../../lib/actions";
import { AutomationDrawer } from "./AutomationDrawer";

const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

export const cf = (path: string, init?: RequestInit) =>
  fetch(`/api/cf/${path}`, { headers: { "Content-Type": "application/json" }, ...init }).then(
    async (r) => {
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { detail?: unknown; message?: unknown } | null;
        const detail =
          typeof body?.detail === "string" ? body.detail : typeof body?.message === "string" ? body.message : null;
        throw new CfError(path, r.status, detail);
      }
      return r.json();
    },
  );

/** Relative time for "runs · 2m ago" and drawer rows (deterministic, coarse). */
export function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Card/drawer status treatment — Active/Paused per canon; Error = the
 *  honest invalid-row state (designed addition, no prototype anchor). */
export function statusOf(r: AutomationListRow): "Active" | "Paused" | "Error" {
  if (r.invalid) return "Error";
  return r.enabled ? "Active" : "Paused";
}
const STATUS_STYLE: Record<string, { sbg: string; sfg: string }> = {
  Active: { sbg: "#D7F5DD", sfg: "#0F7A28" },
  Paused: { sbg: "#F2EEE4", sfg: "#8A7F6B" },
  Error: { sbg: "rgba(224,121,107,.14)", sfg: "#C9543F" },
};

/** Canon saveBuilder desc derivation — no desc column exists; deterministic. */
export function deriveDesc(r: AutomationListRow): string {
  if (r.invalid || !r.trigger) return "This rule couldn't be read — delete it or recreate it.";
  const n = r.actions.length;
  return `${n} action${n === 1 ? "" : "s"} when ${triggerLabel(r.trigger.kind).toLowerCase()}`;
}

/** Condition chip/drawer text — the ONE engine condition kind. */
export function conditionText(c: { kind: "keyword_contains"; keywords: string[] }): string {
  return `Reply contains ${c.keywords.map((k) => `“${k}”`).join(" or ")}`;
}

const SEGS = ["All", "Active", "Paused"] as const;
type Seg = (typeof SEGS)[number];

export function AutomationsView({ role }: { role: Role }) {
  const [rows, setRows] = useState<AutomationListRow[] | null>(null);
  const [seg, setSeg] = useState<Seg>("All");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const toastToken = useRef(0);
  const canManage = role === "OWNER" || role === "ADMIN";

  const flash = useCallback((text: string, error = false) => {
    const tok = ++toastToken.current;
    setToast({ text, error });
    setTimeout(() => {
      if (toastToken.current === tok) setToast(null);
    }, 2600);
  }, []);

  const refetch = useCallback(async () => {
    try {
      const data = (await cf("automations")) as AutomationListRow[];
      setRows(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setRows((prev) => prev ?? []);
    }
  }, []);

  // A4: 5s polling — run counts move as the worker fires rules.
  useEffect(() => {
    void refetch();
    const t = setInterval(() => void refetch(), 5000);
    return () => clearInterval(t);
  }, [refetch]);

  const toggle = useCallback(
    async (row: AutomationListRow) => {
      if (row.invalid || !canManage) return;
      const next = !row.enabled;
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, enabled: next } : r)) ?? prev);
      try {
        await cf(`automations/${row.id}`, { method: "PATCH", body: JSON.stringify({ enabled: next }) });
        flash(next ? "Automation enabled" : "Automation paused");
      } catch (err) {
        // Optimistic-until-confirmed (the G-fidelity pattern): revert loudly.
        setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, enabled: row.enabled } : r)) ?? prev);
        flash(err instanceof CfError && err.detail ? err.detail : "Couldn't update — try again", true);
      }
    },
    [canManage, flash],
  );

  const merged = rows ?? [];
  const countFor = (s: Seg) => (s === "All" ? merged.length : merged.filter((r) => statusOf(r) === s).length);
  const filtered = useMemo(
    () => (seg === "All" ? merged : merged.filter((r) => statusOf(r) === seg)),
    [merged, seg],
  );
  const automationNames = useMemo(
    () => Object.fromEntries(merged.map((r) => [r.id, r.name])),
    [merged],
  );
  const drawerRow = drawerId ? merged.find((r) => r.id === drawerId) ?? null : null;

  const newBtn = (
    // W1: the builder lands in W2 of this PR — the canon button renders but
    // is honestly inert until then (no fake modal, no dead click).
    <span
      aria-disabled="true"
      title="The builder lands in W2 of this PR"
      style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 15, color: "#0A0F0C", background: GRAD, borderRadius: 12, padding: "12px 22px", boxShadow: "0 6px 16px rgba(53,232,52,.26)", cursor: "not-allowed", opacity: 0.6 }}
    >
      + New automation
    </span>
  );

  return (
    <div style={{ flex: 1, background: "#FBF7F0", minWidth: 0, padding: "26px 30px 34px", minHeight: "100vh", fontFamily: "'Hanken Grotesk',sans-serif" }}>
      <style>{`.auto-card:hover{border-color:#9FD8AC !important;box-shadow:0 8px 26px rgba(14,21,18,.08) !important;}`}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, letterSpacing: "-.02em", color: "#0E1512" }}>Automations</div>
          <div style={{ fontSize: 15, color: "#5C6B62" }}>
            {rows === null ? "Loading…" : `${merged.length} automation${merged.length === 1 ? "" : "s"} · ${countFor("Active")} active`}
          </div>
        </div>
        {newBtn}
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #EBE3D6", marginBottom: 18 }}>
        {SEGS.map((s) => {
          const on = s === seg;
          return (
            <div
              key={s}
              data-testid={`seg-${s.toLowerCase()}`}
              onClick={() => setSeg(s)}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: on ? 700 : 600, color: on ? "#0E1512" : "#8A7F6B", padding: "11px 15px", borderBottom: `2px solid ${on ? "#16A82A" : "transparent"}`, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {s}
              <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#16A82A" : "#8A7F6B", background: on ? "rgba(53,232,52,.14)" : "#F2EEE4", borderRadius: 100, padding: "1px 8px" }}>{countFor(s)}</span>
            </div>
          );
        })}
      </div>

      {loadError && (
        <div style={{ background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", color: "#C9543F", borderRadius: 12, padding: "10px 14px", fontSize: 13.5, marginBottom: 12 }}>
          Couldn't load automations — retrying automatically.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map((r) => {
          const st = statusOf(r);
          const { sbg, sfg } = STATUS_STYLE[st]!;
          const on = st === "Active";
          const icon = r.trigger ? TRIGGER_ICONS[r.trigger.kind] : "⚠";
          return (
            <div
              key={r.id}
              className="auto-card"
              data-testid="automation-card"
              onClick={() => setDrawerId(r.id)}
              style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: "16px 20px", boxShadow: "0 4px 16px rgba(14,21,18,.04)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 13 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, flex: "none", background: r.invalid ? "rgba(224,121,107,.14)" : "rgba(54,215,237,.16)", color: r.invalid ? "#C9543F" : "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  <div style={{ fontSize: 12.5, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deriveDesc(r)}</div>
                </div>
                <div style={{ flex: "none", textAlign: "right" }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 17, color: "#0E1512", lineHeight: 1 }}>{r.runs}</div>
                  <div style={{ fontSize: 11, color: "#9AA59E", marginTop: 2 }}>runs · {relTime(r.lastRunAt)}</div>
                </div>
                <span style={{ flex: "none", fontSize: 12, fontWeight: 700, color: sfg, background: sbg, borderRadius: 100, padding: "4px 11px" }}>{st}</span>
                <span
                  data-testid={`toggle-${r.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggle(r);
                  }}
                  style={{ width: 42, height: 24, borderRadius: 100, background: on ? GRAD : "#E4EAE6", position: "relative", display: "inline-block", flex: "none", cursor: r.invalid || !canManage ? "not-allowed" : "pointer", opacity: r.invalid ? 0.4 : 1 }}
                >
                  <span style={{ position: "absolute", top: 3, [on ? "right" : "left"]: 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", paddingLeft: 49 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".04em" }}>When</span>
                {r.trigger ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#1192A6", background: "rgba(54,215,237,.14)", borderRadius: 8, padding: "5px 11px", whiteSpace: "nowrap" }}>{triggerChip(r.trigger)}</span>
                ) : (
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "#C9543F", background: "rgba(224,121,107,.14)", borderRadius: 8, padding: "5px 11px" }}>Unreadable trigger</span>
                )}
                {r.conditions.length > 0 && (
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 8, padding: "5px 9px", whiteSpace: "nowrap" }}>+{r.conditions.length} filter</span>
                )}
                <span style={{ color: "#C9CFC9" }}>→</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".04em" }}>Then</span>
                {r.actions.map((a, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 8, padding: "5px 11px", whiteSpace: "nowrap" }}>
                    {ACTION_ICONS[a.kind]} {actionChip(a, automationNames)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}

        {rows !== null && filtered.length === 0 && (
          <div data-testid="automations-empty" style={{ textAlign: "center", padding: "60px 20px", background: "#fff", border: "1px dashed #D8CFBE", borderRadius: 16 }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>⟳</div>
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, color: "#0E1512", marginBottom: 4 }}>
              {seg === "All" ? "No automations yet" : `No ${seg.toLowerCase()} automations`}
            </div>
            <div style={{ fontSize: 13.5, color: "#9AA59E", marginBottom: 18 }}>
              {seg === "All" ? "Create your first rule to run work in the background." : "Try another tab or create a new automation."}
            </div>
            {newBtn}
          </div>
        )}
      </div>

      {drawerRow && (
        <AutomationDrawer
          row={drawerRow}
          automationNames={automationNames}
          canManage={canManage}
          onClose={() => setDrawerId(null)}
          onToggle={() => void toggle(drawerRow)}
          onDeleted={() => {
            setDrawerId(null);
            flash("Automation deleted");
            void refetch();
          }}
          flash={flash}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 80, background: "#0C140F", color: "#fff", borderRadius: 12, padding: "13px 20px", fontSize: 14, fontWeight: 600, boxShadow: "0 16px 44px rgba(0,0,0,.34)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: toast.error ? "#E0796B" : "#7FE8A0" }}>{toast.error ? "✕" : "✓"}</span>
          {toast.text}
        </div>
      )}
    </div>
  );
}
