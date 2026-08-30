"use client";

/**
 * B8 (DEC-135): the Bold Integrations surface — the ONE registry
 * (`lib/integrations.ts` over the core provider union) rendered in Bold
 * skin with REAL statuses from `GET /integrations` (probe-backed; never
 * "connected" without a live token). Honest connect states:
 *
 *  - a LIVE provider that is connected shows its real status chip
 *    (connected / needs a look / revoked);
 *  - a live-but-unconnected provider offers Connect: BuyerPing enables
 *    in place (the B6 one-tap tier); OAuth/fields providers hand off to
 *    the classic console's SHIPPED wizards with plain copy — re-porting
 *    five connect flows into Bold is its own unit (Q-117), and a working
 *    pointer beats a broken re-implementation;
 *  - an ABSENT provider keeps its owner-readable reason (ads closed loop
 *    stays B11; billing stays B9/Q-111) — never a working "+ Connect"
 *    for a provider that doesn't exist.
 *
 * This registry is also the receptionist's open-ended external-actions
 * surface (Q-090 scope note): what is CONNECTED here is what she may act
 * through — the WHAT-SHE-MAY-DO master toggle gates it.
 */
import { useCallback, useEffect, useState } from "react";
import { CATEGORY_LABELS, INTEGRATION_CATALOG, TILE, type CatalogEntry } from "../../lib/integrations";
import { mono } from "./bold-cards";
import { fetchIntegrationStatuses, setBuyerping, type IntegrationStatusRow } from "./bold-live";

const STATUS_CHIP: Record<string, [string, string, string, string]> = {
  connected: ["Connected", "var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"],
  unhealthy: ["Needs a look", "var(--cvb-amber,#8A6D1A)", "var(--cvb-amber-bg,#F7EFDA)", "var(--cvb-amber-line,#EAD9A8)"],
  revoked: ["Revoked", "#B0483A", "#FBEEEA", "#F0D2CB"],
};

export function BoldIntegrationsView({ flash }: { flash: (m: string) => void }) {
  const [statuses, setStatuses] = useState<Map<string, IntegrationStatusRow> | null>(null);
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatuses(await fetchIntegrationStatuses());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const cats = [...new Set(INTEGRATION_CATALOG.map((e) => e.cat))];

  async function toggleBuyerping(connected: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await setBuyerping(!connected);
      if (!res.ok) {
        flash(res.error || "That did not save — try again.");
        return;
      }
      flash(connected ? "BuyerPing off — Ada matches on fit alone." : "BuyerPing on — intent signals start collecting.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="bold-integrations" style={{ padding: "26px 40px 40px" }}>
      {cats.map((cat) => {
        const entries = INTEGRATION_CATALOG.filter((e) => e.cat === cat);
        return (
          <div key={cat} style={{ marginBottom: 26 }}>
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 12 }}>
              {CATEGORY_LABELS[cat].toUpperCase()}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 11 }}>
              {entries.map((e) => {
                const st = statuses?.get(e.id) ?? null;
                const chip = st ? STATUS_CHIP[st.status] : null;
                const tile = TILE[e.tile];
                const live = e.availability.kind === "live";
                return (
                  <div
                    key={e.id}
                    data-testid={`bold-int-${e.id}`}
                    onClick={() => setOpen(e)}
                    style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 18, padding: 16, cursor: "pointer", opacity: live ? 1 : 0.72 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <span style={{ width: 34, height: 34, borderRadius: 12, flex: "none", background: tile.tilebg, color: tile.tilefg, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 14 }}>
                        {e.glyph}
                      </span>
                      <span style={{ fontWeight: 800, fontSize: 13.5, letterSpacing: "-.02em", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                      {chip ? (
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: chip[1], background: chip[2], border: `1px solid ${chip[3]}`, borderRadius: 999, padding: "3px 8px", flex: "none" }}>{chip[0]}</span>
                      ) : live ? (
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--cvb-cyan,#0E7D93)", background: "var(--cvb-cyan-tint,#E2F3F6)", border: "1px solid var(--cvb-cyan-line,#BFE3EB)", borderRadius: 999, padding: "3px 8px", flex: "none" }}>Connect</span>
                      ) : e.availability.kind === "managed" ? (
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--cvb-muted)", background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 999, padding: "3px 8px", flex: "none" }}>In Settings</span>
                      ) : (
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--cvb-ghost)", background: "var(--cvb-panel)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 999, padding: "3px 8px", flex: "none" }}>On its way</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 10 }}>{e.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {open ? (
        <div onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,14,12,.14)", display: "flex", justifyContent: "flex-end", zIndex: 30 }}>
          <div onClick={(ev) => ev.stopPropagation()} data-testid="bold-int-drawer" style={{ width: 392, maxWidth: "88%", height: "100%", background: "var(--cvb-card)", borderLeft: "1px solid var(--cvb-line)", padding: "30px 28px", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 42, height: 42, borderRadius: 14, flex: "none", background: TILE[open.tile].tilebg, color: TILE[open.tile].tilefg, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 17 }}>{open.glyph}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.03em" }}>{open.name}</div>
                <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".13em", color: "var(--cvb-faint)", marginTop: 3 }}>
                  {CATEGORY_LABELS[open.cat].toUpperCase()} ·{" "}
                  {statuses?.get(open.id)?.status?.toUpperCase() ?? (open.availability.kind === "live" ? "NOT CONNECTED" : "ON ITS WAY")}
                </div>
              </div>
              <span onClick={() => setOpen(null)} style={{ width: 32, height: 32, borderRadius: 11, border: "1px solid var(--cvb-line-ctl)", display: "grid", placeItems: "center", color: "var(--cvb-muted)", fontSize: 13, cursor: "pointer", flex: "none" }}>✕</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--cvb-muted)", lineHeight: 1.6, marginTop: 16 }}>{open.desc}</div>

            {open.availability.kind === "live" ? (
              open.id === "buyerping" ? (
                <span
                  onClick={() => void toggleBuyerping(statuses?.get("buyerping")?.status === "connected")}
                  data-testid="bold-int-buyerping-toggle"
                  style={{ display: "inline-block", fontSize: 12.5, fontWeight: 800, color: "#fff", background: busy ? "var(--cvb-ghost)" : "var(--cvb-forest)", borderRadius: 12, padding: "11px 16px", marginTop: 20, cursor: "pointer" }}
                >
                  {statuses?.get("buyerping")?.status === "connected" ? "Turn it off" : "Connect BuyerPing"}
                </span>
              ) : (
                <div data-testid="bold-int-classic-pointer" style={{ marginTop: 20, background: "var(--cvb-well)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 14, padding: "13px 15px", fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
                  {statuses?.get(open.id)
                    ? "Manage this connection — reconnect, settings, activity — in the classic console's Integrations page for now. Its full setup moves here in its own step."
                    : "Connecting walks through a short setup that lives in the classic console's Integrations page for now — it moves here in its own step."}
                  <a href="/integrations" style={{ display: "inline-block", marginTop: 10, fontSize: 12.5, fontWeight: 800, color: "var(--cvb-cyan,#0E7D93)" }}>
                    Open the classic Integrations page →
                  </a>
                </div>
              )
            ) : open.availability.kind === "managed" ? (
              <div style={{ marginTop: 20, background: "var(--cvb-well)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 14, padding: "13px 15px", fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
                {open.availability.note}
                <a href={open.availability.href} style={{ display: "inline-block", marginTop: 10, fontSize: 12.5, fontWeight: 800, color: "var(--cvb-cyan,#0E7D93)" }}>
                  Open it →
                </a>
              </div>
            ) : (
              <div style={{ marginTop: 20, background: "var(--cvb-well)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 14, padding: "13px 15px", fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
                {open.availability.reason}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
