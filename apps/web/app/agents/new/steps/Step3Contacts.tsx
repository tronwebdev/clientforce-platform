"use client";

/**
 * Step 3 — Add contacts (W3-1 · W3-7 · W3-8 + W3-10's step-3 tags).
 * Three source cards per the prototype's `contactSources` literals; "Upload
 * CSV" opens the REAL C2.5 import flow (the ONE shared component — never a
 * wizard fork) as a modal over the step; the Audience preview card renders
 * whichever sources are active with real counts; the C2.8 list picker and
 * the DEC-039a manual drawer feed it. All state stays in the orchestrator.
 */
import type { ContactFieldDefDto } from "@clientforce/core";
import { ContactImportFlow } from "../../../../components/ContactImportFlow";
import type { GoalFit } from "../../../../lib/goal-fit";
import { GRAD, manualInp, manualLbl, type ManualEntry } from "../shared";
import { EMPTY_MANUAL } from "../shared";

/** Prototype `previewContacts` avatar tints, cycled by row index. */
const AV_TINTS = ["rgba(53,232,52,.16)", "rgba(54,215,237,.16)", "rgba(208,245,107,.3)", "#F2EEE4"];

interface Step3Props {
  importOpen: boolean;
  setImportOpen: React.Dispatch<React.SetStateAction<boolean>>;
  csvImport: { listId: string; name: string; count: number } | null;
  setCsvImport: React.Dispatch<React.SetStateAction<{ listId: string; name: string; count: number } | null>>;
  importRows: { email: string | null; unsub: boolean }[] | null;
  isAdmin: boolean;
  fieldDefs: ContactFieldDefDto[];
  refreshFieldDefs: () => void;
  ensureImportList: (fileName: string) => Promise<{ id: string; name: string }>;
  importCompleted: (listId: string | null) => void;
  listOpen: boolean;
  setListOpen: React.Dispatch<React.SetStateAction<boolean>>;
  wizardLists: { id: string; name: string; memberCount: number; archived: boolean }[];
  pickedList: { id: string; name: string; memberCount: number } | null;
  setPickedList: React.Dispatch<React.SetStateAction<{ id: string; name: string; memberCount: number } | null>>;
  listSearch: string;
  setListSearch: React.Dispatch<React.SetStateAction<string>>;
  manualOpen: boolean;
  setManualOpen: React.Dispatch<React.SetStateAction<boolean>>;
  manual: ManualEntry;
  setManual: React.Dispatch<React.SetStateAction<ManualEntry>>;
  manualQueue: ManualEntry[];
  setManualQueue: React.Dispatch<React.SetStateAction<ManualEntry[]>>;
  addContacts: (rows: Array<{ email: string; firstName?: string; lastName?: string; company?: string; phone?: string }>, src: "manual" | "csv") => Promise<void>;
  audienceTotal: number;
  audienceSample: { key: string; name: string; email: string; company: string; initials: string }[];
  toast: (m: string) => void;
  goalFit: GoalFit;
}

export function Step3Contacts(props: Step3Props) {
  const {
    importOpen, setImportOpen, csvImport, setCsvImport, importRows, isAdmin, fieldDefs, refreshFieldDefs,
    ensureImportList, importCompleted, listOpen, setListOpen, wizardLists,
    pickedList, setPickedList, listSearch, setListSearch, manualOpen, setManualOpen,
    manual, setManual, manualQueue, setManualQueue, addContacts,
    audienceTotal, audienceSample, toast, goalFit,
  } = props;
  // W3-10: existing-audience goals highlight the two bring-your-own-audience
  // sources ("FOR THIS GOAL" tag + soft-green border); the tag yields to the
  // picked treatment (the ✕ occupies its corner).
  const fitTag = goalFit === "existing_audience";
  const cards = [
    csvImport
      ? { icon: "⬆", title: csvImport.name, desc: `${csvImport.count} contact${csvImport.count === 1 ? "" : "s"} enroll at launch · as of launch day`, iconbg: "rgba(53,232,52,.16)", act: () => setImportOpen(true), tid: "contacts-csv", picked: true, clear: () => setCsvImport(null), clearTid: "csv-import-clear", tag: false }
      : { icon: "⬆", title: "Upload CSV", desc: "Import contacts from a .csv file.", iconbg: "rgba(53,232,52,.16)", act: () => setImportOpen(true), tid: "contacts-csv", picked: false, clear: null, clearTid: "", tag: fitTag },
    // C2.8: picked treatment composes the goal-card selected state
    // (the prototype shows only the resting card — flagged, DEC-055).
    pickedList
      ? { icon: "❒", title: pickedList.name, desc: `${pickedList.memberCount} contact${pickedList.memberCount === 1 ? "" : "s"} enroll at launch · as of launch day`, iconbg: "rgba(54,215,237,.16)", act: () => { setListSearch(""); setListOpen(true); }, tid: "contacts-list", picked: true, clear: () => setPickedList(null), clearTid: "picked-list-clear", tag: false }
      : { icon: "❒", title: "Choose a list", desc: "Pick an existing saved list.", iconbg: "rgba(54,215,237,.16)", act: () => { setListSearch(""); setListOpen(true); }, tid: "contacts-list", picked: false, clear: null, clearTid: "", tag: fitTag },
    { icon: "✎", title: "Add manually", desc: "Enter contacts one by one.", iconbg: "#F2EEE4", act: () => setManualOpen(true), tid: "contacts-manual", picked: false, clear: null, clearTid: "", tag: false },
  ];
  const shown = audienceSample.length;
  return (
    <>
      <div style={{ maxWidth: 820 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
          {cards.map((c) => (
            <div key={c.tid} onClick={c.act} data-testid={c.tid} style={{ position: "relative", border: c.picked ? "2px solid #35E834" : c.tag ? "1px solid #9FD8AC" : "1px solid #EBE3D6", borderRadius: 14, background: c.picked ? "rgba(53,232,52,.07)" : "#fff", padding: 18, cursor: "pointer", boxShadow: "0 2px 8px rgba(14,21,18,.03)" }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: c.iconbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, marginBottom: 12 }}>{c.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: c.picked ? 18 : 0 }}>{c.title}</div>
              <div style={{ fontSize: 13, color: "#8A7F6B", lineHeight: 1.4 }}>{c.desc}</div>
              {c.picked && c.clear ? (
                <span onClick={(e) => { e.stopPropagation(); c.clear(); }} title="Remove" style={{ position: "absolute", top: 10, right: 10, color: "#9AA59E", fontSize: 13, cursor: "pointer", padding: 4 }} data-testid={c.clearTid}>✕</span>
              ) : c.tag ? (
                <span style={{ position: "absolute", top: 10, right: 10, fontSize: 9, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#0F7A28", background: "#D7F5DD", borderRadius: 6, padding: "2px 7px" }} data-testid={`${c.tid}-goal-tag`}>For this goal</span>
              ) : null}
            </div>
          ))}
        </div>

        {/* W3-7: Audience preview — real counts from whichever sources are
            active (the same arithmetic launch enrolls); honest empty state
            before any source is chosen (designed body, no prototype anchor
            for empty). */}
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)", overflow: "hidden" }} data-testid="audience-preview">
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #F2EEE4" }}>
            <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, color: "#0E1512", flex: 1 }}>Audience preview</span>
            {audienceTotal > 0 ? (
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F7A28", background: "#D7F5DD", borderRadius: 100, padding: "5px 13px" }} data-testid="audience-count">{audienceTotal} contact{audienceTotal === 1 ? "" : "s"} ready</span>
            ) : null}
          </div>
          {audienceTotal === 0 ? (
            <div style={{ padding: "26px 18px", textAlign: "center", fontSize: 13, color: "#9AA59E" }} data-testid="audience-empty">No contacts yet — upload a CSV, choose a list, or add them manually.</div>
          ) : (
            <>
              {audienceSample.map((p, i) => (
                <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 18px", borderBottom: "1px solid #F7F2EA" }} data-testid="audience-row">
                  <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: AV_TINTS[i % 4], color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700 }}>{p.initials}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, color: "#9AA59E" }}>{p.email}</div>
                  </div>
                  <span style={{ fontSize: 13, color: "#5C6B62" }}>{p.company}</span>
                </div>
              ))}
              {audienceTotal > shown ? (
                <div style={{ padding: "12px 18px", fontSize: 13, color: "#9AA59E", textAlign: "center" }} data-testid="audience-more">+ {audienceTotal - shown} more</div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* W3-1: THE C2.5 import flow, mounted over the wizard step (the agent
          setup stays open underneath). Same component + semantics as the
          Contacts mount; the wizard extras land the run in a referenceable
          list (ensureDefaultList) and hand back the listId (importCompleted). */}
      <ContactImportFlow
        open={importOpen}
        onClose={() => setImportOpen(false)}
        lists={wizardLists.filter((l) => !l.archived)}
        fieldDefs={fieldDefs.filter((d) => !d.archived)}
        refreshDefs={refreshFieldDefs}
        isAdmin={isAdmin}
        existingRows={importRows}
        toast={toast}
        onImported={(_result, listId) => importCompleted(listId)}
        ensureDefaultList={ensureImportList}
      />

      {/* list picker — designed; no saved lists exist yet in P1 */}
      {/* C2.8: live 480px list picker (prototype anatomy) — SNAPSHOT semantics:
          the picked list's members enroll at launch through the CSV path. */}
      {listOpen ? (
        <div onClick={() => setListOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 36, zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid="list-picker">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512" }}>Choose a list</div>
                <div style={{ fontSize: 12.5, color: "#9AA59E" }}>Pick a saved contact list to enroll.</div>
              </div>
              <span onClick={() => setListOpen(false)} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }}>✕</span>
            </div>
            <div style={{ padding: "14px 16px" }}>
              {/* 49-4: the prototype's search row */}
              <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 14px", marginBottom: 12 }}>
                <span style={{ color: "#9AA59E" }}>⚲</span>
                <input value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="Search lists…" style={{ border: "none", background: "transparent", fontSize: 13.5, color: "#0E1512", flex: 1, minWidth: 0, outline: "none", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="list-picker-search" />
              </div>
              {wizardLists.filter((l) => !l.archived).length === 0 ? (
                <div style={{ border: "1px dashed #D8CFBE", borderRadius: 12, background: "#FBF7F0", padding: "26px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>❒</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>No saved lists yet</div>
                  <div style={{ fontSize: 12.5, color: "#8A7F6B" }}>Lists you save from Contacts appear here — upload a CSV or add contacts manually for now.</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 340, overflowY: "auto" }}>
                  {wizardLists.filter((l) => !l.archived && l.name.toLowerCase().includes(listSearch.trim().toLowerCase())).map((l) => (
                    <div key={l.id} onClick={() => { setPickedList({ id: l.id, name: l.name, memberCount: l.memberCount }); setListOpen(false); }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#9FD8AC"; e.currentTarget.style.background = "#FBF7F0"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#EBE3D6"; e.currentTarget.style.background = "#fff"; }} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #EBE3D6", borderRadius: 12, padding: "12px 14px", cursor: "pointer", background: "#fff" }} data-testid={`list-pick-${l.id}`}>
                      <span style={{ width: 38, height: 38, borderRadius: 10, background: "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flex: "none" }}>❒</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{l.name}</div>
                        <div style={{ fontSize: 12, color: "#9AA59E" }}>{l.memberCount} contact{l.memberCount === 1 ? "" : "s"}</div>
                      </div>
                      <span style={{ color: "#C9CFC9", fontSize: 18 }}>›</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* manual-add drawer — §3/DEC-039a: full prototype anatomy, multi-add session */}
      {manualOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
          <div onClick={() => setManualOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(12,20,15,.4)" }} />
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "100%", background: "#FBF7F0", boxShadow: "-24px 0 70px rgba(0,0,0,.28)", display: "flex", flexDirection: "column" }} data-testid="manual-drawer">
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6" }}>
              <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Add contacts manually</span>
              <span onClick={() => setManualOpen(false)} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer" }} data-testid="manual-close">✕</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "20px 22px" }}>
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: 16, marginBottom: 18 }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                  {([["firstName", "First name", "Jane"], ["lastName", "Last name", "Doe"]] as const).map(([k, label, ph]) => (
                    <div key={k} style={{ flex: 1 }}>
                      <label style={manualLbl}>{label}</label>
                      <input value={manual[k]} onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))} placeholder={ph} style={manualInp} data-testid={`manual-${k}`} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={manualLbl}>Email</label>
                  <input value={manual.email} onChange={(e) => setManual((m) => ({ ...m, email: e.target.value }))} placeholder="jane@clinic.com" style={manualInp} data-testid="manual-email" />
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                  {([["company", "Company", "Clinic name"], ["phone", "Phone", "+1…"]] as const).map(([k, label, ph]) => (
                    <div key={k} style={{ flex: 1 }}>
                      <label style={manualLbl}>{label}</label>
                      <input value={manual[k]} onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))} placeholder={ph} style={manualInp} data-testid={`manual-${k}`} />
                    </div>
                  ))}
                </div>
                <div
                  onClick={() => { if (!manual.email.includes("@")) return; setManualQueue((q) => [...q, manual]); setManual(EMPTY_MANUAL); }}
                  style={{ textAlign: "center", fontSize: 13.5, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.08)", border: "1.5px solid rgba(53,232,52,.3)", borderRadius: 11, padding: 11, cursor: manual.email.includes("@") ? "pointer" : "default", opacity: manual.email.includes("@") ? 1 : 0.6 }}
                  data-testid="manual-queue-add"
                >
                  + Add contact
                </div>
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A7F6B", letterSpacing: ".07em", textTransform: "uppercase", marginBottom: 10 }}>Added this session · {manualQueue.length}</div>
              {manualQueue.map((c, i) => (
                <div key={`${c.email}-${i}`} style={{ display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 14px", marginBottom: 8 }} data-testid="manual-queued-row">
                  <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: i % 2 === 0 ? "rgba(53,232,52,.16)" : "rgba(54,215,237,.16)", color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700 }}>
                    {`${(c.firstName.replace(/^dr\.?\s+/i, "")[0] ?? "").toUpperCase()}${(c.lastName[0] ?? "").toUpperCase()}` || c.email.slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>{[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}</div>
                    <div style={{ fontSize: 12, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}{c.company ? ` · ${c.company}` : ""}</div>
                  </div>
                  <span onClick={() => setManualQueue((q) => q.filter((_, j) => j !== i))} style={{ color: "#C9543F", fontSize: 12, fontWeight: 600, cursor: "pointer", flex: "none" }}>Remove</span>
                </div>
              ))}
            </div>
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff" }}>
              <span style={{ fontSize: 13, color: "#9AA59E", flex: 1 }}>{manualQueue.length} contact{manualQueue.length === 1 ? "" : "s"} ready to add</span>
              <span
                onClick={() => { if (manualQueue.length === 0) return; void addContacts(manualQueue, "manual").then(() => { setManualQueue([]); setManualOpen(false); }); }}
                style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 22px", cursor: manualQueue.length ? "pointer" : "default", boxShadow: "0 6px 16px rgba(53,232,52,.26)", opacity: manualQueue.length ? 1 : 0.55 }}
                data-testid="manual-save"
              >
                Add to campaign
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
