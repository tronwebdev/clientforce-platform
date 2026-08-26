"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentListItem, BoldActivityRow, CampaignOutcomes } from "@clientforce/core";
import { goalSentence, goalValueMeta } from "@clientforce/core";
import type { BoldDrawerState } from "./BoldDrawer";
import {
  KIND_TONES,
  composeRow,
  contactName,
  fetchBoldActivity,
  fetchBoldOutcomes,
  initials,
  avTint,
  money,
  patchAgentValue,
  relTime,
} from "./bold-live";

/**
 * Campaign overview (B1) — hero with the goal stated, ONE row of stats where
 * every figure carries a qualifier, the live "happening now" card, and the
 * recent-activity feed. All numbers are reads: outcomes (F1 honesty floors),
 * the Bold activity endpoint, and the Addendum-2 value fields. Where a number
 * has no source yet, the surface says so — nothing is invented.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

interface BoldOverviewProps {
  agent: AgentListItem;
  onOpenDrawer: (d: BoldDrawerState) => void;
  onAllActivity: () => void;
  onValueSaved: () => void;
  flash: (t: string) => void;
}

export function BoldOverview({ agent, onOpenDrawer, onAllActivity, onValueSaved, flash }: BoldOverviewProps) {
  const [outcomes, setOutcomes] = useState<CampaignOutcomes | null>(null);
  const [feed, setFeed] = useState<BoldActivityRow[] | null>(null);
  const [wonRows, setWonRows] = useState<BoldActivityRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [estDraft, setEstDraft] = useState("");
  const [targetDraft, setTargetDraft] = useState("");

  useEffect(() => {
    let alive = true;
    setOutcomes(null);
    setFeed(null);
    void fetchBoldOutcomes(agent.id).then((o) => alive && setOutcomes(o));
    void fetchBoldActivity(agent.id).then((a) => alive && setFeed(a?.rows ?? []));
    void fetchBoldActivity(agent.id, "won").then((a) => alive && setWonRows(a?.rows ?? []));
    return () => {
      alive = false;
    };
  }, [agent.id]);

  const meta = goalValueMeta(agent.goal);
  const pill = agent.goalPill;
  const completions = outcomes?.totals.goalCompletions ?? agent.bookings;
  const est = agent.valueEstCents;
  const target = agent.valueGoalUnits;
  const monetary = meta.monetary && est != null && est > 0;
  // Potential = money already in motion (completions × est) — the goal
  // ceiling is expressed ONLY through % OF GOAL + "to go" (owner ruling,
  // B1 review; prototype: 8 booked × $2,400 = $19.2k potential).
  const potentialCents = monetary ? est * completions : null;
  const realizedCents = wonRows.reduce((n, r) => n + (r.amountCents ?? 0), 0);
  const pct = target ? Math.min(100, Math.round((completions / target) * 100)) : null;

  const heroValue =
    meta.heroMode === "money" && monetary && completions > 0 ? money(est * completions) : String(completions);
  const heroSub = monetary
    ? completions > 0
      ? `${money(potentialCents ?? 0)} potential at ${money(est)} a ${meta.unitNoun}`
      : `${money(est)} a ${meta.unitNoun} — potential lands with the first ${meta.unitNoun}`
    : meta.monetary
      ? `Set a value per ${meta.unitNoun} to see money here`
      : `${meta.valueBasis} — this goal is its own reward`;

  const sent = outcomes?.totals.sent ?? 0;
  const replies = outcomes?.totals.replies ?? 0;
  const rate = outcomes?.totals.replyRatePct ?? null;

  const liveRow = feed?.find((r) => r.kind === "goal" || r.kind === "won") ?? null;
  const liveComposed = liveRow ? composeRow(liveRow) : null;

  const saveValue = useCallback(async () => {
    const estCents = estDraft.trim() === "" ? null : Math.round(Number(estDraft) * 100);
    const units = targetDraft.trim() === "" ? null : Math.round(Number(targetDraft));
    if ((estCents != null && !Number.isFinite(estCents)) || (units != null && !Number.isFinite(units))) {
      flash("Numbers only");
      return;
    }
    const ok = await patchAgentValue(agent.id, { valueEstCents: estCents, valueGoalUnits: units });
    flash(ok ? "Value saved — the hero recomputes from it" : "Could not save — try again");
    if (ok) {
      setEditing(false);
      onValueSaved();
    }
  }, [agent.id, estDraft, targetDraft, flash, onValueSaved]);

  const stats = useMemo(() => {
    const tiles: Array<{ k: string; label: string; v: string; delta: string; fg: string }> = [];
    tiles.push(
      monetary
        ? {
            k: "potential",
            label: "POTENTIAL",
            v: money(potentialCents ?? 0),
            delta: `${completions} × ${money(est)}`,
            fg: completions > 0 ? "var(--cvb-ink)" : "var(--cvb-faint)",
          }
        : {
            k: "potential",
            label: "POTENTIAL",
            v: "—",
            delta: meta.monetary ? `set a value per ${meta.unitNoun}` : "no direct revenue",
            fg: "var(--cvb-faint)",
          },
    );
    tiles.push(
      realizedCents > 0
        ? {
            k: "realized",
            label: "REALIZED",
            v: money(realizedCents),
            delta: `${wonRows.length} receipt${wonRows.length === 1 ? "" : "s"}`,
            fg: "var(--cvb-forest)",
          }
        : {
            k: "realized",
            label: pill.toUpperCase(),
            v: String(completions),
            delta: target ? `of ${target} target` : `${agent.contacts} enrolled`,
            fg: completions > 0 ? "var(--cvb-forest)" : "var(--cvb-faint)",
          },
    );
    tiles.push(
      rate != null
        ? { k: "rate", label: "REPLY RATE", v: `${rate}%`, delta: `${replies} of ${sent} reached`, fg: "var(--cvb-ink)" }
        : {
            k: "rate",
            label: "REPLY RATE",
            v: "—",
            delta: sent > 0 ? `${replies} of ${sent} — needs 20 sends` : "nothing sent yet",
            fg: "var(--cvb-faint)",
          },
    );
    return tiles;
  }, [monetary, potentialCents, target, est, completions, meta, realizedCents, wonRows.length, pill, agent.contacts, rate, replies, sent]);

  const openStat = (k: string) => {
    if (k === "potential" && monetary) {
      const done = est * completions;
      const remaining = target ? est * Math.max(0, target - completions) : 0;
      const total = Math.max(1, done + remaining);
      onOpenDrawer({
        t: "num",
        label: "POTENTIAL VALUE",
        v: money(done),
        read: `${pill} multiplied by the per-${meta.unitNoun} value you set. It becomes realized when a payment receipt lands.`,
        breakLabel: "HOW IT SPLITS",
        rows: [
          { n: `${pill} (${completions})`, v: money(done), w: (done / total) * 100, c: "var(--cvb-forest)" },
          ...(target
            ? [{ n: `To go (${Math.max(0, target - completions)})`, v: money(remaining), w: (remaining / total) * 100, c: "var(--cvb-line-ctl)" }]
            : []),
        ],
      });
      return;
    }
    if (k === "rate") {
      const replyRows = (feed ?? []).filter((r) => r.kind === "reply");
      const buckets = new Map<string, number>();
      for (const r of replyRows) {
        const label = r.intent ? r.intent.replace(/_/g, " ") : "replied";
        buckets.set(label, (buckets.get(label) ?? 0) + 1);
      }
      const total = Math.max(1, replyRows.length);
      onOpenDrawer({
        t: "num",
        label: "REPLY RATE",
        v: rate != null ? `${rate}%` : "—",
        read:
          rate != null
            ? "Distinct repliers over sends, classified by the reply reader — the split below is from the loaded activity window."
            : `The rate stays honest-absent below 20 sends (F1 floor). ${replies} of ${sent} reached so far.`,
        breakLabel: "HOW THEY REPLIED",
        rows: [...buckets.entries()].map(([n, v], i) => ({
          n,
          v: String(v),
          w: (v / total) * 100,
          c: i === 0 ? "var(--cvb-forest)" : i === 1 ? "var(--cvb-cyan)" : "var(--cvb-dot-amber)",
        })),
      });
    }
  };

  return (
    <div style={{ padding: "26px 40px 40px" }}>
      {/* Hero — dark stage, gradient hairline, goal stated explicitly. */}
      <div data-tour="hero" style={{ border: "1px solid var(--cvb-line)", borderRadius: 22, animation: "cvb-rise .45s var(--cvb-ease) both" }}>
        <div style={{ background: "linear-gradient(150deg,#0C2A1B,#0A1524 66%,#0A0F14)", borderRadius: "21px 21px 0 0" }}>
          <div style={{ height: 2, background: "var(--cvb-gradient-signature)", borderRadius: "21px 21px 0 0" }} />
          <div style={{ padding: "26px 28px 28px", display: "flex", alignItems: "flex-end", gap: 26, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 190 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "rgba(255,255,255,.5)" }}>
                  {pill.toUpperCase()} · {agent.status === "ACTIVE" ? "LIVE" : agent.status === "PAUSED" ? "PAUSED" : "DRAFT"}
                </span>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: "#D6FBD2", background: "rgba(53,232,52,.14)", border: "1px solid rgba(53,232,52,.28)", borderRadius: 999, padding: "3px 9px" }}>
                  {meta.kindLabel}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.72)", lineHeight: 1.5, marginTop: 9, maxWidth: 340 }}>{goalSentence(agent.goal)}</div>
              <div className="cvb-display" style={{ fontWeight: 900, fontSize: 50, letterSpacing: "-.036em", lineHeight: 0.98, color: "#fff", marginTop: 11 }} data-testid="bold-hero-value">
                {heroValue}
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)", marginTop: 10, lineHeight: 1.45 }}>{heroSub}</div>
            </div>
            <div style={{ width: 190, flex: "none" }}>
              {pct != null ? (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span className="cvb-display" style={{ fontWeight: 900, fontSize: 22, letterSpacing: "-.03em", color: "var(--cvb-live)", lineHeight: 1 }}>
                      {pct}%
                    </span>
                    <span style={{ ...mono, fontSize: 9, letterSpacing: ".14em", color: "rgba(255,255,255,.4)" }}>OF GOAL</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,.13)", marginTop: 11, overflow: "hidden" }}>
                    <span style={{ display: "block", height: 5, width: `${pct}%`, background: "linear-gradient(90deg,#35E834,#D0F56B)", borderRadius: 3, transformOrigin: "left", animation: "cvb-grow .8s var(--cvb-ease) .15s both" }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.44)", lineHeight: 1.45, marginTop: 10 }}>
                    {Math.max(0, (target ?? 0) - completions)} of {target} to go.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.44)", lineHeight: 1.5 }}>
                  No target set — pace shows once you set one.
                </div>
              )}
              {/* Review-kind goals never render money (Addendum-2 §E) — no
                  value estimate exists to edit on them. The editor is an
                  OVERLAY POPOVER anchored to the button (owner ruling, B1
                  approval): opening it never reflows the hero — no layout
                  shift, no reserved gap; % OF GOAL stays exactly in place. */}
              {meta.monetary ? (
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    data-testid="bold-value-edit"
                    onClick={() => {
                      if (!editing) {
                        setEstDraft(est != null ? String(est / 100) : "");
                        setTargetDraft(target != null ? String(target) : "");
                      }
                      setEditing((e) => !e);
                    }}
                    style={{
                      marginTop: 12,
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "rgba(255,255,255,.75)",
                      background: "rgba(255,255,255,.08)",
                      border: "1px solid rgba(255,255,255,.2)",
                      borderRadius: 9,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {est != null || target != null ? "Edit value" : `Set ${meta.valueBasis}`}
                  </button>
                  {editing ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        right: 0,
                        width: 210,
                        zIndex: 7,
                        background: "var(--cvb-panel)",
                        border: "1px solid var(--cvb-line-strong)",
                        borderRadius: 14,
                        padding: 8,
                        boxShadow: "var(--cvb-shadow-card)",
                      }}
                    >
                      {/* One shared recessed well, fields divided — the
                          2026-08-16 input amendment. Labels carry the unit. */}
                      <div
                        style={{
                          background: "var(--cvb-well-fill)",
                          border: "1px solid var(--cvb-well-line)",
                          borderRadius: "var(--cvb-r-well)",
                          boxShadow: "var(--cvb-shadow-well)",
                          overflow: "hidden",
                        }}
                      >
                        <label style={{ display: "block", padding: "6px 9px 7px" }}>
                          <span style={{ ...mono, display: "block", fontSize: 8.5, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>
                            $ PER {meta.unitNoun.toUpperCase()}
                          </span>
                          <input
                            data-testid="bold-value-est"
                            value={estDraft}
                            onChange={(e) => setEstDraft(e.target.value)}
                            placeholder="2,400"
                            inputMode="decimal"
                            style={{ width: "100%", border: 0, outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "var(--cvb-ink)", marginTop: 2 }}
                          />
                        </label>
                        <div style={{ height: 1, background: "var(--cvb-well-divider)" }} />
                        <label style={{ display: "block", padding: "6px 9px 7px" }}>
                          <span style={{ ...mono, display: "block", fontSize: 8.5, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>
                            TARGET {meta.unitNoun.toUpperCase()}S
                          </span>
                          <input
                            data-testid="bold-value-target"
                            value={targetDraft}
                            onChange={(e) => setTargetDraft(e.target.value)}
                            placeholder="12"
                            inputMode="numeric"
                            style={{ width: "100%", border: 0, outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "var(--cvb-ink)", marginTop: 2 }}
                          />
                        </label>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                        <button
                          type="button"
                          data-testid="bold-value-save"
                          onClick={() => void saveValue()}
                          style={{ flex: 1, fontSize: 11.5, fontWeight: 700, color: "var(--cvb-card)", background: "var(--cvb-forest)", border: 0, borderRadius: 10, padding: "7px 0", cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(false)}
                          style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cvb-ink-soft)", background: "transparent", border: "1px solid var(--cvb-line-ctl)", borderRadius: 10, padding: "7px 11px", cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {/* One-row stats — every figure carries its qualifier (ruling). */}
        <div style={{ display: "flex", background: "var(--cvb-panel)", borderRadius: "0 0 21px 21px", overflow: "hidden" }} data-testid="bold-stats-row">
          {stats.map((m, i) => (
            <div
              key={m.k}
              onClick={() => openStat(m.k)}
              style={{ flex: 1, minWidth: 0, padding: "18px 16px", borderLeft: `1px solid ${i === 0 ? "transparent" : "var(--cvb-line-inner)"}`, cursor: "pointer" }}
            >
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</div>
              <div className="cvb-display" style={{ fontWeight: 900, fontSize: 25, letterSpacing: "-.03em", lineHeight: 1, marginTop: 10, color: m.fg, whiteSpace: "nowrap" }}>{m.v}</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: m.fg === "var(--cvb-forest)" ? "var(--cvb-forest)" : "var(--cvb-faint)", marginTop: 8, lineHeight: 1.35 }}>{m.delta}</div>
            </div>
          ))}
        </div>
      </div>

      {/* HAPPENING NOW divider + latest goal/won card. */}
      <div data-tour="act" style={{ display: "flex", alignItems: "center", gap: 12, margin: "38px 0 16px" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cvb-forest)", flex: "none", position: "relative" }}>
          <span style={{ position: "absolute", inset: -4, borderRadius: "50%", border: "2px solid var(--cvb-forest)", animation: "cvb-glow 1.8s ease-out infinite" }} />
        </span>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>HAPPENING NOW</span>
        <span style={{ flex: 1, height: 1, background: "var(--cvb-line-inner)" }} />
        <span onClick={onAllActivity} data-testid="bold-all-activity" style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-cyan)", cursor: "pointer" }}>
          All activity →
        </span>
      </div>

      {liveRow && liveComposed ? (
        <div
          onClick={() => liveRow.contact && onOpenDrawer({ t: "person", contact: liveRow.contact })}
          style={{
            background: "var(--cvb-card)",
            border: "1px solid #DDE9E1",
            borderRadius: 20,
            padding: "20px 22px",
            display: "flex",
            gap: 18,
            alignItems: "center",
            boxShadow: "0 0 0 6px var(--cvb-glow-ring)",
            cursor: liveRow.contact ? "pointer" : "default",
          }}
        >
          <span
            style={{
              width: 58,
              height: 58,
              borderRadius: "50%",
              flex: "none",
              background: avTint(liveRow.contact?.id ?? "x").bg,
              color: avTint(liveRow.contact?.id ?? "x").fg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 19,
              fontWeight: 900,
            }}
          >
            {initials(liveRow.contact)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-.024em" }}>{contactName(liveRow.contact)}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "3px 9px" }}>
                {liveComposed.chip}
              </span>
            </div>
            <div style={{ fontSize: 14, color: "var(--cvb-ink-soft)", lineHeight: 1.5, marginTop: 7 }}>{liveComposed.body}</div>
          </div>
          <div style={{ textAlign: "right", flex: "none" }}>
            {liveComposed.value ? (
              <div className="cvb-display" style={{ fontWeight: 900, fontSize: 22, letterSpacing: "-.03em", color: "var(--cvb-forest)", lineHeight: 1 }}>{liveComposed.value}</div>
            ) : null}
            <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 5 }}>{relTime(liveRow.occurredAt)}</div>
          </div>
        </div>
      ) : null}

      {/* Recent activity feed. */}
      <div style={{ marginTop: 6 }} data-testid="bold-feed">
        {feed == null ? <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", padding: "18px 6px" }}>Loading activity…</div> : null}
        {feed?.filter((r) => r.id !== liveRow?.id).slice(0, 6).map((r) => (
          <FeedRow key={r.id} row={r} agentId={agent.id} onOpenDrawer={onOpenDrawer} />
        ))}
        {feed != null && feed.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cvb-muted)" }}>Nothing has happened yet</div>
            <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 6 }}>
              Activity lands here the moment the campaign moves.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function FeedRow({ row, agentId, onOpenDrawer }: { row: BoldActivityRow; agentId: string; onOpenDrawer: (d: BoldDrawerState) => void }) {
  const c = composeRow(row);
  const tone = KIND_TONES[c.tone] ?? KIND_TONES.send!;
  const tint = row.contact ? avTint(row.contact.id) : null;
  const open = () => {
    if (row.kind === "send" && row.day) {
      onOpenDrawer({ t: "grp", agentId, label: `SEND · ${row.day}`, name: c.body, stepNodeId: row.stepNodeId, day: row.day });
    } else if (row.contact) {
      onOpenDrawer({ t: "person", contact: row.contact });
    }
  };
  return (
    <div onClick={open} style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 6px", borderBottom: "1px solid var(--cvb-line-2)", cursor: "pointer" }}>
      <span style={{ width: 3, height: 34, borderRadius: 2, background: tone[3], flex: "none" }} />
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          flex: "none",
          background: tint?.bg ?? tone[1],
          color: tint?.fg ?? tone[0],
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: tint ? 13 : 14,
          fontWeight: tint ? 800 : 400,
        }}
      >
        {row.contact ? initials(row.contact) : tone[4]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: "var(--cvb-ink)", lineHeight: 1.45 }}>{c.body}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: tone[0], background: tone[1], border: `1px solid ${tone[2]}`, borderRadius: 999, padding: "2px 8px" }}>{c.chip}</span>
          <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)" }}>{relTime(row.occurredAt)}</span>
        </div>
      </div>
      {c.value ? <span style={{ ...mono, fontSize: 11, color: "var(--cvb-forest)", flex: "none" }}>{c.value}</span> : null}
    </div>
  );
}
