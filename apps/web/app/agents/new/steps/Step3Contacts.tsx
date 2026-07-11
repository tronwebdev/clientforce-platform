"use client";

/**
 * Step 3 — Add contacts (W3 commit 0: pure move from Wizard.tsx).
 * Source cards + added list, the CSV modal, the C2.8 list picker and the
 * DEC-039a manual-add drawer. All state stays in the Wizard orchestrator.
 */
import { GRAD, Modal, ModalActions, inp, manualInp, manualLbl, type AddedContact, type ManualEntry } from "../shared";
import { EMPTY_MANUAL } from "../shared";

interface Step3Props {
  csvOpen: boolean;
  setCsvOpen: React.Dispatch<React.SetStateAction<boolean>>;
  csvText: string;
  setCsvText: React.Dispatch<React.SetStateAction<string>>;
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
  added: AddedContact[];
  addContacts: (rows: Array<{ email: string; firstName?: string; lastName?: string; company?: string; phone?: string }>, src: "manual" | "csv") => Promise<void>;
}

export function Step3Contacts(props: Step3Props) {
  const {
    csvOpen, setCsvOpen, csvText, setCsvText, listOpen, setListOpen, wizardLists,
    pickedList, setPickedList, listSearch, setListSearch, manualOpen, setManualOpen,
    manual, setManual, manualQueue, setManualQueue, added, addContacts,
  } = props;
  return (
    <>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 18 }}>
              {[
                { icon: "⬆", title: "Upload CSV", desc: "Import contacts from a .csv file.", iconbg: "rgba(53,232,52,.16)", act: () => setCsvOpen(true), tid: "contacts-csv", picked: false },
                // C2.8: picked treatment composes the goal-card selected state
                // (the prototype shows only the resting card — flagged).
                pickedList
                  ? { icon: "❒", title: pickedList.name, desc: `${pickedList.memberCount} contact${pickedList.memberCount === 1 ? "" : "s"} enroll at launch · as of launch day`, iconbg: "rgba(54,215,237,.16)", act: () => { setListSearch(""); setListOpen(true); }, tid: "contacts-list", picked: true }
                  : { icon: "❒", title: "Choose a list", desc: "Pick an existing saved list.", iconbg: "rgba(54,215,237,.16)", act: () => { setListSearch(""); setListOpen(true); }, tid: "contacts-list", picked: false },
                { icon: "✎", title: "Add manually", desc: "Enter contacts one by one.", iconbg: "#F2EEE4", act: () => setManualOpen(true), tid: "contacts-manual", picked: false },
              ].map((c) => (
                <div key={c.tid} onClick={c.act} data-testid={c.tid} style={{ position: "relative", border: c.picked ? "2px solid #35E834" : "1px solid #EBE3D6", borderRadius: 13, background: c.picked ? "rgba(53,232,52,.07)" : "#fff", padding: "16px 14px", cursor: "pointer" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: c.iconbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, marginBottom: 11 }}>{c.icon}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                  <div style={{ fontSize: 13, color: "#8A7F6B", lineHeight: 1.4 }}>{c.desc}</div>
                  {c.picked ? (
                    <span onClick={(e) => { e.stopPropagation(); setPickedList(null); }} title="Remove list" style={{ position: "absolute", top: 10, right: 10, color: "#9AA59E", fontSize: 13, cursor: "pointer", padding: 4 }} data-testid="picked-list-clear">✕</span>
                  ) : null}
                </div>
              ))}
            </div>
            {added.length > 0 ? (
              <div style={{ border: "1px solid #EBE3D6", borderRadius: 13, background: "#fff" }} data-testid="contacts-added">
                {added.map((a, i) => (
                  <div key={`${a.email}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: i ? "1px solid #F2EEE4" : "none", fontSize: 13.5, color: "#0E1512" }}>
                    <span style={{ color: "#16A82A" }}>✓</span>
                    {a.firstName ? `${a.firstName} · ` : ""}{a.email}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#9AA59E" }}>No contacts yet — add at least one to continue.</div>
            )}
          </div>

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

      {/* CSV modal */}
      {csvOpen ? (
        <Modal onClose={() => setCsvOpen(false)} title="Upload CSV" tid="csv-modal">
          <div style={{ fontSize: 12.5, color: "#8A7F6B", marginBottom: 8 }}>Paste rows as <code>email,firstName,lastName,company</code> — header row optional.</div>
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={7} style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 12.5 }} data-testid="csv-text" placeholder={"email,firstName\njane@acme.io,Jane"} />
          <ModalActions
            onCancel={() => setCsvOpen(false)}
            saveLabel="Import"
            onSave={() => {
              const rows = csvText
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l && !l.toLowerCase().startsWith("email,"))
                .map((l) => {
                  const [email, firstName, lastName, company] = l.split(",").map((v) => v?.trim());
                  return { email: email ?? "", firstName, lastName, company };
                });
              void addContacts(rows, "csv").then(() => {
                setCsvOpen(false);
                setCsvText("");
              });
            }}
          />
        </Modal>
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
