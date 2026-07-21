"use client";

/**
 * Integrations surface (INT W1-UI) — ported from `Integrations.dc.html`:
 * page header ("{n} of {m} connected"), live search, category pills (All + the
 * 6 canon categories), 3-col card grid over the canon 15-provider catalog
 * (`lib/integrations.ts`), 460px detail drawer.
 *
 * Card states are HONEST by construction:
 *   - live + probe-backed row → connected/unhealthy/revoked treatment;
 *   - live + no row → "+ Connect" (opens the drawer wizard);
 *   - managed (twilio) → deep link to the REAL Settings SMS section;
 *   - absent → the reason line, never a working Connect.
 *
 * BEHAVIOR ADAPTATION vs the prototype (flagged): the prototype simulates
 * connect in-page; the real Slack flow is OAuth and LEAVES the page at step 1.
 * On return the callback route redirects here with `?connected=slack` (the
 * view auto-opens the Slack drawer at the config step) or `?error=…` (rendered
 * verbatim in an honest banner). The params are consumed via replaceState so a
 * refresh doesn't replay them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { isIntegrationProvider, type IntegrationDto } from "@clientforce/core";
import type { Role } from "../../../lib/types";
import { CfError } from "../../../components/sequence/shared";
import {
  CATEGORY_LABELS,
  INTEGRATION_CATALOG,
  INTEGRATION_CATEGORIES,
  TILE,
  type CatalogEntry,
  type IntegrationCategory,
} from "../../../lib/integrations";
import { IntegrationDrawer } from "./IntegrationDrawer";

const BRICO = "'Bricolage Grotesque',sans-serif";

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

/** Relative time for "Last sync" / activity rows (deterministic, coarse). */
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

const CATS: ReadonlyArray<{ id: "all" | IntegrationCategory; label: string }> = [
  { id: "all", label: "All" },
  ...INTEGRATION_CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c] })),
];

/** Card status chip for a live provider's probe-backed row (honest per status). */
function cardChip(row: IntegrationDto): { text: string; fg: string; bg: string; border: string } {
  switch (row.status) {
    case "connected":
      return { text: "✓ Connected", fg: "#16A82A", bg: "rgba(53,232,52,.1)", border: "rgba(53,232,52,.3)" };
    case "unhealthy":
      return { text: "! Unhealthy", fg: "#A87B16", bg: "rgba(232,196,91,.14)", border: "rgba(232,196,91,.45)" };
    case "revoked":
      return { text: "Disconnected", fg: "#C9543F", bg: "rgba(224,121,107,.1)", border: "rgba(224,121,107,.35)" };
  }
}

export function IntegrationsView({ role }: { role: Role }) {
  const [rows, setRows] = useState<IntegrationDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cat, setCat] = useState<"all" | IntegrationCategory>("all");
  const [q, setQ] = useState("");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerBoot, setDrawerBoot] = useState<"auto" | "config">("auto");
  const [oauthError, setOauthError] = useState<string | null>(null);
  const canManage = role === "OWNER" || role === "ADMIN";

  const refetch = useCallback(async () => {
    try {
      const data = (await cf("integrations")) as { integrations: IntegrationDto[] };
      setRows(data.integrations);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setRows((prev) => prev ?? []);
    }
  }, []);

  // A4: 5s polling — probe status and last-sync move server-side (useSenders).
  useEffect(() => {
    void refetch();
    const t = setInterval(() => void refetch(), 5000);
    return () => clearInterval(t);
  }, [refetch]);

  // OAuth round-trip return (behavior adaptation, see header comment).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const connected = sp.get("connected");
    const error = sp.get("error");
    if (connected && isIntegrationProvider(connected)) {
      setDrawerId(connected);
      setDrawerBoot("config");
    }
    if (error) setOauthError(error);
    if (connected || error) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const byProvider = useMemo(() => {
    const map = new Map<string, IntegrationDto>();
    for (const r of rows ?? []) map.set(r.provider, r);
    return map;
  }, [rows]);

  const connectedCount = (rows ?? []).filter((r) => r.status === "connected").length;
  const totalCount = INTEGRATION_CATALOG.length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return INTEGRATION_CATALOG.filter(
      (e) => (cat === "all" || e.cat === cat) && (needle === "" || e.name.toLowerCase().includes(needle)),
    );
  }, [cat, q]);

  const openDrawer = (entry: CatalogEntry) => {
    if (entry.availability.kind !== "live") return;
    setDrawerBoot("auto");
    setDrawerId(entry.id);
  };

  const drawerEntry = drawerId
    ? INTEGRATION_CATALOG.find((e) => e.id === drawerId && e.availability.kind === "live") ?? null
    : null;

  return (
    <div style={{ flex: 1, background: "#FBF7F0", minWidth: 0, padding: "26px 30px 34px", minHeight: "100vh", fontFamily: "'Hanken Grotesk',sans-serif" }}>
      <style>{`.intg-card:hover{border-color:#9FD8AC !important;box-shadow:0 8px 26px rgba(14,21,18,.09) !important;}
.intg-search::placeholder{color:#9AA59E;}`}</style>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 28, letterSpacing: "-.02em", color: "#0E1512" }}>Integrations</div>
          <div style={{ fontSize: 15, color: "#5C6B62" }}>
            {rows === null
              ? "Loading…"
              : `${connectedCount} of ${totalCount} connected · Plug Clientforce into the tools you already use.`}
          </div>
        </div>
        {/* display-only per the prototype — no request flow exists */}
        <span style={{ fontSize: 14, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 18px" }}>＋ Request an integration</span>
      </div>

      {oauthError && (
        <div data-testid="oauth-error" style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", color: "#C9543F", borderRadius: 12, padding: "10px 14px", fontSize: 13.5, marginBottom: 12 }}>
          <span style={{ flex: 1, minWidth: 0 }}>Couldn't finish connecting — {oauthError}</span>
          <span onClick={() => setOauthError(null)} style={{ cursor: "pointer", fontWeight: 700, flex: "none" }}>✕</span>
        </div>
      )}
      {loadError && (
        <div style={{ background: "rgba(224,121,107,.1)", border: "1px solid #F0CFC8", color: "#C9543F", borderRadius: 12, padding: "10px 14px", fontSize: 13.5, marginBottom: 12 }}>
          Couldn't load integrations — retrying automatically.
        </div>
      )}

      {/* search + categories */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <div style={{ flex: "0 0 300px", display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 16px" }}>
          <span style={{ color: "#9AA59E" }}>⚲</span>
          <input
            className="intg-search"
            data-testid="integrations-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search integrations…"
            style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, color: "#0E1512", flex: 1, minWidth: 0, fontFamily: "inherit", padding: 0 }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CATS.map((c) => {
            const on = c.id === cat;
            return (
              <span
                key={c.id}
                data-testid={`cat-${c.id}`}
                onClick={() => setCat(c.id)}
                style={{ fontSize: 13, fontWeight: 600, color: on ? "#0A0F0C" : "#5C6B62", background: on ? "rgba(53,232,52,.16)" : "#fff", border: `1px solid ${on ? "#35E834" : "#EBE3D6"}`, borderRadius: 100, padding: "8px 15px", cursor: "pointer" }}
              >
                {c.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {filtered.map((entry) => {
          const av = entry.availability;
          const row = av.kind === "live" ? byProvider.get(av.provider) ?? null : null;
          const tile = TILE[entry.tile];
          const clickable = av.kind === "live";
          const chip = row ? cardChip(row) : null;
          return (
            <div
              key={entry.id}
              className={clickable ? "intg-card" : undefined}
              data-testid={`card-${entry.id}`}
              onClick={clickable ? () => openDrawer(entry) : undefined}
              style={{ background: "#fff", border: `1px solid ${row?.status === "connected" ? "rgba(53,232,52,.4)" : "#EBE3D6"}`, borderRadius: 16, padding: 18, boxShadow: "0 4px 16px rgba(14,21,18,.04)", display: "flex", flexDirection: "column", cursor: clickable ? "pointer" : "default" }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, flex: "none", background: tile.tilebg, color: tile.tilefg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BRICO, fontWeight: 800, fontSize: 18 }}>{entry.glyph}</span>
                <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: "#0E1512" }}>{entry.name}</div>
                  <div style={{ fontSize: 12, color: "#9AA59E", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{CATEGORY_LABELS[entry.cat]}</div>
                </div>
                {row?.status === "connected" && (
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#35E834", boxShadow: "0 0 0 4px rgba(53,232,52,.18)", flex: "none", marginTop: 6 }} />
                )}
                {row?.status === "unhealthy" && (
                  <span title="Unreachable at the last probe" style={{ width: 10, height: 10, borderRadius: "50%", background: "#E8C45B", boxShadow: "0 0 0 4px rgba(232,196,91,.2)", flex: "none", marginTop: 6 }} />
                )}
              </div>
              <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, flex: 1, marginBottom: 16 }}>{entry.desc}</div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {av.kind === "live" && row && chip && (
                  <>
                    <span style={{ flex: 1, textAlign: "center", fontSize: 13.5, fontWeight: 700, color: chip.fg, background: chip.bg, border: `1px solid ${chip.border}`, borderRadius: 10, padding: 9 }}>{chip.text}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 14px", cursor: "pointer" }}>Manage</span>
                  </>
                )}
                {av.kind === "live" && !row && rows === null && (
                  // Honest loading — never a "+ Connect" before the real state lands.
                  <span style={{ flex: 1, textAlign: "center", fontSize: 13.5, fontWeight: 600, color: "#9AA59E", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: 9 }}>Checking…</span>
                )}
                {av.kind === "live" && !row && rows !== null && (
                  <span
                    data-testid={`connect-${entry.id}`}
                    aria-disabled={canManage ? undefined : "true"}
                    title={canManage ? undefined : "Owners and admins manage integrations"}
                    style={{ flex: 1, textAlign: "center", fontSize: 13.5, fontWeight: 700, color: "#0E1512", background: "#fff", border: "1.5px solid #16A82A", borderRadius: 10, padding: 9, cursor: canManage ? "pointer" : "not-allowed", opacity: canManage ? 1 : 0.6 }}
                  >
                    + Connect
                  </span>
                )}
                {av.kind === "managed" && (
                  <a
                    data-testid="managed-provider"
                    href={av.href}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, textAlign: "center", fontSize: 13.5, fontWeight: 600, color: "#1192A6", background: "rgba(54,215,237,.1)", border: "1px solid rgba(54,215,237,.35)", borderRadius: 10, padding: 9, textDecoration: "none" }}
                  >
                    {av.note} →
                  </a>
                )}
                {av.kind === "absent" && (
                  <span
                    data-testid="absent-provider"
                    aria-disabled="true"
                    style={{ flex: 1, textAlign: "center", fontSize: 12.5, fontWeight: 600, color: "#8A7F6B", background: "#F2EEE4", border: "1px solid #EBE3D6", borderRadius: 10, padding: 9, cursor: "default" }}
                  >
                    {av.reason}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div data-testid="integrations-empty" style={{ textAlign: "center", padding: "60px 20px", background: "#fff", border: "1px dashed #D8CFBE", borderRadius: 16, marginTop: 14 }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>⚲</div>
          <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 18, color: "#0E1512", marginBottom: 4 }}>No integrations match</div>
          <div style={{ fontSize: 13.5, color: "#9AA59E" }}>Try another search or category.</div>
        </div>
      )}

      {drawerEntry && drawerEntry.availability.kind === "live" && (
        <IntegrationDrawer
          entry={drawerEntry}
          provider={drawerEntry.availability.provider}
          row={byProvider.get(drawerEntry.id) ?? null}
          bootMode={drawerBoot}
          canManage={canManage}
          onClose={() => {
            setDrawerId(null);
            setDrawerBoot("auto");
          }}
          onChanged={() => void refetch()}
        />
      )}
    </div>
  );
}
