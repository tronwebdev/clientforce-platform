"use client";

/**
 * B6.5 (DEC-150..154): the Lead finder rebuilt as a STANDING WATCH.
 *
 * The B6 surface was a search box built on an assumption that is now wrong —
 * that the user connects a data provider. Three defects followed from it and
 * are fixed here rather than patched (SURFACE_SPEC §1):
 *
 *  1. `provider not connected` reached the USER. It is an operator condition
 *     (ADDENDUM_5 §1): the platform holds one key, one vendor relationship,
 *     one bill. The user sees "Search is temporarily unavailable — nothing
 *     for you to fix", and no vendor is ever named.
 *  2. Licensed supply rendered with no tier gate. A `bp` type now produces
 *     no row anywhere in the response until BuyerPing is on (§12.1) — the
 *     gate is in the API, not in this file.
 *  3. It was a search page. It is a watch: signals arrive on their own, each
 *     with its evidence; a credit is spent only to reveal contact details.
 *
 * Every noun on this page comes from the shape/vertical registries through
 * `GET /leads/config` — the title, the subject noun, the group labels and the
 * basis sentence. A hard-coded B2B noun here is a review defect (§12.9).
 *
 * Honest absence, where a number has no truthful source: the three paid pool
 * bands count the open market, which only the search provider can report, so
 * they say so instead of showing an invented estimate (DEC-115, Q-140).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addWatchTopic,
  fetchCreditPrices,
  fetchLeadConfig,
  fetchLeadPool,
  hideLead,
  removeWatchTopic,
  revealLead,
  saveBrief,
  searchLeads,
  setBuyerping,
  type LeadCandidateRow,
  type LeadFinderConfig,
  type LeadPool,
  type LeadSearchResult,
  type LeadSuppression,
} from "./bold-live";
import { BoldOverlay, BoldSheet } from "./BoldOverlay";
import { mono } from "./bold-cards";
import type { EffectiveCreditPrices } from "@clientforce/core";

type Mode = "market" | "fit" | "direct";

const fitPill = (fit: number): [string, string, string] =>
  fit >= 90
    ? ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"]
    : fit >= 80
      ? ["var(--cvb-cyan,#0E7D93)", "var(--cvb-cyan-tint,#E2F3F6)", "var(--cvb-cyan-line,#BFE3EB)"]
      : ["var(--cvb-faint)", "var(--cvb-panel)", "var(--cvb-line-ctl)"];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

const monoChip = {
  ...mono,
  fontSize: 8.5,
  letterSpacing: ".12em",
  borderRadius: 6,
  padding: "2px 6px",
} as const;

const eyebrow = {
  ...mono,
  fontSize: 9,
  letterSpacing: ".16em",
  color: "var(--cvb-ghost)",
} as const;

/** A plain date, for the WATCHING SINCE chip. Never a decorative one. */
const shortDate = (iso: string) =>
  new Date(iso)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();

export function BoldLeadFinderView({
  flash,
  onTitle,
}: {
  flash: (msg: string) => void;
  /** The page question is registry-derived, so the surface reports it up. */
  onTitle?: (t: string | null) => void;
}) {
  const [config, setConfig] = useState<LeadFinderConfig | null>(null);
  const [prices, setPrices] = useState<EffectiveCreditPrices | null>(null);
  const [mode, setMode] = useState<Mode>("market");
  const [feed, setFeed] = useState<LeadSearchResult | null>(null);
  const [pool, setPool] = useState<LeadPool | null>(null);
  const [band, setBand] = useState("yours");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [when, setWhen] = useState<"any" | "today" | "week">("any");
  const [fitMin, setFitMin] = useState(0);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchTab, setWatchTab] = useState<"watch" | "bp">("watch");
  const [provOpen, setProvOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [exclOpen, setExclOpen] = useState(false);
  const [drawer, setDrawer] = useState<LeadCandidateRow | null>(null);
  const [topicInput, setTopicInput] = useState("");
  const [query, setQuery] = useState("");
  const [directFilters, setDirectFilters] = useState<Record<string, string>>({});
  const [directRows, setDirectRows] = useState<LeadCandidateRow[] | null>(null);
  const [directRan, setDirectRan] = useState(false);
  const watchBtn = useRef<HTMLSpanElement | null>(null);

  const loadConfig = useCallback(async () => {
    const [c, p] = await Promise.all([fetchLeadConfig(), fetchCreditPrices()]);
    if (c) setConfig(c);
    if (p) setPrices(p);
  }, []);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const runFeed = useCallback(async () => {
    setBusy(true);
    const res = await searchLeads("ada", {
      ...(group ? { group } : {}),
      when,
      fitMin: String(fitMin),
    });
    setBusy(false);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    setFeed(res.body as LeadSearchResult);
  }, [flash, group, when, fitMin]);

  useEffect(() => {
    if (config) void runFeed();
  }, [config, runFeed]);

  useEffect(() => {
    if (mode === "fit" && pool === null) void fetchLeadPool().then((p) => p && setPool(p));
  }, [mode, pool]);

  useEffect(() => {
    if (config && onTitle) onTitle(config.title);
    return () => onTitle?.(null);
  }, [config, onTitle]);

  if (!config) {
    return (
      <div style={{ padding: "26px 40px", ...mono, fontSize: 10, color: "var(--cvb-ghost)" }}>
        loading…
      </div>
    );
  }

  const revealPrice = prices?.effective?.lead_reveal ?? null;
  const intentPrice = prices?.effective?.intent_enrichment ?? null;
  const tierOn = config.buyerping.connected;
  const rows = feed?.candidates ?? [];
  const counts = feed?.counts;
  const suppression: LeadSuppression | null = feed?.suppression ?? null;
  const todayCount = counts?.when.today ?? 0;
  const groupLabel = (key: string | null) =>
    key ? (config.watching.find((g) => g.key === key)?.label ?? key) : "";

  /* ------------------------------------------------------------- writes */

  const reveal = async (r: LeadCandidateRow) => {
    const res = await revealLead(r.providerRef);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    const b = res.body as { charged: number; alreadyKnown: boolean };
    flash(
      b.alreadyKnown
        ? `${r.name} was already in your contacts — nothing charged`
        : `${r.name} revealed · ${b.charged} credit${b.charged === 1 ? "" : "s"}`,
    );
    void runFeed();
    setDrawer(null);
  };

  const hide = async (r: LeadCandidateRow) => {
    const res = await hideLead(r.provider, r.providerRef);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash("Hidden — she will stop surfacing people like this");
    void runFeed();
    setDrawer(null);
  };

  const toggleTier = async () => {
    const res = await setBuyerping(!tierOn);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash(
      tierOn
        ? "BuyerPing off — she keeps watching your own records and your site"
        : "BuyerPing on — the extra kinds of moment start arriving",
    );
    await loadConfig();
    void runFeed();
  };

  const addTopic = async () => {
    const label = topicInput.trim();
    if (!label) return;
    const res = await addWatchTopic("topic", label);
    setTopicInput("");
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash(`Watching “${label}”`);
    await loadConfig();
  };

  const dropTopic = async (id: string, label: string) => {
    const res = await removeWatchTopic(id);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash(`Stopped watching “${label}”`);
    await loadConfig();
  };

  const runDirect = async () => {
    setBusy(true);
    const res = await searchLeads("direct", { ...directFilters, ...(query ? { query } : {}) });
    setBusy(false);
    setDirectRan(true);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    setDirectRows((res.body as LeadSearchResult).candidates);
  };

  /* -------------------------------------------------------------- parts */

  const briefCard = (
    <div
      data-testid="bold-lead-brief"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 15,
        background: "linear-gradient(180deg,var(--cvb-card,#fff),var(--cvb-panel,#F7FAF8))",
        border: "1px solid var(--cvb-line)",
        borderRadius: 18,
        padding: "14px 17px",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 10,
          background: "var(--cvb-mint)",
          border: "1px solid var(--cvb-mint-line)",
          color: "var(--cvb-forest)",
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          flex: "none",
        }}
      >
        ✦
      </span>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>
            {config.brief.sentence}
          </span>
          {config.brief.watchingSince ? (
            <span
              data-testid="bold-lead-since"
              onClick={() => setProvOpen(!provOpen)}
              style={{
                ...monoChip,
                color: "var(--cvb-faint)",
                background: "var(--cvb-panel)",
                border: "1px solid var(--cvb-line)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              WATCHING SINCE {shortDate(config.brief.watchingSince)}
              {provOpen ? " ✕" : ""}
            </span>
          ) : null}
        </div>
        {provOpen ? (
          <div
            data-testid="bold-lead-provenance"
            style={{ fontSize: 11, color: "var(--cvb-ghost)", marginTop: 6, lineHeight: 1.5 }}
          >
            {config.brief.provenance}
          </div>
        ) : null}
      </div>
      <span
        ref={watchBtn}
        data-testid="bold-lead-watch-btn"
        onClick={() => {
          setWatchTab("watch");
          setWatchOpen(true);
        }}
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          color: "var(--cvb-faint)",
          background: "var(--cvb-panel)",
          border: "1px solid var(--cvb-line)",
          borderRadius: 11,
          padding: "8px 13px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          flex: "none",
        }}
      >
        What she watches
      </span>
      <span
        data-testid="bold-lead-editbrief"
        onClick={() => void editBrief()}
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          color: "var(--cvb-cyan,#0E7D93)",
          cursor: "pointer",
          flex: "none",
        }}
      >
        Edit brief
      </span>
    </div>
  );

  /** The brief edit writes through the ICP profile — the same shape the
   *  onboarding audience step wrote at first run, so there is one home. */
  async function editBrief() {
    const current = config?.profile;
    if (!current) return;
    const next = window.prompt(
      "Where should she watch? (leave blank to keep it as it is)",
      current.location ?? "",
    );
    if (next === null) return;
    const res = await saveBrief({ ...current, ...(next.trim() ? { location: next.trim() } : {}) });
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash("Brief updated — she watches for this from now on");
    await loadConfig();
    void runFeed();
  }

  const modeRow = (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}
    >
      <span style={{ ...eyebrow, flex: "none" }}>✦ ADA FINDS</span>
      {(
        [
          ["market", `In the market · ${counts?.when.any ?? 0}`],
          ["fit", "All who fit"],
        ] as Array<[Mode, string]>
      ).map(([k, label]) => (
        <span
          key={k}
          onClick={() => setMode(k)}
          data-testid={`bold-lead-mode-${k}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12.5,
            fontWeight: mode === k ? 800 : 600,
            padding: "9px 14px",
            borderRadius: 999,
            cursor: "pointer",
            background: mode === k ? "var(--cvb-ink,#101613)" : "var(--cvb-panel)",
            color: mode === k ? "#fff" : "var(--cvb-faint)",
            border: `1px solid ${mode === k ? "var(--cvb-ink,#101613)" : "var(--cvb-line-ctl)"}`,
          }}
        >
          {label}
          {/* Owner-approved exception to the no-emoji rule, and only when
              something actually fired today. Never permanent. */}
          {k === "market" && todayCount > 0 ? (
            <span data-testid="bold-lead-today-flame" style={{ fontSize: 12, lineHeight: 1 }}>
              🔥
            </span>
          ) : null}
        </span>
      ))}
      <span style={{ width: 1, height: 22, background: "var(--cvb-line)", margin: "0 4px" }} />
      <span style={{ ...eyebrow, flex: "none" }}>YOU FILTER</span>
      <span
        onClick={() => setMode("direct")}
        data-testid="bold-lead-mode-direct"
        style={{
          fontSize: 12.5,
          fontWeight: mode === "direct" ? 800 : 600,
          padding: "9px 15px",
          borderRadius: 999,
          cursor: "pointer",
          background: mode === "direct" ? "var(--cvb-ink,#101613)" : "var(--cvb-panel)",
          color: mode === "direct" ? "#fff" : "var(--cvb-faint)",
          border: `1px solid ${mode === "direct" ? "var(--cvb-ink,#101613)" : "var(--cvb-line-ctl)"}`,
        }}
      >
        Direct search
      </span>
      {group ? (
        <span
          data-testid="bold-lead-sigchip"
          onClick={() => setGroup(null)}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: "var(--cvb-forest)",
            background: "var(--cvb-mint)",
            border: "1px solid var(--cvb-mint-line)",
            borderRadius: 999,
            padding: "7px 12px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Signal: {groupLabel(group)} ✕
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      <span
        data-testid="bold-lead-waiting"
        style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-ghost)" }}
      >
        {feed?.waiting ?? 0} WAITING ON YOU
      </span>
    </div>
  );

  const feedRow = (r: LeadCandidateRow) => {
    const [ff, fb, fd] = fitPill(r.fit);
    return (
      <div
        key={r.id}
        data-testid={`bold-lead-row-${r.providerRef}`}
        onClick={() => setDrawer(r)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 13,
          padding: "14px 6px 14px 13px",
          borderBottom: "1px solid var(--cvb-line-inner)",
          borderLeft: `3px solid ${r.bucket === "today" ? "var(--cvb-amber,#D9A82B)" : "var(--cvb-mint-line)"}`,
          flexWrap: "wrap",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 13,
            display: "grid",
            placeItems: "center",
            background: "var(--cvb-mint)",
            color: "var(--cvb-forest)",
            fontWeight: 900,
            fontSize: 15,
            flex: "none",
          }}
        >
          {initials(r.name)}
        </span>
        <div style={{ flex: 1, minWidth: 190 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</span>
            {r.scored ? (
              <span
                style={{
                  ...mono,
                  fontSize: 10,
                  color: ff,
                  background: fb,
                  border: `1px solid ${fd}`,
                  borderRadius: 999,
                  padding: "2px 7px",
                }}
              >
                {r.fit} fit
              </span>
            ) : (
              <span
                style={{
                  ...mono,
                  fontSize: 10,
                  color: "var(--cvb-ghost)",
                  background: "var(--cvb-panel)",
                  border: "1px dashed var(--cvb-line-ctl)",
                  borderRadius: 999,
                  padding: "2px 7px",
                }}
              >
                unscored
              </span>
            )}
          </div>
          {/* The receipt, in ink — the evidence, not a score. */}
          <div style={{ fontSize: 12.5, color: "var(--cvb-ink,#101613)", marginTop: 4, lineHeight: 1.45 }}>
            {r.receipt}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
            {r.about ? <span style={{ fontSize: 11, color: "var(--cvb-ghost)" }}>{r.about}</span> : null}
            <span
              style={{
                ...monoChip,
                color: "var(--cvb-faint)",
                background: "var(--cvb-panel)",
                border: "1px solid var(--cvb-line)",
              }}
            >
              {r.sourceTag}
            </span>
            <span
              data-testid={`bold-lead-basis-${r.providerRef}`}
              style={{
                ...monoChip,
                color: r.channelWarm ? "var(--cvb-forest)" : "var(--cvb-amber,#8A6D1A)",
                background: r.channelWarm ? "var(--cvb-mint)" : "var(--cvb-amber-bg,#F7EFDA)",
                border: `1px solid ${r.channelWarm ? "var(--cvb-mint-line)" : "var(--cvb-amber-line,#EAD9A8)"}`,
              }}
            >
              {r.channelLabel}
            </span>
          </div>
        </div>
        {r.revealed ? (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: "var(--cvb-faint)",
              background: "var(--cvb-panel)",
              border: "1px solid var(--cvb-line-ctl)",
              borderRadius: 999,
              padding: "3px 9px",
              flex: "none",
            }}
          >
            In your book
          </span>
        ) : (
          <>
            <span
              onClick={(e) => {
                e.stopPropagation();
                void reveal(r);
              }}
              data-testid={`bold-lead-reveal-${r.providerRef}`}
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "#fff",
                background: "var(--cvb-forest)",
                borderRadius: 11,
                padding: "9px 13px",
                cursor: "pointer",
                flex: "none",
                whiteSpace: "nowrap",
              }}
            >
              Reveal{revealPrice != null ? ` · ${revealPrice} cr` : ""}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                void hide(r);
              }}
              data-testid={`bold-lead-notforme-${r.providerRef}`}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--cvb-ghost)",
                cursor: "pointer",
                flex: "none",
                whiteSpace: "nowrap",
              }}
            >
              Not for me
            </span>
          </>
        )}
      </div>
    );
  };

  // A plain computation, deliberately not a hook: everything below sits after
  // the `if (!config)` early return, and a hook there changes the hook order
  // between the loading and loaded renders — React throws.
  const groupsInFeed = (() => {
    const buckets: Array<["today" | "week", string, string]> = [
      ["today", "TODAY", "var(--cvb-amber,#D9A82B)"],
      ["week", "EARLIER THIS WEEK", "var(--cvb-mint-line)"],
    ];
    const older = rows.filter((r) => r.bucket === "older");
    const out = buckets
      .map(([k, label, dot]) => ({ k, label, dot, list: rows.filter((r) => r.bucket === k) }))
      .filter((g) => g.list.length > 0);
    if (older.length > 0) {
      out.push({ k: "week", label: "EARLIER", dot: "var(--cvb-line-ctl)", list: older });
    }
    return out;
  })();

  const marketBody = (
    <div data-testid="bold-lead-feed">
      {groupsInFeed.map((g) => (
        <div key={g.label} style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 4px 6px" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.dot, flex: "none" }} />
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>
              {g.label} · {g.list.length}
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--cvb-line-inner)" }} />
          </div>
          {g.list.map(feedRow)}
        </div>
      ))}

      {rows.length === 0 && !busy ? (
        <div data-testid="bold-lead-empty" style={{ textAlign: "center", padding: "56px 20px" }}>
          <div style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.028em" }}>
            {group || when !== "any" || fitMin > 0
              ? "Nothing matches those filters"
              : "Nothing has fired yet"}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--cvb-ghost)",
              lineHeight: 1.55,
              margin: "8px auto 0",
              maxWidth: 420,
            }}
          >
            {group || when !== "any" || fitMin > 0
              ? "Everything she found is still here — widen the signal type, the window or the fit floor to see it."
              : `Your brief is live and ${config.watching.length} ${
                  config.watching.length === 1 ? "kind" : "kinds"
                } of moment are being watched. Nothing has happened yet — that is the watch working, not a fault.`}
          </div>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          {suppression && suppression.total > 0 ? (
            <div
              data-testid="bold-lead-suppressed"
              style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}
            >
              <span style={{ fontSize: 11.5, color: "var(--cvb-ghost)", flex: 1, minWidth: 200, lineHeight: 1.5 }}>
                {suppression.total} held back for you — {suppression.reasons.map((r) => `${r.n} ${r.label}`).join(", ")}.
              </span>
            </div>
          ) : null}
          {config.locked.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: "var(--cvb-ghost)", flex: 1, minWidth: 200, lineHeight: 1.5 }}>
                {config.locked.length} more {config.locked.length === 1 ? "kind" : "kinds"} of moment could be
                watching for you — {config.locked.map((g) => g.label.toLowerCase()).join(", ")}.
              </span>
              <span
                data-testid="bold-lead-seebp"
                onClick={() => {
                  setWatchTab("bp");
                  setWatchOpen(true);
                }}
                style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-cyan,#0E7D93)", cursor: "pointer" }}
              >
                See what they are
              </span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );

  const activeBand = pool?.bands.find((b) => b.key === band) ?? pool?.bands[0] ?? null;

  const poolBody = !pool ? (
    <div style={{ ...mono, fontSize: 10, color: "var(--cvb-ghost)", marginTop: 22 }}>loading…</div>
  ) : (
    <div data-testid="bold-lead-pool">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: "linear-gradient(180deg,var(--cvb-card,#fff),var(--cvb-panel,#F7FAF8))",
          border: "1px solid var(--cvb-line)",
          borderRadius: 18,
          padding: "14px 18px",
          marginTop: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flex: "none" }}>
          <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: "-.04em" }}>{pool.total}</span>
          <span style={{ fontSize: 13, color: "var(--cvb-faint)" }}>
            {pool.noun.many} you can work today
          </span>
        </div>
        <span style={{ width: 1, height: 26, background: "var(--cvb-line)", flex: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 200, flexWrap: "wrap" }}>
          <span
            onClick={() => {
              setWhyOpen(!whyOpen);
              setExclOpen(false);
            }}
            style={{
              ...monoChip,
              color: "var(--cvb-faint)",
              background: "var(--cvb-panel)",
              border: "1px solid var(--cvb-line)",
              cursor: "pointer",
            }}
          >
            HOW THIS IS SCORED{whyOpen ? " ✕" : ""}
          </span>
          {pool.suppression.total > 0 ? (
            <span
              onClick={() => {
                setExclOpen(!exclOpen);
                setWhyOpen(false);
              }}
              style={{
                ...monoChip,
                color: "var(--cvb-amber,#8A6D1A)",
                background: "var(--cvb-amber-bg,#F7EFDA)",
                border: "1px solid var(--cvb-amber-line,#EAD9A8)",
                cursor: "pointer",
              }}
            >
              {pool.suppression.total} HELD BACK{exclOpen ? " ✕" : ""}
            </span>
          ) : null}
        </div>
      </div>
      {whyOpen ? (
        <div style={{ fontSize: 12, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 9, maxWidth: 640 }}>
          {pool.scoredNote} {config.brief.provenance}
        </div>
      ) : null}
      {exclOpen ? (
        <div style={{ fontSize: 12, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 9, maxWidth: 640 }}>
          {pool.suppression.total} held back:{" "}
          {pool.suppression.reasons.map((r) => `${r.n} ${r.label}`).join(", ")}.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        {pool.bands.map((b) => {
          const on = b.key === band;
          return (
            <div
              key={b.key}
              data-testid={`bold-lead-band-${b.key}`}
              onClick={() => setBand(b.key)}
              style={{
                flex: 1,
                minWidth: 180,
                background: on ? "var(--cvb-mint)" : "var(--cvb-panel)",
                border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line-inner)"}`,
                borderRadius: 16,
                padding: "13px 15px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    ...mono,
                    fontSize: 8.5,
                    letterSpacing: ".14em",
                    color: on ? "var(--cvb-forest)" : "var(--cvb-ghost)",
                    flex: 1,
                  }}
                >
                  {b.tag}
                </span>
                <span
                  style={{
                    ...mono,
                    fontSize: 8.5,
                    letterSpacing: ".12em",
                    color: b.free ? "var(--cvb-forest)" : "var(--cvb-ghost)",
                    flex: "none",
                  }}
                >
                  {b.free ? "FREE" : revealPrice != null ? `${revealPrice} CR` : "1 CR"}
                </span>
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  letterSpacing: "-.03em",
                  marginTop: 6,
                  color: on ? "var(--cvb-forest)" : "var(--cvb-ink,#101613)",
                }}
              >
                {/* Honest absence: no provider count exists on this
                    deployment, so the band says so rather than guessing. */}
                {b.count === null ? "—" : b.count}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.45, marginTop: 3 }}>
                {b.count === null ? (b.note ?? b.sub) : b.sub}
              </div>
            </div>
          );
        })}
      </div>

      {activeBand && activeBand.count !== null ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--cvb-panel)",
              border: "1px solid var(--cvb-line)",
              borderRadius: 14,
              padding: "12px 15px",
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                {activeBand.free
                  ? `All ${activeBand.count} already have details`
                  : `Revealing all ${activeBand.count} costs ${activeBand.count} credits`}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", marginTop: 3 }}>
                {activeBand.free
                  ? "You already hold their details and consent."
                  : "Or reveal a few from the list first."}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0 2px", flexWrap: "wrap" }}>
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-ghost)" }}>
              {activeBand.tag} · {activeBand.count}
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--cvb-line-inner)" }} />
            <span style={{ fontSize: 11.5, color: "var(--cvb-ghost)" }}>Ranked by fit</span>
          </div>
          {activeBand.rows.map((r) => {
            const [ff, fb, fd] = fitPill(r.fit);
            return (
              <div
                key={r.id}
                data-testid={`bold-lead-poolrow-${r.contactId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "13px 6px",
                  borderBottom: "1px solid var(--cvb-line-inner)",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 13,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--cvb-mint)",
                    color: "var(--cvb-forest)",
                    fontWeight: 900,
                    fontSize: 15,
                    flex: "none",
                  }}
                >
                  {initials(r.name)}
                </span>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                    <span
                      style={{
                        ...mono,
                        fontSize: 10,
                        color: ff,
                        background: fb,
                        border: `1px solid ${fd}`,
                        borderRadius: 999,
                        padding: "2px 7px",
                      }}
                    >
                      {r.fit} fit
                    </span>
                    <span
                      style={{
                        ...monoChip,
                        color: "var(--cvb-faint)",
                        background: "var(--cvb-panel)",
                        border: "1px solid var(--cvb-line)",
                      }}
                    >
                      {r.sourceTag}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                    {r.why.slice(0, 3).map((w) => (
                      <span
                        key={w}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--cvb-forest)",
                          background: "var(--cvb-mint)",
                          border: "1px solid var(--cvb-mint-line)",
                          borderRadius: 999,
                          padding: "3px 8px",
                        }}
                      >
                        {w}
                      </span>
                    ))}
                    {r.about ? <span style={{ fontSize: 11, color: "var(--cvb-ghost)" }}>{r.about}</span> : null}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "var(--cvb-forest)", flex: "none" }}>Details on file</span>
              </div>
            );
          })}
          {activeBand.count > activeBand.rows.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 6px 0" }}>
              <span style={{ fontSize: 11.5, color: "var(--cvb-ghost)", flex: 1 }}>
                Showing the top {activeBand.rows.length} of {activeBand.count} by fit.
              </span>
            </div>
          ) : null}
        </>
      ) : activeBand ? (
        <div
          data-testid="bold-lead-band-nocount"
          style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 16, maxWidth: 560 }}
        >
          {activeBand.note}
        </div>
      ) : null}
    </div>
  );

  const unavailable = (
    <div
      data-testid="bold-lead-unavailable"
      style={{
        border: "1px dashed var(--cvb-line-ctl)",
        borderRadius: 18,
        padding: "30px 24px",
        textAlign: "center",
        marginTop: 22,
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 17 }}>Search is temporarily unavailable</div>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--cvb-faint)",
          marginTop: 8,
          maxWidth: 420,
          margin: "8px auto 0",
          lineHeight: 1.55,
        }}
      >
        Nothing for you to fix — your watch is still running, and everything already in the market
        list is unaffected.
      </div>
    </div>
  );

  const directBody = (
    <div data-testid="bold-lead-direct">
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, flexWrap: "wrap" }}>
        <div
          style={{
            flex: 1,
            minWidth: 240,
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "var(--cvb-card,#fff)",
            border: "1px solid var(--cvb-line)",
            borderRadius: 14,
            padding: "0 14px",
            height: 46,
          }}
        >
          <span style={{ color: "var(--cvb-ghost)", fontSize: 14 }}>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="bold-lead-direct-q"
            placeholder={`Describe the ${config.noun.one} you want to find…`}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13.5,
              color: "var(--cvb-ink,#101613)",
            }}
          />
        </div>
        <span
          onClick={() => void runDirect()}
          data-testid="bold-lead-direct-go"
          style={{
            fontSize: 12.5,
            fontWeight: 800,
            color: "#fff",
            background: "var(--cvb-forest)",
            borderRadius: 13,
            padding: "13px 18px",
            cursor: "pointer",
          }}
        >
          Search
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {config.directFilters.map((f) => {
          const cur = directFilters[f.key] ?? f.options[0] ?? "";
          return (
            <span
              key={f.key}
              data-testid={`bold-lead-filter-${f.key}`}
              onClick={() => {
                const i = f.options.indexOf(cur);
                const next = f.options[(i + 1) % f.options.length] ?? cur;
                setDirectFilters({ ...directFilters, [f.key]: next });
              }}
              style={{
                border: "1px solid var(--cvb-line-ctl)",
                borderRadius: 12,
                padding: "9px 13px",
                cursor: "pointer",
                background: "var(--cvb-panel)",
              }}
            >
              <span style={{ ...eyebrow, display: "block" }}>{f.label}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{cur}</span>
            </span>
          );
        })}
      </div>
      {!config.providerPeopleSearch ? (
        <div
          data-testid="bold-lead-ownbook-search"
          style={{ fontSize: 12.5, color: "var(--cvb-faint)", marginTop: 18, lineHeight: 1.55, maxWidth: 560 }}
        >
          Direct search here looks through your own {config.noun.many} — the people you already
          hold. She does not go shopping for {config.noun.many} you have never met.
        </div>
      ) : !config.providerConfigured && directRan ? (
        unavailable
      ) : null}
      {directRows?.map(feedRow)}
      {directRan && directRows?.length === 0 && config.providerConfigured ? (
        <div style={{ textAlign: "center", padding: "40px 20px", fontSize: 13, color: "var(--cvb-ghost)" }}>
          Nothing matched those filters.
        </div>
      ) : null}
    </div>
  );

  /* ------------------------------------------------------- watch panel */

  const watchPanel = (
    <BoldOverlay
      open={watchOpen}
      onClose={() => setWatchOpen(false)}
      anchorRef={watchBtn}
      align="right"
      width={372}
      testId="bold-lead-watch"
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={eyebrow}>WHAT SHE WATCHES</div>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-.03em", marginTop: 3 }}>
            {config.title}
          </div>
        </div>
        <span
          onClick={() => setWatchOpen(false)}
          style={{ fontSize: 12, color: "var(--cvb-ghost)", cursor: "pointer" }}
        >
          ✕
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          background: "var(--cvb-panel)",
          border: "1px solid var(--cvb-line-inner)",
          borderRadius: 11,
          padding: 3,
          marginTop: 11,
        }}
      >
        {(
          [
            ["watch", `Watching · ${config.watching.length}`],
            ["bp", tierOn ? "BuyerPing · on" : "BuyerPing"],
          ] as Array<["watch" | "bp", string]>
        ).map(([k, label]) => (
          <span
            key={k}
            data-testid={`bold-lead-watchtab-${k}`}
            onClick={() => setWatchTab(k)}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 11.5,
              fontWeight: watchTab === k ? 800 : 600,
              color: watchTab === k ? "var(--cvb-ink,#101613)" : "var(--cvb-faint)",
              background: watchTab === k ? "var(--cvb-card,#fff)" : "transparent",
              border: `1px solid ${watchTab === k ? "var(--cvb-line)" : "transparent"}`,
              borderRadius: 9,
              padding: "7px 8px",
              cursor: "pointer",
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {watchTab === "watch" ? (
        <>
          <div style={{ ...eyebrow, marginTop: 13 }}>WATCHING NOW — TAP TO FILTER</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
            {config.watching.map((g) => {
              const on = group === g.key;
              return (
                <div
                  key={g.key}
                  data-testid={`bold-lead-group-${g.key}`}
                  onClick={() => setGroup(on ? null : g.key)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 9,
                    padding: "8px 7px",
                    borderRadius: 10,
                    cursor: "pointer",
                    background: on ? "var(--cvb-mint)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 5,
                      flex: "none",
                      marginTop: 1,
                      background: on ? "var(--cvb-mint)" : "var(--cvb-panel)",
                      border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--cvb-forest)",
                    }}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1, minWidth: 0 }}>{g.label}</span>
                      <span
                        style={{
                          ...monoChip,
                          color: g.tier === "bp" ? "var(--cvb-amber,#8A6D1A)" : "var(--cvb-faint)",
                          background: g.tier === "bp" ? "var(--cvb-amber-bg,#F7EFDA)" : "var(--cvb-panel)",
                          border: `1px solid ${g.tier === "bp" ? "var(--cvb-amber-line,#EAD9A8)" : "var(--cvb-line)"}`,
                          flex: "none",
                        }}
                      >
                        {g.tier === "bp" ? "BUYERPING" : "INCLUDED"}
                      </span>
                      <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: "var(--cvb-forest)", flex: "none" }}>
                        {counts?.groups[g.key] ?? 0}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--cvb-ghost)", lineHeight: 1.45, marginTop: 2 }}>
                      {g.why}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: "1px solid var(--cvb-line-inner)", marginTop: 11, paddingTop: 11 }}>
            <div style={eyebrow}>WHEN IT FIRED</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {(
                [
                  ["any", "Anytime"],
                  ["today", "Today"],
                  ["week", "This week"],
                ] as Array<["any" | "today" | "week", string]>
              ).map(([k, label]) => (
                <span
                  key={k}
                  data-testid={`bold-lead-when-${k}`}
                  onClick={() => setWhen(k)}
                  style={{
                    fontSize: 11.5,
                    fontWeight: when === k ? 800 : 600,
                    color: when === k ? "var(--cvb-forest)" : "var(--cvb-faint)",
                    background: when === k ? "var(--cvb-mint)" : "var(--cvb-panel)",
                    border: `1px solid ${when === k ? "var(--cvb-mint-line)" : "var(--cvb-line)"}`,
                    borderRadius: 999,
                    padding: "5px 11px",
                    cursor: "pointer",
                  }}
                >
                  {label} · {counts?.when[k] ?? 0}
                </span>
              ))}
            </div>
            <div style={{ ...eyebrow, marginTop: 11 }}>FIT AGAINST YOUR BRIEF</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {(
                [
                  [0, "Any fit"],
                  [80, "80 and above"],
                  [90, "90 and above"],
                ] as Array<[number, string]>
              ).map(([n, label]) => (
                <span
                  key={n}
                  data-testid={`bold-lead-fit-${n}`}
                  onClick={() => setFitMin(n)}
                  style={{
                    fontSize: 11.5,
                    fontWeight: fitMin === n ? 800 : 600,
                    color: fitMin === n ? "var(--cvb-forest)" : "var(--cvb-faint)",
                    background: fitMin === n ? "var(--cvb-mint)" : "var(--cvb-panel)",
                    border: `1px solid ${fitMin === n ? "var(--cvb-mint-line)" : "var(--cvb-line)"}`,
                    borderRadius: 999,
                    padding: "5px 11px",
                    cursor: "pointer",
                  }}
                >
                  {label} · {n === 0 ? (counts?.fit.any ?? 0) : (counts?.fit[String(n)] ?? 0)}
                </span>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--cvb-line-inner)", marginTop: 11, paddingTop: 11 }}>
            <div style={eyebrow}>WORDS AND PLACES</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
              {config.watchTopics.map((t) => (
                <span
                  key={t.id}
                  onClick={() => void dropTopic(t.id, t.label)}
                  data-testid={`bold-lead-topic-${t.id}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--cvb-faint)",
                    background: "var(--cvb-panel)",
                    border: "1px solid var(--cvb-line)",
                    borderRadius: 999,
                    padding: "4px 9px",
                    cursor: "pointer",
                  }}
                >
                  {t.label} ✕
                </span>
              ))}
              <input
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addTopic();
                }}
                data-testid="bold-lead-topic-add"
                placeholder="+ add"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--cvb-cyan,#0E7D93)",
                  background: "transparent",
                  border: "1px dashed var(--cvb-line-ctl)",
                  borderRadius: 999,
                  padding: "4px 9px",
                  width: 96,
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--cvb-line-inner)", marginTop: 11, paddingTop: 11 }}>
            <div style={eyebrow}>HOW SHE MAY REACH THEM</div>
            <div
              data-testid="bold-lead-basisline"
              style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 7 }}
            >
              {config.basis}
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 13 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                background: "var(--cvb-amber-bg,#F7EFDA)",
                border: "1px solid var(--cvb-amber-line,#EAD9A8)",
                color: "var(--cvb-amber,#8A6D1A)",
                display: "grid",
                placeItems: "center",
                fontSize: 13,
                flex: "none",
              }}
            >
              ◔
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: "-.02em" }}>BuyerPing</div>
              <div style={{ fontSize: 11, color: "var(--cvb-ghost)", marginTop: 1 }}>
                {tierOn
                  ? `On · ${config.watching.filter((g) => g.tier === "bp").length} more kinds of moment`
                  : "Buyer intent · not on yet"}
              </div>
            </div>
            <span
              style={{
                ...monoChip,
                borderRadius: 999,
                padding: "3px 8px",
                color: tierOn ? "var(--cvb-forest)" : "var(--cvb-amber,#8A6D1A)",
                background: tierOn ? "var(--cvb-mint)" : "var(--cvb-amber-bg,#F7EFDA)",
                border: `1px solid ${tierOn ? "var(--cvb-mint-line)" : "var(--cvb-amber-line,#EAD9A8)"}`,
                flex: "none",
              }}
            >
              {tierOn ? "On" : "Adds real intent"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
            {(tierOn
              ? [
                  "Tells you who is actively looking right now — job posts, new sites, review dips, ad spend moving.",
                  "Signals land on the lead so Ada can open with a reason, not a cold hello.",
                  "You can filter the list down to people showing a specific signal.",
                ]
              : [
                  "Without it, Ada still matches on fit — who looks like your best customers. That works, and it is the default.",
                  "With it, she also knows who is moving right now: hiring, launching a site, spending more on ads, losing reviews.",
                  "The difference is timing. Same list, ordered by who is in the market this week.",
                ]
            ).map((d) => (
              <div key={d} style={{ display: "flex", gap: 8 }}>
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--cvb-mint-line)",
                    flex: "none",
                    marginTop: 6,
                  }}
                />
                <span style={{ flex: 1, fontSize: 12, color: "var(--cvb-faint)", lineHeight: 1.55 }}>{d}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            {(tierOn
              ? [
                  ["SIGNALS TODAY", String(config.buyerping.signalsToday), "across your watch"],
                  ["KINDS WATCHED", String(config.watching.length), "on your plan"],
                  ["COST", intentPrice != null ? `${intentPrice} credits` : "—", "per lead enriched"],
                ]
              : [
                  ["FIT MATCHING", "Included", "works without BuyerPing"],
                  ["INTENT SIGNALS", "Locked", "needs BuyerPing on"],
                  ["COST AFTER", intentPrice != null ? `${intentPrice} credits` : "—", "per lead enriched"],
                ]
            ).map(([n, v, sub]) => (
              <div
                key={n}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "var(--cvb-panel)",
                  border: "1px solid var(--cvb-line-inner)",
                  borderRadius: 12,
                  padding: "9px 10px",
                }}
              >
                <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".12em", color: "var(--cvb-ghost)" }}>{n}</div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-.02em", marginTop: 3 }}>{v}</div>
                <div style={{ fontSize: 10, color: "var(--cvb-ghost)", lineHeight: 1.4, marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>

          {config.locked.length > 0 ? (
            <div style={{ borderTop: "1px solid var(--cvb-line-inner)", marginTop: 12, paddingTop: 11 }}>
              <div style={eyebrow}>NOT WATCHING YET</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 9 }}>
                {config.locked.map((g) => (
                  <div key={g.key} style={{ display: "flex", alignItems: "flex-start", gap: 9, opacity: 0.72 }}>
                    <span
                      style={{
                        width: 15,
                        height: 15,
                        borderRadius: 5,
                        background: "var(--cvb-panel)",
                        border: "1px solid var(--cvb-line)",
                        flex: "none",
                        marginTop: 1,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cvb-faint)" }}>{g.label}</div>
                      <div style={{ fontSize: 10.5, color: "var(--cvb-ghost)", marginTop: 1 }}>
                        {/* No producer exists for licensed supply on this
                            deployment, so there is no honest "would find"
                            number to show. We name the kind and stop. */}
                        {g.estimate ?? g.why}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 13 }}>
            <span
              data-testid="bold-lead-bp-toggle"
              onClick={() => void toggleTier()}
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                color: "#fff",
                background: "var(--cvb-forest)",
                borderRadius: 11,
                padding: "9px 14px",
                cursor: "pointer",
                flex: "none",
                whiteSpace: "nowrap",
              }}
            >
              {tierOn ? "Turn BuyerPing off" : "Turn on BuyerPing"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...mono, fontSize: 10.5, color: "var(--cvb-ink,#101613)" }}>
                {tierOn ? "On · billed with your plan" : "PROPOSED · priced on your plan"}
              </div>
              <div style={{ fontSize: 10, color: "var(--cvb-ghost)" }}>
                Price comes from your plan, not from this page
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--cvb-ghost)", lineHeight: 1.5, marginTop: 9 }}>
            Nothing is watched, and nobody is contacted, until you switch it on.
          </div>
        </>
      )}
    </BoldOverlay>
  );

  /* ------------------------------------------------------- lead drawer */

  const leadDrawer = (
    <BoldSheet open={drawer !== null} onClose={() => setDrawer(null)} testId="bold-lead-drawer">
      {drawer ? (
        <div style={{ padding: "22px 22px 30px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                display: "grid",
                placeItems: "center",
                background: "var(--cvb-mint)",
                color: "var(--cvb-forest)",
                fontWeight: 900,
                fontSize: 16,
                flex: "none",
              }}
            >
              {initials(drawer.name)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-.03em" }}>{drawer.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", marginTop: 2 }}>
                {drawer.about || drawer.sourceTag}
              </div>
            </div>
            <span
              onClick={() => setDrawer(null)}
              style={{ fontSize: 13, color: "var(--cvb-ghost)", cursor: "pointer" }}
            >
              ✕
            </span>
          </div>

          {/* §10: the drawer reads ONLY fields the row itself carries. */}
          <div style={{ marginTop: 18 }}>
            <div style={eyebrow}>WHAT SHE SAW</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>{drawer.receipt}</div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={eyebrow}>WHY IT SCORED WHAT IT SCORED</div>
            <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 6 }}>
              {drawer.scored
                ? drawer.fitReasons.join(" · ")
                : "No fact in your brief matched this one yet, so she has not put a number on it."}
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={eyebrow}>HOW SHE MAY REACH THEM</div>
            <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 6 }}>
              {drawer.channelLabel}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            {[
              ["FIT", drawer.scored ? String(drawer.fit) : "unscored", "against your own book"],
              ["WHERE IT CAME FROM", drawer.sourceTag, drawer.basis.replace(/_/g, " ")],
              [
                "REVEAL",
                drawer.revealed ? "Already yours" : revealPrice != null ? `${revealPrice} credit` : "1 credit",
                "email and phone",
              ],
            ].map(([n, v, sub]) => (
              <div
                key={n}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "var(--cvb-panel)",
                  border: "1px solid var(--cvb-line-inner)",
                  borderRadius: 12,
                  padding: "9px 10px",
                }}
              >
                <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".12em", color: "var(--cvb-ghost)" }}>{n}</div>
                <div style={{ fontSize: 13, fontWeight: 800, marginTop: 3 }}>{v}</div>
                <div style={{ fontSize: 10, color: "var(--cvb-ghost)", marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
            {!drawer.revealed ? (
              <span
                data-testid="bold-lead-drawer-reveal"
                onClick={() => void reveal(drawer)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: "#fff",
                  background: "var(--cvb-forest)",
                  borderRadius: 12,
                  padding: "11px 14px",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Reveal · {revealPrice != null ? `${revealPrice} credit` : "1 credit"}
              </span>
            ) : null}
            <span
              data-testid="bold-lead-drawer-hide"
              onClick={() => void hide(drawer)}
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: "#B0483A",
                background: "var(--cvb-card,#fff)",
                border: "1px solid #F0D2CB",
                borderRadius: 12,
                padding: "11px 14px",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              Not a fit — hide it
            </span>
          </div>
        </div>
      ) : null}
    </BoldSheet>
  );

  return (
    <div style={{ padding: "22px 40px 40px" }} data-testid="bold-leadfinder">
      <div
        data-testid="bold-lead-value"
        style={{
          fontSize: 13,
          color: "var(--cvb-faint)",
          lineHeight: 1.5,
          maxWidth: 660,
          margin: "-12px 0 12px",
        }}
      >
        She watches for the moment someone needs what you sell, then hands you the reason. You only
        spend a credit when you want their details.
      </div>
      {briefCard}
      {modeRow}
      {mode === "market" ? marketBody : mode === "fit" ? poolBody : directBody}
      {watchPanel}
      {leadDrawer}
    </div>
  );
}
