"use client";

/**
 * Settings — inert-by-scope sections (spec 2.A/B/C/E/F/G/K/L). Layouts,
 * seed data and modal flows are prototype-verbatim and fully interactive on
 * LOCAL state (no dead ends), but nothing here is wired to the API this
 * phase. Phone/WhatsApp are out-of-scope channels (A1) — their connect flows
 * open the designed drawer trees with coming-soon submits.
 */
import { useState, type CSSProperties } from "react";
import {
  BRICO,
  ConnectFlowDrawer,
  GRAD,
  gradBtn,
  inp,
  lbl,
  ModalShell,
  sectionCard,
  sectionHead,
  tableCard,
  tbodyRow,
  theadRow,
} from "./shared";

const fieldBox: CSSProperties = { height: 46, borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 14, color: "#0E1512", boxSizing: "border-box" };

function Toggle({ on, onClick, w = 44, h = 26 }: { on: boolean; onClick: () => void; w?: number; h?: number }) {
  const knob = h - 6;
  return (
    <span onClick={onClick} style={{ width: w, height: h, borderRadius: 100, background: on ? "linear-gradient(135deg,#36D7ED,#35E834)" : "#E4EAE6", position: "relative", display: "inline-block", flex: "none", cursor: "pointer" }}>
      <span style={{ position: "absolute", top: 3, ...(on ? { right: 3 } : { left: 3 }), width: knob, height: knob, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
    </span>
  );
}

// ── 2.A PROFILE ─────────────────────────────────────────────────────────────

const WORKSPACE_DETAILS = [
  { label: "Name", value: "BrightPath Growth", mono: false },
  { label: "ID", value: "ws_8h2k4p9x2v7m1q", mono: true },
  { label: "Members", value: "4", mono: false },
  { label: "Created", value: "Mar 12, 2026", mono: false },
  { label: "Plan", value: "Growth", mono: false },
  { label: "Region", value: "US · us-east-1", mono: false },
];

export function ProfileSection({ toast }: { toast: (m: string) => void }) {
  const [tfa, setTfa] = useState(true);
  return (
    <div data-testid="section-profile">
      <div style={sectionCard}>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512" }}>Workspace details</div>
        <div style={{ fontSize: 13, color: "#9AA59E", marginBottom: 16 }}>The currently active workspace.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {WORKSPACE_DETAILS.map((w) => (
            <div key={w.label}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#9AA59E", marginBottom: 3 }}>{w.label}</div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "#0E1512", fontFamily: w.mono ? "monospace" : "inherit", wordBreak: "break-word" }}>{w.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={sectionCard}>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", marginBottom: 16 }}>Personal info</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "linear-gradient(135deg,#36D7ED,#35E834)", color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 21, fontFamily: BRICO }}>JM</div>
          <span onClick={() => toast("Choose a photo to upload")} style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 15px", cursor: "pointer" }}>Change photo</span>
        </div>
        <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Full name</label><div style={fieldBox}>Jordan Mensah</div></div>
          <div style={{ flex: 1 }}><label style={lbl}>Email</label><div style={fieldBox}>jordan@brightpathgrowth.co</div></div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Company</label><div style={fieldBox}>BrightPath Growth</div></div>
          <div style={{ flex: 1 }}><label style={lbl}>Timezone</label><div style={fieldBox}>(GMT−06:00) Central Time<span style={{ marginLeft: "auto", color: "#9AA59E" }}>⌄</span></div></div>
        </div>
      </div>
      <div style={{ ...sectionCard, padding: 0, overflow: "hidden" }}>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", padding: "18px 24px 4px" }}>Security</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 24px", borderTop: "1px solid #F2EEE4" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>Two-factor authentication</div>
            <div style={{ fontSize: 12.5, color: "#9AA59E" }}>Require a code at sign-in.</div>
          </div>
          <Toggle on={tfa} onClick={() => setTfa((v) => !v)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 24px", borderTop: "1px solid #F2EEE4" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>Password</div>
            <div style={{ fontSize: 12.5, color: "#9AA59E" }}>Last changed 3 months ago.</div>
          </div>
          <span onClick={() => toast("Password reset link sent")} style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 15px", cursor: "pointer" }}>Change</span>
        </div>
      </div>
      <span onClick={() => toast("Profile saved")} style={{ display: "inline-block", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "11px 22px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.24)" }}>Save changes</span>
    </div>
  );
}

// ── 2.B BILLING (+ 3.4 top-up modal) ────────────────────────────────────────

const PACKS = [
  { id: "p1", credits: 1000, price: "$20", per: "2.0¢/credit", best: false },
  { id: "p2", credits: 2500, price: "$45", per: "1.8¢/credit", best: true },
  { id: "p3", credits: 5000, price: "$80", per: "1.6¢/credit", best: false },
  { id: "p4", credits: 10000, price: "$150", per: "1.5¢/credit", best: false },
];
const INVOICES = [
  { date: "Jun 1, 2026", amount: "$199.00", status: "Paid" },
  { date: "May 1, 2026", amount: "$199.00", status: "Paid" },
  { date: "Apr 1, 2026", amount: "$199.00", status: "Paid" },
];

export function BillingSection({ toast }: { toast: (m: string) => void }) {
  const [credits, setCredits] = useState(6200);
  const [autoTopup, setAutoTopup] = useState(true);
  const [topup, setTopup] = useState<{ open: boolean; step: number; packId: string; method: string; paidCredits: number }>({ open: false, step: 0, packId: "p2", method: "visa", paidCredits: 0 });
  const pack = PACKS.find((p) => p.id === topup.packId) ?? PACKS[1]!;

  return (
    <div data-testid="section-billing">
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ background: "#0C140F", borderRadius: 18, padding: 22, color: "#fff", boxSizing: "border-box" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#7FE8A0", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>Credit balance</div>
          <div style={{ fontFamily: BRICO, fontWeight: 800, fontSize: 40, lineHeight: 1, marginBottom: 4 }}>{credits.toLocaleString()}</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)", marginBottom: 16 }}>≈ {Math.round(credits / 150)} days at current pace</div>
          <span onClick={() => setTopup({ open: true, step: 0, packId: "p2", method: "visa", paidCredits: 0 })} style={{ display: "inline-block", fontSize: 13.5, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 10, padding: "9px 16px", cursor: "pointer" }} data-testid="open-topup">+ Top up credits</span>
        </div>
        <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 18, padding: 22, boxShadow: "0 4px 16px rgba(14,21,18,.04)", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1512" }}>This month’s usage</span>
            <span style={{ fontSize: 13, color: "#9AA59E" }}>1,840 / 8,000</span>
          </div>
          <div style={{ height: 10, borderRadius: 100, background: "#F2EEE4", overflow: "hidden", marginBottom: 14 }}>
            <div style={{ height: "100%", width: "23%", borderRadius: 100, background: "linear-gradient(90deg,#36D7ED,#35E834)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #F2EEE4", paddingTop: 12 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", flex: 1 }}>Auto top-up at 500 credits</span>
            <Toggle on={autoTopup} onClick={() => setAutoTopup((v) => !v)} w={42} h={24} />
          </div>
        </div>
      </div>
      <div style={{ ...sectionCard, padding: 22, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512" }}>Growth plan</div>
          <div style={{ fontSize: 13.5, color: "#5C6B62" }}>$199 / mo · 8,000 credits · unlimited agents · all channels</div>
        </div>
        <span onClick={() => toast("Opening plan options…")} style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>Change plan</span>
      </div>
      <div style={{ ...tableCard, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "18px 22px" }}>
          <span style={{ width: 42, height: 30, borderRadius: 7, background: "#0C140F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>VISA</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#0E1512", flex: 1 }}>Visa ···· 4242 <span style={{ color: "#9AA59E", fontWeight: 400 }}>· expires 08/27</span></span>
          <span onClick={() => toast("Update payment method")} style={{ fontSize: 13.5, fontWeight: 600, color: "#16A82A", cursor: "pointer" }}>Update</span>
        </div>
      </div>
      <div style={tableCard}>
        <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 16, color: "#0E1512", padding: "16px 22px" }}>Invoices</div>
        {INVOICES.map((iv) => (
          <div key={iv.date} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 22px", borderTop: "1px solid #F2EEE4" }}>
            <span style={{ fontSize: 14, color: "#0E1512", flex: 1 }}>{iv.date}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{iv.amount}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0F7A28", background: "#D7F5DD", borderRadius: 100, padding: "4px 11px" }}>{iv.status}</span>
            <span onClick={() => toast("Downloading invoice…")} style={{ fontSize: 13, fontWeight: 600, color: "#16A82A", cursor: "pointer" }}>↓ PDF</span>
          </div>
        ))}
      </div>

      {topup.open ? (
        <div onClick={() => { setTopup((t) => ({ ...t, open: false })); if (topup.step === 1) toast("Credits added to your balance"); }} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid="topup-modal">
            {topup.step === 0 ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
                  <span style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Top up credits</span>
                  <span onClick={() => setTopup((t) => ({ ...t, open: false }))} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", boxSizing: "border-box" }}>✕</span>
                </div>
                <div style={{ padding: "20px 22px" }}>
                  <label style={{ ...lbl, marginBottom: 9 }}>Choose a credit pack</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
                    {PACKS.map((p) => {
                      const on = topup.packId === p.id;
                      return (
                        <div key={p.id} onClick={() => setTopup((t) => ({ ...t, packId: p.id }))} style={{ position: "relative", border: on ? "2px solid #35E834" : "1px solid #EBE3D6", background: on ? "rgba(53,232,52,.06)" : "#fff", borderRadius: 13, padding: 14, cursor: "pointer", boxSizing: "border-box" }}>
                          {p.best ? <span style={{ position: "absolute", top: -9, left: 14, fontSize: 10, fontWeight: 800, letterSpacing: ".04em", color: "#0A0F0C", background: GRAD, borderRadius: 6, padding: "2px 8px" }}>BEST VALUE</span> : null}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontFamily: BRICO, fontWeight: 800, fontSize: 20, color: "#0E1512" }}>{p.credits.toLocaleString()}</span>
                            <span style={{ color: "#16A82A", fontSize: 14, visibility: on ? "visible" : "hidden" }}>●</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#9AA59E" }}>credits</div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{p.price}</span>
                            <span style={{ fontSize: 11.5, color: "#9AA59E" }}>{p.per}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <label style={{ ...lbl, marginBottom: 8 }}>Payment method</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[{ id: "visa", label: "Visa ···· 4242", glyph: "VISA" }, { id: "new", label: "Add a new card", glyph: "＋" }].map((m) => {
                      const on = topup.method === m.id;
                      return (
                        <div key={m.id} onClick={() => setTopup((t) => ({ ...t, method: m.id }))} style={{ display: "flex", alignItems: "center", gap: 12, border: on ? "2px solid #35E834" : "1px solid #EBE3D6", background: on ? "rgba(53,232,52,.06)" : "#fff", borderRadius: 12, padding: "11px 14px", cursor: "pointer", boxSizing: "border-box" }}>
                          <span style={{ width: 42, height: 28, borderRadius: 6, flex: "none", background: "#0C140F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>{m.glyph}</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#0E1512", flex: 1 }}>{m.label}</span>
                          <span style={{ color: "#16A82A", fontSize: 15, visibility: on ? "visible" : "hidden" }}>✓</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#FBF7F0" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#9AA59E" }}>{pack.credits.toLocaleString()} credits</div>
                    <div style={{ fontFamily: BRICO, fontWeight: 800, fontSize: 20, color: "#0E1512" }}>{pack.price}</div>
                  </div>
                  <span onClick={() => { setCredits((c) => c + pack.credits); setTopup((t) => ({ ...t, step: 1, paidCredits: pack.credits })); }} style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "11px 22px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }} data-testid="pay-topup">Pay {pack.price}</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: "32px 26px 22px", textAlign: "center" }}>
                  <div style={{ width: 58, height: 58, borderRadius: "50%", background: "#D7F5DD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#16A82A", margin: "0 auto 16px" }}>✓</div>
                  <div style={{ fontFamily: BRICO, fontWeight: 800, fontSize: 21, color: "#0E1512", marginBottom: 6 }}>Payment successful</div>
                  <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, maxWidth: 340, margin: "0 auto 18px" }}>
                    Added <strong style={{ color: "#0E1512" }}>{topup.paidCredits.toLocaleString()} credits</strong>. Your new balance is <strong style={{ color: "#16A82A" }}>{credits.toLocaleString()}</strong>.
                  </div>
                  <div style={{ background: "#FBF7F0", border: "1px solid #EBE3D6", borderRadius: 12, padding: 14, display: "flex", alignItems: "center", gap: 12, textAlign: "left", boxSizing: "border-box" }}>
                    <span style={{ width: 40, height: 40, borderRadius: 11, flex: "none", background: "rgba(53,232,52,.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9AA59E" }}>New balance</div>
                      <div style={{ fontFamily: BRICO, fontWeight: 800, fontSize: 22, color: "#0E1512" }}>{credits.toLocaleString()}</div>
                    </div>
                    <span style={{ fontSize: 12, color: "#9AA59E" }}>A receipt was emailed to you.</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                  <span onClick={() => { setTopup((t) => ({ ...t, open: false })); toast("Credits added to your balance"); }} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 24px", cursor: "pointer" }}>Done</span>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── 2.C CUSTOM FIELDS (+ 3.2 modal) ─────────────────────────────────────────

const CF_GRID = "1.4fr 1fr 1.2fr 44px";
const CF_SEED = [
  { label: "Clinic size", type: "Number", slug: "clinic_size" },
  { label: "Last visit", type: "Date", slug: "last_visit" },
  { label: "Practice type", type: "Dropdown", slug: "practice_type" },
  { label: "Decision maker", type: "Checkbox", slug: "is_decision_maker" },
];
const slugify = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "auto_generated";

export function CustomFieldsSection({ toast }: { toast: (m: string) => void }) {
  const [cfList, setCfList] = useState(CF_SEED);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("Text");
  const q = search.trim().toLowerCase();
  const rows = cfList.filter((f) => !q || f.label.toLowerCase().includes(q) || f.slug.includes(q));
  const valid = Boolean(label.trim());

  return (
    <div data-testid="section-custom">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: "0 0 300px", display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 16px", boxSizing: "border-box" }}>
          <span style={{ color: "#9AA59E" }}>⚲</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fields…" style={{ border: "none", background: "transparent", fontSize: 14, color: "#0E1512", flex: 1, minWidth: 0, padding: 0, outline: "none", fontFamily: "'Hanken Grotesk',sans-serif" }} />
        </div>
        <span onClick={() => { setAddOpen(true); setLabel(""); setType("Text"); }} style={{ ...gradBtn, marginLeft: "auto", padding: "11px 18px" }} data-testid="add-field">+ Add field</span>
      </div>
      <div style={tableCard}>
        <div style={theadRow(CF_GRID)}><span>Field label</span><span>Type</span><span>Field ID</span><span /></div>
        {rows.map((f) => (
          <div key={f.slug} style={{ ...tbodyRow(CF_GRID), fontSize: 14, color: "#0E1512" }}>
            <span style={{ fontWeight: 600 }}>{f.label}</span>
            <span><span style={{ fontSize: 12, fontWeight: 600, color: "#5C6B62", background: "#F2EEE4", borderRadius: 7, padding: "3px 10px" }}>{f.type}</span></span>
            <span style={{ fontFamily: "monospace", fontSize: 12.5, color: "#8A7F6B" }}>{f.slug}</span>
            <span onClick={() => { setCfList((arr) => arr.filter((x) => x.slug !== f.slug)); toast("Custom field removed"); }} style={{ textAlign: "center", color: "#C9543F", fontWeight: 700, cursor: "pointer" }} title="Remove">✕</span>
          </div>
        ))}
        {rows.length === 0 ? <div style={{ padding: 34, textAlign: "center", color: "#9AA59E", fontSize: 13.5 }}>No custom fields match.</div> : null}
      </div>

      {addOpen ? (
        <ModalShell
          width={440}
          title="New custom field"
          onClose={() => setAddOpen(false)}
          testid="custom-field-modal"
          footer={
            <>
              <span onClick={() => setAddOpen(false)} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
              <span
                onClick={() => {
                  if (!valid) return;
                  const slug = slugify(label);
                  setCfList((arr) => [...arr, { label: label.trim(), type, slug: arr.some((x) => x.slug === slug) ? `${slug}_${arr.length}` : slug }]);
                  setAddOpen(false);
                  toast("Custom field created");
                }}
                style={{ fontSize: 14, fontWeight: 700, color: valid ? "#0A0F0C" : "#9AA59E", background: valid ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 20px", cursor: valid ? "pointer" : "not-allowed" }}
              >Create field</span>
            </>
          }
        >
          <div style={{ padding: "20px 22px" }}>
            <label style={lbl}>Field label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Clinic size" style={{ ...inp, marginBottom: 5 }} />
            <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 16 }}>Field ID: <span style={{ fontFamily: "monospace", color: "#8A7F6B" }}>{slugify(label)}</span></div>
            <label style={{ ...lbl, marginBottom: 8 }}>Type</label>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {["Text", "Number", "Date", "Dropdown", "Checkbox"].map((t) => {
                const on = type === t;
                return (
                  <span key={t} onClick={() => setType(t)} style={{ fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 100, cursor: "pointer", background: on ? GRAD : "#fff", color: on ? "#0A0F0C" : "#5C6B62", border: `1px solid ${on ? "transparent" : "#EBE3D6"}`, boxSizing: "border-box" }}>{t}</span>
                );
              })}
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}

// ── 2.E TEAM (+ 3.3 invite modal) ───────────────────────────────────────────

const TEAM_GRID = "1.8fr 1fr .9fr 44px";
interface Member { name: string; email: string; role: string; initials: string; avbg: string; status: string; sbg: string; sfg: string }
const TEAM_SEED: Member[] = [
  { name: "Jordan Mensah", email: "jordan@brightpathgrowth.co", role: "Owner", initials: "JM", avbg: "linear-gradient(135deg,#36D7ED,#35E834)", status: "Active", sbg: "#D7F5DD", sfg: "#0F7A28" },
  { name: "Maya Patel", email: "maya@brightpathgrowth.co", role: "Admin", initials: "MP", avbg: "rgba(54,215,237,.4)", status: "Active", sbg: "#D7F5DD", sfg: "#0F7A28" },
  { name: "Leo Nguyen", email: "leo@brightpathgrowth.co", role: "Member", initials: "LN", avbg: "rgba(208,245,107,.6)", status: "Active", sbg: "#D7F5DD", sfg: "#0F7A28" },
  { name: "Sara Kim", email: "sara@brightpathgrowth.co", role: "Member", initials: "SK", avbg: "#F2EEE4", status: "Invited", sbg: "rgba(232,196,91,.18)", sfg: "#A87B16" },
];
const ROLES = [
  { id: "Admin", icon: "🛡", desc: "Manage workspace, billing & members" },
  { id: "Member", icon: "⚒", desc: "Build agents & send campaigns" },
  { id: "Client", icon: "👤", desc: "View reports & approve messages" },
  { id: "Viewer", icon: "👁", desc: "Read-only access" },
];

export function TeamSection({ toast }: { toast: (m: string) => void }) {
  const [newMembers, setNewMembers] = useState<Member[]>([]);
  const [invite, setInvite] = useState({ open: false, step: 0, email: "", role: "Member" });
  const [sent, setSent] = useState({ email: "", link: "", role: "" });
  const team = [...TEAM_SEED, ...newMembers];
  const emailValid = /.+@.+\..+/.test(invite.email);

  function sendInvite() {
    if (!emailValid) return;
    const email = invite.email.trim();
    const link = `https://app.clientforce.co/invite/${Math.random().toString(36).slice(2, 11)}`;
    const initials = email.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "??";
    setSent({ email, link, role: invite.role });
    setNewMembers((arr) => [...arr, { name: email.split("@")[0] ?? email, email, role: invite.role, initials, avbg: "#F2EEE4", status: "Invited", sbg: "rgba(232,196,91,.18)", sfg: "#A87B16" }]);
    setInvite((v) => ({ ...v, step: 1 }));
  }

  return (
    <div data-testid="section-team">
      <div style={tableCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px" }}>
          <div>
            <div style={sectionHead}>Team &amp; roles</div>
            <div style={{ fontSize: 13, color: "#9AA59E" }}>{team.length} members · 2 seats available</div>
          </div>
          <span onClick={() => setInvite({ open: true, step: 0, email: "", role: "Member" })} style={gradBtn} data-testid="open-invite">+ Invite</span>
        </div>
        <div style={{ ...theadRow(TEAM_GRID), borderTop: "1px solid #EBE3D6" }}><span>Member</span><span>Role</span><span>Status</span><span /></div>
        {team.map((m) => (
          <div key={m.email} style={tbodyRow(TEAM_GRID)}>
            <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: m.avbg, color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700 }}>{m.initials}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{m.name}</span>
                <span style={{ display: "block", fontSize: 12.5, color: "#9AA59E" }}>{m.email}</span>
              </span>
            </span>
            <span style={{ fontSize: 13.5, color: "#3B463F", fontWeight: 600 }}>{m.role}</span>
            <span><span style={{ fontSize: 12, fontWeight: 600, color: m.sfg, background: m.sbg, borderRadius: 100, padding: "4px 11px" }}>{m.status}</span></span>
            <span onClick={() => toast("Row actions")} style={{ textAlign: "center", color: "#9AA59E", fontSize: 18, fontWeight: 700, cursor: "pointer" }}>⋯</span>
          </div>
        ))}
      </div>

      {invite.open ? (
        <div onClick={() => setInvite((v) => ({ ...v, open: false }))} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid="invite-modal">
            {invite.step === 0 ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
                  <span style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Invite to workspace</span>
                  <span onClick={() => setInvite((v) => ({ ...v, open: false }))} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", boxSizing: "border-box" }}>✕</span>
                </div>
                <div style={{ padding: "20px 22px" }}>
                  <label style={lbl}>Email address</label>
                  <input value={invite.email} onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))} placeholder="name@company.com" style={{ ...inp, marginBottom: 16 }} data-testid="invite-email" />
                  <label style={{ ...lbl, marginBottom: 8 }}>Role &amp; access</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ROLES.map((r) => {
                      const on = invite.role === r.id;
                      return (
                        <div key={r.id} onClick={() => setInvite((v) => ({ ...v, role: r.id }))} style={{ display: "flex", alignItems: "center", gap: 12, border: on ? "2px solid #35E834" : "1px solid #EBE3D6", background: on ? "rgba(53,232,52,.06)" : "#fff", borderRadius: 12, padding: "12px 14px", cursor: "pointer", boxSizing: "border-box" }}>
                          <span style={{ width: 34, height: 34, borderRadius: 9, flex: "none", background: "#F2EEE4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{r.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>{r.id}</div>
                            <div style={{ fontSize: 12, color: "#9AA59E" }}>{r.desc}</div>
                          </div>
                          <span style={{ color: "#16A82A", fontSize: 15, visibility: on ? "visible" : "hidden" }}>✓</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                  <span onClick={() => setInvite((v) => ({ ...v, open: false }))} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
                  <span onClick={sendInvite} style={{ fontSize: 14, fontWeight: 700, color: emailValid ? "#0A0F0C" : "#9AA59E", background: emailValid ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 20px", cursor: emailValid ? "pointer" : "not-allowed" }} data-testid="send-invite">Send invite</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: "30px 26px 22px", textAlign: "center" }}>
                  <div style={{ width: 58, height: 58, borderRadius: "50%", background: "#D7F5DD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "#16A82A", margin: "0 auto 16px" }}>✓</div>
                  <div style={{ fontFamily: BRICO, fontWeight: 800, fontSize: 21, color: "#0E1512", marginBottom: 6 }}>Access sent</div>
                  <div style={{ fontSize: 13.5, color: "#5C6B62", lineHeight: 1.5, maxWidth: 360, margin: "0 auto 18px" }}>
                    We emailed an invite to <strong style={{ color: "#0E1512" }}>{sent.email}</strong> with <strong style={{ color: "#0E1512" }}>{sent.role}</strong> access. They’ll appear as “Invited” until they accept.
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "#9AA59E", marginBottom: 7 }}>Or share this invite link</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 11, border: "1px solid #EBE3D6", background: "#FBF7F0", display: "flex", alignItems: "center", padding: "0 13px", fontSize: 13, color: "#1192A6", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", boxSizing: "border-box" }}>{sent.link}</div>
                      <span
                        onClick={() => {
                          try {
                            void navigator.clipboard?.writeText(sent.link);
                          } catch {
                            /* clipboard unavailable */
                          }
                          toast("Invite link copied to clipboard");
                        }}
                        style={{ flex: "none", fontSize: 13.5, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "12px 16px", cursor: "pointer" }}
                      >⧉ Copy</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>
                  <span onClick={() => setInvite({ open: true, step: 0, email: "", role: "Member" })} style={{ fontSize: 14, fontWeight: 600, color: "#16A82A", cursor: "pointer" }}>+ Invite another</span>
                  <span onClick={() => setInvite((v) => ({ ...v, open: false }))} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 22px", cursor: "pointer" }}>Done</span>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── 2.F SCHEDULES (generic MCFG.schedule modal) ─────────────────────────────

const SCHEDULE_GRID = "1.4fr 1.4fr 1.1fr 1fr 44px";
const SCHEDULES = [
  { name: "Business hours", days: "Mon–Fri", hours: "9:00 AM – 5:00 PM", tz: "CT", isDefault: true },
  { name: "Extended", days: "Mon–Sat", hours: "8:00 AM – 7:00 PM", tz: "CT", isDefault: false },
  { name: "Weekend nurture", days: "Sat–Sun", hours: "10:00 AM – 2:00 PM", tz: "CT", isDefault: false },
];
const SCHEDULE_FIELDS = [
  { label: "Name", ph: "Business hours", sel: false },
  { label: "Days", ph: "Mon–Fri", sel: true },
  { label: "Hours", ph: "9:00 AM – 5:00 PM", sel: false },
];

export function SchedulesSection({ toast }: { toast: (m: string) => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <div data-testid="section-schedules">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={sectionHead}>Sending schedules</div>
        <span onClick={() => setModalOpen(true)} style={gradBtn}>+ New schedule</span>
      </div>
      <div style={tableCard}>
        <div style={theadRow(SCHEDULE_GRID)}><span>Name</span><span>Days</span><span>Hours</span><span>Timezone</span><span /></div>
        {SCHEDULES.map((s) => (
          <div key={s.name} style={{ ...tbodyRow(SCHEDULE_GRID), fontSize: 13.5, color: "#0E1512" }}>
            <span style={{ fontWeight: 600 }}>
              {s.name} {s.isDefault ? <span style={{ fontSize: 11, fontWeight: 700, color: "#0F7A28", background: "#D7F5DD", borderRadius: 6, padding: "1px 7px" }}>Default</span> : null}
            </span>
            <span style={{ color: "#5C6B62" }}>{s.days}</span>
            <span style={{ color: "#5C6B62" }}>{s.hours}</span>
            <span style={{ color: "#5C6B62" }}>{s.tz}</span>
            <span onClick={() => toast("Row actions")} style={{ textAlign: "center", color: "#9AA59E", fontWeight: 700, cursor: "pointer" }}>⋯</span>
          </div>
        ))}
      </div>
      {modalOpen ? (
        <ModalShell
          width={440}
          title="New sending schedule"
          onClose={() => setModalOpen(false)}
          testid="schedule-modal"
          footer={
            <>
              <span onClick={() => setModalOpen(false)} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
              <span onClick={() => { setModalOpen(false); toast("Schedule created"); }} style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 20px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)" }}>Create schedule</span>
            </>
          }
        >
          <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 13 }}>
            {SCHEDULE_FIELDS.map((f) => (
              <div key={f.label}>
                <label style={lbl}>{f.label}</label>
                <div style={{ height: 44, borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 14, color: "#B7BDB6", boxSizing: "border-box" }}>
                  {f.ph}
                  {f.sel ? <span style={{ marginLeft: "auto", color: "#9AA59E" }}>⌄</span> : null}
                </div>
              </div>
            ))}
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}

// ── 2.G USAGE ───────────────────────────────────────────────────────────────

const USAGE = [
  { label: "Email sends", used: "4,540", total: "20,000", pct: "23%", color: "linear-gradient(90deg,#36D7ED,#35E834)" },
  { label: "SMS messages", used: "1,680", total: "5,000", pct: "34%", color: "#36D7ED" },
  { label: "WhatsApp messages", used: "1,344", total: "5,000", pct: "27%", color: "#16A82A" },
  { label: "AI voice minutes", used: "420", total: "2,000", pct: "21%", color: "#1192A6" },
  { label: "Auto-prospecting credits", used: "180", total: "1,000", pct: "18%", color: "#6B7A1F" },
];

export function UsageSection() {
  return (
    <div data-testid="section-usage">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={sectionHead}>Workspace usage</div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "9px 14px" }}>June 2026 <span style={{ color: "#9AA59E" }}>⌄</span></span>
      </div>
      <div style={{ ...sectionCard, marginBottom: 0 }}>
        {USAGE.map((u) => (
          <div key={u.label} style={{ padding: "13px 0", borderTop: "1px solid #F2EEE4" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: "#0E1512", flex: 1 }}>{u.label}</span>
              <span style={{ fontSize: 13, color: "#9AA59E" }}>{u.used} / {u.total}</span>
            </div>
            <div style={{ height: 8, borderRadius: 100, background: "#F2EEE4", overflow: "hidden" }}>
              <div style={{ height: "100%", width: u.pct, borderRadius: 100, background: u.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 2.K PHONE NUMBERS (out-of-scope channel — inert layout, A1) ─────────────

const PHONE_GRID = "1.4fr 1.3fr 1.4fr .9fr 44px";
const PHONES = [
  { e164: "+1 (512) 555-0100", channel: "Voice & WhatsApp", label: "Main line", badges: [{ label: "Voice default", fg: "#0F7A28", bg: "#D7F5DD" }, { label: "WA default", fg: "#0F7A28", bg: "#D7F5DD" }] },
  { e164: "+1 (512) 555-0144", channel: "Voice", label: "Overflow", badges: [{ label: "Voice", fg: "#5C6B62", bg: "#F2EEE4" }] },
  { e164: "+44 20 7946 0011", channel: "WhatsApp", label: "UK sender", badges: [{ label: "WA", fg: "#5C6B62", bg: "#F2EEE4" }] },
];

export function PhoneSection({ toast }: { toast: (m: string) => void }) {
  const [flowOpen, setFlowOpen] = useState(false);
  return (
    <div data-testid="section-phone">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={sectionHead}>Phone numbers</div>
          <div style={{ fontSize: 13, color: "#9AA59E" }}>Numbers for AI voice calls &amp; WhatsApp.</div>
        </div>
        <span onClick={() => setFlowOpen(true)} style={gradBtn}>+ Add number</span>
      </div>
      <div style={tableCard}>
        <div style={theadRow(PHONE_GRID)}><span>Number</span><span>Channel</span><span>Default</span><span>Name</span><span /></div>
        {PHONES.map((p) => (
          <div key={p.e164} style={{ ...tbodyRow(PHONE_GRID), fontSize: 13.5, color: "#0E1512" }}>
            <span style={{ fontWeight: 600 }}>{p.e164}</span>
            <span style={{ color: "#5C6B62" }}>{p.channel}</span>
            <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {p.badges.map((b) => (
                <span key={b.label} style={{ fontSize: 11, fontWeight: 700, color: b.fg, background: b.bg, borderRadius: 7, padding: "3px 9px" }}>{b.label}</span>
              ))}
            </span>
            <span style={{ color: "#5C6B62" }}>{p.label}</span>
            <span onClick={() => toast("Phone number removed")} style={{ textAlign: "center", color: "#C9543F", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Delete</span>
          </div>
        ))}
      </div>
      {flowOpen ? <ConnectFlowDrawer channel="phone" onClose={() => setFlowOpen(false)} toast={toast} /> : null}
    </div>
  );
}

// ── 2.L WHATSAPP SENDERS (out-of-scope channel — inert layout, A1) ──────────

const WA_GRID = "1.5fr 1.2fr 1fr 1fr 1.1fr";
const WHATSAPPS = [
  { number: "+1 (512) 555-0100", name: "BrightPath Growth", status: "Connected", sbg: "#D7F5DD", sfg: "#0F7A28", quality: "High", qfg: "#16A82A", id: "wa_3f81a0" },
  { number: "+44 20 7946 0011", name: "BrightPath UK", status: "Pending", sbg: "rgba(232,196,91,.18)", sfg: "#A87B16", quality: "—", qfg: "#9AA59E", id: "wa_5d22c7" },
];

export function WhatsappSection({ toast }: { toast: (m: string) => void }) {
  const [flowOpen, setFlowOpen] = useState(false);
  return (
    <div data-testid="section-whatsapp">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={sectionHead}>WhatsApp senders</div>
          <div style={{ fontSize: 13, color: "#9AA59E" }}>Business numbers approved for WhatsApp.</div>
        </div>
        <span onClick={() => setFlowOpen(true)} style={gradBtn}>+ Add sender</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(232,196,91,.12)", border: "1px solid rgba(232,196,91,.45)", borderRadius: 12, padding: "11px 16px", marginBottom: 14, boxSizing: "border-box" }} data-testid="whatsapp-notice">
        <span>ℹ</span>
        <span style={{ fontSize: 12.5, color: "#5C6B62" }}>WhatsApp sender setup is being updated — new connections are paused. Existing senders keep working.</span>
      </div>
      <div style={tableCard}>
        <div style={theadRow(WA_GRID)}><span>Number</span><span>Display name</span><span>Status</span><span>Quality</span><span>ID</span></div>
        {WHATSAPPS.map((w) => (
          <div key={w.id} style={{ ...tbodyRow(WA_GRID), fontSize: 13.5, color: "#0E1512" }}>
            <span style={{ fontWeight: 600 }}>{w.number}</span>
            <span style={{ color: "#5C6B62" }}>{w.name}</span>
            <span><span style={{ fontSize: 12, fontWeight: 600, color: w.sfg, background: w.sbg, borderRadius: 100, padding: "4px 10px" }}>{w.status}</span></span>
            <span style={{ color: w.qfg, fontWeight: 600 }}>{w.quality}</span>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8A7F6B" }}>{w.id}</span>
          </div>
        ))}
      </div>
      {flowOpen ? <ConnectFlowDrawer channel="whatsapp" onClose={() => setFlowOpen(false)} toast={toast} /> : null}
    </div>
  );
}
