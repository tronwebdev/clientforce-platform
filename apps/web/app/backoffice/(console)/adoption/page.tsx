import { fetchAdoption } from "../../../../lib/backoffice";

/** Product adoption (FR-TELEM-01..04): activation funnel · DAU/WAU · feature
 *  adoption, computed from the internal telemetry store. Below the sample floor,
 *  numbers are marked "low data" rather than over-read. Internal-only. */
export default async function AdoptionPage() {
  const a = await fetchAdoption();
  const maxCount = a ? Math.max(1, ...a.funnel.map((s) => s.count)) : 1;

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Adoption
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 18px", maxWidth: 720 }}>
        Product-adoption telemetry — ids and event names only, never message or contact content. Internal;
        excluded from tenant Analytics.
      </p>

      {!a ? (
        <div style={{ padding: 40, textAlign: "center", color: "#5b6560", background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14 }}>
          No telemetry available.
        </div>
      ) : (
        <>
          {a.lowData ? (
            <div style={{ marginBottom: 16, fontSize: 13, color: "#8a6d3b", background: "rgba(208,245,107,0.25)", border: "1px solid #d0f56b", borderRadius: 10, padding: "8px 12px", display: "inline-block" }}>
              Low data — too few events in this window to read into these numbers.
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <Stat label="DAU (active workspaces)" value={a.dau.toLocaleString()} />
            <Stat label="WAU (active workspaces)" value={a.wau.toLocaleString()} />
            <Stat label="Stickiness (DAU/WAU)" value={a.wau > 0 ? `${Math.round((a.dau / a.wau) * 100)}%` : "—"} muted={a.wau === 0} />
          </div>

          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>Activation funnel</h2>
          <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, padding: 18, marginBottom: 24 }}>
            {a.funnel.map((s) => (
              <div key={s.step} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{ width: 100, fontSize: 13, textTransform: "capitalize", color: "#5b6560" }}>{s.step}</div>
                <div style={{ flex: 1, background: "var(--cf-color-bg, #fbf7f0)", borderRadius: 8, height: 26, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round((s.count / maxCount) * 100)}%`, minWidth: s.count > 0 ? 2 : 0, height: "100%", background: "var(--cf-gradient-brand, #35e834)" }} />
                </div>
                <div style={{ width: 56, textAlign: "right", fontWeight: 700 }}>{s.count.toLocaleString()}</div>
                <div style={{ width: 64, textAlign: "right", fontSize: 12, color: "#8a938d" }}>
                  {s.conversionPct === null ? "" : `${s.conversionPct}%`}
                </div>
              </div>
            ))}
          </div>

          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>Feature adoption</h2>
          {a.featureAdoption.length === 0 ? (
            <div style={{ color: "#8a938d", fontSize: 13 }}>No feature-use events in this window.</div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, overflow: "hidden", maxWidth: 480 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--cf-color-bg, #fbf7f0)", textAlign: "left" }}>
                    <th style={{ padding: "9px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6560", fontWeight: 700 }}>Feature</th>
                    <th style={{ padding: "9px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6560", fontWeight: 700 }}>Workspaces</th>
                  </tr>
                </thead>
                <tbody>
                  {a.featureAdoption.map((f) => (
                    <tr key={f.feature} style={{ borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
                      <td style={{ padding: "9px 14px", fontFamily: "monospace", fontSize: 12 }}>{f.feature}</td>
                      <td style={{ padding: "9px 14px", fontWeight: 600 }}>{f.workspaces.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, padding: "16px 18px", minWidth: 170 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "#8a938d", fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 26, fontWeight: 700, marginTop: 6, color: muted ? "#8a938d" : "#0e1512" }}>{value}</div>
    </div>
  );
}
