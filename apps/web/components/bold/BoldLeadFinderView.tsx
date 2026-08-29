"use client";

/**
 * B6 (DEC-131): the Lead finder — the prototype's three modes on the real
 * seam, every departure honest and flagged:
 *  - ADA'S MATCHES: the ICP card composed from the REAL profile; keyless,
 *    the pool is the workspace's OWN book (lapsed, lost, unworked) ranked by
 *    our scorer with factual receipts — never the prototype's fixture rows;
 *  - SEARCH IT YOURSELF: registry filter tiles per ICP shape (ruling 3 —
 *    no hard-coded B2B nouns); DIRECT SEARCH: the free-text people search.
 *    Both answer "provider not connected" keylessly; consumer-shape
 *    workspaces see neither (first-party only, ever).
 *  - Fit is the headline, intent the second tier (§4.6). Reveal is the paid
 *    step, priced from the live CreditPrice table, charged once ever.
 *  - The BuyerPing chip + drawer port with real signal counts and the
 *    watch-topics editor; "Save this search" (a toast even in the proto) is
 *    visibly deferred — scouts are Q-104.
 */
import { useCallback, useEffect, useState } from "react";
import {
  addWatchTopic,
  fetchCreditPrices,
  fetchLeadConfig,
  hideLead,
  removeWatchTopic,
  revealLead,
  searchLeads,
  setBuyerping,
  type LeadCandidateRow,
  type LeadFinderConfig,
} from "./bold-live";
import type { BoldDrawerState } from "./BoldDrawer";
import { mono } from "./bold-cards";
import type { EffectiveCreditPrices } from "@clientforce/core";

type Mode = "ada" | "own" | "legacy";
const MODES: Array<[Mode, string]> = [
  ["ada", "Ada's matches"],
  ["own", "Search it yourself"],
  ["legacy", "Direct search"],
];

const fitPill = (fit: number): [string, string, string] =>
  fit >= 90
    ? ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"]
    : fit >= 80
      ? ["var(--cvb-cyan,#0E7D93)", "var(--cvb-cyan-tint,#E2F3F6)", "var(--cvb-cyan-line,#BFE3EB)"]
      : ["var(--cvb-faint)", "var(--cvb-panel)", "var(--cvb-line-ctl)"];

export function BoldLeadFinderView({
  onOpenDrawer,
  flash,
}: {
  onOpenDrawer: (d: BoldDrawerState) => void;
  flash: (msg: string) => void;
}) {
  const [config, setConfig] = useState<LeadFinderConfig | null>(null);
  const [prices, setPrices] = useState<EffectiveCreditPrices | null>(null);
  const [mode, setMode] = useState<Mode>("ada");
  const [rows, setRows] = useState<LeadCandidateRow[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bpOpen, setBpOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [topicInput, setTopicInput] = useState("");

  const loadConfig = useCallback(async () => {
    const [c, p] = await Promise.all([fetchLeadConfig(), fetchCreditPrices()]);
    if (c) setConfig(c);
    if (p) setPrices(p);
  }, []);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const runSearch = useCallback(
    async (m: Mode, extra?: Record<string, string>) => {
      setBusy(true);
      const res = await searchLeads(m === "ada" ? "ada" : "direct", extra);
      setBusy(false);
      setSearched(true);
      if (!res.ok) {
        flash(res.error);
        return;
      }
      const body = res.body as { providerConfigured: boolean; candidates: LeadCandidateRow[] };
      setRows(body.candidates);
      if (m === "ada") flash("Ada ran the search");
    },
    [flash],
  );

  // Ada mode opens with its search already run — the prototype's posture,
  // on real rows.
  useEffect(() => {
    if (mode === "ada" && rows === null && config) void runSearch("ada");
  }, [mode, rows, config, runSearch]);

  if (!config) {
    return <div style={{ padding: "26px 40px", ...mono, fontSize: 10, color: "var(--cvb-ghost)" }}>loading…</div>;
  }
  const consumerShape = config.profile.shape === "consumer";
  const revealPrice = prices?.effective?.lead_reveal ?? null;
  const intentPrice = prices?.effective?.intent_enrichment ?? null;

  const pick = (m: Mode) => {
    setMode(m);
    setRows(m === "ada" ? rows : null);
    setSearched(false);
  };

  const reveal = async (r: LeadCandidateRow) => {
    const res = await revealLead(r.providerRef);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    const body = res.body as { contactId: string; charged: number; alreadyKnown: boolean };
    flash(
      body.alreadyKnown
        ? `${r.name} was already in your contacts — nothing charged`
        : `Revealed ${r.name} · ${body.charged} credit${body.charged === 1 ? "" : "s"}`,
    );
    setRows((cur) =>
      (cur ?? []).map((x) => (x.id === r.id ? { ...x, revealed: true, contactId: body.contactId } : x)),
    );
  };

  const hide = async (r: LeadCandidateRow) => {
    const res = await hideLead(r.provider, r.providerRef);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash("Hidden. Ada stops surfacing this profile.");
    setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id));
  };

  /* ------------------------------------------------------------ pieces */
  const bpChip = (
    <span
      onClick={() => setBpOpen(true)}
      data-testid="bold-lead-bp-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        borderRadius: 999,
        padding: "8px 13px",
        fontSize: 11.5,
        fontWeight: 700,
        cursor: "pointer",
        color: config.buyerping.connected ? "var(--cvb-forest)" : "var(--cvb-amber)",
        background: config.buyerping.connected ? "var(--cvb-mint)" : "var(--cvb-amber-bg)",
        border: `1px solid ${config.buyerping.connected ? "var(--cvb-mint-line)" : "var(--cvb-amber-line)"}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: config.buyerping.connected ? "var(--cvb-forest)" : "var(--cvb-amber)" }} />
      {config.buyerping.connected ? "BuyerPing connected" : "Add buyer intent"}
    </span>
  );

  const candidateRow = (r: LeadCandidateRow) => {
    const [ff, fb, fd] = fitPill(r.fit);
    return (
      <div key={r.id} style={{ display: "flex", gap: 13, alignItems: "center", padding: "15px 6px", borderBottom: "1px solid var(--cvb-line-inner)" }}>
        <span style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center", background: "var(--cvb-mint)", color: "var(--cvb-forest)", fontWeight: 900, fontSize: 15, flex: "none" }}>
          {r.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </span>
        <div
          style={{ flex: 1, minWidth: 0, cursor: r.contactId ? "pointer" : "default" }}
          onClick={() =>
            r.contactId &&
            onOpenDrawer({
              t: "person",
              contact: { id: r.contactId, firstName: r.name.split(" ")[0] ?? null, lastName: r.name.split(" ").slice(1).join(" ") || null, email: null },
            })
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{r.name}</span>
            <span style={{ ...mono, fontSize: 10, color: ff, background: fb, border: `1px solid ${fd}`, borderRadius: 999, padding: "2px 8px" }}>{r.fit} fit</span>
            {r.intentWeight > 0 ? (
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "2px 8px" }}>
                {r.intentReceipts[0] ?? "showing intent"}
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: "var(--cvb-ghost)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[r.title, r.company, r.location, r.headcount ? `${r.headcount} staff` : null].filter(Boolean).join(" · ") || "—"}
          </div>
          <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-ghost)", marginTop: 3 }}>{r.fitReasons.slice(0, 2).join(" · ")}</div>
        </div>
        {r.origin === "provider" ? (
          r.revealed ? (
            <span style={{ ...mono, fontSize: 10, color: "var(--cvb-ghost)", flex: "none" }}>Revealed</span>
          ) : (
            <>
              <span onClick={() => void reveal(r)} data-testid={`bold-lead-reveal-${r.providerRef}`} style={{ fontSize: 11.5, fontWeight: 800, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 10, padding: "7px 12px", cursor: "pointer", flex: "none" }}>
                Reveal{revealPrice != null ? ` · ${revealPrice} cr` : ""}
              </span>
              <span onClick={() => void hide(r)} style={{ fontSize: 11.5, fontWeight: 700, color: "#B0483A", border: "1px solid #F0D2CB", borderRadius: 10, padding: "7px 10px", cursor: "pointer", flex: "none" }}>
                Hide
              </span>
            </>
          )
        ) : (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--cvb-faint)", background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 999, padding: "3px 9px", flex: "none" }}>
            In your book
          </span>
        )}
      </div>
    );
  };

  const notConnected = (
    <div data-testid="bold-lead-noprovider" style={{ border: "1px dashed var(--cvb-line-ctl)", borderRadius: 18, padding: "30px 24px", textAlign: "center", marginTop: 22 }}>
      <div style={{ fontWeight: 900, fontSize: 17 }}>The lead-data provider isn&rsquo;t connected</div>
      <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", marginTop: 8, maxWidth: 420, margin: "8px auto 0", lineHeight: 1.55 }}>
        Direct search needs the provider key on the server. Ada&rsquo;s matches still work — she
        ranks your own book: lapsed, lost and never-worked contacts, honestly.
      </div>
    </div>
  );

  return (
    <div style={{ padding: "26px 40px 40px" }} data-testid="bold-leadfinder">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {MODES.filter(([k]) => k === "ada" || !consumerShape).map(([k, label]) => (
          <span
            key={k}
            onClick={() => pick(k)}
            data-testid={`bold-lead-mode-${k}`}
            style={{ fontSize: 12.5, fontWeight: mode === k ? 800 : 700, padding: "9px 15px", borderRadius: 999, cursor: "pointer", background: mode === k ? "var(--cvb-ink,#101613)" : "var(--cvb-panel)", color: mode === k ? "#fff" : "var(--cvb-faint)", border: `1px solid ${mode === k ? "var(--cvb-ink,#101613)" : "var(--cvb-line-ctl)"}` }}
          >
            {label}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        {bpChip}
      </div>
      {consumerShape ? (
        <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-ghost)", marginTop: 10 }}>
          Consumer-shape workspace — finding runs on your own activity only; nothing is ever bought about individuals.
        </div>
      ) : null}

      {/* ── ADA MODE ── */}
      {mode === "ada" ? (
        <div style={{ background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 20, padding: "19px 20px", marginTop: 18, display: "flex", gap: 14, alignItems: "flex-start" }}>
          <span style={{ color: "var(--cvb-forest)", fontSize: 15, flex: "none" }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: "#1D5B34", lineHeight: 1.55 }} data-testid="bold-lead-icp">
              {config.providerConfigured
                ? "I search the provider's book and yours together, scored against your closed business — no keywords needed."
                : "The provider isn't connected, so I rank YOUR book: contacts who went quiet, said not-now, or were never worked — scored against your closed business."}
              {config.buyerping.connected && config.buyerping.signalsToday > 0
                ? ` BuyerPing sees ${config.buyerping.signalsToday} signal${config.buyerping.signalsToday === 1 ? "" : "s"} today.`
                : ""}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {[
                config.profile.shape === "local_business" ? "local business" : config.profile.shape,
                ...(config.profile.vertical ? [config.profile.vertical] : []),
                config.buyerping.connected ? "intent connected" : "intent not connected",
              ].map((c) => (
                <span key={c} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--cvb-forest)", background: "#fff", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "3px 9px" }}>{c}</span>
              ))}
            </div>
          </div>
          <span onClick={() => void runSearch("ada")} data-testid="bold-lead-search" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 12, padding: "11px 17px", cursor: "pointer", flex: "none", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Searching…" : rows ? "Search again" : "Search"}
          </span>
        </div>
      ) : null}

      {/* ── SEARCH IT YOURSELF (registry tiles per shape) ── */}
      {mode === "own" && !consumerShape ? (
        <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 20, padding: "18px 20px", marginTop: 18 }}>
          <div style={{ fontWeight: 900, fontSize: 17 }}>Search it yourself</div>
          <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>
            Same data Ada searches. Set the filters and she still scores every result against your closed business.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginTop: 14 }}>
            {config.directFilters.map((f) => {
              const val = filters[f.key] ?? f.options[0]!;
              return (
                <div
                  key={f.key}
                  onClick={() => {
                    const i = f.options.indexOf(val);
                    setFilters((cur) => ({ ...cur, [f.key]: f.options[(i + 1) % f.options.length]! }));
                  }}
                  style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: "11px 13px", cursor: "pointer" }}
                >
                  <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>{f.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{val}</div>
                </div>
              );
            })}
            <div
              onClick={() => (config.buyerping.connected ? null : setBpOpen(true))}
              style={{ background: "var(--cvb-card)", border: `1px solid ${config.buyerping.connected ? "var(--cvb-line-ctl)" : "var(--cvb-amber-line)"}`, borderRadius: 13, padding: "11px 13px", cursor: "pointer" }}
            >
              <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".14em", color: config.buyerping.connected ? "var(--cvb-faint)" : "var(--cvb-amber)" }}>BUYER INTENT</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: config.buyerping.connected ? "var(--cvb-ink,#101613)" : "var(--cvb-amber)" }}>
                {config.buyerping.connected ? "Any signal" : "Not available"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
            <span onClick={() => void runSearch("own", filters)} data-testid="bold-lead-run" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 12, padding: "11px 17px", cursor: "pointer" }}>
              Run this search
            </span>
            <span style={{ fontSize: 11, color: "var(--cvb-ghost)" }}>
              Searching is free.{revealPrice != null ? ` ${revealPrice} credit${revealPrice === 1 ? "" : "s"} each time you reveal a contact.` : ""}
            </span>
          </div>
        </div>
      ) : null}

      {/* ── DIRECT SEARCH (free text) ── */}
      {mode === "legacy" && !consumerShape ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Job title, company or keyword…"
              data-testid="bold-lead-query"
              style={{ flex: 1, fontSize: 13, border: "1px solid var(--cvb-line-ctl)", borderRadius: 12, padding: "11px 14px" }}
            />
            <span onClick={() => void runSearch("legacy", { query })} data-testid="bold-lead-go" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 12, padding: "11px 17px", cursor: "pointer" }}>
              Search
            </span>
            <span title="Scouts arrive as their own unit" style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-ghost)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 12, padding: "11px 14px", cursor: "default" }}>
              Save this search — coming soon
            </span>
          </div>
        </div>
      ) : null}

      {/* ── RESULTS ── */}
      {rows && rows.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 6 }} data-testid="bold-lead-count">
            {rows.length} FOUND
          </div>
          <div>{rows.map(candidateRow)}</div>
          <div style={{ fontSize: 11, color: "var(--cvb-ghost)", marginTop: 10 }}>
            The number beside each row is Ada&rsquo;s fit score against your closed business. Intent, when
            shown, is the second tier — a reason with a receipt, never a guess.
          </div>
        </div>
      ) : null}
      {rows && rows.length === 0 && searched ? (
        mode === "ada" ? (
          <div style={{ textAlign: "center", padding: "50px 20px" }}>
            <div style={{ fontWeight: 900, fontSize: 19 }}>Nothing to stage yet</div>
            <div style={{ fontSize: 13, color: "var(--cvb-ghost)", marginTop: 6, maxWidth: 380, margin: "6px auto 0" }}>
              Your book has no lapsed or unworked contacts to rank{config.providerConfigured ? "" : ", and the provider isn't connected"}.
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "50px 20px" }}>
            <div style={{ fontWeight: 900, fontSize: 19 }}>Nothing found on those filters</div>
            <div style={{ fontSize: 13, color: "var(--cvb-ghost)", marginTop: 6 }}>Widen a filter, or let Ada search from your closed business instead.</div>
          </div>
        )
      ) : null}
      {(mode === "own" || mode === "legacy") && !consumerShape && !config.providerConfigured && !searched
        ? notConnected
        : null}

      {/* ── BuyerPing drawer ── */}
      {bpOpen ? (
        <>
          <div onClick={() => setBpOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,14,12,.16)", zIndex: 70 }} />
          <div data-testid="bold-lead-bp" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 400, maxWidth: "92%", background: "var(--cvb-card)", borderLeft: "1px solid var(--cvb-line-ctl)", zIndex: 71, overflowY: "auto", padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--cvb-amber-bg)", border: "1px solid var(--cvb-amber-line)", color: "var(--cvb-amber)", fontSize: 15, flex: "none" }}>◔</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800 }}>BuyerPing</div>
                <div style={{ fontSize: 11, color: "var(--cvb-ghost)" }}>
                  {config.buyerping.connected ? `Connected · ${config.buyerping.signalsToday} signal${config.buyerping.signalsToday === 1 ? "" : "s"} today` : "Buyer intent · not connected"}
                </div>
              </div>
              <span onClick={() => setBpOpen(false)} data-testid="bold-lead-bp-close" style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", border: "1px solid var(--cvb-line-ctl)", color: "var(--cvb-faint)", cursor: "pointer" }}>✕</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 14 }}>
              {config.buyerping.connected
                ? "Signals land on the lead with a plain reason, so Ada can open with timing instead of a cold hello. Your own activity — chats, forms, replies, calls — is the free tier and runs in real time."
                : "Without it, Ada still matches on fit — who looks like your best customers. That works, and it is the default. With it, she also knows who is moving right now, from your own live activity first."}
            </div>
            {intentPrice != null ? (
              <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-ghost)", marginTop: 10 }}>
                provider intent enrichment · {intentPrice} credits per lead — first-party signals are included
              </div>
            ) : null}
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", margin: "18px 0 8px" }}>WATCH TOPICS — WHAT COUNTS AS BUYING INTENT</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {config.watchTopics.map((t) => (
                <span key={t.id} onClick={() => void removeWatchTopic(t.id).then(() => loadConfig())} title="Remove" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
                  ✓ {t.label}
                </span>
              ))}
              {(config.topicSuggestions.byVertical[config.profile.vertical ?? ""] ?? config.topicSuggestions.fallback)
                .filter((s) => !config.watchTopics.some((t) => t.label === s))
                .map((s) => (
                  <span key={s} onClick={() => void addWatchTopic("topic", s).then(() => loadConfig())} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-faint)", background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
                    ＋ {s}
                  </span>
                ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input value={topicInput} onChange={(e) => setTopicInput(e.target.value)} placeholder="Add your own…" data-testid="bold-lead-topic-input" style={{ flex: 1, fontSize: 12, border: "1px solid var(--cvb-line-ctl)", borderRadius: 10, padding: "8px 11px" }} />
              <span
                onClick={() =>
                  topicInput.trim() &&
                  void addWatchTopic("topic", topicInput.trim()).then(() => {
                    setTopicInput("");
                    void loadConfig();
                  })
                }
                data-testid="bold-lead-topic-add"
                style={{ fontSize: 11.5, fontWeight: 800, color: "var(--cvb-forest)", border: "1px solid var(--cvb-mint-line)", borderRadius: 10, padding: "8px 12px", cursor: "pointer" }}
              >
                Add
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              {config.buyerping.connected ? (
                <span onClick={() => void setBuyerping(false).then(() => { flash("BuyerPing disconnected — fit matching still runs"); void loadConfig(); })} data-testid="bold-lead-bp-toggle" style={{ fontSize: 12, fontWeight: 800, color: "#B0483A", border: "1px solid #F0D2CB", borderRadius: 11, padding: "10px 14px", cursor: "pointer" }}>
                  Disconnect BuyerPing
                </span>
              ) : (
                <span onClick={() => void setBuyerping(true).then(() => { flash("BuyerPing connected — your own signals count from now"); void loadConfig(); })} data-testid="bold-lead-bp-toggle" style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 11, padding: "10px 15px", cursor: "pointer" }}>
                  Connect BuyerPing
                </span>
              )}
              <span onClick={() => setBpOpen(false)} style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-faint)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 14px", cursor: "pointer" }}>
                Not now
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
