import { fetchReconciliation } from "../../../../lib/backoffice";

/** Provider-invoice reconciliation (FR-ADMIN-02): our metered usage vs the
 *  seeded provider invoices, per provider per month. The FR-BILL-04 prerequisite. */
export default async function ReconciliationPage() {
  const rows = await fetchReconciliation();

  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());
  const variancePill = (r: (typeof rows)[number]) => {
    if (r.matchesInvoice === null)
      return <span style={{ color: "#8a938d", fontSize: 12 }}>not metered</span>;
    const ok = r.matchesInvoice;
    return (
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: "2px 9px",
          borderRadius: 999,
          background: ok ? "rgba(53,232,52,0.15)" : "rgba(201,84,63,0.12)",
          color: ok ? "#16a82a" : "#c9543f",
        }}
      >
        {ok ? "matches" : `${r.variance! > 0 ? "+" : ""}${r.variance} (${r.variancePct}%)`}
      </span>
    );
  };

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Reconciliation
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 20px", maxWidth: 720 }}>
        Our metered usage (from the event ledger) vs each provider invoice, per provider per month. This is the
        prerequisite for enforcing credits after one reconciled month — metrics we don&apos;t meter yet are shown
        honestly as <em>not metered</em>, never a fabricated match.
      </p>

      {rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#5b6560", background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14 }}>
          No provider invoices loaded yet.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--cf-color-bg, #fbf7f0)", textAlign: "left" }}>
                {["Provider", "Metric", "Month", "Our metered", "Invoice qty", "Invoice $", "Reconciliation"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6560", fontWeight: 700 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.provider}-${r.metric}-${r.month}-${i}`} style={{ borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{r.provider}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12 }}>{r.metric}</td>
                  <td style={{ padding: "10px 14px", color: "#5b6560" }}>{r.month}</td>
                  <td style={{ padding: "10px 14px" }}>{fmt(r.meteredQuantity)}</td>
                  <td style={{ padding: "10px 14px" }}>{fmt(r.invoiceQuantity)}</td>
                  <td style={{ padding: "10px 14px", color: "#5b6560" }}>
                    {r.invoiceAmount === null ? "—" : `$${(r.invoiceAmount / 100).toFixed(2)}`}
                  </td>
                  <td style={{ padding: "10px 14px" }}>{variancePill(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
