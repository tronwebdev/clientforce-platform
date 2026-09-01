"use client";

/**
 * B8 (DEC-135): the numbers surface — the campaign Stats tab AND the
 * workspace Analytics page are this ONE component over the ONE `/stats`
 * read, so they can never disagree. The prototype's anatomy (range pills ·
 * stat tiles · WHERE PEOPLE DROP funnel · BY CHANNEL · the Ada reading
 * card) renders on real aggregates only:
 *
 *  - every tile/funnel number is server-derived (sources named on the
 *    endpoint); rates below the F1 min-send floor say "too few to read"
 *    instead of quoting noise (§7 empty-state standard);
 *  - the value tile is the owner-typed ESTIMATE (labeled), and "collected"
 *    appears only when real `payment.received.v1` money exists;
 *  - the prototype's per-channel $-cost column has NO source until
 *    metering (Q-108) — deferred visibly (Q-114), never invented;
 *  - the workspace page's CAMPAIGN filter is live; CHANNEL and TEAM
 *    filters need attribution work — visibly deferred (Q-115);
 *  - "What Ada sees" renders DETERMINISTIC fact sentences computed
 *    server-side from the same aggregates — receipts, never advice; the
 *    prototype's "Draft both changes" action implies planner work (Q-116).
 */
import { useCallback, useEffect, useState } from "react";
import type { AgentListItem } from "@clientforce/core";
import { mono } from "./bold-cards";
import { fetchBoldAgents, fetchStats, money, type BoldStatsResponse } from "./bold-live";

const RANGES: Array<["7" | "30" | "all", string]> = [
  ["7", "7 days"],
  ["30", "30 days"],
  ["all", "All time"],
];

const CH_META: Record<string, { n: string; ic: string; bg: string; bd: string; fg: string }> = {
  email: {
    n: "Email",
    ic: "✉",
    bg: "var(--cvb-mint)",
    bd: "var(--cvb-mint-line)",
    fg: "var(--cvb-forest)",
  },
  sms: {
    n: "SMS",
    ic: "✆",
    bg: "var(--cvb-cyan-tint,#E2F3F6)",
    bd: "var(--cvb-cyan-line,#BFE3EB)",
    fg: "var(--cvb-cyan,#0E7D93)",
  },
  voice: {
    n: "Calls",
    ic: "☎",
    bg: "var(--cvb-panel)",
    bd: "var(--cvb-line-ctl)",
    fg: "var(--cvb-muted)",
  },
};

export function BoldStatsView({ agentId }: { agentId?: string }) {
  const [range, setRange] = useState<"7" | "30" | "all">("30");
  const [campFilter, setCampFilter] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [data, setData] = useState<BoldStatsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const workspaceScope = agentId == null;

  const load = useCallback(async () => {
    setLoaded(false);
    const [stats, agentList] = await Promise.all([
      fetchStats(range, agentId ?? campFilter ?? undefined),
      workspaceScope ? fetchBoldAgents() : Promise.resolve(null),
    ]);
    setData(stats);
    if (agentList) setAgents(agentList.filter((a) => a.status !== "ARCHIVED"));
    setLoaded(true);
  }, [range, agentId, campFilter, workspaceScope]);

  useEffect(() => {
    void load();
  }, [load]);

  const t = data?.tiles;
  const belowFloor = (data?.floors.totalSent ?? 0) < (data?.floors.low ?? 20);
  const maxFunnel = Math.max(1, ...(data?.funnel ?? []).map((f) => f.count));

  const tiles: Array<{ label: string; v: string; sub: string; fg?: string }> = [
    { label: "REACHED", v: loaded ? String(t?.reached ?? 0) : "—", sub: "unique contacts" },
    {
      label: "REPLIED",
      v: loaded ? String(t?.replied ?? 0) : "—",
      sub:
        t?.repliedPct != null
          ? `${t.repliedPct}% of reached`
          : belowFloor && (t?.replied ?? 0) > 0
            ? "too few sends to read a rate"
            : "of the people reached",
    },
    {
      label: "BOOKED",
      v: loaded ? String(t?.booked ?? 0) : "—",
      sub:
        t?.bookedPctOfRepliers != null
          ? `${t.bookedPctOfRepliers}% of repliers`
          : "moved to booked",
      fg: "var(--cvb-forest)",
    },
    t?.collectedCents
      ? {
          label: "COLLECTED",
          v: money(t.collectedCents),
          sub: "payments received",
          fg: "var(--cvb-forest-ink,#0E5C2B)",
        }
      : {
          label: "EST. VALUE",
          v: loaded && t?.estValueCents ? money(t.estValueCents) : "—",
          sub: t?.estValueCents ? "your estimate × won" : "set a value estimate to see this",
          fg: "var(--cvb-forest-ink,#0E5C2B)",
        },
  ];

  return (
    <div data-testid="bold-stats" style={{ padding: "26px 40px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div
          style={{
            display: "flex",
            gap: 5,
            background: "var(--cvb-panel)",
            borderRadius: 13,
            padding: 4,
            width: "fit-content",
          }}
        >
          {RANGES.map(([key, label]) => (
            <span
              key={key}
              onClick={() => setRange(key)}
              data-testid={`bold-stats-range-${key}`}
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                padding: "9px 16px",
                borderRadius: 10,
                cursor: "pointer",
                background: range === key ? "var(--cvb-card)" : "transparent",
                color: range === key ? "var(--cvb-ink)" : "var(--cvb-faint)",
              }}
            >
              {label}
            </span>
          ))}
        </div>
        {workspaceScope ? (
          <>
            <select
              value={campFilter ?? ""}
              onChange={(e) => setCampFilter(e.target.value || null)}
              data-testid="bold-stats-campfilter"
              style={{
                ...mono,
                fontSize: 11.5,
                fontWeight: 600,
                padding: "9px 12px",
                borderRadius: 11,
                background: "var(--cvb-card)",
                color: "var(--cvb-muted)",
                border: "1px solid var(--cvb-line-ctl)",
              }}
            >
              <option value="">CAMPAIGN · all</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <span
              data-testid="bold-stats-filters-deferred"
              title="Coming soon"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: "9px 12px",
                borderRadius: 11,
                border: "1px dashed var(--cvb-line-ctl)",
                color: "var(--cvb-ghost)",
              }}
            >
              CHANNEL · TEAM — filters on their way
            </span>
          </>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          background: "var(--cvb-card)",
          border: "1px solid var(--cvb-line-ctl)",
          borderRadius: 20,
          overflow: "hidden",
          marginTop: 22,
        }}
      >
        {tiles.map((tile, i) => (
          <div
            key={tile.label}
            data-testid={`bold-stats-tile-${tile.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "18px 14px",
              borderLeft: i === 0 ? "none" : "1px solid var(--cvb-line-inner)",
            }}
          >
            <div
              style={{
                ...mono,
                fontSize: 10,
                letterSpacing: ".13em",
                color: "var(--cvb-faint)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {tile.label}
            </div>
            <div
              data-testid={`bold-stats-tilev-${tile.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              style={{
                fontFamily: "var(--cvb-font-display)",
                fontWeight: 900,
                fontSize: 23,
                letterSpacing: "-.03em",
                lineHeight: 1,
                marginTop: 10,
                color: tile.fg ?? "var(--cvb-ink)",
                whiteSpace: "nowrap",
              }}
            >
              {tile.v}
            </div>
            <div
              style={{ fontSize: 10.5, color: "var(--cvb-faint)", marginTop: 8, lineHeight: 1.35 }}
            >
              {tile.sub}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "38px 0 20px" }}>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>
          WHERE PEOPLE DROP
        </span>
        <span style={{ flex: 1, height: 1, background: "var(--cvb-line-inner)" }} />
      </div>
      {loaded && (data?.tiles.reached ?? 0) === 0 ? (
        <div
          data-testid="bold-stats-empty"
          style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.6 }}
        >
          Nothing reached anyone in this window yet — the funnel draws itself from the first send.
        </div>
      ) : (
        <>
          {/* B8 review fix: the DROP path stops at Interested. Booked/Won are
              OUTCOMES — a booking can arrive without any reply (inbound, the
              site agent), so drawing them on the drop path reads as a bug the
              moment the "funnel" rises. They render below their own rule, and
              a rising count carries the server's computed receipt. */}
          {(data?.funnel ?? [])
            .filter((f) => !f.outcome)
            .map((f) => (
              <div
                key={f.key}
                style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 11 }}
              >
                <span
                  style={{
                    width: 88,
                    flex: "none",
                    fontSize: 12.5,
                    fontWeight: 700,
                    letterSpacing: "-.016em",
                  }}
                >
                  {f.label}
                  {f.note ? (
                    <span
                      style={{
                        display: "block",
                        fontSize: 9,
                        fontWeight: 500,
                        color: "var(--cvb-ghost)",
                      }}
                    >
                      {f.note}
                    </span>
                  ) : null}
                </span>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 38,
                    borderRadius: 11,
                    background: "var(--cvb-well)",
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: 38,
                      width: `${Math.max(6, Math.round((f.count / maxFunnel) * 100))}%`,
                      background:
                        f.key === "replied" || f.key === "interested"
                          ? "var(--cvb-cyan-tint,#D5EAF0)"
                          : "var(--cvb-panel)",
                      borderRadius: 11,
                      paddingLeft: 13,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--cvb-font-display)",
                        fontWeight: 900,
                        fontSize: 16,
                        letterSpacing: "-.028em",
                      }}
                    >
                      {f.count}
                    </span>
                  </span>
                </div>
                <span
                  style={{
                    width: 44,
                    flex: "none",
                    ...mono,
                    fontSize: 10.5,
                    color: "var(--cvb-faint)",
                    textAlign: "right",
                  }}
                >
                  {maxFunnel > 0 && (data?.funnel?.[0]?.count ?? 0) > 0
                    ? `${Math.round((f.count / (data!.funnel[0]!.count || 1)) * 100)}%`
                    : "—"}
                </span>
              </div>
            ))}
          <div
            style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 12px" }}
            data-testid="bold-stats-outcomes-rule"
          >
            <span
              style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-forest)" }}
            >
              WHAT CAME OF IT
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--cvb-mint-line)" }} />
          </div>
          {(data?.funnel ?? [])
            .filter((f) => f.outcome)
            .map((f) => (
              <div
                key={f.key}
                data-testid={`bold-stats-outcome-${f.key}`}
                style={{ marginBottom: 11 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span
                    style={{
                      width: 88,
                      flex: "none",
                      fontSize: 12.5,
                      fontWeight: 700,
                      letterSpacing: "-.016em",
                      color: "var(--cvb-forest-ink,#0E3D22)",
                    }}
                  >
                    {f.label}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 38,
                      borderRadius: 11,
                      background: "var(--cvb-well)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        height: 38,
                        width: `${Math.max(6, Math.round((f.count / maxFunnel) * 100))}%`,
                        background: "var(--cvb-mint)",
                        border: "1px solid var(--cvb-mint-line)",
                        borderRadius: 11,
                        paddingLeft: 13,
                        boxSizing: "border-box",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--cvb-font-display)",
                          fontWeight: 900,
                          fontSize: 16,
                          letterSpacing: "-.028em",
                          color: "var(--cvb-forest-ink,#0E3D22)",
                        }}
                      >
                        {f.count}
                      </span>
                    </span>
                  </div>
                  <span
                    style={{
                      width: 44,
                      flex: "none",
                      ...mono,
                      fontSize: 10.5,
                      color: "var(--cvb-faint)",
                      textAlign: "right",
                    }}
                  >
                    {maxFunnel > 0 && (data?.funnel?.[0]?.count ?? 0) > 0
                      ? `${Math.round((f.count / (data!.funnel[0]!.count || 1)) * 100)}%`
                      : "—"}
                  </span>
                </div>
                {f.note ? (
                  <div
                    data-testid={`bold-stats-outcome-note-${f.key}`}
                    style={{
                      ...mono,
                      fontSize: 9.5,
                      color: "var(--cvb-forest)",
                      margin: "5px 0 0 102px",
                      lineHeight: 1.5,
                    }}
                  >
                    {f.note}
                  </div>
                ) : null}
              </div>
            ))}
        </>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 32 }}>
        <div
          style={{
            flex: 1,
            minWidth: 280,
            background: "var(--cvb-card)",
            border: "1px solid var(--cvb-line-ctl)",
            borderRadius: 20,
            padding: 22,
          }}
        >
          <div
            style={{
              ...mono,
              fontSize: 9.5,
              letterSpacing: ".16em",
              color: "var(--cvb-faint)",
              marginBottom: 16,
            }}
          >
            BY CHANNEL
          </div>
          {(data?.channels ?? []).map((c, i, arr) => {
            const meta = CH_META[c.channel] ?? CH_META.email!;
            return (
              <div
                key={c.channel}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--cvb-line-inner)",
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 11,
                    flex: "none",
                    background: meta.bg,
                    border: `1px solid ${meta.bd}`,
                    color: meta.fg,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 13,
                  }}
                >
                  {meta.ic}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-.018em" }}>
                    {meta.n}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 2 }}>
                    {c.sent} {c.channel === "voice" ? "placed" : "sent"} · {c.repliers} replied
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--cvb-font-display)",
                    fontWeight: 900,
                    fontSize: 18,
                    letterSpacing: "-.028em",
                    color: c.booked > 0 ? "var(--cvb-forest)" : "var(--cvb-ghost)",
                  }}
                >
                  {c.booked > 0 ? `${c.booked} booked` : "—"}
                </span>
              </div>
            );
          })}
          <div
            style={{ fontSize: 10.5, color: "var(--cvb-ghost)", marginTop: 12, lineHeight: 1.5 }}
          >
            Cost per booking arrives when sends and minutes start metering — no number is better
            than a made-up one.
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 280,
            background: "var(--cvb-mint)",
            border: "1px solid var(--cvb-mint-line)",
            borderRadius: 20,
            padding: 22,
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ color: "var(--cvb-forest)", fontSize: 14, flex: "none" }}>✦</span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "var(--cvb-font-display)",
                  fontWeight: 900,
                  fontSize: 17,
                  letterSpacing: "-.028em",
                  color: "var(--cvb-forest-ink,#0E3D22)",
                }}
              >
                What Ada sees
              </div>
              {loaded && (data?.reading.length ?? 0) === 0 ? (
                <div
                  data-testid="bold-stats-reading-empty"
                  style={{
                    fontSize: 13,
                    color: "var(--cvb-forest)",
                    lineHeight: 1.6,
                    marginTop: 10,
                  }}
                >
                  Nothing stands out in this window yet — readings appear when the numbers say
                  something.
                </div>
              ) : (
                (data?.reading ?? []).map((line) => (
                  <div
                    key={line}
                    data-testid="bold-stats-reading"
                    style={{
                      fontSize: 13.5,
                      color: "var(--cvb-forest)",
                      lineHeight: 1.6,
                      marginTop: 10,
                    }}
                  >
                    {line}
                  </div>
                ))
              )}
              <div
                style={{
                  ...mono,
                  fontSize: 9.5,
                  color: "var(--cvb-forest)",
                  opacity: 0.75,
                  marginTop: 14,
                  lineHeight: 1.5,
                }}
              >
                Computed from the numbers above — acting on a reading is on its way.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
