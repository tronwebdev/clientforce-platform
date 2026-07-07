"use client";

/**
 * Brand knowledge (spec 2.D — canonical BusinessContext surface, §6).
 * WIRED: Company docs & SOPs + Web pages (workspace-scoped knowledge sources)
 * and the Core offer (context `offer` field, workspace layer). The Agent
 * summary dark card + Guardrails card render exactly per the prototype as
 * designed-inert local state (amber preview note) — they persist with the
 * workspace Brand-kit unit later. Description has no context field key yet →
 * local state with a title note.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  BRICO,
  cf,
  fmtDate,
  GRAD,
  HANKEN,
  lbl,
  PAIR,
  sectionCard,
} from "./shared";

const PREVIEW_NOTE = "Preview — edits here don\u2019t save yet";

// ── seed data (prototype verbatim) ──────────────────────────────────────────

const GK: Record<string, { label: string; fg: string; bg: string; icon: string }> = {
  do: { label: "Always", fg: "#0F7A28", bg: "#D7F5DD", icon: "✓" },
  dont: { label: "Never", fg: "#C9543F", bg: "rgba(224,121,107,.16)", icon: "✕" },
  tone: { label: "Tone", fg: "#1192A6", bg: "rgba(54,215,237,.16)", icon: "♪" },
};

const GUARDRAIL_SEED = [
  { id: "g1", kind: "tone", text: "Friendly, concise and outcome-focused" },
  { id: "g2", kind: "dont", text: "Make medical or clinical claims" },
  { id: "g3", kind: "do", text: "Mention HIPAA-friendly handling when relevant" },
  { id: "g4", kind: "do", text: "Use the contact first name and clinic name" },
];

const PRESETS = ["Keep emails under 90 words", "No emojis in email", "Always include one clear CTA", "Never mention competitors", "Reference a relevant case study"];

const CONNECT_SOURCES = [
  { id: "website", glyph: "⧉", name: "Website crawl", desc: "brightpathgrowth.co", connected: true },
  { id: "notion", glyph: "N", name: "Notion", desc: "Wiki & SOPs workspace", connected: true },
  { id: "gdrive", glyph: "G", name: "Google Drive", desc: "Docs, slides & sheets", connected: false },
  { id: "dropbox", glyph: "D", name: "Dropbox", desc: "Shared folders", connected: false },
];

/** SUMMARY_DEFAULTS — 14 sections, prototype lines 1084–1099 verbatim. */
const SUMMARY_DEFAULTS = [
  { id: "s1", n: "01", title: "Business overview", body: "BrightPath Growth is a done-for-you outbound agency for dental & medical clinics. We fill new-patient appointments across email, SMS, WhatsApp and AI voice — and only charge for booked appointments. US-based, ~40 active clinic clients." },
  { id: "s2", n: "02", title: "Customer profile (ICP)", body: "Independent dental & medical clinics and small DSO groups (1–10 locations) in the US/UK/EU. Buyers: practice owners, office managers, marketing leads. ~$1–8M revenue, busy but under-booked on new patients." },
  { id: "s3", n: "03", title: "Pain points", body: "Empty chairs / unfilled slots. Front desk too busy to follow up leads. Wasted ad spend with weak follow-up. No-shows. Can’t match DSO marketing budgets." },
  { id: "s4", n: "04", title: "Products / services / offer", body: "Free 15-minute growth audit → done-for-you multi-channel campaign (email + SMS + WhatsApp + AI voice). Pay-per-booked-appointment pricing. Includes list building, copy, sending infra, and AI reply + call handling." },
  { id: "s5", n: "05", title: "Unique selling proposition (USP)", body: "Only-pay-for-booked-appointments removes risk. True multi-channel incl. AI voice that books live on the calendar. Fully done-for-you. HIPAA-friendly handling." },
  { id: "s6", n: "06", title: "Objection handling database", body: "“Too busy” → we do everything, you just approve. “Tried agencies” → pay per booked appt, no retainers. “Compliance?” → HIPAA-friendly, opt-out handled. “Already run ads” → we convert what ads miss with follow-up." },
  { id: "s7", n: "07", title: "Competitor intelligence", body: "vs front desk: no bandwidth to follow up. vs ad agencies: they drive clicks, we book appointments. vs other tools: most are email-only & DIY — we’re multi-channel and managed. Don’t name competitors in outreach." },
  { id: "s8", n: "08", title: "Case studies / social proof / testimonials", body: "Bright Smiles Dental: 18 new-patient appts in 3 weeks. Rossi Clinic: 32% SMS reply rate. 40+ clinics live. Average first booked appointment within week one." },
  { id: "s9", n: "09", title: "Sales process", body: "1) Free audit call. 2) Map ICP + import lists. 3) Approve first messages. 4) Launch sequence. 5) AI handles replies + books. 6) Weekly reporting. Goal of first touch: book the audit." },
  { id: "s10", n: "10", title: "Brand voice", body: "Friendly, concise, outcome-focused. Confident, never pushy. Plain English, no jargon. Personalize with first name + clinic name. No emojis in email; light emoji ok on WhatsApp." },
  { id: "s11", n: "11", title: "Frequently asked questions", body: "How fast? First appts usually within week one. Contracts? No long lock-in. The list? We build or import. Compliant? HIPAA-friendly, one-click opt-out. What do I do? Approve the first message — we handle the rest." },
  { id: "s12", n: "12", title: "Compliance & restrictions", body: "Never make medical/clinical claims. Always include opt-out (STOP for SMS, unsubscribe for email). HIPAA-friendly handling of PHI. Honor suppression list. No sends outside business hours." },
  { id: "s13", n: "13", title: "Bonuses", body: "Free reputation/review audit. Done-for-you booking-calendar setup. First 100 contacts sourced free. 14-day no-booking, no-fee guarantee." },
  { id: "s14", n: "14", title: "Product intelligence & customer support brain", body: "Onboarding ~48 hours. Reschedules handled by AI. Billing per booked appointment, invoiced monthly. Support via shared inbox, <2h response. Escalate clinical questions to the clinic." },
];

const SUMMARY_CITES: Record<string, { icon: string; label: string; srcLine: string; quote: string }[]> = {
  s1: [
    { icon: "🌐", label: "Homepage", srcLine: "🌐 brightpathgrowth.co — homepage hero", quote: "We fill empty chairs. Done-for-you outreach that books new-patient appointments — you only pay when a patient books." },
    { icon: "📄", label: "Growth-audit PDF", srcLine: "📄 Growth-audit-overview.pdf — page 1", quote: "US-based team working with 40+ active clinic clients." },
  ],
  s2: [{ icon: "📄", label: "Growth-audit PDF", srcLine: "📄 Growth-audit-overview.pdf — page 2", quote: "Built for independent clinics and small DSO groups (1–10 locations) in the $1–8M revenue range." }],
  s3: [{ icon: "🌐", label: "/why-brightpath", srcLine: "🌐 brightpathgrowth.co/why-brightpath", quote: "Your front desk is too busy to chase leads — paid clicks die in the inbox while chairs sit empty." }],
  s4: [{ icon: "🌐", label: "/services", srcLine: "🌐 brightpathgrowth.co/services", quote: "Free 15-minute growth audit, then a done-for-you campaign across email, SMS, WhatsApp and AI voice." }],
  s5: [{ icon: "🌐", label: "/pricing", srcLine: "🌐 brightpathgrowth.co/pricing", quote: "No retainers. You pay per booked appointment — if we don’t book, you don’t pay." }],
  s6: [{ icon: "❓", label: "FAQ · Q7", srcLine: "❓ Objection-handling FAQ — Q7 of 18", quote: "Already tried an agency? You pay per booked appointment — no retainers, no lock-in." }],
  s8: [{ icon: "🌐", label: "/results", srcLine: "🌐 brightpathgrowth.co/results", quote: "Bright Smiles Dental booked 18 new-patient appointments in the first 3 weeks." }],
  s9: [{ icon: "📄", label: "Growth-audit PDF", srcLine: "📄 Growth-audit-overview.pdf — page 4", quote: "Step one is always the free audit call — every first touch drives to that booking." }],
  s10: [{ icon: "🌐", label: "Site copy", srcLine: "🌐 brightpathgrowth.co — headlines sampled across 38 pages", quote: "More patients. Less chasing." }],
  s11: [{ icon: "❓", label: "FAQ · Q1", srcLine: "❓ Objection-handling FAQ — Q1 of 18", quote: "How fast will I see appointments? Usually within the first week of launch." }],
  s12: [{ icon: "❓", label: "FAQ · Q14", srcLine: "❓ Objection-handling FAQ — Q14 of 18", quote: "Every SMS includes STOP opt-out; every email includes one-click unsubscribe. PHI is handled HIPAA-friendly." }],
  s13: [{ icon: "🌐", label: "/pricing", srcLine: "🌐 brightpathgrowth.co/pricing — footnotes", quote: "Includes a free reputation audit, booking-calendar setup, and your first 100 contacts sourced free." }],
  s14: [{ icon: "❓", label: "FAQ · Q16", srcLine: "❓ Objection-handling FAQ — Q16 of 18", quote: "Onboarding takes about 48 hours; reschedules are handled automatically by the AI." }],
};
const SUMMARY_AI: Record<string, boolean> = { s7: true };

// ── live knowledge-source shape ─────────────────────────────────────────────

interface KSource {
  id: string;
  agentId: string | null;
  kind: string;
  uri: string | null;
  label: string;
  status: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

function docIcon(name: string): { icon: string; iconbg: string } {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return { icon: "📕", iconbg: "rgba(224,121,107,.16)" };
  if (ext === "xlsx" || ext === "csv") return { icon: "📊", iconbg: "rgba(53,232,52,.16)" };
  if (ext === "ppt" || ext === "pptx" || ext === "key") return { icon: "📑", iconbg: "rgba(232,196,91,.2)" };
  return { icon: "📄", iconbg: "rgba(54,215,237,.16)" };
}
function docMeta(s: KSource): string {
  const name = typeof s.meta?.filename === "string" ? s.meta.filename : s.label;
  const ext = (name.split(".").pop() ?? "").toUpperCase();
  const bytes = typeof s.meta?.bytes === "number" ? s.meta.bytes : null;
  const size = bytes === null ? null : bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  return [ext, size, `added ${fmtDate(s.createdAt)}`].filter(Boolean).join(" · ");
}
function statusPill(status: string): { label: string; fg: string; bg: string } {
  if (status === "READY") return { label: "Indexed", fg: PAIR.good.fg, bg: PAIR.good.bg };
  if (status === "FAILED") return { label: "Failed", fg: PAIR.bad.fg, bg: PAIR.bad.bg };
  return { label: "Indexing…", fg: PAIR.warn.fg, bg: PAIR.warn.bg };
}

const removeBtn: CSSProperties = { width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#C9543F", fontSize: 12, cursor: "pointer", flex: "none", boxSizing: "border-box" };
const cardTitle16: CSSProperties = { fontFamily: BRICO, fontWeight: 700, fontSize: 16, color: "#0E1512" };
const previewNote: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#A87B16", marginBottom: 10 };
const textarea: CSSProperties = { width: "100%", boxSizing: "border-box", borderRadius: 11, border: "1px solid #EBE3D6", background: "#fff", padding: "12px 14px", fontSize: 14, lineHeight: 1.55, color: "#0E1512", fontFamily: HANKEN, resize: "vertical", outline: "none" };

export function BrandKit({ toast }: { toast: (m: string) => void }) {
  // ── wired knowledge (workspace scope) ────────────────────────────────────
  const [sources, setSources] = useState<KSource[] | null>(null);
  const [srcError, setSrcError] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setSources((await cf("knowledge/sources?scope=workspace")) as KSource[]);
      setSrcError(false);
    } catch {
      setSrcError(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000); // A4 — indexing status is live
    return () => clearInterval(t);
  }, [refresh]);
  const docs = sources?.filter((s) => s.kind === "DOCUMENT") ?? null;
  const webs = sources?.filter((s) => s.kind === "WEBSITE") ?? null;
  const indexedCount = (docs ?? []).filter((d) => d.status === "READY").length;

  async function uploadDocs(files: FileList | null) {
    if (!files || files.length === 0) return;
    let ok = 0;
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      // raw fetch — multipart must NOT carry the JSON content-type of cf()
      const res = await fetch("/api/cf/knowledge/sources/upload", { method: "POST", body: fd }).catch(() => null);
      if (res?.ok) ok += 1;
    }
    await refresh();
    toast(ok > 0 ? `${ok} document${ok > 1 ? "s" : ""} uploaded` : "Upload failed — PDF, DOCX, XLSX, TXT, CSV or MD up to 25 MB");
  }
  async function removeSource(id: string) {
    await cf(`knowledge/sources/${id}`, { method: "DELETE" }).catch(() => {});
    await refresh();
  }

  // ── web pages input ──────────────────────────────────────────────────────
  const [webInput, setWebInput] = useState("");
  const webValid = webInput.trim().length > 3 && /\./.test(webInput);
  async function addWebSource() {
    const raw = webInput.trim();
    if (!webValid) return;
    const cleaned = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const uri = /^https?:\/\//.test(raw) ? raw : `https://${cleaned}`;
    try {
      await cf("knowledge/sources", { method: "POST", body: JSON.stringify({ kind: "WEBSITE", uri, label: cleaned }) });
      setWebInput("");
      await refresh();
      toast(`Indexing ${cleaned}…`);
    } catch {
      toast("Couldn’t add that URL — check the address and try again.");
    }
  }

  // ── description / offer (offer = wired context field, workspace layer) ──
  const [description, setDescription] = useState("");
  const [offer, setOffer] = useState("");
  useEffect(() => {
    void cf("context")
      .then((res: { workspace?: { fields?: Record<string, { value?: unknown }> } }) => {
        const v = res?.workspace?.fields?.offer?.value;
        if (typeof v === "string") setOffer(v);
      })
      .catch(() => {});
  }, []);
  async function saveKnowledge() {
    if (offer.trim()) {
      // NO agentId → the workspace layer of BusinessContext
      const ok = await cf("context/answers", { method: "POST", body: JSON.stringify({ key: "offer", value: offer.trim() }) })
        .then(() => true)
        .catch(() => false);
      if (!ok) {
        toast("Couldn’t save the offer — try again.");
        return;
      }
    }
    toast("Brand knowledge saved");
  }

  // ── agent summary (designed-inert local state) ───────────────────────────
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sections, setSections] = useState(SUMMARY_DEFAULTS.map((s) => ({ ...s })));
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({ s1: true });
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const [quote, setQuote] = useState<{ id: string; idx: number } | null>(null);

  // ── guardrails (designed-inert local state) ─────────────────────────────
  const [guardrails, setGuardrails] = useState(GUARDRAIL_SEED);
  const [gKind, setGKind] = useState("do");
  const [gText, setGText] = useState("");
  const [gSeq, setGSeq] = useState(4);
  const addGuardrail = (kind: string, text: string) => {
    if (!text.trim() || guardrails.some((g) => g.text === text)) return;
    setGuardrails((g) => [...g, { id: `g${gSeq + 1}`, kind, text }]);
    setGSeq((n) => n + 1);
  };

  // ── brand identity (local-state inert) ───────────────────────────────────
  const [logo, setLogo] = useState<string | null>(null);
  const [colors, setColors] = useState({ primary: "#35E834", accent: "#36D7ED", ink: "#0C140F" });
  const [tagline, setTagline] = useState("");

  return (
    <div data-testid="section-brand">
      {/* header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 18, color: "#0E1512" }}>Brand knowledge</div>
          <div style={{ fontSize: 13, color: "#9AA59E" }}>Docs, SOPs, sources, offer &amp; guardrails — the context your AI agents write and act from.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <span onClick={() => setSummaryOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.1)", border: "1px solid #9FD8AC", borderRadius: 11, padding: "9px 15px", cursor: "pointer" }} data-testid="agent-summary-toggle">
            ✦ Agent summary <span style={{ fontSize: 11, color: "#5C9E6E" }}>{summaryOpen ? "Hide ▴" : "View ▾"}</span>
          </span>
          <span onClick={() => void saveKnowledge()} style={{ fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 18px", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.24)" }} data-testid="save-knowledge">Save knowledge</span>
        </div>
      </div>

      {/* agent summary reveal (dark card) */}
      {summaryOpen ? (
        <div style={{ background: "#0C140F", borderRadius: 18, padding: "20px 22px", marginBottom: 16, color: "#fff", boxShadow: "0 14px 34px rgba(12,20,15,.2)" }} data-testid="agent-summary-card">
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 4 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, flex: "none", background: GRAD, color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>✦</span>
            <span style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 16, flex: 1 }}>Agent summary</span>
            <span onClick={() => setSummaryOpen(false)} style={{ fontSize: 12.5, color: "rgba(255,255,255,.55)", cursor: "pointer" }}>✕ Hide</span>
          </div>
          <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.55)", marginBottom: 6 }}>The synthesized context your agents reason from — every section traces to a source. Edit any section.</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#EFCB68", marginBottom: 13 }}>{PREVIEW_NOTE}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 11 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#7FE8A0", background: "rgba(127,232,160,.12)", borderRadius: 100, padding: "3px 10px" }}>{SUMMARY_DEFAULTS.length} sections</span>
            <span style={{ flex: 1 }} />
            <span onClick={() => setOpenMap(Object.fromEntries(sections.map((s) => [s.id, true])))} style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.6)", cursor: "pointer" }}>Expand all</span>
            <span onClick={() => setOpenMap({})} style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.6)", cursor: "pointer" }}>Collapse all</span>
          </div>
          {sections.map((s) => {
            const open = Boolean(openMap[s.id]);
            const preview = s.body.length > 96 ? `${s.body.slice(0, 95).trim()}…` : s.body;
            const cites = SUMMARY_CITES[s.id] ?? [];
            const isAI = Boolean(SUMMARY_AI[s.id]);
            const isEdited = Boolean(edited[s.id]);
            const openQ = quote && quote.id === s.id ? quote.idx : -1;
            const prov = isEdited ? "✎ edited" : isAI ? "✦ AI-inferred" : `${cites.length} source${cites.length === 1 ? "" : "s"}`;
            const provFg = isEdited ? "#7FE8A0" : isAI ? "#EFCB68" : "rgba(255,255,255,.38)";
            const q = openQ >= 0 ? cites[openQ] : null;
            return (
              <div key={s.id} style={{ border: "1px solid rgba(255,255,255,.10)", borderRadius: 11, marginBottom: 8, overflow: "hidden", background: "rgba(255,255,255,.03)" }} data-testid={`summary-section-${s.id}`}>
                <div onClick={() => setOpenMap((m) => ({ ...m, [s.id]: !m[s.id] }))} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", cursor: "pointer" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: "#0A0F0C", background: GRAD, borderRadius: 6, padding: "3px 6px", flex: "none", fontFamily: "monospace" }}>{s.n}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{s.title}</div>
                    {!open ? <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{preview}</div> : null}
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: provFg, flex: "none" }}>{prov}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)", flex: "none" }}>{open ? "▴" : "▾"}</span>
                </div>
                {open ? (
                  <div style={{ padding: "0 13px 13px" }}>
                    <textarea
                      value={s.body}
                      rows={4}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEdited((m) => ({ ...m, [s.id]: true }));
                        setSections((arr) => arr.map((x) => (x.id === s.id ? { ...x, body: v } : x)));
                      }}
                      style={{ width: "100%", boxSizing: "border-box", borderRadius: 10, border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.06)", padding: "11px 13px", fontSize: 13, lineHeight: 1.55, color: "#fff", fontFamily: HANKEN, resize: "vertical", outline: "none" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
                      {cites.length > 0 && !isAI ? (
                        <>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.4)", flex: "none" }}>Grounded in</span>
                          {cites.map((c, i) => (
                            <span key={c.label} onClick={() => setQuote((cur) => (cur && cur.id === s.id && cur.idx === i ? null : { id: s.id, idx: i }))} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 100, border: `1px solid ${openQ === i ? "#7FE8A0" : "rgba(255,255,255,.16)"}`, background: openQ === i ? "rgba(127,232,160,.1)" : "rgba(255,255,255,.05)", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.75)", cursor: "pointer" }}>
                              <span style={{ fontSize: 10.5 }}>{c.icon}</span>{c.label}
                            </span>
                          ))}
                        </>
                      ) : null}
                      {isAI ? <span style={{ fontSize: 11, fontWeight: 600, color: "#EFCB68" }}>✦ Inferred by AI — no direct source in your docs. Edit to confirm, or add a doc and regenerate.</span> : null}
                      <span style={{ flex: 1 }} />
                      {isEdited ? (
                        <>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,.5)", flex: "none" }}>✎ Edited by you — overrides docs</span>
                          <span
                            onClick={() => {
                              setSections((arr) => arr.map((x) => (x.id === s.id ? { ...x, body: SUMMARY_DEFAULTS.find((d) => d.id === s.id)?.body ?? x.body } : x)));
                              setEdited((m) => ({ ...m, [s.id]: false }));
                            }}
                            style={{ fontSize: 11, fontWeight: 700, color: "#7FE8A0", cursor: "pointer", flex: "none" }}
                          >↺ Revert</span>
                        </>
                      ) : null}
                    </div>
                    {q ? (
                      <div style={{ marginTop: 8, borderLeft: "2px solid #7FE8A0", padding: "1px 0 1px 11px" }}>
                        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.82)", lineHeight: 1.55, fontStyle: "italic" }}>“{q.quote}”</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,.45)" }}>{q.srcLine}</span>
                          <span style={{ flex: 1 }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#7FE8A0", cursor: "pointer", flex: "none" }}>Open source ↗</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 13 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,.45)", flex: 1, minWidth: 0 }}>Auto-generated from your docs, sources, offer &amp; guardrails.</span>
            <span
              onClick={() => {
                setSections(SUMMARY_DEFAULTS.map((s) => ({ ...s })));
                setEdited({});
                setQuote(null);
                toast("Summary regenerated from your knowledge");
              }}
              style={{ fontSize: 13, fontWeight: 600, color: "#7FE8A0", cursor: "pointer", flex: "none" }}
            >↻ Regenerate</span>
            <span onClick={() => toast("Agent summary saved")} style={{ fontSize: 13.5, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 10, padding: "9px 18px", cursor: "pointer", flex: "none" }}>Save summary</span>
          </div>
        </div>
      ) : null}

      {/* company docs & SOPs — WIRED (workspace-scoped knowledge sources) */}
      <div style={sectionCard} data-testid="brand-docs-card">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <span style={{ ...cardTitle16, flex: 1 }}>Company docs &amp; SOPs</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#16A82A", background: "rgba(53,232,52,.1)", borderRadius: 100, padding: "3px 11px" }} data-testid="docs-indexed-pill">{indexedCount} indexed</span>
        </div>
        <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 14 }}>Upload playbooks, SOPs, pricing &amp; FAQs — agents are grounded in everything here.</div>
        <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "1.5px dashed #9FD8AC", borderRadius: 13, padding: 24, textAlign: "center", cursor: "pointer", background: "rgba(53,232,52,.04)", marginBottom: 14, boxSizing: "border-box" }} data-testid="docs-dropzone">
          <input type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.csv,.md" onChange={(e) => { void uploadDocs(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
          <span style={{ fontSize: 24, marginBottom: 7 }}>⬆</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1512" }}>Drag &amp; drop or browse</span>
          <span style={{ fontSize: 12, color: "#9AA59E" }}>PDF, DOCX, XLSX, TXT, MD · up to 25 MB each</span>
        </label>
        {docs === null && !srcError ? (
          <div data-testid="brand-docs-skeleton">
            {[0, 1].map((i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 14px", marginBottom: 8, background: "#FBFAF7" }}>
                <span style={{ width: 36, height: 36, borderRadius: 9, background: "#F2EEE4", flex: "none" }} />
                <div style={{ flex: 1 }}><div style={{ height: 12, width: "42%", background: "#F2EEE4", borderRadius: 6 }} /></div>
              </div>
            ))}
          </div>
        ) : srcError ? (
          <div style={{ padding: "18px 0", textAlign: "center" }} data-testid="brand-docs-error">
            <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 10 }}>Couldn&apos;t load your knowledge sources.</div>
            <span onClick={() => void refresh()} style={{ fontSize: 12.5, fontWeight: 700, color: "#16A82A", cursor: "pointer" }}>Retry</span>
          </div>
        ) : (docs ?? []).length === 0 ? (
          <div style={{ padding: "10px 0 2px", textAlign: "center", color: "#9AA59E", fontSize: 13 }} data-testid="brand-docs-empty">No documents yet — drop your first playbook or SOP above.</div>
        ) : (
          (docs ?? []).map((d) => {
            const name = typeof d.meta?.filename === "string" ? d.meta.filename : d.label;
            const ic = docIcon(name);
            const pill = statusPill(d.status);
            return (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 14px", marginBottom: 8, background: "#FBFAF7" }} data-testid="brand-doc-row">
                <span style={{ width: 36, height: 36, borderRadius: 9, flex: "none", background: ic.iconbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{ic.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</div>
                  <div style={{ fontSize: 12, color: "#9AA59E" }}>{docMeta(d)}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: pill.fg, background: pill.bg, borderRadius: 7, padding: "4px 9px", flex: "none" }}>{pill.label}</span>
                <span onClick={() => void removeSource(d.id)} style={removeBtn} data-testid="brand-doc-remove">✕</span>
              </div>
            );
          })
        )}
      </div>

      {/* connect a source (tiles inert) + web pages (wired) */}
      <div style={sectionCard} data-testid="brand-sources-card">
        <div style={{ ...cardTitle16, marginBottom: 3 }}>Connect a source</div>
        <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 14 }}>Sync knowledge automatically from the tools you already use.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {CONNECT_SOURCES.map((s) => {
            const on = s.connected;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, border: on ? "1.5px solid #9FD8AC" : "1px solid #EBE3D6", borderRadius: 13, padding: "13px 14px", background: on ? "rgba(53,232,52,.04)" : "#fff", boxSizing: "border-box" }} data-testid={`brand-source-${s.id}`}>
                <span style={{ width: 38, height: 38, borderRadius: 10, flex: "none", background: on ? "rgba(53,232,52,.14)" : "#F2EEE4", color: on ? "#16A82A" : "#5C6B62", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, fontFamily: BRICO }}>{s.glyph}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0E1512" }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.desc}</div>
                </div>
                <span
                  onClick={() => toast("Connectors arrive with a later phase")}
                  title="Connectors arrive with a later phase"
                  style={{ fontSize: 12.5, fontWeight: 700, color: on ? "#0F7A28" : "#0A0F0C", background: on ? "#D7F5DD" : GRAD, border: `1px solid ${on ? "#9FD8AC" : "transparent"}`, borderRadius: 9, padding: "7px 12px", cursor: "pointer", flex: "none", whiteSpace: "nowrap" }}
                >{on ? "✓ Connected" : "Connect"}</span>
              </div>
            );
          })}
        </div>
        <div style={{ height: 1, background: "#F2EEE4", margin: "18px 0 14px" }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0E1512", marginBottom: 3 }}>Web pages</div>
        <div style={{ fontSize: 12, color: "#9AA59E", marginBottom: 11 }}>Add any URL — we crawl &amp; index it for your agents.</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 11 }}>
          <input value={webInput} onChange={(e) => setWebInput(e.target.value)} placeholder="example.com/page" style={{ flex: 1, minWidth: 0, height: 42, borderRadius: 10, border: "1px solid #EBE3D6", background: "#fff", padding: "0 13px", fontSize: 13.5, color: "#1192A6", boxSizing: "border-box", outline: "none", fontFamily: HANKEN }} data-testid="web-source-input" />
          <span onClick={() => void addWebSource()} style={{ flex: "none", fontSize: 13.5, fontWeight: 700, color: webValid ? "#0A0F0C" : "#9AA59E", background: webValid ? GRAD : "#ECE7DC", borderRadius: 10, padding: "0 18px", display: "flex", alignItems: "center", cursor: webValid ? "pointer" : "not-allowed" }} data-testid="web-source-add">＋ Add</span>
        </div>
        {(webs ?? []).map((w) => {
          const pill = statusPill(w.status);
          const display = w.label || (w.uri ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
          return (
            <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 11, border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 13px", marginBottom: 7, background: "#FBFAF7" }} data-testid="web-source-row">
              <span style={{ width: 30, height: 30, borderRadius: 8, flex: "none", background: "rgba(54,215,237,.14)", color: "#1192A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⧉</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#1192A6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: pill.fg, background: pill.bg, borderRadius: 7, padding: "4px 9px", flex: "none" }}>{pill.label}</span>
              <span onClick={() => void removeSource(w.id)} style={{ ...removeBtn, width: 30, height: 30, borderRadius: 8 }} data-testid="web-source-remove">✕</span>
            </div>
          );
        })}
      </div>

      {/* description / offer */}
      <div style={sectionCard} data-testid="brand-description-card">
        <label style={{ ...lbl, marginBottom: 7 }}>Company description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={textarea} title="Edits here don\u2019t save yet" data-testid="brand-description" />
        <label style={{ ...lbl, margin: "16px 0 7px" }}>Core offer</label>
        <textarea value={offer} onChange={(e) => setOffer(e.target.value)} rows={2} style={textarea} data-testid="brand-offer" />
      </div>

      {/* guardrails (free-text writing rules — NOT the A8 send-boundary schema) */}
      <div style={sectionCard} data-testid="brand-guardrails-card">
        <div style={{ ...cardTitle16, marginBottom: 3 }}>Guardrails</div>
        <div style={{ fontSize: 12.5, color: "#9AA59E", marginBottom: 6 }}>Rules every agent must follow when writing or speaking. Tag each as Always / Never / Tone.</div>
        <div style={previewNote}>{PREVIEW_NOTE}</div>
        {guardrails.map((g) => {
          const M = GK[g.kind] ?? GK.do!;
          return (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 11, border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 13px", marginBottom: 8, background: "#FBFAF7" }} data-testid="guardrail-row">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: M.fg, background: M.bg, borderRadius: 7, padding: "4px 9px", flex: "none", width: 64, justifyContent: "center", boxSizing: "content-box" }}>{M.icon} {M.label}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#0E1512" }}>{g.text}</span>
              <span onClick={() => setGuardrails((arr) => arr.filter((x) => x.id !== g.id))} style={{ ...removeBtn, width: 30, height: 30, borderRadius: 8 }}>✕</span>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <div style={{ display: "flex", gap: 4, flex: "none", background: "#F2EEE4", borderRadius: 9, padding: 3 }}>
            {(["do", "dont", "tone"] as const).map((k) => {
              const M = GK[k]!;
              const on = gKind === k;
              return (
                <span key={k} onClick={() => setGKind(k)} style={{ fontSize: 12, fontWeight: 700, padding: "6px 11px", borderRadius: 7, cursor: "pointer", color: on ? M.fg : "#5C6B62", background: on ? M.bg : "#fff", border: `1px solid ${on ? M.fg : "#EBE3D6"}`, boxSizing: "border-box" }}>{M.label}</span>
              );
            })}
          </div>
          <input value={gText} onChange={(e) => setGText(e.target.value)} placeholder="Add a rule…" style={{ flex: 1, minWidth: 0, height: 42, borderRadius: 10, border: "1px solid #EBE3D6", background: "#fff", padding: "0 13px", fontSize: 13.5, color: "#0E1512", boxSizing: "border-box", outline: "none", fontFamily: HANKEN }} data-testid="guardrail-input" />
          <span
            onClick={() => { addGuardrail(gKind, gText.trim()); setGText(""); }}
            style={{ flex: "none", fontSize: 13.5, fontWeight: 700, color: gText.trim() ? "#0A0F0C" : "#9AA59E", background: gText.trim() ? GRAD : "#ECE7DC", borderRadius: 10, padding: "0 18px", height: 42, display: "flex", alignItems: "center", cursor: gText.trim() ? "pointer" : "not-allowed", boxSizing: "border-box" }}
          >Add</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 13 }}>
          <span style={{ fontSize: 11.5, color: "#9AA59E", alignSelf: "center" }}>Suggestions:</span>
          {PRESETS.map((p) => (
            <span
              key={p}
              onClick={() => {
                const kind = /^(no |never|don)/i.test(p) ? "dont" : /tone|friendly|warm|concise/i.test(p) ? "tone" : "do";
                addGuardrail(kind, p);
              }}
              style={{ fontSize: 12, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 100, padding: "5px 12px", cursor: "pointer" }}
            >＋ {p}</span>
          ))}
        </div>
      </div>

      {/* brand identity (de-emphasized, local-state inert) */}
      <div style={{ ...sectionCard, padding: "20px 24px", marginBottom: 0 }} data-testid="brand-identity-card">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 15, color: "#0E1512", flex: 1 }}>Brand identity <span style={{ fontSize: 12, fontWeight: 500, color: "#9AA59E" }}>· optional, for branded assets</span></span>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
          <div style={{ flex: "none" }}>
            {logo ? (
              <div style={{ width: 128, height: 78, borderRadius: 11, border: "1px solid #EBE3D6", background: "#FBF7F0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative", boxSizing: "border-box" }}>
                <div style={{ width: "86%", height: "80%", backgroundImage: `url(${logo})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }} />
                <span onClick={() => setLogo(null)} style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 6, background: "rgba(255,255,255,.92)", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#C9543F", fontSize: 11, cursor: "pointer", boxSizing: "border-box" }}>✕</span>
              </div>
            ) : (
              <label style={{ width: 128, height: 78, borderRadius: 11, border: "1.5px dashed #D8CFBE", background: "#FBF7F0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", textAlign: "center", boxSizing: "border-box" }} data-testid="brand-logo-dropzone">
                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setLogo(URL.createObjectURL(f)); toast("Logo uploaded"); } }} style={{ display: "none" }} />
                <span style={{ fontSize: 17, marginBottom: 3 }}>⬆</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#5C6B62" }}>Upload logo</span>
              </label>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {(
                [
                  { key: "primary" as const, label: "Primary" },
                  { key: "accent" as const, label: "Accent" },
                  { key: "ink" as const, label: "Ink" },
                ]
              ).map((c) => (
                <div key={c.key} style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#9AA59E", marginBottom: 4 }}>{c.label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #EBE3D6", borderRadius: 9, padding: "6px 9px", boxSizing: "border-box" }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, flex: "none", background: colors[c.key], border: "1px solid rgba(0,0,0,.08)", boxSizing: "border-box" }} />
                    <input value={colors[c.key]} onChange={(e) => setColors((v) => ({ ...v, [c.key]: e.target.value }))} style={{ border: "none", background: "transparent", fontSize: 12.5, fontFamily: "monospace", color: "#0E1512", flex: 1, minWidth: 0, padding: 0, outline: "none" }} />
                  </div>
                </div>
              ))}
            </div>
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Tagline — one-line positioning…" style={{ width: "100%", height: 40, borderRadius: 9, border: "1px solid #EBE3D6", background: "#fff", padding: "0 12px", fontSize: 13.5, color: "#0E1512", boxSizing: "border-box", outline: "none", fontFamily: HANKEN }} />
          </div>
        </div>
      </div>
    </div>
  );
}
