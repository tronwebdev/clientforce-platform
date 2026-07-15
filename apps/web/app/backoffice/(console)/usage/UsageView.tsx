"use client";

import { useEffect, useState } from "react";
import type { BackofficeAgencyRow, UsageRollup } from "@clientforce/core";

async function bo(path: string): Promise<unknown> {
  const res = await fetch(`/api/bo/${path}`, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, padding: "16px 18px", minWidth: 150 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "#8a938d", fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 26, fontWeight: 700, marginTop: 6, color: muted ? "#8a938d" : "#0e1512" }}>{value}</div>
    </div>
  );
}

export function UsageView({ agencies }: { agencies: BackofficeAgencyRow[] }) {
  const options = agencies.flatMap((a) => [
    { key: `agency:${a.id}`, label: `${a.name} — whole agency` },
    ...a.workspaces.map((w) => ({ key: `workspace:${w.id}`, label: `${a.name} / ${w.name}` })),
  ]);
  const [sel, setSel] = useState(options[0]?.key ?? "");
  const [usage, setUsage] = useState<UsageRollup | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sel) return;
    const [scope, id] = sel.split(":");
    setLoading(true);
    bo(`usage?scope=${scope}&id=${id}`)
      .then((u) => setUsage(u as UsageRollup))
      .catch(() => setUsage(null))
      .finally(() => setLoading(false));
  }, [sel]);

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>Usage</h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 18px", maxWidth: 720 }}>
        Consumption over the last 30 days, from the event and credit ledgers.
      </p>

      {options.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#5b6560", background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14 }}>
          No tenants yet.
        </div>
      ) : (
        <>
          <select
            value={sel}
            onChange={(e) => setSel(e.target.value)}
            aria-label="Scope"
            style={{ height: 40, borderRadius: 10, border: "1px solid var(--cf-color-hairline, #ebe3d6)", padding: "0 12px", fontSize: 14, minWidth: 320, marginBottom: 20, background: "#fff" }}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>

          {loading || !usage ? (
            <div style={{ color: "#8a938d", padding: 20 }}>Loading…</div>
          ) : (
            <>
              {usage.lowData ? (
                <div style={{ marginBottom: 14, fontSize: 13, color: "#8a6d3b", background: "rgba(208,245,107,0.25)", border: "1px solid #d0f56b", borderRadius: 10, padding: "8px 12px", display: "inline-block" }}>
                  Low data — too few events to read into these numbers.
                </div>
              ) : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {Object.entries(usage.sendsByChannel).length === 0 ? (
                  <Stat label="Sends" value="0" muted />
                ) : (
                  Object.entries(usage.sendsByChannel).map(([ch, n]) => (
                    <Stat key={ch} label={`${ch} sends`} value={n.toLocaleString()} />
                  ))
                )}
                <Stat label="Voice minutes" value={usage.voiceMinutes.toLocaleString()} />
                <Stat label="Credit burn" value={usage.creditBurn.toLocaleString()} />
                <Stat label="Credit granted" value={usage.creditGranted.toLocaleString()} />
                <Stat label="AI spend" value="not yet metered" muted />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
