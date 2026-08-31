"use client";

/**
 * Credits and usage (SURFACE_SPEC_SETTINGS §9).
 *
 * The design is a dark hero plus three tabs, and this adopts it. What it does
 * NOT do is fill that design with numbers nobody can compute. The answer to
 * "the design is dishonest" was never "ship a worse design" — it is "render
 * only what is true, and say what is missing and why".
 *
 * So, per field (§9.3):
 *
 *  - **Balance** — the workspace's own balance. Always there.
 *  - **What things cost** — `CreditPrice`, effective-dated, resolved
 *    server-side. No per-action price is written in this file; if a price is
 *    missing from the table the row is missing from the page.
 *  - **Where they go** — the ledger, grouped by what wrote it. Only kinds
 *    with a debit path appear. The rest are NAMED as not-metered-yet rather
 *    than drawn as a zero bar, because a zero bar reads as a measurement.
 *  - **Included monthly · % of allowance** — no plan carries a credit
 *    allowance, so the bar and its tile do not render at all. Inventing a
 *    denominator would make every percentage on the page a fiction.
 *  - **Burn · Runs out · runway** — need real history. Below the minimum they
 *    are absent with the reason; a projection from three days of data is a
 *    fabrication with a progress bar drawn on it.
 *  - **Auto top-up · invoices · buying** — need billing. Visibly deferred.
 *
 * The buy flow lives in the right-hand drawer, not the prototype's centred
 * modal: every add in settings opens the same drawer, and that rule is newer
 * than the prototype.
 */
import { useEffect, useState } from "react";
import type { EffectiveCreditPrices } from "@clientforce/core";
import { mono } from "./bold-cards";
import { AbsentBecause, CHIP, EYEBROW, PrimaryButton, SettingsDrawer, StepDots, StepPrompt, ChoiceRow } from "./bold-settings-kit";
import { fetchCreditPrices, fetchCreditsSummary, type CreditsSummary } from "./bold-live";
import type { CreditsGate } from "./bold-settings-live";

const TABS = ["Where they go", "What things cost", "Top-ups"] as const;

/**
 * Friendly copy per priced action. An action with no entry renders its raw key
 * in mono rather than vanishing — an unnamed price is still a real price.
 */
const ACTION_META: Record<string, { ic: string; label: string; sub: string; tint: [string, string, string] }> = {
  email_send: {
    ic: "✉",
    label: "An email",
    sub: "Includes the writing. Bounces are not charged.",
    tint: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  },
  reply_email_send: {
    ic: "↩",
    label: "An email reply",
    sub: "Whether she drafted it or you typed it.",
    tint: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  },
  sms_segment: {
    ic: "✆",
    label: "An SMS",
    sub: "Per segment. She keeps messages inside one.",
    tint: ["var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  },
  reply_sms_send: {
    ic: "✆",
    label: "An SMS reply",
    sub: "Per segment, same as any other text.",
    tint: ["var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  },
  whatsapp_msg: {
    ic: "◍",
    label: "A WhatsApp message",
    sub: "Per message, at the provider's session rate.",
    tint: ["var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  },
  voice_minute: {
    ic: "☎",
    label: "A call minute",
    sub: "Outbound or inbound. Rounded up per minute.",
    tint: ["var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)"],
  },
  enrichment: {
    ic: "◉",
    label: "Enriching a contact",
    sub: "Charged once per contact, ever.",
    tint: ["#F0EDF9", "#DCD5EF", "#5B4A8A"],
  },
  lead_reveal: {
    ic: "◎",
    label: "Revealing a lead",
    sub: "Their name, role and direct line — charged once, ever.",
    tint: ["#F0EDF9", "#DCD5EF", "#5B4A8A"],
  },
  intent_enrichment: {
    ic: "◈",
    label: "A buying signal",
    sub: "One warm signal attached to a lead.",
    tint: ["var(--cvb-amber-bg)", "var(--cvb-amber-line)", "var(--cvb-amber)"],
  },
  signal_lead: {
    ic: "◈",
    label: "A signalled lead",
    sub: "A lead surfaced by a watch you set.",
    tint: ["var(--cvb-amber-bg)", "var(--cvb-amber-line)", "var(--cvb-amber)"],
  },
  widget_turn: {
    ic: "◬",
    label: "A site-agent turn",
    sub: "One exchange in the widget on your site.",
    tint: ["var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)"],
  },
  reply_draft: {
    ic: "✦",
    label: "Anything Ada writes",
    sub: "Drafting, classifying and deciding are free.",
    tint: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
  },
};

/** Ledger reasons → the plain words for what happened. */
const LEDGER_META: Record<string, { label: string; sub: string }> = {
  lead_reveal: { label: "Lead reveals", sub: "Contact details unlocked in the Lead finder" },
  backoffice_adjustment: { label: "Platform adjustment", sub: "Credits moved by your platform contact" },
  adjustment: { label: "Platform adjustment", sub: "Credits moved by your platform contact" },
  topup: { label: "Top-up", sub: "Credits you bought" },
};

type Summary = CreditsSummary & Partial<CreditsGate>;

export function BoldCreditsView({ flash }: { flash?: (m: string) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [prices, setPrices] = useState<EffectiveCreditPrices | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Where they go");
  const [buying, setBuying] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const [s, p] = await Promise.all([fetchCreditsSummary(), fetchCreditPrices()]);
      setSummary(s as Summary | null);
      setPrices(p);
      setLoaded(true);
    })();
  }, []);

  const spent = summary?.spent ?? [];
  const spentTotal = spent.reduce((n, r) => n + r.credits, 0);
  const maxRow = Math.max(1, ...spent.map((r) => r.credits));
  const gate = summary?.history;
  const allowance = summary?.allowance;
  const metering = summary?.metering;

  /** Priced-but-unmetered, split from priced-at-zero — see the note below. */
  const label = (a: string) => ACTION_META[a]?.label ?? a;
  const uniq = (xs: string[]) => xs.filter((v, i, arr) => arr.indexOf(v) === i);
  const chargeable = uniq(
    (metering?.unmetered ?? []).filter((a) => (prices?.effective[a] ?? 0) > 0).map(label),
  );
  const free = uniq(
    (metering?.unmetered ?? []).filter((a) => (prices?.effective[a] ?? 0) === 0).map(label),
  );

  /* The hero's tiles are a LIST, not a fixed four: a tile with no source is
     not rendered as a dash, it simply is not one of the tiles. */
  const tiles: Array<{ label: string; value: string; dim?: boolean }> = [
    { label: "USED THIS MONTH", value: loaded ? spentTotal.toLocaleString("en-US") : "—" },
    {
      label: "ADDED THIS MONTH",
      value: loaded ? (summary?.added ?? []).reduce((n, r) => n + r.credits, 0).toLocaleString("en-US") : "—",
      dim: true,
    },
  ];
  if (allowance?.includedMonthly != null) {
    tiles.push({ label: "INCLUDED MONTHLY", value: allowance.includedMonthly.toLocaleString("en-US"), dim: true });
  }
  if (gate?.enough) {
    // Burn is only computed where there is enough history to compute it from.
    const days = Math.max(1, gate.days);
    const perDay = Math.round(spentTotal / Math.min(days, 30));
    tiles.push({ label: "BURN", value: `${perDay}/day`, dim: true });
    if (perDay > 0 && summary) {
      tiles.push({ label: "RUNS OUT", value: `${Math.max(0, Math.round(summary.balance / perDay))} days`, dim: true });
    }
  }

  return (
    <div data-testid="bold-credits" style={{ padding: "26px 40px 40px" }}>
      {/* ---------------------------------------------------------- hero */}
      <div
        style={{
          borderRadius: 22,
          overflow: "hidden",
          background: "linear-gradient(150deg,#0C2A1B,#0A1524 66%,#0A0F14)",
          boxShadow: "var(--cvb-shadow-two-layer)",
        }}
      >
        <div style={{ height: 2, background: "var(--cvb-gradient-signature)" }} />
        <div style={{ padding: "26px 28px", display: "flex", alignItems: "flex-end", gap: 26, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "rgba(255,255,255,.5)" }}>
              CREDITS LEFT
            </div>
            <div
              data-testid="bold-credits-balance"
              className="cvb-display"
              style={{ fontWeight: 900, fontSize: 56, letterSpacing: "-.042em", lineHeight: 0.96, color: "#fff", marginTop: 11 }}
            >
              {loaded && summary ? summary.balance.toLocaleString("en-US") : "—"}
            </div>
            <div
              data-testid="bold-credits-runway"
              style={{ fontSize: 13, color: "rgba(255,255,255,.62)", lineHeight: 1.5, marginTop: 11, maxWidth: 460 }}
            >
              {!loaded
                ? "Reading your ledger…"
                : gate?.enough
                  ? "Ada slows non-urgent sends before you run dry, she does not stop."
                  : `How long this lasts needs about ${gate?.minDays ?? 14} days of spending to work out, and there ${
                      (gate?.days ?? 0) === 1 ? "is 1 day" : `are ${gate?.days ?? 0} days`
                    } so far. Until then this page will not guess.`}
            </div>
          </div>
          <div style={{ width: 200, flex: "none" }}>
            {allowance?.includedMonthly != null && summary ? (
              <>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.14)", overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block",
                      height: 6,
                      width: `${Math.min(100, Math.round((summary.balance / allowance.includedMonthly) * 100))}%`,
                      background: "linear-gradient(90deg,#35E834,#D0F56B)",
                      borderRadius: 3,
                    }}
                  />
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.5)", marginTop: 10 }}>
                  {Math.min(100, Math.round((summary.balance / allowance.includedMonthly) * 100))}% of your monthly
                  allowance left
                </div>
              </>
            ) : (
              <div
                data-testid="bold-credits-no-allowance"
                style={{ fontSize: 11.5, color: "rgba(255,255,255,.45)", lineHeight: 1.55 }}
              >
                {allowance?.reason ?? "No monthly allowance is attached to this workspace"}, so there is no share of one
                to show.
              </div>
            )}
            <span
              onClick={() => setBuying(true)}
              role="button"
              data-testid="bold-credits-topup"
              style={{
                display: "block",
                textAlign: "center",
                fontSize: 13,
                fontWeight: 800,
                color: "#101613",
                background: "var(--cvb-gradient-signature)",
                borderRadius: 12,
                padding: 13,
                cursor: "pointer",
                marginTop: 14,
              }}
            >
              Top up
            </span>
          </div>
        </div>
        <div style={{ display: "flex", borderTop: "1px solid rgba(255,255,255,.1)" }}>
          {tiles.map((t) => (
            <div key={t.label} style={{ flex: 1, minWidth: 0, padding: "15px 18px", borderLeft: "1px solid rgba(255,255,255,.1)" }}>
              <div
                style={{
                  ...mono,
                  fontSize: 9,
                  letterSpacing: ".12em",
                  color: "rgba(255,255,255,.45)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t.label}
              </div>
              <div
                className="cvb-display"
                style={{
                  fontWeight: 900,
                  fontSize: 20,
                  letterSpacing: "-.028em",
                  marginTop: 7,
                  color: t.dim ? "rgba(255,255,255,.86)" : "#fff",
                }}
              >
                {t.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------------- tabs */}
      <div
        style={{
          display: "flex",
          gap: 5,
          background: "var(--cvb-panel)",
          borderRadius: 13,
          padding: 4,
          width: "fit-content",
          margin: "22px 0 0",
        }}
      >
        {TABS.map((t) => (
          <span
            key={t}
            onClick={() => setTab(t)}
            role="tab"
            aria-selected={tab === t}
            data-testid={`bold-credits-tab-${t.split(" ")[0]!.toLowerCase()}`}
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 16px",
              borderRadius: 10,
              cursor: "pointer",
              background: tab === t ? "var(--cvb-card)" : "transparent",
              color: tab === t ? "var(--cvb-ink)" : "var(--cvb-faint)",
            }}
          >
            {t}
          </span>
        ))}
      </div>

      {/* ------------------------------------------------- where they go */}
      {tab === "Where they go" ? (
        <div style={{ marginTop: 22, maxWidth: 760 }}>
          {spent.length === 0 ? (
            <div data-testid="bold-credits-empty" style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
              Nothing has drawn down credits this month.
            </div>
          ) : (
            spent.map((r) => {
              const meta = LEDGER_META[r.reason];
              const action = ACTION_META[r.reason];
              const tint = action?.tint ?? ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"];
              return (
                <div
                  key={r.reason}
                  data-testid={`bold-credits-kind-${r.reason}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 4px",
                    borderBottom: "1px solid var(--cvb-line-inner)",
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 11,
                      flex: "none",
                      background: tint[0],
                      border: `1px solid ${tint[1]}`,
                      color: tint[2],
                      display: "grid",
                      placeItems: "center",
                      fontSize: 13,
                    }}
                  >
                    {action?.ic ?? "◇"}
                  </span>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-.018em" }}>
                      {meta?.label ?? <span style={mono}>{r.reason}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3 }}>
                      {meta?.sub ?? "From your ledger"} · {r.entries} time{r.entries === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div style={{ width: 120, flex: "none" }}>
                    <div style={{ height: 5, borderRadius: 3, background: "var(--cvb-line-inner)", overflow: "hidden" }}>
                      <span
                        style={{
                          display: "block",
                          height: 5,
                          width: `${Math.round((r.credits / maxRow) * 100)}%`,
                          background: tint[2],
                          borderRadius: 3,
                        }}
                      />
                    </div>
                  </div>
                  <span
                    className="cvb-display"
                    style={{ fontWeight: 900, fontSize: 17, letterSpacing: "-.026em", width: 68, flex: "none", textAlign: "right" }}
                  >
                    {r.credits.toLocaleString("en-US")}
                  </span>
                </div>
              );
            })
          )}

          {/* The kinds that have a price but no meter. Named, not drawn — and
              a FREE action is not one of them: it is not unmeasured, it costs
              nothing, which is a different sentence. */}
          {chargeable.length > 0 ? (
            <div style={{ marginTop: 22 }} data-testid="bold-credits-unmetered">
              <div style={{ ...EYEBROW, marginBottom: 10 }}>NOT METERED YET</div>
              <AbsentBecause
                what={chargeable.join(" · ")}
                why="These have a price, but nothing writes them to your ledger yet — so this page cannot say what they cost you this month, and does not draw a bar pretending they cost nothing."
              />
              {free.length > 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 10 }}>
                  {free.join(" · ")} {free.length === 1 ? "is" : "are"} free — nothing to meter.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------------------------------------------- what things cost */}
      {tab === "What things cost" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, maxWidth: 900, marginTop: 22 }}>
          {prices == null || Object.keys(prices.effective).length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>No prices are set for this workspace yet.</div>
          ) : (
            Object.entries(prices.effective)
              .sort(([, a], [, b]) => a - b)
              .map(([action, credits]) => {
                const meta = ACTION_META[action];
                const tint = meta?.tint ?? ["var(--cvb-panel)", "var(--cvb-line-ctl)", "var(--cvb-muted)"];
                const metered = metering?.metered.includes(action) ?? false;
                return (
                  <div
                    key={action}
                    data-testid={`bold-credits-rate-${action}`}
                    style={{
                      background: "var(--cvb-panel-quiet)",
                      border: "1px solid var(--cvb-line)",
                      borderRadius: 17,
                      padding: 17,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 9,
                          flex: "none",
                          background: tint[0],
                          border: `1px solid ${tint[1]}`,
                          color: tint[2],
                          display: "grid",
                          placeItems: "center",
                          fontSize: 12,
                        }}
                      >
                        {meta?.ic ?? "◇"}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, letterSpacing: "-.016em" }}>
                        {meta?.label ?? <span style={mono}>{action}</span>}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 12 }}>
                      <span className="cvb-display" style={{ fontWeight: 900, fontSize: 26, letterSpacing: "-.032em" }}>
                        {credits}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--cvb-faint)" }}>
                        {credits === 1 ? "credit" : "credits"}
                      </span>
                      {credits === 0 ? (
                        // Free by design, not awaiting a meter.
                        <span style={{ ...CHIP.live, marginLeft: "auto" }}>always free</span>
                      ) : !metered ? (
                        <span style={{ ...CHIP.mute, marginLeft: "auto" }}>not charged yet</span>
                      ) : null}
                    </div>
                    {meta?.sub ? (
                      <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.45, marginTop: 9 }}>
                        {meta.sub}
                      </div>
                    ) : null}
                  </div>
                );
              })
          )}
          <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
            Every price here is the effective-dated rate for your account — change it centrally and these move by
            themselves. Nothing on this page has a price written into it.
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- top-ups */}
      {tab === "Top-ups" ? (
        <div style={{ maxWidth: 680, marginTop: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {gate?.enough ? null : (
            <AbsentBecause
              testid="bold-credits-burn-absent"
              what="Burn rate and how long you have left"
              why={`Both are worked out from spending over time, and this workspace has ${
                (gate?.days ?? 0) === 0 ? "no ledger history" : `${gate!.days} days of it`
              } — under the ${gate?.minDays ?? 14} days either figure needs to mean anything.`}
            />
          )}
          <AbsentBecause
            testid="bold-credits-billing-absent"
            what="Auto top-up, invoices and receipts"
            why="These need a card on file, and billing is not connected to this workspace yet. Top-ups happen through your platform contact for now, and land in the ledger below."
          />

          <div>
            <div style={{ ...EYEBROW, margin: "8px 0 12px" }}>THE LEDGER — NEWEST FIRST</div>
            {(summary?.recent ?? []).length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>
                No entries yet — the first reveal or adjustment starts it.
              </div>
            ) : (
              (summary?.recent ?? []).map((e, i, arr) => (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 2px",
                    borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--cvb-line-inner)",
                  }}
                >
                  <span style={{ ...mono, fontSize: 11, color: "var(--cvb-muted)", width: 74, flex: "none" }}>
                    {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{LEDGER_META[e.reason]?.label ?? e.reason}</div>
                    <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 2 }}>
                      balance after {e.balanceAfter.toLocaleString("en-US")}
                    </div>
                  </div>
                  <span
                    style={{
                      ...mono,
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: e.delta < 0 ? "var(--cvb-ink)" : "var(--cvb-forest)",
                    }}
                  >
                    {e.delta > 0 ? "+" : ""}
                    {e.delta.toLocaleString("en-US")}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {buying ? <BuyCreditsDrawer balance={summary?.balance ?? null} onClose={() => setBuying(false)} flash={flash} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------- buy flow */

/**
 * The buy flow, in the right-hand drawer.
 *
 * It stops honestly at the point where money would move. There is no card on
 * file, no payment intent and no receipt to email — so rather than mock a
 * checkout that cannot charge anyone, the last step says exactly what is
 * missing and what to do instead. The pack sizes are shape, not prices: they
 * carry no per-credit rate, because a rate shown here that billing later
 * disagrees with is worse than no rate at all.
 */
function BuyCreditsDrawer({
  balance,
  onClose,
  flash,
}: {
  balance: number | null;
  onClose: () => void;
  flash?: (m: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [pack, setPack] = useState(5_000);
  const PACKS = [2_000, 5_000, 10_000];

  return (
    <SettingsDrawer
      label="TOP UP"
      title="Buy credits"
      onClose={onClose}
      testid="bold-drawer-buy"
      footer={
        <>
          {step > 0 ? <PrimaryButton label="Back" tone="quiet" onClick={() => setStep(step - 1)} /> : null}
          <span style={{ flex: 1 }} />
          <StepDots step={step} of={3} />
          {step < 2 ? (
            <PrimaryButton label="Continue" testid="bold-drawer-buy-next" onClick={() => setStep(step + 1)} />
          ) : (
            <PrimaryButton
              label="Done"
              testid="bold-drawer-buy-done"
              onClick={() => {
                flash?.("Nothing was charged — ask your platform contact to add them.");
                onClose();
              }}
            />
          )}
        </>
      }
    >
      {step === 0 ? (
        <>
          <StepPrompt prompt="How many credits?" help="Credits never expire, and unused ones roll on with you." />
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {PACKS.map((p) => (
              <ChoiceRow
                key={p}
                title={`${p.toLocaleString("en-US")} credits`}
                sub={
                  balance != null
                    ? `Takes you to ${(balance + p).toLocaleString("en-US")}`
                    : "Added to your balance"
                }
                selected={pack === p}
                onSelect={() => setPack(p)}
                testid={`bold-drawer-buy-pack-${p}`}
              />
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.6, marginTop: 14 }}>
            Your plan, card and invoices live in the account area — this workspace only spends.
          </div>
        </>
      ) : step === 1 ? (
        <>
          <StepPrompt prompt="Confirm what you are adding." />
          <div
            style={{
              background: "var(--cvb-mint)",
              border: "1px solid var(--cvb-mint-line)",
              borderRadius: 16,
              padding: 17,
            }}
          >
            <div className="cvb-display" style={{ fontWeight: 900, fontSize: 26, letterSpacing: "-.03em", color: "#0E3D22" }}>
              {pack.toLocaleString("en-US")} credits
            </div>
            {balance != null ? (
              <div style={{ fontSize: 12, color: "#1D5B34", marginTop: 6 }}>
                Takes you to {(balance + pack).toLocaleString("en-US")} credits
              </div>
            ) : null}
          </div>
          <div style={{ ...EYEBROW, margin: "22px 0 10px" }}>PAYING WITH</div>
          <AbsentBecause
            testid="bold-drawer-buy-nocard"
            what="No card is on file"
            why="Billing is not connected to this workspace yet, so there is nothing here to charge and no price to quote."
          />
        </>
      ) : (
        <>
          <StepPrompt
            prompt="Nothing was charged."
            help="This is as far as buying credits goes today, and saying so is better than a receipt for a payment that never happened."
          />
          <div style={{ fontSize: 13, color: "var(--cvb-muted)", lineHeight: 1.6 }}>
            Ask your platform contact to add {pack.toLocaleString("en-US")} credits and they appear in the ledger the
            moment they do — with the balance they took you to, like every other entry.
          </div>
        </>
      )}
    </SettingsDrawer>
  );
}
