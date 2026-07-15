"use client";

/**
 * Wizard shared module (W3 commit 0 — pure move from Wizard.tsx).
 * Constants, DTO-shaped interfaces and small components used by more than
 * one wizard step. No behavior change; every literal is the prototype's.
 */

// W3-4 (DEC-076): GRAD + the sequence-editor types moved to the shared
// sequence module (one definition, two hosts); re-exported here so every
// pre-W3-4 wizard import keeps resolving.
export { GRAD, type BriefDraft, type PreviewState } from "../../../components/sequence/shared";
import { CfError, GRAD } from "../../../components/sequence/shared";

// W2 (#94): failures throw the shared CfError — message stays `path: status`
// (existing toasts/matchers untouched); the API's owner-readable `detail`
// rides the object for surfaces that render it (the sub-campaign creator).
export const cf = (path: string, init?: RequestInit) =>
  fetch(`/api/cf/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  }).then(async (r) => {
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { detail?: unknown; message?: unknown } | null;
      const detail =
        typeof body?.detail === "string" ? body.detail : typeof body?.message === "string" ? body.message : null;
      throw new CfError(path, r.status, detail);
    }
    return r.json();
  });

/**
 * B10: sending-schedule timezones. The A8 schema stores the IANA zone; the two
 * display formats are the prototype's own literals — menu rows follow the
 * "(GMT−06:00) Central Time" shape, the closed control follows
 * "America/Chicago (CT)". The prototype shows only the closed control, so the
 * menu anatomy reuses the wizard's existing dropdowns (flagged composition).
 */
export const TZ_OPTIONS = [
  { zone: "UTC", offset: "GMT+00:00", label: "UTC", short: "UTC" },
  { zone: "America/New_York", offset: "GMT−05:00", label: "Eastern Time", short: "ET" },
  { zone: "America/Chicago", offset: "GMT−06:00", label: "Central Time", short: "CT" },
  { zone: "America/Denver", offset: "GMT−07:00", label: "Mountain Time", short: "MT" },
  { zone: "America/Los_Angeles", offset: "GMT−08:00", label: "Pacific Time", short: "PT" },
  { zone: "Europe/London", offset: "GMT+00:00", label: "London", short: "GMT" },
  { zone: "Europe/Berlin", offset: "GMT+01:00", label: "Central Europe", short: "CET" },
  { zone: "Africa/Lagos", offset: "GMT+01:00", label: "Lagos", short: "WAT" },
  { zone: "Asia/Dubai", offset: "GMT+04:00", label: "Dubai", short: "GST" },
  { zone: "Asia/Kolkata", offset: "GMT+05:30", label: "India", short: "IST" },
  { zone: "Asia/Singapore", offset: "GMT+08:00", label: "Singapore", short: "SGT" },
  { zone: "Australia/Sydney", offset: "GMT+10:00", label: "Sydney", short: "AEST" },
] as const;
export const tzShort = (zone: string): string => TZ_OPTIONS.find((t) => t.zone === zone)?.short ?? zone;

/** Building-screen step list, verbatim from the prototype (BSTEPS). */
export const BSTEPS = [
  { icon: "📚", label: "Parsing knowledge base & business context", category: "Knowledge" },
  { icon: "🎯", label: "Identifying target audience & pain points", category: "Analysis" },
  { icon: "⚖", label: "Applying CAN-SPAM, GDPR & compliance rules", category: "Compliance" },
  { icon: "📡", label: "Selecting optimal channel mix for your goal", category: "Strategy" },
  { icon: "✍", label: "Drafting personalised subject lines & hooks", category: "Copy" },
  { icon: "📊", label: "Scoring deliverability & inbox placement", category: "Deliverability" },
  { icon: "⏱", label: "Optimising send timing & sequence cadence", category: "Timing" },
  { icon: "🚀", label: "Generating multi-channel outreach sequence", category: "Build" },
];
export const BUILD_DELAYS = [700, 650, 850, 600, 720, 580, 540, 820];

/** Goal cards, verbatim from the prototype's goalDefs (keys = registry GoalKeys). */
export const GOALS: Array<{ key: string; icon: string; title: string; desc: string }> = [
  { key: "book_appointments", icon: "📅", title: "Book appointments", desc: "Get prospects onto your calendar." },
  { key: "generate_leads", icon: "🎯", title: "Generate leads", desc: "Capture & qualify new leads." },
  { key: "reactivate_leads", icon: "♻", title: "Reactivate leads", desc: "Win back lapsed contacts." },
  { key: "drive_signups", icon: "🚀", title: "Drive sign-ups", desc: "Convert interest into trials." },
  { key: "collect_reviews", icon: "⭐", title: "Collect reviews", desc: "Request reviews from clients." },
  { key: "promote_offer", icon: "🏷", title: "Promote an offer", desc: "Pitch a product, promo or launch." },
  { key: "fill_event", icon: "🎟", title: "Fill an event", desc: "Drive webinar or open-house signups." },
  { key: "upsell_clients", icon: "📈", title: "Upsell clients", desc: "Pitch upgrades to current clients." },
  { key: "custom", icon: "✎", title: "Custom goal", desc: "Describe your own objective." },
];

export interface Citation {
  chunkId: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: string;
  locator: string;
  quote: string;
}
export interface ContextField {
  value: string;
  citations?: Citation[];
  source?: string;
}
export interface KnowledgeSource {
  id: string;
  label: string;
  kind: string;
  status: "PENDING" | "INGESTING" | "READY" | "FAILED";
  uri?: string | null;
  chunkCount?: number;
  meta?: { chunkCount?: number } | null;
}
export interface SenderRow {
  id: string;
  /** SenderType — W2 (#94): the email-vs-TWILIO_SMS scan feeds the creator. */
  type?: string;
  fromEmail: string;
  fromName?: string | null;
  dailyLimit: number;
  status: string;
  sentToday: number;
  domainAuthStatus?: Record<string, unknown> | null;
}
export type AddMode = null | "picker" | "url" | "doc" | "connector";

export interface Gap {
  key: string;
  label: string;
  description?: string;
  state: "open" | "typed" | "ai_decides" | "covered";
}

export const SRC_ICON: Record<string, string> = { WEBSITE: "🌐", DOCUMENT: "📄", TEXT: "📝", CONNECTOR: "🔌" };
export const SRC_KIND_LABEL: Record<string, string> = { WEBSITE: "Website", DOCUMENT: "Document", TEXT: "Pasted text", CONNECTOR: "Connector" };
/** v2: every not-yet-ready state renders amber and never counts as context. */
export const ING_PILL: Record<string, { fg: string; label: string }> = {
  PENDING: { fg: "#D4A020", label: "Queued" },
  INGESTING: { fg: "#D4A020", label: "Ingesting" },
  READY: { fg: "#16A82A", label: "Ready" },
  FAILED: { fg: "#C9543F", label: "Failed" },
};


/** The wizard's step-3 "added contacts" working-set entry (C2.8 49-3). */
export interface AddedContact {
  id: string;
  email: string;
  firstName?: string;
  /** W3-7: the audience-preview rows render name · email · company. */
  lastName?: string;
  company?: string;
  src?: "manual" | "csv";
}

/** DEC-039a manual-drawer row shape (multi-add session queue). */
export interface ManualEntry {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  phone: string;
}
export const EMPTY_MANUAL: ManualEntry = { firstName: "", lastName: "", email: "", company: "", phone: "" };

/**
 * W3-9/W3-10 — step-4 lead-capture working set (visual only in P1: the
 * config persists via draftState, no capture backend exists). `ap: null`
 * means "no explicit choice" — the goal-fit default applies (existing-
 * audience goals default OFF); the user's toggle always overrides.
 */
export interface CaptureState {
  enabled: boolean;
  ap: boolean | null;
  apKeywords: string[];
  apParams: Record<string, string>;
  apSignals: Record<string, boolean>;
  widget: boolean;
  form: boolean;
  embed: boolean;
}
/** Defaults are the prototype's own literals (A12) — keywords start EMPTY
 *  (the proto's dental chips are sample data, never seeded as real config). */
export const DEFAULT_CAPTURE: CaptureState = {
  enabled: true,
  ap: null,
  apKeywords: [],
  apParams: { location: "United States · Canada", industry: "Dental & Orthodontics", size: "1–50 staff", rating: "4.0 ★ +" },
  apSignals: { api: true, news: true, reviews: true, social: true },
  widget: false,
  form: false,
  embed: false,
};

/** DEC-039a drawer micro-caps label + 42px field. */
export const manualLbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 };
export const manualInp: React.CSSProperties = { height: 42, width: "100%", boxSizing: "border-box", borderRadius: 10, background: "#FBF7F0", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", padding: "0 13px", fontSize: 13.5, color: "#0E1512", fontFamily: "'Hanken Grotesk',sans-serif" };
export const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "10px 13px", fontSize: 13.5, color: "#0E1512", marginBottom: 6, fontFamily: "'Hanken Grotesk',sans-serif" };

export function Modal({ title, children, onClose, tid }: { title: string; children: React.ReactNode; onClose: () => void; tid?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(12,20,15,.45)" }} />
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 560, maxWidth: "92vw", background: "#FBF7F0", borderRadius: 18, boxShadow: "0 30px 80px rgba(0,0,0,.32)", overflow: "hidden" }} data-testid={tid}>
        <div style={{ background: "#fff", borderBottom: "1px solid #EBE3D6", padding: "14px 20px", fontSize: 16, fontWeight: 700, color: "#0E1512" }}>{title}</div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

export function ModalActions({ onCancel, onSave, saveLabel = "Save" }: { onCancel: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 8 }}>
      <button type="button" onClick={onCancel} style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", fontSize: 13.5, fontWeight: 600, color: "#0E1512", cursor: "pointer", fontFamily: "'Hanken Grotesk',sans-serif" }}>Cancel</button>
      <button type="button" onClick={onSave} data-testid="modal-save" style={{ background: GRAD, border: "none", borderRadius: 11, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", boxShadow: "0 6px 16px rgba(53,232,52,.26)", fontFamily: "'Hanken Grotesk',sans-serif" }}>{saveLabel}</button>
    </div>
  );
}

export function Stepper({ value, onMinus, onPlus }: { value: string; onMinus: () => void; onPlus: () => void }) {
  const btn: React.CSSProperties = { width: 34, height: 34, borderRadius: 10, border: "1px solid #EBE3D6", background: "#fff", fontSize: 16, cursor: "pointer", color: "#0E1512" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button type="button" onClick={onMinus} style={btn}>−</button>
      <span style={{ minWidth: 90, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{value}</span>
      <button type="button" onClick={onPlus} style={btn}>+</button>
    </div>
  );
}

/** Prototype 44×25 gradient toggle (step-5 sending-behavior rows). */
export function GradToggle({ on, onClick, tid }: { on: boolean; onClick: () => void; tid: string }) {
  return (
    <div onClick={onClick} style={{ width: 44, height: 25, borderRadius: 100, background: on ? GRAD : "#D8CFBE", display: "flex", alignItems: "center", justifyContent: on ? "flex-end" : "flex-start", padding: 3, cursor: "pointer", flex: "none", transition: "background .2s" }} data-testid={tid}>
      <span style={{ width: 19, height: 19, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
    </div>
  );
}

export function LimitCard({ label, value, onMinus, onPlus, tid }: { label: string; value: string; onMinus: () => void; onPlus: () => void; tid: string }) {
  return (
    <div style={{ border: "1px solid #EBE3D6", borderRadius: 13, background: "#fff", padding: "14px 14px" }} data-testid={`limit-${tid}`}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#9AA59E", marginBottom: 10 }}>{label}</div>
      <Stepper value={value} onMinus={onMinus} onPlus={onPlus} />
    </div>
  );
}

export function shiftH(hhmm: string, delta: number): string {
  const [h = 9] = hhmm.split(":").map(Number);
  const nh = Math.min(23, Math.max(0, h + delta));
  return `${String(nh).padStart(2, "0")}:00`;
}
