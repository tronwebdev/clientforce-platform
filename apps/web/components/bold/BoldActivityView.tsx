"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoldActivityRow } from "@clientforce/core";
import type { BoldDrawerState } from "./BoldDrawer";
import { FeedRow } from "./BoldOverview";
import { fetchBoldActivity } from "./bold-live";

/**
 * The full activity page (B1, ADDENDUM_4 §4.2) — reached only from the
 * overview's "All activity →", never a tab (ruling). Filter chips map to the
 * additive activity endpoint's kinds; day groups; rows with a count drill
 * into their sorted subset via the recipients read; contact rows open the
 * person peek. The header stats count the LOADED window and say so.
 */

const FILTERS: Array<[string, string]> = [
  ["all", "Everything"],
  ["goal", "Booked"],
  ["won", "Won"],
  ["reply", "Replies"],
  ["send", "Sends"],
  ["decision", "Decisions"],
];

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const key = (x: Date) => x.toISOString().slice(0, 10);
  if (key(d) === key(now)) return "TODAY";
  if (key(d) === key(new Date(now.getTime() - 864e5))) return "YESTERDAY";
  if (now.getTime() - d.getTime() < 7 * 864e5) return "EARLIER THIS WEEK";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase();
}

export function BoldActivityView({
  agentId,
  onOpenDrawer,
}: {
  agentId: string;
  onOpenDrawer: (d: BoldDrawerState) => void;
}) {
  const [kind, setKind] = useState("all");
  const [rows, setRows] = useState<BoldActivityRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setCursor(null);
    void fetchBoldActivity(agentId, kind).then((a) => {
      if (!alive) return;
      setRows(a?.rows ?? []);
      setCursor(a?.nextCursor ?? null);
    });
    return () => {
      alive = false;
    };
  }, [agentId, kind]);

  const groups = useMemo(() => {
    const out: Array<{ label: string; rows: BoldActivityRow[] }> = [];
    for (const r of rows ?? []) {
      const label = dayLabel(r.occurredAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [rows]);

  const loaded = rows ?? [];
  const stats = [
    { label: "EVENTS", v: String(loaded.length), fg: "var(--cvb-ink)" },
    { label: "BOOKED", v: String(loaded.filter((r) => r.kind === "goal").length), fg: "var(--cvb-forest)" },
    { label: "PAID", v: String(loaded.filter((r) => r.kind === "won").length), fg: "#0e5c2b" },
    { label: "HER CALLS", v: String(loaded.filter((r) => r.kind === "decision").length), fg: "var(--cvb-amber)" },
  ];

  return (
    <div style={{ padding: "26px 40px 40px" }} data-testid="bold-activity-page">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map(([k, l]) => (
          <span
            key={k}
            onClick={() => setKind(k)}
            data-testid={`bold-act-filter-${k}`}
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              padding: "8px 13px",
              borderRadius: 11,
              cursor: "pointer",
              background: kind === k ? "var(--cvb-ink)" : "var(--cvb-panel)",
              color: kind === k ? "var(--cvb-card)" : "var(--cvb-muted)",
              border: `1px solid ${kind === k ? "var(--cvb-ink)" : "var(--cvb-line-ctl)"}`,
            }}
          >
            {l}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 20, overflow: "hidden", marginTop: 20 }}>
        {stats.map((a, i) => (
          <div key={a.label} style={{ flex: 1, minWidth: 0, padding: "16px 14px", borderLeft: `1px solid ${i === 0 ? "transparent" : "var(--cvb-line-inner)"}` }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label}</div>
            <div className="cvb-display" style={{ fontWeight: 900, fontSize: 23, letterSpacing: "-.03em", lineHeight: 1, marginTop: 9, color: a.fg }}>{a.v}</div>
          </div>
        ))}
      </div>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--cvb-faint-2)", marginTop: 8 }}>
        COUNTS COVER THE LOADED WINDOW{cursor ? " — MORE BELOW" : ""}
      </div>

      {rows == null ? <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", padding: "30px 6px" }}>Loading…</div> : null}
      {groups.map((g) => (
        <div key={g.label} style={{ marginTop: 34 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>{g.label}</span>
            <span style={{ flex: 1, height: 1, background: "var(--cvb-line-inner)" }} />
            <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)" }}>{g.rows.length} event{g.rows.length === 1 ? "" : "s"}</span>
          </div>
          {g.rows.map((r) => (
            <FeedRow key={r.id} row={r} agentId={agentId} onOpenDrawer={onOpenDrawer} />
          ))}
        </div>
      ))}
      {rows != null && rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cvb-muted)" }}>Nothing of that kind yet</div>
          <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 6 }}>Try another filter.</div>
        </div>
      ) : null}
      {cursor ? (
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void fetchBoldActivity(agentId, kind, cursor).then((a) => {
                setRows((cur) => [...(cur ?? []), ...(a?.rows ?? [])]);
                setCursor(a?.nextCursor ?? null);
                setLoadingMore(false);
              });
            }}
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--cvb-ink-soft)",
              background: "var(--cvb-panel)",
              border: "1px solid var(--cvb-line-ctl)",
              borderRadius: 12,
              padding: "10px 18px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {loadingMore ? "Loading…" : "Older activity"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
