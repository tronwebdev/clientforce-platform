import { fetchAuditLog } from "../../../../lib/backoffice";

/** Backoffice audit log (FR-ADMIN-01): every operator action, append-only. */
export default async function AuditPage() {
  const rows = await fetchAuditLog();

  return (
    <div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}>
        Audit log
      </h1>
      <p style={{ color: "#5b6560", fontSize: 14, margin: "0 0 20px" }}>
        Every backoffice action is recorded — operator, action, target, and reason.
      </p>

      {rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#5b6560", background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14 }}>
          No operator actions recorded yet.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid var(--cf-color-hairline, #ebe3d6)", borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--cf-color-bg, #fbf7f0)", textAlign: "left" }}>
                {["When", "Operator", "Action", "Target", "Reason"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6560", fontWeight: 700 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--cf-color-hairline, #ebe3d6)" }}>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "#5b6560" }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: "10px 14px" }}>{r.operatorEmail}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12 }}>{r.action}</td>
                  <td style={{ padding: "10px 14px", color: "#5b6560" }}>
                    {r.targetType}: <span style={{ fontFamily: "monospace", fontSize: 11 }}>{r.targetId}</span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
