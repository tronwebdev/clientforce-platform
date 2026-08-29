"use client";

/**
 * B7 (DEC-132): the credits spend view — the prototype's credits surface on
 * the REAL spine: `Workspace.creditBalance` + the `CreditLedger` rows the
 * reveal debit (B6) and backoffice adjustments write, and the effective-dated
 * `CreditPrice` table for "what things cost" (D1/D2 — prices are data, never
 * UI constants).
 *
 * Honesty rails: the prototype's monthly-allowance %, burn rate and runway
 * derive from a plan model that does not exist yet — nothing here fakes
 * them. "Where they go" is real ledger aggregation only; sends, SMS and call
 * minutes do not draw down credits yet (Q-108) and the surface says so.
 * Top-ups and auto top-up need the billing rail (B9) — visibly deferred
 * (Q-111); the ledger list below them is real.
 */
import { useEffect, useState } from "react";
import type { EffectiveCreditPrices } from "@clientforce/core";
import { mono } from "./bold-cards";
import { fetchCreditPrices, fetchCreditsSummary, type CreditsSummary } from "./bold-live";

const TABS = ["Where they go", "What things cost", "Top-ups"] as const;

/** DEC-129-style registry: friendly copy per PRICE ACTION key; an unknown
 *  action renders its raw key in mono rather than being hidden. */
const ACTION_META: Record<string, { ic: string; label: string; sub: string }> = {
  email_send: { ic: "✉", label: "An email", sub: "Includes the writing." },
  sms_send: { ic: "✆", label: "An SMS", sub: "Per message sent." },
  sms_segment: { ic: "✆", label: "An SMS segment", sub: "She keeps messages inside one." },
  voice_minute: { ic: "☎", label: "A call minute", sub: "Rounded up per minute." },
  call_minute: { ic: "☎", label: "A call minute", sub: "Rounded up per minute." },
  enrichment: { ic: "◉", label: "Enriching a contact", sub: "Charged once per contact, ever." },
  lead_reveal: { ic: "◎", label: "Revealing a lead", sub: "Their contact details, charged once ever." },
  intent_enrichment: { ic: "◈", label: "Intent enrichment", sub: "Provider warm signals on a lead." },
  widget_conversation: { ic: "◬", label: "A site-agent conversation", sub: "Per conversation the widget holds." },
  ada_draft: { ic: "✦", label: "Anything Ada writes", sub: "Drafting and deciding." },
};

const LEDGER_META: Record<string, string> = {
  lead_reveal: "Lead reveals",
  backoffice_adjustment: "Platform adjustment",
  adjustment: "Platform adjustment",
};

export function BoldCreditsView() {
  const [summary, setSummary] = useState<CreditsSummary | null>(null);
  const [prices, setPrices] = useState<EffectiveCreditPrices | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Where they go");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const [s, p] = await Promise.all([fetchCreditsSummary(), fetchCreditPrices()]);
      setSummary(s);
      setPrices(p);
      setLoaded(true);
    })();
  }, []);

  const spentTotal = (summary?.spent ?? []).reduce((n, r) => n + r.credits, 0);
  const maxRow = Math.max(1, ...(summary?.spent ?? []).map((r) => r.credits));

  return (
    <div data-testid="bold-credits" style={{ padding: "26px 40px 40px" }}>
      <div
        style={{
          background: "var(--cvb-forest)",
          borderRadius: 24,
          padding: "26px 28px",
          color: "#fff",
          display: "flex",
          gap: 26,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: "none" }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "rgba(255,255,255,.75)" }}>CREDITS LEFT</div>
          <div data-testid="bold-credits-balance" style={{ fontWeight: 900, fontSize: 40, letterSpacing: "-.036em", lineHeight: 1, marginTop: 10 }}>
            {loaded && summary ? summary.balance.toLocaleString("en-US") : "—"}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220, display: "flex", gap: 22, flexWrap: "wrap" }}>
          <div>
            <div style={{ ...mono, fontSize: 9, letterSpacing: ".14em", color: "rgba(255,255,255,.7)" }}>SPENT THIS MONTH</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginTop: 6 }}>{loaded ? spentTotal.toLocaleString("en-US") : "—"}</div>
          </div>
          <div>
            <div style={{ ...mono, fontSize: 9, letterSpacing: ".14em", color: "rgba(255,255,255,.7)" }}>ADDED THIS MONTH</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginTop: 6 }}>
              {loaded ? (summary?.added ?? []).reduce((n, r) => n + r.credits, 0).toLocaleString("en-US") : "—"}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 180, fontSize: 11.5, color: "rgba(255,255,255,.82)", lineHeight: 1.55, alignSelf: "center" }}>
            Only lead reveals draw credits down so far — sends, SMS and call minutes don&rsquo;t meter yet, so what&rsquo;s here is the
            whole truth.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 5, background: "var(--cvb-panel)", borderRadius: 13, padding: 4, width: "fit-content", margin: "22px 0 18px" }}>
        {TABS.map((t) => (
          <span
            key={t}
            onClick={() => setTab(t)}
            style={{ fontSize: 12.5, fontWeight: 700, padding: "9px 16px", borderRadius: 10, cursor: "pointer", background: tab === t ? "var(--cvb-card)" : "transparent", color: tab === t ? "var(--cvb-ink)" : "var(--cvb-faint)" }}
          >
            {t}
          </span>
        ))}
      </div>

      {tab === "Where they go" ? (
        <div style={{ maxWidth: 620 }}>
          {(summary?.spent ?? []).length === 0 ? (
            <div data-testid="bold-credits-empty" style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
              Nothing has drawn down credits this month. Reveals in the Lead finder are the first thing that does — email, SMS and call
              minutes don&rsquo;t meter yet, and this page will say so the day they start.
            </div>
          ) : (
            (summary?.spent ?? []).map((r) => (
              <div key={r.reason} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, flex: 1, letterSpacing: "-.014em" }}>
                    {LEDGER_META[r.reason] ?? r.reason}
                  </span>
                  <span style={{ ...mono, fontSize: 10.5, color: "var(--cvb-muted)" }}>
                    {r.credits.toLocaleString("en-US")} credit{r.credits === 1 ? "" : "s"} · {r.entries} time{r.entries === 1 ? "" : "s"}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--cvb-panel)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: 6, width: `${Math.round((r.credits / maxRow) * 100)}%`, background: "var(--cvb-forest)", borderRadius: 3 }} />
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === "What things cost" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, maxWidth: 900 }}>
          {prices == null || Object.keys(prices.effective).length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>No prices are set for this workspace yet.</div>
          ) : (
            Object.entries(prices.effective)
              .sort(([, a], [, b]) => a - b)
              .map(([action, credits]) => {
                const meta = ACTION_META[action];
                return (
                  <div key={action} data-testid={`bold-credits-rate-${action}`} style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 18, padding: 17 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 30, height: 30, borderRadius: 10, flex: "none", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", color: "var(--cvb-forest)", display: "grid", placeItems: "center", fontSize: 13 }}>
                        {meta?.ic ?? "◇"}
                      </span>
                      <span style={{ fontWeight: 800, fontSize: 13.5, letterSpacing: "-.02em", flex: 1 }}>
                        {meta?.label ?? <span style={mono}>{action}</span>}
                      </span>
                      <span style={{ ...mono, fontSize: 13, fontWeight: 700, color: "var(--cvb-forest)" }}>
                        {credits} cr
                      </span>
                    </div>
                    {meta?.sub ? <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 8 }}>{meta.sub}</div> : null}
                  </div>
                );
              })
          )}
          <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
            Prices are effective-dated platform data — when your agency has its own rates, these update by themselves. Only reveals charge
            today; the others start charging when their metering lands.
          </div>
        </div>
      ) : null}

      {tab === "Top-ups" ? (
        <div style={{ maxWidth: 620 }}>
          <div
            data-testid="bold-credits-topup-deferred"
            style={{ background: "var(--cvb-well)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 16, padding: "15px 17px", fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6 }}
          >
            Buying credits and auto top-up arrive with the billing rail — card, receipts and packs together. Until then, top-ups happen
            through your platform contact and land in the ledger below.
          </div>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)", margin: "22px 0 12px" }}>THE LEDGER — NEWEST FIRST</div>
          {(summary?.recent ?? []).length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>No entries yet — the first reveal or adjustment starts it.</div>
          ) : (
            (summary?.recent ?? []).map((e, i, arr) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 2px", borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--cvb-line-inner)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{LEDGER_META[e.reason] ?? e.reason}</div>
                  <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 2 }}>
                    {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · balance after{" "}
                    {e.balanceAfter.toLocaleString("en-US")}
                  </div>
                </div>
                <span style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: e.delta < 0 ? "var(--cvb-ink)" : "var(--cvb-forest)" }}>
                  {e.delta > 0 ? "+" : ""}
                  {e.delta.toLocaleString("en-US")}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
