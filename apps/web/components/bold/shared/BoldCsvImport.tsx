"use client";

import { useMemo, useRef, useState } from "react";
import { createContactList, importContactRows, type BoldImportResult } from "../bold-live";

/**
 * The SHARED Bold CSV ingest + column mapper (B2.5, DEC-108) — built here per
 * DEC-107(3) so B3's contacts surface consumes the same component. It writes
 * through the SHIPPED import path only: `POST /lists {origin:"csv_import"}` +
 * chunked transactional `POST /contacts/import` rides (≤25 rows a ride, one
 * `validationBatchKey` per run — the LH1 batch never blocks the import).
 *
 * Consent honesty (DEC-108): when a consent column is mapped, rows whose
 * value doesn't read as a yes still IMPORT — as contacts only, never into
 * the campaign list, so launch never enrolls them. That is real client-side
 * behavior (two import passes), not a claim. No consent column mapped means
 * no filter — exactly the shipped path's own posture.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

const CLIENT_CHUNK = 25;

/** CSV parse with quoted-field handling (the shipped flow's naive split
 *  breaks on quoted commas; this stays dependency-free). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const FIELDS = [
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["company", "Company"],
  ["consent", "Consent"],
] as const;
type FieldKey = (typeof FIELDS)[number][0];
const NONE = "(none)";

function autoMatch(field: FieldKey, headers: string[]): string {
  const h = headers.map((x) => x.toLowerCase());
  const pick = (test: (s: string) => boolean) => {
    const i = h.findIndex(test);
    return i >= 0 ? headers[i]! : NONE;
  };
  if (field === "name") return pick((s) => s.includes("name") && !s.includes("company"));
  if (field === "email") return pick((s) => s.includes("mail"));
  if (field === "phone") return pick((s) => s.includes("phone") || s.includes("mobile"));
  if (field === "company") return pick((s) => s.includes("company") || s.includes("organi"));
  return pick((s) => s.includes("consent") || s.includes("opt"));
}

const CONSENT_YES = new Set(["y", "yes", "true", "1", "opted in", "optedin", "opt-in", "consented"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CsvImportOutcome {
  listId: string;
  listName: string;
  /** Consented rows headed for the list — launch re-resolves live. */
  consented: number;
  result: BoldImportResult;
}

export function BoldCsvImport({
  onImported,
  flash,
}: {
  onImported: (outcome: CsvImportOutcome) => void;
  flash: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<FieldKey, string>>({ name: NONE, email: NONE, phone: NONE, company: NONE, consent: NONE });
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<CsvImportOutcome | null>(null);

  const col = (field: FieldKey) => headers.indexOf(map[field]);
  const analysis = useMemo(() => {
    const emailIdx = headers.indexOf(map.email);
    const consentIdx = headers.indexOf(map.consent);
    let valid = 0;
    let invalid = 0;
    let consented = 0;
    for (const r of rows) {
      const email = (emailIdx >= 0 ? r[emailIdx] : "")?.trim() ?? "";
      if (!EMAIL_RE.test(email)) {
        invalid++;
        continue;
      }
      valid++;
      if (consentIdx < 0 || CONSENT_YES.has((r[consentIdx] ?? "").trim().toLowerCase())) consented++;
    }
    return { valid, invalid, consented, heldBack: valid - consented };
  }, [rows, headers, map]);

  function onFile(f: File) {
    void f.text().then((text) => {
      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        flash("That file has no data rows.");
        return;
      }
      const hdrs = parsed[0]!.map((h) => h.trim());
      setHeaders(hdrs);
      setRows(parsed.slice(1));
      setFileName(f.name);
      setMap({
        name: autoMatch("name", hdrs),
        email: autoMatch("email", hdrs),
        phone: autoMatch("phone", hdrs),
        company: autoMatch("company", hdrs),
        consent: autoMatch("consent", hdrs),
      });
    });
  }

  function toRow(r: string[]) {
    const cell = (field: FieldKey) => {
      const i = col(field);
      return i >= 0 ? (r[i] ?? "").trim() : "";
    };
    const full = cell("name");
    const [firstName, ...restName] = full.split(/\s+/).filter(Boolean);
    return {
      email: cell("email"),
      ...(firstName ? { firstName } : {}),
      ...(restName.length ? { lastName: restName.join(" ") } : {}),
      ...(cell("phone") ? { phone: cell("phone") } : {}),
      ...(cell("company") ? { company: cell("company") } : {}),
    };
  }

  async function runImport() {
    if (importing || map.email === NONE || fileName === null) return;
    setImporting(true);
    try {
      // The list, from the file name (the shipped wizard's convention:
      // extension stripped, 409 retried with a numbered suffix).
      const base = fileName.replace(/\.[^.]+$/, "").slice(0, 72) || "Imported list";
      let list: { id: string; name: string } | null = null;
      for (let n = 1; n <= 5 && !list; n++) {
        const name = n === 1 ? base : `${base} (${n})`;
        const res = await createContactList(name, "csv_import");
        if (res.ok) list = res.body as { id: string; name: string };
      }
      if (!list) {
        flash("Couldn't create a list for this file — try renaming it.");
        return;
      }
      const emailIdx = headers.indexOf(map.email);
      const consentIdx = headers.indexOf(map.consent);
      const consentedRows: ReturnType<typeof toRow>[] = [];
      const contactOnlyRows: ReturnType<typeof toRow>[] = [];
      for (const r of rows) {
        const email = (emailIdx >= 0 ? r[emailIdx] : "")?.trim() ?? "";
        if (!EMAIL_RE.test(email)) continue;
        const consented = consentIdx < 0 || CONSENT_YES.has((r[consentIdx] ?? "").trim().toLowerCase());
        (consented ? consentedRows : contactOnlyRows).push(toRow(r));
      }
      const batchKey = crypto.randomUUID();
      const total: BoldImportResult = { created: 0, skippedDuplicates: 0, suppressed: 0, failed: [] };
      const post = async (chunk: ReturnType<typeof toRow>[], listId?: string) => {
        const res = await importContactRows(chunk, listId, batchKey);
        if (!res.ok) {
          flash(res.error);
          return false;
        }
        const b = res.body as BoldImportResult;
        total.created += b.created;
        total.skippedDuplicates += b.skippedDuplicates;
        total.suppressed += b.suppressed;
        total.failed.push(...(b.failed ?? []));
        return true;
      };
      for (let i = 0; i < consentedRows.length; i += CLIENT_CHUNK) {
        if (!(await post(consentedRows.slice(i, i + CLIENT_CHUNK), list.id))) return;
      }
      for (let i = 0; i < contactOnlyRows.length; i += CLIENT_CHUNK) {
        if (!(await post(contactOnlyRows.slice(i, i + CLIENT_CHUNK)))) return;
      }
      const outcome: CsvImportOutcome = {
        listId: list.id,
        listName: list.name,
        consented: consentedRows.length,
        result: total,
      };
      setDone(outcome);
      onImported(outcome);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ marginTop: 18, maxWidth: 560, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 19, padding: 18 }} data-testid="bold-csv">
      {fileName === null ? (
        <div
          onClick={() => fileRef.current?.click()}
          data-testid="bold-csv-pick"
          style={{ border: "1px dashed var(--cvb-line-hover)", borderRadius: 15, padding: 26, textAlign: "center", cursor: "pointer" }}
        >
          <div style={{ fontSize: 20, color: "var(--cvb-faint-2)" }}>↑</div>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-.02em", marginTop: 8 }}>Choose a CSV</div>
          <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 5, lineHeight: 1.5 }}>
            Map the columns yourself — duplicates merge server-side and addresses verify before anything sends.
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            data-testid="bold-csv-input"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 32, height: 32, borderRadius: 11, flex: "none", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", color: "var(--cvb-forest)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>◫</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-.02em" }}>{fileName}</div>
              <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 2 }}>{rows.length} rows</div>
            </div>
            {done === null ? (
              <span
                onClick={() => {
                  setFileName(null);
                  setRows([]);
                  setHeaders([]);
                }}
                style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cvb-danger)", cursor: "pointer", flex: "none" }}
              >
                Remove
              </span>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14 }} data-testid="bold-csv-tally">
            {[
              [String(rows.length), "rows read"],
              [String(analysis.consented), "with consent"],
              [String(analysis.heldBack), "held back"],
              ...(analysis.invalid > 0 ? [[String(analysis.invalid), "invalid emails skipped"]] : []),
              ...(done ? [[String(done.result.skippedDuplicates), "duplicates merged"]] : []),
            ].map(([v, l]) => (
              <span key={l} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--cvb-muted)", background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 999, padding: "5px 11px" }}>
                {v} {l}
              </span>
            ))}
          </div>

          {done === null ? (
            <>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)", margin: "18px 0 10px" }}>MAP THE COLUMNS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {FIELDS.map(([key, label]) => (
                  <div key={key} data-testid={`bold-csv-field-${key}`}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-ink-soft)", marginBottom: 6 }}>
                      {label}
                      {key === "email" ? <span style={{ color: "var(--cvb-danger)" }}> *</span> : null}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[...headers, NONE].map((c) => {
                        const on = map[key] === c;
                        return (
                          <span
                            key={c}
                            onClick={() => setMap((m) => ({ ...m, [key]: c }))}
                            style={{ fontSize: 11, fontWeight: 600, color: on ? "var(--cvb-forest)" : "var(--cvb-muted)", background: on ? "var(--cvb-mint)" : "var(--cvb-card)", border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`, borderRadius: 999, padding: "6px 11px", cursor: "pointer" }}
                          >
                            {c}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {map.consent !== NONE && analysis.heldBack > 0 ? (
                <div style={{ background: "var(--cvb-amber-bg)", border: "1px solid var(--cvb-amber-line)", borderRadius: 14, padding: 13, marginTop: 16, fontSize: 12, color: "var(--cvb-amber)", lineHeight: 1.5 }}>
                  {analysis.heldBack} row{analysis.heldBack === 1 ? " has" : "s have"} no consent value. They will not be contacted — they import as contacts only.
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <span
                  onClick={() => void runImport()}
                  data-testid="bold-csv-import"
                  style={{ fontSize: 12.5, fontWeight: 800, color: "var(--cvb-card)", background: map.email === NONE ? "var(--cvb-ghost)" : "var(--cvb-forest)", borderRadius: 11, padding: "10px 16px", cursor: map.email === NONE ? "default" : "pointer", opacity: importing ? 0.6 : 1 }}
                >
                  {importing ? "Importing…" : "Import the file"}
                </span>
                {map.email === NONE ? (
                  <span style={{ fontSize: 11.5, color: "var(--cvb-faint)", alignSelf: "center" }}>Map the Email column first.</span>
                ) : null}
              </div>
            </>
          ) : (
            <div style={{ background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 14, padding: 13, marginTop: 16, fontSize: 12.5, color: "var(--cvb-forest)", lineHeight: 1.5 }} data-testid="bold-csv-done">
              ✓ Imported into “{done.listName}” — {done.consented} contact{done.consented === 1 ? "" : "s"} enroll at launch, as of launch day.
              {done.result.failed.length > 0 ? ` ${done.result.failed.length} row${done.result.failed.length === 1 ? "" : "s"} failed server checks.` : ""}
            </div>
          )}
        </>
      )}
    </div>
  );
}
