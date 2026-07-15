"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { BackofficeAgencyRow } from "@clientforce/core";
import { Button, Toast } from "@clientforce/ui";

interface EffectiveRow {
  action: string;
  credits: number | null;
}
interface HistoryRow {
  id: string;
  agencyId: string | null;
  action: string;
  credits: number;
  effectiveFrom: string;
}
interface PricesResponse {
  agencyId: string | null;
  effective: EffectiveRow[];
  history: HistoryRow[];
}

async function bo(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/bo/${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function PricingView({ agencies }: { agencies: BackofficeAgencyRow[] }) {
  const [scope, setScope] = useState(""); // "" = platform defaults
  const [data, setData] = useState<PricesResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [credits, setCredits] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (agencyId: string) => {
    const res = (await bo(`credit-prices${agencyId ? `?agencyId=${agencyId}` : ""}`).catch(() => null)) as
      | PricesResponse
      | null;
    if (res) setData(res);
  }, []);

  useEffect(() => {
    void refresh(scope);
  }, [scope, refresh]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = Number(credits);
    if (!action.trim()) return setError("Action is required.");
    if (!Number.isInteger(n) || n < 0) return setError("Credits must be a non-negative whole number.");
    setBusy(true);
    try {
      await bo("credit-prices", {
        method: "POST",
        body: JSON.stringify({
          ...(scope ? { agencyId: scope } : {}),
          action: action.trim(),
          credits: n,
          ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom).toISOString() } : {}),
        }),
      });
      setAction("");
      setCredits("");
      setEffectiveFrom("");
      setToast("Price saved (effective-dated, audited).");
      await refresh(scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = scope ? agencies.find((a) => a.id === scope)?.name ?? "agency" : "Platform defaults";

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>Credit pricing</h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 18px", maxWidth: 720 }}>
        Effective-dated prices. Saving appends a new row (never edits in place), so the full change history is
        preserved and a per-agency override beats the platform default. Every change is audited.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
        <label style={{ fontSize: 13, color: "#5b6560" }}>Scope</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="Pricing scope"
          style={{ height: 38, borderRadius: 10, border: "1px solid var(--cf-color-hairline, #ebe3d6)", padding: "0 12px", fontSize: 14, background: "#fff" }}
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
            Effective now — {scopeLabel}
          </h2>
          <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--cf-color-bg, #fbf7f0)", textAlign: "left" }}>
                  <th style={{ padding: "9px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6560", fontWeight: 700 }}>Action</th>
                  <th style={{ padding: "9px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6560", fontWeight: 700 }}>Credits</th>
                </tr>
              </thead>
              <tbody>
                {(data?.effective ?? []).length === 0 ? (
                  <tr><td colSpan={2} style={{ padding: 18, color: "#8a938d" }}>No prices set.</td></tr>
                ) : (
                  data!.effective.map((e) => (
                    <tr key={e.action} style={{ borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
                      <td style={{ padding: "9px 14px", fontFamily: "monospace", fontSize: 12 }}>{e.action}</td>
                      <td style={{ padding: "9px 14px", fontWeight: 600 }}>{e.credits ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <form onSubmit={submit} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8, background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Set a price ({scopeLabel})</div>
            <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="action (e.g. email_send)" style={inp} />
            <input value={credits} onChange={(e) => setCredits(e.target.value)} type="number" placeholder="credits" style={inp} />
            <label style={{ fontSize: 12, color: "#8a938d" }}>Effective from (blank = now)</label>
            <input value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} type="datetime-local" style={inp} />
            {error ? <div style={{ color: "var(--cf-color-danger, #c9543f)", fontSize: 13 }}>{error}</div> : null}
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save price"}</Button>
          </form>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>History</h2>
          <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--cf-color-bg, #fbf7f0)", textAlign: "left" }}>
                  {["Action", "Scope", "Credits", "Effective from"].map((h) => (
                    <th key={h} style={{ padding: "9px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6560", fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.history ?? []).length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 18, color: "#8a938d" }}>No history.</td></tr>
                ) : (
                  data!.history.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
                      <td style={{ padding: "9px 14px", fontFamily: "monospace", fontSize: 12 }}>{r.action}</td>
                      <td style={{ padding: "9px 14px", color: "#5b6560" }}>{r.agencyId ? "override" : "default"}</td>
                      <td style={{ padding: "9px 14px", fontWeight: 600 }}>{r.credits}</td>
                      <td style={{ padding: "9px 14px", color: "#5b6560" }}>{new Date(r.effectiveFrom).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
