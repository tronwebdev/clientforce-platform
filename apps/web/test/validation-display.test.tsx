/**
 * LH1 W2 (DEC-087): display contracts for the validation surfaces —
 * the verdict-chip map (all four states, exact treatments), the import
 * report card's honest lines (progressive "Validating N…", counts verbatim,
 * held copy per reason — a hold reads as a QUEUE, never a failure), and the
 * exclusions download. Static markup pins, node env (repo convention).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ValidationBatchReport } from "@clientforce/core";
import { EMAIL_VERDICTS, VALIDATION_HOLD_REASONS } from "@clientforce/core";
import { ValidationReportCard, VALIDATION_HELD_COPY, VERDICT_CHIP } from "../components/validation";

const report = (
  counts: Partial<ValidationBatchReport["counts"]>,
  status: ValidationBatchReport["status"] = "running",
  heldReason: ValidationBatchReport["heldReason"] = null,
): ValidationBatchReport => ({
  id: "vb1",
  status,
  heldReason,
  source: "csv_import",
  listId: null,
  counts: { total: 0, pending: 0, valid: 0, risky: 0, invalid: 0, skippedSuppressed: 0, ...counts },
  createdAt: new Date(0).toISOString(),
  completedAt: null,
});

describe("verdict chips (LH1)", () => {
  it("covers every verdict in the enum of record — no state renders unstyled", () => {
    for (const v of EMAIL_VERDICTS) expect(VERDICT_CHIP[v], v).toBeTruthy();
  });
  it("pins the four treatments: valid green · risky amber · invalid red · unverified neutral", () => {
    expect(VERDICT_CHIP.valid).toMatchObject({ label: "✓ Valid email", fg: "#16A82A" });
    expect(VERDICT_CHIP.risky).toMatchObject({ label: "Risky", fg: "#9A6B12" });
    expect(VERDICT_CHIP.invalid).toMatchObject({ label: "Invalid", fg: "#C9543F" });
    expect(VERDICT_CHIP.unverified).toMatchObject({ label: "Unverified", fg: "#8A7F6B" });
  });
});

describe("import validation report card (LH1)", () => {
  it("pending renders the honest progressive line + live counts — never a blocking state", () => {
    const html = renderToStaticMarkup(
      <ValidationReportCard batchId="vb1" report={report({ total: 100, pending: 40, valid: 55, risky: 3, invalid: 2 })} invalidRows={null} />,
    );
    expect(html).toContain("Validating 40 contacts — sending starts as they clear.");
    expect(html).toContain("55 valid · 3 risky (held) · 2 invalid (excluded) · 0 already suppressed");
    expect(html).toContain("Validating…");
  });

  it("every hold reason has HONEST queued copy (held = queue, never an error)", () => {
    for (const reason of VALIDATION_HOLD_REASONS) {
      expect(VALIDATION_HELD_COPY[reason], reason).toContain("held until verified");
      const html = renderToStaticMarkup(
        <ValidationReportCard batchId="vb1" report={report({ total: 10, pending: 10 }, "held", reason)} invalidRows={null} />,
      );
      expect(html).toContain(VALIDATION_HELD_COPY[reason]!.replace(/'/g, "&#x27;"));
    }
  });

  it("completed happy path: Complete pill, counts, and NO download when nothing was excluded", () => {
    const html = renderToStaticMarkup(
      <ValidationReportCard batchId="vb1" report={report({ total: 10, valid: 10 }, "completed")} invalidRows={null} />,
    );
    expect(html).toContain("Complete");
    expect(html).toContain("10 valid · 0 risky (held) · 0 invalid (excluded) · 0 already suppressed");
    expect(html).not.toContain("Download excluded rows");
  });

  it("exclusions download + invalid row detail appear exactly when something was excluded", () => {
    const html = renderToStaticMarkup(
      <ValidationReportCard
        batchId="vb1"
        report={report({ total: 10, valid: 6, invalid: 3, skippedSuppressed: 1 }, "completed")}
        invalidRows={[{ contactId: "c1", email: "dead@x.test", outcome: "invalid", via: "zerobounce", detail: "mailbox_not_found" }]}
      />,
    );
    expect(html).toContain("/api/cf/contacts/validation-batches/vb1/exclusions.csv");
    expect(html).toContain("dead@x.test");
    expect(html).toContain("mailbox_not_found");
  });

  it("no report yet = an honest checking state, nothing invented", () => {
    const html = renderToStaticMarkup(<ValidationReportCard batchId="vb1" report={null} invalidRows={null} />);
    expect(html).toContain("Checking addresses…");
    expect(html).not.toContain("valid ·");
  });
});
