"use client";

/**
 * C2.5 contacts CSV import — THE one 3-step import flow (Upload → Map →
 * Review → Done), extracted verbatim from ContactsView so the Create-Agent
 * wizard can mount the SAME component (W3-1: reuse, never a wizard fork).
 * Kickoff-premise correction, flagged on the PR: the flow lived inline in
 * ContactsView.tsx, not packages/ui — it is `cf`-coupled (chunked
 * transactional POSTs), so the shared home is this app-level component.
 *
 * Semantics unchanged from the IMP round (DEC-058): client-side parse,
 * auto-match mapping w/ admin custom-field create, snapshotted review tiles
 * (IMP-2), chunked transactional `POST /contacts/import` (server-side
 * dedupe/suppression/list-attach), server-count done modal, error summary
 * with retry-failed-only (IMP-1), close-mid-run continues in the background.
 *
 * The component stays MOUNTED while `open` is false so a background run
 * (DEC-058) survives the modal closing; the parent only flips `open`.
 *
 * Wizard mount extras (Contacts mount behavior-identical without them):
 * `ensureDefaultList` — the import must land in a referenceable list, so the
 * list select's default becomes “＋ New list "<file>"”, created at import
 * start; `onImported` — hands the caller the server result + the listId the
 * run landed in (the wizard resolves count/sample live from it — B6 rule).
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  importContactRowSchema,
  type ContactFieldDefDto,
  type ImportContactRow,
  type ImportContactsResult,
  type ValidationBatchReport,
  type ValidationBatchRow,
} from "@clientforce/core";
import { listGlyph } from "@clientforce/ui";
import { ValidationReportCard } from "./validation";

const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

const cf = (path: string, init?: RequestInit) =>
  fetch(`/api/cf/${path}`, { headers: { "Content-Type": "application/json" }, ...init }).then(
    async (r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    },
  );

/** 40-1: a CSV header becomes a HUMAN label ("practice_type" -> "Practice type");
 *  the raw slug lives only in the def key / token ({{custom.practice_type}}). */
export const humanizeHeader = (h: string) => h.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());

/** 40-2: the two designed create failures get distinct copy (409 vs 422). */
export const fieldCreateFailureCopy = (err: unknown) => {
  const status = err instanceof Error ? /:\s*(\d+)$/.exec(err.message)?.[1] : null;
  return status === "422"
    ? "This workspace has reached its 30-field limit — archive a field to add another."
    : "Couldn't create that field — it may already exist.";
};

/** "Add to list" select styles (the add-drawer literals ContactsView uses). */
const addLbl: CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 };
const addInp: CSSProperties = { width: "100%", boxSizing: "border-box", height: 44, borderRadius: 10, background: "#fff", border: "1px solid #EBE3D6", padding: "0 13px", fontSize: 14, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" };

/** CSV map targets — standard labels · `custom:<key>` · `__create__` · skip. */
const CSV_FIELDS = ["First name", "Last name", "Email", "Company", "Phone", "Title", "Skip this column"] as const;
const CSV_FIELD_KEY: Record<string, string> = { "First name": "firstName", "Last name": "lastName", Email: "email", Company: "company", Phone: "phone", Title: "title" };
const CSV_CREATE = "__create__";
function autoMatch(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z]/g, "");
  if (h.includes("first")) return "First name";
  if (h.includes("last") || h === "surname") return "Last name";
  if (h.includes("email") || h.includes("mail")) return "Email";
  if (h.includes("company") || h.includes("org")) return "Company";
  if (h.includes("phone") || h.includes("tel")) return "Phone";
  if (h.includes("title") || h.includes("role")) return "Title";
  return "Skip this column";
}
/** IMP-3: chunk size for the bulk endpoint — small enough that the progress
 *  bar moves on an owner-sized (tens of rows) file, well under the server's
 *  IMPORT_CHUNK_MAX. Each chunk is one transactional POST /contacts/import. */
const CLIENT_CHUNK = 25;

export interface ContactImportFlowProps {
  /** Render the modal. The component stays mounted while closed (DEC-058). */
  open: boolean;
  onClose: () => void;
  /** Active (non-archived) lists for the review step's "Add to list" select. */
  lists: { id: string; name: string }[];
  /** Active (non-archived) custom-field defs for the "Maps to" dropdown. */
  fieldDefs: ContactFieldDefDto[];
  refreshDefs: () => void;
  isAdmin: boolean;
  /**
   * Workspace rows for the review step's client-side dupe/suppression
   * ESTIMATE (IMP-2) — the server re-dedupes authoritatively either way.
   * null = not loaded; estimates degrade to zero, tiles stay honest labels.
   */
  existingRows: { email: string | null; unsub: boolean }[] | null;
  toast: (m: string) => void;
  /** Fires when an import run (or retry) completes, before the done modal. */
  onImported?: (result: ImportContactsResult, listId: string | null) => void;
  /**
   * Wizard mount: with no list picked the import creates one at start
   * (named after the file) so the audience can reference it. Absent
   * (Contacts mount) the default stays "No list (all contacts)".
   */
  ensureDefaultList?: (fileName: string) => Promise<{ id: string; name: string }>;
}

export function ContactImportFlow({ open, onClose, lists, fieldDefs, refreshDefs, isAdmin, existingRows, toast, onImported, ensureDefaultList }: ContactImportFlowProps) {
  // 36-2: 3-step CSV wizard (Upload → Map → Review → Done), client-side parse.
  const [csvStep, setCsvStep] = useState(0);
  const [csvFile, setCsvFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [csvMap, setCsvMap] = useState<string[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [mapDD, setMapDD] = useState<number | null>(null);
  // IMP-1/IMP-2 (owner bug round 2026-07-08): the Review tiles are SNAPSHOTTED
  // when the user enters the Review step — never recomputed while a poll
  // refreshes rows — and execution has real states: button disables, a
  // progress bar tracks chunks, and the done modal shows the SERVER's counts.
  const [reviewSnap, setReviewSnap] = useState<{
    newCount: number; dupes: number; suppressed: number; mapped: number;
    createCount: number; valid: string[][]; emailIdx: number;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProg, setImportProg] = useState<{ done: number; total: number } | null>(null);
  const [importResult, setImportResult] = useState<ImportContactsResult | null>(null);
  /** Rows sent to the server this run — retry pulls failed indexes from here. */
  const sentRowsRef = useRef<ImportContactRow[]>([]);
  /** DEC-058: closing mid-import continues in the background + completion toast. */
  const bgCloseRef = useRef(false);
  const [csvListId, setCsvListId] = useState<string>("");
  const [csvListDD, setCsvListDD] = useState(false);
  /** Wizard mount: the list the run auto-created (sticky for retries). */
  const ensuredListRef = useRef<{ id: string; name: string } | null>(null);
  // LH1 (DEC-087): the ASYNC validation pass — one client key per import run
  // (retries reuse it) so every chunk lands on ONE ValidationBatch; the done
  // modal polls the batch report progressively (A4 cadence). Validation
  // never blocks the import — these states only feed the honest report card.
  const valKeyRef = useRef<string | null>(null);
  const [valBatchId, setValBatchId] = useState<string | null>(null);
  const [valReport, setValReport] = useState<ValidationBatchReport | null>(null);
  const [valInvalidRows, setValInvalidRows] = useState<ValidationBatchRow[] | null>(null);

  useEffect(() => {
    if (!open || csvStep !== 3 || !valBatchId) return;
    let dead = false;
    const poll = async () => {
      const report = (await cf(`contacts/validation-batches/${valBatchId}`).catch(() => null)) as ValidationBatchReport | null;
      if (dead || !report) return;
      setValReport(report);
      if (report.counts.pending === 0 && report.counts.invalid > 0) {
        const detail = (await cf(`contacts/validation-batches/${valBatchId}/rows?outcome=invalid&take=8`).catch(() => null)) as { rows: ValidationBatchRow[] } | null;
        if (!dead && detail) setValInvalidRows(detail.rows);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 5000);
    return () => { dead = true; clearInterval(t); };
  }, [open, csvStep, valBatchId]);

  function loadCsv(name: string, text: string) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const headers = lines[0]!.split(",").map((v) => v.trim());
    const rows = lines.slice(1).map((l) => l.split(",").map((v) => v.trim()));
    setCsvFile({ name, headers, rows });
    setCsvMap(headers.map(autoMatch));
  }
  /** IMP-2: Review stats compute ONCE, on entering the Review step — the tiles
   *  render this snapshot. Dupes/suppressed here are the client's ESTIMATE for
   *  the preview; the done modal shows the server's authoritative counts (the
   *  server re-dedupes transactionally, so a stale estimate can never skip a
   *  legitimate row). */
  function snapReview() {
    if (!csvFile) return;
    const emailIdx = csvMap.findIndex((m) => m === "Email");
    const existing = new Set((existingRows ?? []).map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
    const unsubEmails = new Set((existingRows ?? []).filter((r) => r.unsub).map((r) => (r.email ?? "").toLowerCase()));
    const valid = csvFile.rows.filter((r) => emailIdx >= 0 && /.+@.+\..+/.test(r[emailIdx] ?? ""));
    const dupes = valid.filter((r) => existing.has((r[emailIdx] ?? "").toLowerCase()));
    const suppressed = valid.filter((r) => unsubEmails.has((r[emailIdx] ?? "").toLowerCase()));
    setReviewSnap({
      newCount: valid.length - dupes.length,
      dupes: dupes.length,
      suppressed: suppressed.length,
      mapped: csvMap.filter((m) => m !== "Skip this column").length,
      createCount: csvMap.filter((m) => m === CSV_CREATE).length,
      valid,
      emailIdx,
    });
  }
  async function runImport() {
    if (!csvFile || !reviewSnap || importing) return;
    setCsvError(null);
    // C2.7: create the new defs FIRST — a def-create failure aborts before any
    // contact posts, so no row can land referencing a field that doesn't exist.
    const customKeyByCol = new Map<number, string>();
    for (let i = 0; i < csvMap.length; i += 1) {
      const m = csvMap[i]!;
      if (m.startsWith("custom:")) customKeyByCol.set(i, m.slice(7));
      else if (m === CSV_CREATE) {
        try {
          const def = (await cf("contact-fields", {
            method: "POST",
            body: JSON.stringify({ label: humanizeHeader(csvFile.headers[i] ?? ""), origin: "csv_import" }),
          })) as ContactFieldDefDto;
          customKeyByCol.set(i, def.key);
        } catch (err) {
          setCsvError(`${fieldCreateFailureCopy(err)} The import was not started.`);
          return;
        }
      }
    }
    if (customKeyByCol.size > 0) void refreshDefs();
    // Build payload rows from the SNAPSHOT — every valid row goes to the
    // server; the server decides duplicates (workspace + within-batch), so the
    // client never mis-skips a row off stale data (IMP-2).
    const rowsToSend: ImportContactRow[] = [];
    const prefailed: ImportContactsResult["failed"] = [];
    for (const r of reviewSnap.valid) {
      const payload: Record<string, unknown> = {};
      const custom: Record<string, string> = {};
      csvMap.forEach((m, i) => {
        const key = CSV_FIELD_KEY[m];
        if (key && r[i]) payload[key] = r[i]!;
        const ck = customKeyByCol.get(i);
        if (ck && r[i]) custom[ck] = r[i]!;
      });
      if (Object.keys(custom).length) payload.custom = custom;
      const parsed = importContactRowSchema.safeParse(payload);
      // index -1 = not sendable; these can't be retried, only reported.
      if (!parsed.success) prefailed.push({ index: -1, email: String(payload.email ?? "(no email)"), reason: "Invalid email address — not imported" });
      else rowsToSend.push(parsed.data);
    }
    await executeImport(rowsToSend, prefailed, { created: 0, skippedDuplicates: 0, suppressed: 0 });
  }
  /** Runs the chunk loop; used by both the first run and "Retry failed". Local
   *  variables + refs only — closing the modal mid-run must not disturb it. */
  async function executeImport(
    rowsToSend: ImportContactRow[],
    prefailed: ImportContactsResult["failed"],
    base: { created: number; skippedDuplicates: number; suppressed: number },
  ) {
    let listId = csvListId; // capture — closeImport() may reset the state mid-run
    // Wizard mount (W3-1): no list picked → the import lands in a fresh list
    // named after the file, created BEFORE any row posts (retries reuse it).
    if (!listId && ensureDefaultList && csvFile) {
      if (ensuredListRef.current) listId = ensuredListRef.current.id;
      else {
        try {
          const created = await ensureDefaultList(csvFile.name);
          ensuredListRef.current = created;
          listId = created.id;
          setCsvListId(created.id);
        } catch {
          setCsvError("Couldn't create a list for this import — try again.");
          return;
        }
      }
    }
    bgCloseRef.current = false;
    sentRowsRef.current = rowsToSend;
    setImporting(true);
    setImportProg({ done: 0, total: rowsToSend.length });
    // LH1: one validation-batch key per run — retries reuse it, so retried
    // rows join the SAME batch and the report stays whole. Captured locally:
    // closing the modal mid-run resets the ref but must not disturb the loop.
    const valKey = (valKeyRef.current ??= crypto.randomUUID());
    const agg: ImportContactsResult = { ...base, failed: [...prefailed] };
    for (let start = 0; start < rowsToSend.length; start += CLIENT_CHUNK) {
      const chunk = rowsToSend.slice(start, start + CLIENT_CHUNK);
      try {
        const res = (await cf("contacts/import", {
          method: "POST",
          body: JSON.stringify({ rows: chunk, ...(listId ? { listId } : {}), validationBatchKey: valKey }),
        })) as ImportContactsResult;
        agg.created += res.created;
        agg.skippedDuplicates += res.skippedDuplicates;
        agg.suppressed += res.suppressed;
        agg.failed.push(...res.failed.map((f) => ({ ...f, index: start + f.index })));
        if (res.validationBatchId) setValBatchId(res.validationBatchId);
      } catch {
        // The chunk is one transaction — a failed call imported none of it.
        chunk.forEach((row, i) => agg.failed.push({ index: start + i, email: row.email, reason: "Network error — row not imported" }));
      }
      setImportProg({ done: Math.min(start + chunk.length, rowsToSend.length), total: rowsToSend.length });
    }
    setImporting(false);
    setImportResult(agg);
    onImported?.(agg, listId || null);
    if (bgCloseRef.current) {
      // DEC-058: the modal was closed mid-run — finish silently, then confirm.
      const fails = agg.failed.length;
      toast(`Imported ${agg.created} contact${agg.created === 1 ? "" : "s"}${agg.skippedDuplicates ? ` · ${agg.skippedDuplicates} duplicate${agg.skippedDuplicates === 1 ? "" : "s"} skipped` : ""}${fails ? ` · ${fails} failed` : ""}`);
      setImportProg(null);
      setImportResult(null);
    } else {
      setCsvStep(3);
    }
  }
  /** Error-summary "Retry N failed" — re-runs ONLY the failed rows (IMP-1);
   *  already-created rows are never resent, and the server would skip them as
   *  duplicates even if they were. */
  async function retryFailed() {
    if (!importResult || importing) return;
    const retryRows = importResult.failed.filter((f) => f.index >= 0).map((f) => sentRowsRef.current[f.index]).filter((r): r is ImportContactRow => Boolean(r));
    const keepFailed = importResult.failed.filter((f) => f.index < 0);
    if (retryRows.length === 0) return;
    await executeImport(retryRows, keepFailed, {
      created: importResult.created,
      skippedDuplicates: importResult.skippedDuplicates,
      suppressed: importResult.suppressed,
    });
  }
  function closeImport() {
    onClose();
    setCsvStep(0);
    setCsvFile(null);
    setCsvMap([]);
    setCsvError(null);
    setCsvListId("");
    setCsvListDD(false);
    setReviewSnap(null);
    ensuredListRef.current = null;
    valKeyRef.current = null;
    setValBatchId(null);
    setValReport(null);
    setValInvalidRows(null);
    if (importing) {
      // DEC-058: continue in the background; the chunk loop only reads locals
      // and refs, so resetting the wizard state above is safe. Completion
      // lands as a toast instead of the done modal.
      bgCloseRef.current = true;
      return;
    }
    setImportProg(null);
    setImportResult(null);
  }

  if (!open) return null;
  return (
          <div onClick={closeImport} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 36, zIndex: 60 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 540, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid="import-modal">
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(53,232,52,.16)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#16A82A" }}>⬆</span>
                <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Import contacts from CSV</span>
                <span onClick={closeImport} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
              </div>
              {csvStep < 3 ? (
                <>
                  <div style={{ padding: "16px 22px 0" }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      {[0, 1, 2].map((n) => (
                        <span key={n} style={{ flex: 1, height: 5, borderRadius: 100, background: n <= csvStep ? "#16A82A" : "#E4EAE6" }} />
                      ))}
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".04em", marginTop: 9, textTransform: "uppercase" }}>Step {Math.min(csvStep + 1, 3)} of 3</div>
                  </div>
                  <div style={{ padding: "16px 22px 20px" }}>
                    {csvStep === 0 ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 14 }}>Upload your file</div>
                        <label style={{ display: "block", border: "1.5px dashed #9FD8AC", borderRadius: 13, padding: "30px 20px", textAlign: "center", background: "rgba(53,232,52,.04)", cursor: "pointer" }} data-testid="csv-dropzone">
                          <input type="file" accept=".csv,text/csv" style={{ display: "none" }} data-testid="csv-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => loadCsv(f.name, t)); e.target.value = ""; }} />
                          <div style={{ fontSize: 28, marginBottom: 9 }}>📄</div>
                          <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Drop your CSV here or browse</div>
                          <div style={{ fontSize: 12.5, color: "#9AA59E" }}>.csv up to 50 MB · first row should be column headers</div>
                        </label>
                        {csvFile ? (
                          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "11px 14px" }} data-testid="csv-file-row">
                            <span style={{ width: 32, height: 32, borderRadius: 8, background: "#D7F5DD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#16A82A", flex: "none" }}>✓</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>{csvFile.name}</div>
                              <div style={{ fontSize: 11.5, color: "#9AA59E" }}>{csvFile.rows.length} rows · {csvFile.headers.length} columns detected</div>
                            </div>
                            <span onClick={() => { setCsvFile(null); setCsvMap([]); }} style={{ color: "#9AA59E", cursor: "pointer" }}>✕</span>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {csvStep === 1 && csvFile ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Map your columns</div>
                        <div style={{ fontSize: 13, color: "#9AA59E", marginBottom: 14 }}>We matched these automatically — adjust any that look off.</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 22px 1.1fr", gap: 8, paddingBottom: 7, borderBottom: "1px solid #EBE3D6", marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em" }}>CSV column</span>
                          <span />
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em" }}>Maps to</span>
                        </div>
                        {csvFile.headers.map((h, i) => {
                          // C2.7 (v3 Contacts.dc.html:327): custom "Maps to" dropdown —
                          // Standard fields / Custom fields sections, admin create row,
                          // teal picked-new state (#1192A6 text / #9AD6E4 border).
                          const picked = csvMap[i] ?? "Skip this column";
                          const isSkip = picked === "Skip this column";
                          const isNew = picked === CSV_CREATE;
                          const title = humanizeHeader(h);
                          const display = isNew ? `＋ ${title} · new field` : picked.startsWith("custom:") ? (fieldDefs.find((d) => d.key === picked.slice(7))?.label ?? picked.slice(7)) : picked;
                          const pick = (v: string) => { setCsvMap((m) => m.map((x, j) => (j === i ? v : x))); setMapDD(null); };
                          return (
                            <div key={h + i} style={{ display: "grid", gridTemplateColumns: "1fr 22px 1.1fr", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F2EEE4" }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0E1512", fontFamily: "monospace" }}>{h}</div>
                                <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{csvFile.rows[0]?.[i] ?? ""}</div>
                              </div>
                              <span style={{ color: "#C2B79F", textAlign: "center", fontSize: 12 }}>→</span>
                              <div style={{ position: "relative" }}>
                                <div onClick={() => setMapDD((v) => (v === i ? null : i))} style={{ border: `1px solid ${isNew ? "#9AD6E4" : "#EBE3D6"}`, borderRadius: 9, padding: "8px 11px", fontSize: 12.5, fontWeight: 600, color: isSkip ? "#9AA59E" : isNew ? "#1192A6" : "#0E1512", background: "#FBF7F0", display: "flex", alignItems: "center", cursor: "pointer" }} data-testid={`csv-map-${i}`}>
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
                                  <span style={{ marginLeft: "auto", color: "#9AA59E", paddingLeft: 6 }}>⌄</span>
                                </div>
                                {mapDD === i ? (
                                  <div style={{ position: "absolute", top: "calc(100% + 5px)", right: 0, width: 224, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", overflow: "hidden", zIndex: 8 }} data-testid="csv-map-dd">
                                    <div style={{ maxHeight: 196, overflowY: "auto" }}>
                                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#9AA59E", padding: "9px 13px 4px" }}>Standard fields</div>
                                      {CSV_FIELDS.filter((f) => f !== "Skip this column").map((f) => (
                                        <div key={f} onClick={() => pick(f)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#0E1512" }}>
                                          <span style={{ flex: 1 }}>{f}</span>
                                          <span style={{ color: "#16A82A", visibility: picked === f ? "visible" : "hidden" }}>✓</span>
                                        </div>
                                      ))}
                                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#1192A6", padding: "9px 13px 4px", borderTop: "1px solid #F2EEE4" }}>Custom fields</div>
                                      {fieldDefs.map((d) => (
                                        <div key={d.id} onClick={() => pick(`custom:${d.key}`)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#0E1512" }} data-testid={`csv-map-custom-${d.key}`}>
                                          <span style={{ flex: 1 }}>{d.label}</span>
                                          <span style={{ color: "#16A82A", visibility: picked === `custom:${d.key}` ? "visible" : "hidden" }}>✓</span>
                                        </div>
                                      ))}
                                    </div>
                                    {isAdmin ? (
                                      <div onClick={() => pick(CSV_CREATE)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 13px", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#16A82A", borderTop: "1px solid #EBE3D6" }} data-testid="csv-map-create">
                                        <span style={{ flex: 1 }}>＋ Create field “{title}”</span>
                                        <span style={{ fontSize: 9, fontWeight: 800, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 100, padding: "2px 6px" }}>ADMIN</span>
                                      </div>
                                    ) : null}
                                    <div onClick={() => pick("Skip this column")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#9AA59E", borderTop: "1px solid #F2EEE4" }}>
                                      <span style={{ flex: 1 }}>Skip this column</span>
                                      <span style={{ color: "#16A82A", visibility: isSkip ? "visible" : "hidden" }}>✓</span>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : null}
                    {csvStep === 2 && reviewSnap ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Review import</div>
                        <div style={{ fontSize: 13, color: "#9AA59E", marginBottom: 16 }}>Here&apos;s what we&apos;ll add to your contacts.</div>
                        {/* C2.8: step-3 "Add to list" select — existing list or none */}
                        <div style={{ marginBottom: 14, position: "relative" }}>
                          <label style={addLbl}>Add to list</label>
                          <div onClick={() => { if (importing) return; setCsvListDD((v) => !v); }} style={{ ...addInp, background: "#FBF7F0", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.6 : 1 }} data-testid="csv-list">
                            <span style={{ color: csvListId ? "#0E1512" : ensureDefaultList ? "#16A82A" : "#9AA59E", fontWeight: csvListId || !ensureDefaultList ? undefined : 600 }}>
                              {csvListId
                                ? (lists.find((l) => l.id === csvListId)?.name ?? ensuredListRef.current?.name ?? "No list (all contacts)")
                                : ensureDefaultList
                                  ? `＋ New list “${(csvFile?.name ?? "import").replace(/\.[^.]+$/, "")}”`
                                  : "No list (all contacts)"}
                            </span>
                            <span style={{ color: "#9AA59E", fontSize: 11 }}>▾</span>
                          </div>
                          {csvListDD ? (
                            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", zIndex: 30, maxHeight: 212, overflowY: "auto" }} data-testid="csv-list-menu">
                              {/* W3-1 wizard mount: the audience references the import's list, so
                                  "no list" isn't offered — the default creates one from the file name. */}
                              <div onClick={() => { setCsvListId(""); setCsvListDD(false); }} style={{ padding: "9px 14px", fontSize: 13.5, color: ensureDefaultList ? "#16A82A" : "#5C6B62", fontWeight: ensureDefaultList ? 600 : undefined, cursor: "pointer" }} data-testid="csv-list-default">
                                {ensureDefaultList ? `＋ New list “${(csvFile?.name ?? "import").replace(/\.[^.]+$/, "")}”` : "No list (all contacts)"}
                              </div>
                              {lists.map((l) => (
                                <div key={l.id} onClick={() => { setCsvListId(l.id); setCsvListDD(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, color: "#0E1512", cursor: "pointer", background: csvListId === l.id ? "rgba(53,232,52,.07)" : "#fff" }} data-testid={`csv-list-opt-${l.id}`}>
                                  <span style={{ width: 24, height: 24, borderRadius: 7, flex: "none", background: listGlyph(l.name).iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{listGlyph(l.name).icon}</span>
                                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                                  {csvListId === l.id ? <span style={{ color: "#16A82A" }}>✓</span> : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                          {[
                            { value: String(reviewSnap.newCount), label: "New contacts", fg: "#16A82A" },
                            { value: String(reviewSnap.dupes), label: "Duplicates skipped", fg: "#1192A6" },
                            { value: String(reviewSnap.suppressed), label: "On suppression list", fg: "#8A7F6B" },
                            { value: String(reviewSnap.mapped), label: "Columns mapped", fg: "#0E1512" },
                          ].map((st2) => (
                            <div key={st2.label} style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "14px 16px" }}>
                              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 24, fontWeight: 800, color: st2.fg, lineHeight: 1, marginBottom: 4 }}>{st2.value}</div>
                              <div style={{ fontSize: 12, color: "#8A7F6B" }}>{st2.label}</div>
                            </div>
                          ))}
                        </div>
                        {/* C2.7: created-field note — the prototype's review has no
                            created-fields tile (4 tiles only); this teal note row makes
                            the create visible without inventing a fifth tile (flagged). */}
                        {reviewSnap.createCount > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(54,215,237,.06)", border: "1px solid rgba(54,215,237,.28)", borderRadius: 11, padding: "11px 14px", marginBottom: 10 }} data-testid="csv-create-note">
                            <span style={{ color: "#1192A6" }}>＋</span>
                            <span style={{ fontSize: 12.5, color: "#1192A6", fontWeight: 600 }}>
                              {reviewSnap.createCount} new custom field{reviewSnap.createCount === 1 ? "" : "s"} will be created: {csvFile!.headers.filter((_, i) => csvMap[i] === CSV_CREATE).map(humanizeHeader).join(", ")}
                            </span>
                          </div>
                        ) : null}
                        {csvError ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(224,121,107,.08)", border: "1px solid rgba(224,121,107,.3)", borderRadius: 11, padding: "11px 14px", marginBottom: 10 }} data-testid="csv-error">
                            <span style={{ color: "#C9543F" }}>⚠</span>
                            <span style={{ fontSize: 12.5, color: "#C9543F", fontWeight: 600 }}>{csvError}</span>
                          </div>
                        ) : null}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(53,232,52,.06)", border: "1px solid rgba(53,232,52,.22)", borderRadius: 11, padding: "11px 14px" }}>
                          <span style={{ color: "#16A82A" }}>✓</span>
                          <span style={{ fontSize: 12.5, color: "#16A82A", fontWeight: 600 }}>All contacts checked against your suppression list.</span>
                        </div>
                        {/* IMP-1: in-flight state — progress over chunks, not
                            re-derived stats; the tiles above stay frozen. */}
                        {importing && importProg ? (
                          <div style={{ marginTop: 12 }} data-testid="import-progress">
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512" }}>Importing… {importProg.done} of {importProg.total}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#8A7F6B" }}>{importProg.total > 0 ? Math.round((importProg.done / importProg.total) * 100) : 0}%</span>
                            </div>
                            <div style={{ height: 8, borderRadius: 100, background: "#E4EAE6", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${importProg.total > 0 ? (importProg.done / importProg.total) * 100 : 0}%`, borderRadius: 100, background: GRAD, transition: "width .3s ease" }} data-testid="import-progress-bar" />
                            </div>
                            <div style={{ fontSize: 11.5, color: "#9AA59E", marginTop: 7 }}>You can close this window — the import keeps running and we&apos;ll confirm when it&apos;s done.</div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                    {csvStep === 0 ? (
                      <span onClick={closeImport} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
                    ) : (
                      <span onClick={() => { if (importing) return; setCsvStep((v) => Math.max(0, v - 1)); }} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.5 : 1 }}>‹ Back</span>
                    )}
                    {(() => {
                      // IMP-1: the primary disables the moment the import starts
                      // — a second click can no longer race a poll refresh into
                      // duplicate contacts. IMP-2: snapshot happens on 1 → 2.
                      const canGo = !importing && (csvStep === 0 ? Boolean(csvFile) : csvStep === 1 ? csvMap.includes("Email") : (reviewSnap?.newCount ?? 0) > 0);
                      const label = importing ? "Importing…" : csvStep === 2 ? `Import ${reviewSnap?.newCount ?? 0} contact${(reviewSnap?.newCount ?? 0) === 1 ? "" : "s"}` : "Continue";
                      return (
                        <span onClick={() => { if (!canGo) return; if (csvStep === 2) void runImport(); else { if (csvStep === 1) snapReview(); setCsvStep((v) => v + 1); } }} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: canGo ? "#0A0F0C" : "#9AA59E", background: canGo ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 22px", cursor: canGo ? "pointer" : "not-allowed", boxShadow: canGo ? "0 6px 16px rgba(53,232,52,.26)" : "none" }} data-testid="import-save">{label}</span>
                      );
                    })()}
                  </div>
                </>
              ) : (
                // IMP-1: the done modal reports the SERVER's counts — created /
                // duplicates / suppressed / failed — never a client-side tally.
                // failed > 0 lands the error-summary variant with per-row
                // reasons and "Retry N failed" (failed rows only re-run).
                (() => {
                  const res = importResult ?? { created: 0, skippedDuplicates: 0, suppressed: 0, failed: [] };
                  const retryable = res.failed.filter((f) => f.index >= 0).length;
                  const hasFails = res.failed.length > 0;
                  const tiles = [
                    { value: String(res.created), label: "Imported", fg: "#16A82A" },
                    { value: String(res.skippedDuplicates), label: "Duplicates skipped", fg: "#1192A6" },
                    { value: String(res.suppressed), label: "On suppression list", fg: "#8A7F6B" },
                    { value: String(res.failed.length), label: "Failed", fg: hasFails ? "#C9543F" : "#0E1512" },
                  ];
                  return (
                    <>
                      <div style={{ padding: "30px 28px 22px", textAlign: "center" }} data-testid={hasFails ? "csv-error-summary" : "csv-done"}>
                        <div style={{ width: 60, height: 60, borderRadius: "50%", background: hasFails ? "rgba(224,121,107,.14)" : "#D7F5DD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: hasFails ? "#C9543F" : "#16A82A", margin: "0 auto 18px" }}>{hasFails ? "⚠" : "✓"}</div>
                        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, color: "#0E1512", marginBottom: 6 }}>
                          {hasFails ? `${res.created} imported · ${res.failed.length} failed` : `${res.created} contact${res.created === 1 ? "" : "s"} imported`}
                        </div>
                        <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, maxWidth: 380, margin: "0 auto 18px" }}>
                          {hasFails
                            ? "The rows below didn't import. You can retry just those rows."
                            : valBatchId
                              ? valReport?.status === "completed"
                                ? "Email validation finished — the report below has the breakdown."
                                : "Email validation is running — contacts become sendable as they clear."
                              : "They're ready to enroll in a campaign."}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, textAlign: "left" }}>
                          {tiles.map((t) => (
                            <div key={t.label} style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: "12px 13px" }}>
                              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 20, fontWeight: 800, color: t.fg, lineHeight: 1, marginBottom: 4 }}>{t.value}</div>
                              <div style={{ fontSize: 11, color: "#8A7F6B" }}>{t.label}</div>
                            </div>
                          ))}
                        </div>
                        {hasFails ? (
                          <div style={{ marginTop: 12, maxHeight: 168, overflowY: "auto", border: "1px solid rgba(224,121,107,.3)", borderRadius: 11, textAlign: "left" }} data-testid="csv-failed-rows">
                            {res.failed.map((f, i) => (
                              <div key={`${f.email}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "9px 13px", borderTop: i === 0 ? "none" : "1px solid #F3EEE4" }}>
                                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0E1512", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>{f.email}</span>
                                <span style={{ fontSize: 12, color: "#C9543F", minWidth: 0 }}>{f.reason}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {/* LH1 (DEC-087): the validation report — §0-flagged designed
                            addition (the prototype's done modal predates validation).
                            Progressive + honest: pending line while verdicts land,
                            honest held states, counts verbatim, exclusions CSV. */}
                        {valBatchId ? (
                          <ValidationReportCard batchId={valBatchId} report={valReport} invalidRows={valInvalidRows} />
                        ) : null}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                        {hasFails ? (
                          <span onClick={closeImport} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Close</span>
                        ) : null}
                        {hasFails && retryable > 0 ? (
                          <span onClick={() => { if (!importing) void retryFailed(); }} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: importing ? "#9AA59E" : "#0A0F0C", background: importing ? "#ECE7DC" : GRAD, borderRadius: 11, padding: "10px 24px", cursor: importing ? "not-allowed" : "pointer", boxShadow: importing ? "none" : "0 6px 16px rgba(53,232,52,.26)" }} data-testid="csv-retry-failed">
                            {importing && importProg ? `Retrying… ${importProg.done} of ${importProg.total}` : `Retry ${retryable} failed`}
                          </span>
                        ) : (
                          <span onClick={closeImport} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 24px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}>Done</span>
                        )}
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
  );
}
