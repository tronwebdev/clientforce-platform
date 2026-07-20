"use client";

/**
 * LH1 (DEC-087): shared validation display atoms — §0-flagged designed
 * additions (the C2.5/import canon predates validation).
 *
 *  · VERDICT_CHIP — the one chip treatment every surface uses (Contacts rows
 *    chip only the action-relevant states; the drawer shows all four).
 *  · ValidationReportCard — the import report: progressive "Validating N…",
 *    honest held states ("validation queued", never silent, never an error),
 *    counts verbatim, row-level invalid detail, exclusions CSV download.
 */
import type { ValidationBatchReport, ValidationBatchRow } from "@clientforce/core";

export const VERDICT_CHIP: Record<string, { label: string; bg: string; fg: string; title: string }> = {
  valid: { label: "✓ Valid email", bg: "rgba(53,232,52,.14)", fg: "#16A82A", title: "Verified deliverable" },
  risky: { label: "Risky", bg: "rgba(232,196,91,.2)", fg: "#9A6B12", title: "Risky address — held from sending (workspace policy)" },
  invalid: { label: "Invalid", bg: "rgba(224,121,107,.14)", fg: "#C9543F", title: "Invalid address — excluded from campaigns" },
  unverified: { label: "Unverified", bg: "#F2EEE4", fg: "#8A7F6B", title: "Validation pending — held until verified" },
};

/** Honest held copy per reason — a hold is a queue, never a failure. */
export const VALIDATION_HELD_COPY: Record<string, string> = {
  workspace_allowance:
    "Validation queued — today's validation allowance is used; it resumes automatically tomorrow. Contacts stay safely held until verified.",
  platform_spend_ceiling:
    "Validation queued — it resumes automatically tomorrow. Contacts stay safely held until verified.",
  provider_unavailable:
    "Validation is temporarily unavailable — queued to retry. Contacts stay safely held until verified.",
};

export function ValidationReportCard({
  batchId,
  report,
  invalidRows,
}: {
  batchId: string;
  report: ValidationBatchReport | null;
  invalidRows: ValidationBatchRow[] | null;
}) {
  const c = report?.counts;
  const resolvedAny = Boolean(c && c.total - c.pending > 0);
  return (
    <div style={{ marginTop: 12, border: "1px solid #EBE3D6", borderRadius: 11, textAlign: "left", padding: "12px 14px", background: "#FBF7F0" }} data-testid="csv-validation-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".05em", flex: 1 }}>Email validation</span>
        {c && c.pending > 0 ? (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#9A6B12", background: "rgba(232,196,91,.2)", borderRadius: 100, padding: "3px 10px" }} data-testid="csv-validation-pending">Validating…</span>
        ) : report?.status === "completed" ? (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.14)", borderRadius: 100, padding: "3px 10px" }}>Complete</span>
        ) : null}
      </div>
      {!report ? (
        <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>Checking addresses…</div>
      ) : (
        <>
          {c && c.pending > 0 ? (
            <div style={{ fontSize: 12.5, color: "#5C6B62", marginBottom: 6 }} data-testid="csv-validation-progress">
              Validating {c.pending.toLocaleString()} contact{c.pending === 1 ? "" : "s"} — sending starts as they clear.
            </div>
          ) : null}
          {report.status === "held" && report.heldReason ? (
            <div style={{ fontSize: 12.5, color: "#9A6B12", marginBottom: 6 }} data-testid="csv-validation-held">
              {VALIDATION_HELD_COPY[report.heldReason] ?? "Validation queued — contacts stay safely held until verified."}
            </div>
          ) : null}
          {resolvedAny && c ? (
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0E1512" }} data-testid="csv-validation-counts">
              {c.valid.toLocaleString()} valid · {c.risky.toLocaleString()} risky (held) · {c.invalid.toLocaleString()} invalid (excluded) · {c.skippedSuppressed.toLocaleString()} already suppressed
            </div>
          ) : null}
          {invalidRows && invalidRows.length > 0 ? (
            <div style={{ marginTop: 8, border: "1px solid rgba(224,121,107,.3)", borderRadius: 9, background: "#fff" }} data-testid="csv-validation-invalid-rows">
              {invalidRows.map((r, i) => (
                <div key={r.contactId} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "7px 11px", borderTop: i === 0 ? "none" : "1px solid #F3EEE4" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0E1512", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>{r.email}</span>
                  <span style={{ fontSize: 11.5, color: "#C9543F", minWidth: 0 }}>{r.detail ?? r.via ?? "invalid"}</span>
                </div>
              ))}
            </div>
          ) : null}
          {c && c.invalid + c.skippedSuppressed > 0 ? (
            <a href={`/api/cf/contacts/validation-batches/${batchId}/exclusions.csv`} download style={{ display: "inline-block", marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "#1192A6", textDecoration: "none" }} data-testid="csv-validation-download">
              ⬇ Download excluded rows (CSV)
            </a>
          ) : null}
        </>
      )}
    </div>
  );
}
