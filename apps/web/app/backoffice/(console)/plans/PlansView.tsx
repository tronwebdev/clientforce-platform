"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { BackofficeAgencyRow } from "@clientforce/core";
import { Button, Toast } from "@clientforce/ui";

/** B9 (D2): the billing editor where per-tier limits are ACTUALLY set. Until
 *  a tier is saved here it stays a proposal — tenant surfaces render its
 *  numbers with the PROPOSED marker. Saving stamps `confirmed` and audits. */

interface PlanRow {
  id: string;
  agencyId: string | null;
  name: string;
  priceMonthlyCents: number;
  limits: Record<string, unknown>;
  confirmed: boolean;
}

const TIERS = ["STARTER", "GROWTH", "SCALE"] as const;

async function bo(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/bo/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function PlansView({ agencies }: { agencies: BackofficeAgencyRow[] }) {
  const [scope, setScope] = useState(""); // "" = platform defaults
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tier, setTier] = useState<(typeof TIERS)[number]>("STARTER");
  const [price, setPrice] = useState("");
  const [limitsText, setLimitsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (agencyId: string) => {
    const res = (await bo(`plans${agencyId ? `?agencyId=${agencyId}` : ""}`).catch(() => null)) as
      | PlanRow[]
      | null;
    if (res) setRows(res);
  }, []);

  useEffect(() => {
    void refresh(scope);
  }, [scope, refresh]);

  // Prefill the editor from the row being edited so a confirm is a review,
  // not a retype.
  const startEdit = (r: PlanRow) => {
    setTier(r.name as (typeof TIERS)[number]);
    setPrice(String(r.priceMonthlyCents / 100));
    setLimitsText(JSON.stringify(r.limits, null, 2));
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0) return setError("Price must be a non-negative number of dollars.");
    let limits: Record<string, unknown>;
    try {
      limits = limitsText.trim() ? (JSON.parse(limitsText) as Record<string, unknown>) : {};
      if (limits === null || typeof limits !== "object" || Array.isArray(limits)) throw new Error("not an object");
      for (const v of Object.values(limits)) {
        if (!["number", "string", "boolean"].includes(typeof v)) throw new Error("values must be numbers, strings or booleans");
      }
    } catch (err) {
      return setError(`Limits must be a JSON object of numbers/strings/booleans${err instanceof Error && err.message !== "not an object" ? ` (${err.message})` : ""}.`);
    }
    setBusy(true);
    try {
      await bo("plans", {
        method: "POST",
        body: JSON.stringify({
          ...(scope ? { agencyId: scope } : {}),
          name: tier,
          priceMonthlyCents: Math.round(dollars * 100),
          limits,
        }),
      });
      setToast(`${tier} saved and confirmed (audited).`);
      await refresh(scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = scope ? (agencies.find((a) => a.id === scope)?.name ?? "agency") : "Platform defaults";
  const shown = (rows ?? []).filter((r) => (scope ? true : r.agencyId === null));

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Plan tiers
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 18px", maxWidth: 720 }}>
        Agency-level tiers (STARTER / GROWTH / SCALE). Per-tier limits are set here and only here —
        until a tier is saved in this editor its numbers are proposals, and tenant surfaces say so.
        A per-agency row beats the platform default for that agency. Every change is audited.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
        <label style={{ fontSize: 13, color: "#5b6560" }}>Scope</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="Plan scope"
          style={{
            height: 38,
            borderRadius: 10,
            border: "1px solid var(--cf-color-hairline, #ebe3d6)",
            padding: "0 12px",
            fontSize: 14,
            background: "#fff",
          }}
        >
          <option value="">Platform defaults</option>
          {agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} (override)
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        <section>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>
            Tiers — {scopeLabel}
          </h2>
          <div
            style={{
              background: "#fff",
              border: "1px solid var(--cf-color-hairline, #ebe3d6)",
              borderRadius: 12,
              overflow: "hidden",
            }}
            data-testid="bo-plans-table"
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--cf-color-bg, #fbf7f0)", textAlign: "left" }}>
                  {["Tier", "Scope", "Monthly", "Limits", "Status", ""].map((h, i) => (
                    <th
                      key={h || i}
                      style={{
                        padding: "9px 14px",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        color: "#5b6560",
                        fontWeight: 700,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 18, color: "#8a938d" }}>
                      Loading…
                    </td>
                  </tr>
                ) : shown.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 18, color: "#8a938d" }}>
                      No tier rows yet.
                    </td>
                  </tr>
                ) : (
                  shown.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
                      <td style={{ padding: "9px 14px", fontWeight: 700 }}>{r.name}</td>
                      <td style={{ padding: "9px 14px", color: "#5b6560" }}>{r.agencyId ? "override" : "default"}</td>
                      <td style={{ padding: "9px 14px", fontWeight: 600 }}>${(r.priceMonthlyCents / 100).toLocaleString("en-US")}</td>
                      <td style={{ padding: "9px 14px", fontFamily: "monospace", fontSize: 11.5, color: "#5b6560", maxWidth: 220, overflowWrap: "anywhere" }}>
                        {Object.keys(r.limits).length ? JSON.stringify(r.limits) : "—"}
                      </td>
                      <td style={{ padding: "9px 14px" }}>
                        <span
                          data-testid={`bo-plan-status-${r.name.toLowerCase()}${r.agencyId ? "-ov" : ""}`}
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: 0.4,
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: r.confirmed ? "#e8f3ea" : "#fdf3dd",
                            color: r.confirmed ? "#2c6e3f" : "#8a6d1a",
                          }}
                        >
                          {r.confirmed ? "CONFIRMED" : "PROPOSED"}
                        </span>
                      </td>
                      <td style={{ padding: "9px 14px" }}>
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#2c6e3f",
                            background: "none",
                            border: 0,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>
            Set a tier ({scopeLabel})
          </h2>
          <form
            onSubmit={submit}
            data-testid="bo-plans-form"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: "#fff",
              border: "1px solid var(--cf-color-hairline, #ebe3d6)",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <select value={tier} onChange={(e) => setTier(e.target.value as (typeof TIERS)[number])} aria-label="Tier" style={inp}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              step="0.01"
              placeholder="monthly price (dollars)"
              aria-label="Monthly price in dollars"
              style={inp}
            />
            <label style={{ fontSize: 12, color: "#8a938d" }}>
              Limits — JSON object, e.g. {"{"}&quot;workspaces&quot;: 3, &quot;emailsPerMonth&quot;: 10000{"}"}
            </label>
            <textarea
              value={limitsText}
              onChange={(e) => setLimitsText(e.target.value)}
              rows={5}
              aria-label="Limits JSON"
              style={{ ...inp, height: "auto", padding: "8px 12px", fontFamily: "monospace", fontSize: 12.5 }}
            />
            {error ? <div style={{ color: "var(--cf-color-danger, #c9543f)", fontSize: 13 }}>{error}</div> : null}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Save & confirm tier"}
            </Button>
            <div style={{ fontSize: 12, color: "#8a938d", lineHeight: 1.5 }}>
              Saving marks the tier CONFIRMED — signup and billing screens stop calling its numbers
              proposals from that moment.
            </div>
          </form>
        </section>
      </div>

      {toast ? <Toast onClose={() => setToast(null)}>{toast}</Toast> : null}
    </div>
  );
}

const inp: CSSProperties = {
  height: 38,
  borderRadius: 9,
  border: "1px solid var(--cf-color-hairline, #ebe3d6)",
  padding: "0 12px",
  fontSize: 14,
};
