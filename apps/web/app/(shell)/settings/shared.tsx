"use client";

/**
 * Shared chrome for the workspace Settings screen (C2.6, checkpoints §6) —
 * ported from `Settings.dc.html`. Style consts are prototype literals; the
 * connect-flow drawer lives here because both the Channels sections
 * (email/mailer) and the inert Phone/WhatsApp sections open it.
 */
import { useState, type CSSProperties, type ReactNode } from "react";

export const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";
export const BRICO = "'Bricolage Grotesque',sans-serif";
export const HANKEN = "'Hanken Grotesk',sans-serif";

export const cf = (path: string, init?: RequestInit) =>
  fetch(`/api/cf/${path}`, { headers: { "Content-Type": "application/json" }, ...init }).then(
    async (r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    },
  );

/** Recurring status-pill color pairs (spec §6.2 — inline per-row literals in the prototype). */
export const PAIR = {
  good: { fg: "#0F7A28", bg: "#D7F5DD" },
  warn: { fg: "#A87B16", bg: "rgba(232,196,91,.18)" },
  bad: { fg: "#C9543F", bg: "rgba(224,121,107,.16)" },
  neutral: { fg: "#8A7F6B", bg: "#F2EEE4" },
  cyan: { fg: "#1192A6", bg: "rgba(54,215,237,.16)" },
} as const;
export type Pair = { fg: string; bg: string };

/** White section card (global section-card idiom). */
export const sectionCard: CSSProperties = { background: "#fff", border: "1px solid #EBE3D6", borderRadius: 18, padding: "22px 24px", boxShadow: "0 4px 16px rgba(14,21,18,.04)", marginBottom: 16, boxSizing: "border-box" };
/** Table card (overflow hidden, header row separate). */
export const tableCard: CSSProperties = { background: "#fff", border: "1px solid #EBE3D6", borderRadius: 18, boxShadow: "0 4px 16px rgba(14,21,18,.04)", overflow: "hidden" };
export const theadRow = (grid: string, small?: boolean): CSSProperties => ({ display: "grid", gridTemplateColumns: grid, padding: "11px 22px", background: "#FBF7F0", borderBottom: "1px solid #EBE3D6", fontSize: small ? 11.5 : 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".02em", color: "#5C6B62" });
export const tbodyRow = (grid: string): CSSProperties => ({ display: "grid", gridTemplateColumns: grid, padding: "13px 22px", borderTop: "1px solid #F2EEE4", alignItems: "center" });

export const cardTitle: CSSProperties = { fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512" };
export const sectionHead: CSSProperties = { fontFamily: BRICO, fontWeight: 700, fontSize: 18, color: "#0E1512" };
export const sectionSub: CSSProperties = { fontSize: 13, color: "#9AA59E" };
export const microLabel: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#9AA59E" };

export const gradBtn: CSSProperties = { fontSize: 14, fontWeight: 700, color: "#0A0F0C", background: GRAD, borderRadius: 11, padding: "10px 18px", cursor: "pointer" };
export const secondaryBtn: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 16px", cursor: "pointer" };
/** Real-input field styles (Contacts add-drawer idiom + prototype literals). */
export const lbl: CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#5C6B62", marginBottom: 6 };
export const inp: CSSProperties = { width: "100%", boxSizing: "border-box", height: 46, borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", padding: "0 14px", fontSize: 14, color: "#0E1512", fontFamily: HANKEN, outline: "none" };

/** "Jun 18" — the prototype's `added` literal shape, from a live ISO date. */
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ── live sender shape (GET /api/cf/senders) ────────────────────────────────

/** Persisted health snapshot (P5 W1 `healthState`, DEC-083 amended shape). */
export interface SenderHealth {
  score: number | null;
  state: "healthy" | "unhealthy" | "low_data";
  band: "healthy" | "watch" | "at_risk" | "paused" | null;
  floor: "none" | "low" | "ok";
  windowDays: number;
  computedAt: string;
  sample: { sent: number; delivered: number; bounced: number; spam: number; replied: number };
  rates: { bounce: number; spam: number; delivery: number | null; reply: number } | null;
}

/** Warmup projection (P5 W1 `warmupProgressFor`). */
export interface SenderWarmup {
  active: boolean;
  day: number;
  days: number;
  currentCap: number;
  target: number;
  pct: number;
  holding: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface Sender {
  id: string;
  type: string;
  fromEmail: string;
  fromName: string | null;
  replyTo?: string | null;
  status: string;
  domainAuthStatus: Record<string, unknown> | null;
  dailyLimit: number;
  sentToday: number;
  warmupState: Record<string, unknown> | null;
  dedicatedIp: string | null;
  createdAt: string;
  /** P5 W2 (DEC-084): additive read-model fields from the list endpoint. */
  health: SenderHealth | null;
  warmup: SenderWarmup | null;
}

export type AuthState = "verified" | "failed" | "unchecked";
export interface AuthRow {
  key: "SPF" | "DKIM" | "DMARC";
  status: AuthState;
  pass: boolean;
  detail: string | null;
  /** Copyable record to publish — present on failed rows (P5 W1 checker). */
  expected: string | null;
}

/**
 * Parse `domainAuthStatus` Json — the P5-W1 checker's `{ status, pass,
 * detail, expected }` records, plus every legacy shape (booleans, bare
 * `{ pass, detail }`). An ABSENT record is `unchecked` (never checked ≠
 * failed — the never-fake-a-fail rule), matching the checker's own state.
 */
export function authRows(s: Sender): AuthRow[] {
  const auth = (s.domainAuthStatus ?? {}) as Record<string, unknown>;
  return (["spf", "dkim", "dmarc"] as const).map((k) => {
    const v = auth[k];
    const obj = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
    const status: AuthState =
      obj?.status === "verified" || obj?.status === "failed" || obj?.status === "unchecked"
        ? obj.status
        : v === true || obj?.pass === true
          ? "verified"
          : v === false || obj?.pass === false
            ? "failed"
            : "unchecked";
    const detail =
      obj && typeof obj.detail === "string" ? obj.detail : obj && typeof obj.record === "string" ? obj.record : null;
    const expected = obj && typeof obj.expected === "string" ? obj.expected : null;
    return { key: k.toUpperCase() as AuthRow["key"], status, pass: status === "verified", detail, expected };
  });
}
export const authPasses = (s: Sender) => authRows(s).filter((r) => r.pass).length;

/** Gmail/Outlook/SMTP envelope logo (inline SVG, prototype literal). */
export function EnvelopeLogo({ fill, size }: { fill: string; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" fill={fill} />
      <path d="M3.5 7.5l8.5 5.5 8.5-5.5" stroke="#fff" strokeWidth="1.7" fill="none" />
    </svg>
  );
}

// ── toast ───────────────────────────────────────────────────────────────────

/**
 * Toast — prototype chrome (#0C140F, 22px ✓ dot, dismiss ✕) but positioned
 * bottom-center per the §0 convention (the prototype renders it top-right;
 * logged deviation — house precedent: AgentsTable.tsx toast).
 */
export function Toast({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  if (!msg) return null;
  return (
    <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 60, display: "flex", alignItems: "center", gap: 11, background: "#0C140F", color: "#fff", borderRadius: 12, padding: "12px 16px", boxShadow: "0 16px 40px rgba(0,0,0,.3)" }} data-testid="toast">
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#35E834", color: "#0A0F0C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flex: "none" }}>✓</span>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{msg}</span>
      <span onClick={onDismiss} style={{ marginLeft: 8, color: "rgba(255,255,255,.5)", cursor: "pointer" }}>✕</span>
    </div>
  );
}

// ── §0 loading / error states (additive — none modeled in the prototype) ────

export function SkeletonRows({ testid, rows = 3 }: { testid: string; rows?: number }) {
  return (
    <div data-testid={testid}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "14px 22px", borderTop: i ? "1px solid #F2EEE4" : "none", alignItems: "center" }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: "#F2EEE4", flex: "none" }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 12, width: "34%", background: "#F2EEE4", borderRadius: 6, marginBottom: 7 }} />
            <div style={{ height: 10, width: "52%", background: "#F7F2EA", borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ what, onRetry, testid }: { what: string; onRetry: () => void; testid: string }) {
  return (
    <div style={{ padding: "48px 20px", textAlign: "center" }} data-testid={testid}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", marginBottom: 4 }}>Couldn&apos;t load {what}</div>
      <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 14 }}>Something went wrong talking to the API — your data is safe.</div>
      <button type="button" onClick={onRetry} style={{ background: GRAD, border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#0A0F0C", cursor: "pointer", fontFamily: HANKEN }}>Retry</button>
    </div>
  );
}

// ── modal + drawer chrome ───────────────────────────────────────────────────

export function ModalShell({ width, title, onClose, children, footer, testid }: { width: number; title: string; onClose: () => void; children: ReactNode; footer: ReactNode; testid?: string }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 40px 90px rgba(0,0,0,.45)", overflow: "hidden" }} data-testid={testid}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid #EBE3D6" }}>
          <span style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>{title}</span>
          <span onClick={onClose} style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", boxSizing: "border-box" }}>✕</span>
        </div>
        {children}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6" }}>{footer}</div>
      </div>
    </div>
  );
}

export function DrawerShell({ width, title, onClose, children, footer, z, shadow, testid }: { width: number; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; z: number; shadow: string; testid?: string }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(12,20,15,.45)", zIndex: z }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width, maxWidth: "100%", background: "#FBF7F0", boxShadow: shadow, display: "flex", flexDirection: "column" }} data-testid={testid}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 22px", background: "#fff", borderBottom: "1px solid #EBE3D6", flex: "none" }}>
          <span style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>{title}</span>
          <span onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA59E", cursor: "pointer", boxSizing: "border-box" }}>✕</span>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

// ── connect / add flows (spec §3.6 FLOWS map, verbatim) ─────────────────────

export type FlowField = { label: string; ph: string; sel?: boolean; pw?: boolean };
export type FlowStep =
  | { kind: "auth"; title: string; authLabel: string; perms: string[] }
  // P3.1 (DEC-078): `spoken` marks the optional workspace-default spoken-name
  // step of the number flows (owner-locked capture moment a — D0 holds: the
  // wizard never grows a field). Live in the twilio path; the buy path shows
  // the same step as designed placeholders.
  | { kind: "fields"; title: string; cta?: string; verify?: boolean; spoken?: boolean; fields: FlowField[] }
  | { kind: "select"; title: string; selects: { label: string; value: string }[] }
  | { kind: "dns"; title: string; records: { type: string; host: string; value: string }[] }
  | { kind: "summary"; title: string; cta?: string; summary: string[] };
export interface FlowProvider { id: string; glyph: string; tbg: string; tfg: string; name: string; desc: string }
export interface FlowDef { title: string; chooserTitle?: string; single?: string; providers?: FlowProvider[]; steps: Record<string, FlowStep[]> }

const DNS: FlowStep = { kind: "dns", title: "Authenticate your domain (DKIM)", records: [{ type: "TXT", host: "@", value: "v=spf1 include:cf-mail.co ~all" }, { type: "CNAME", host: "cf._domainkey", value: "cf._domainkey.cf-mail.co" }, { type: "TXT", host: "_dmarc", value: "v=DMARC1; p=none;" }] };

export const FLOWS: Record<string, FlowDef> = {
  email: {
    title: "Connect email account",
    chooserTitle: "How do you want to send email?",
    providers: [
      { id: "gmail", glyph: "G", tbg: "rgba(208,245,107,.45)", tfg: "#6B7A1F", name: "Google / Gmail", desc: "Gmail or Workspace via OAuth" },
      { id: "outlook", glyph: "O", tbg: "rgba(54,215,237,.16)", tfg: "#1192A6", name: "Microsoft 365 / Outlook", desc: "Outlook.com or Microsoft 365" },
      { id: "exchange", glyph: "E", tbg: "rgba(54,215,237,.16)", tfg: "#1192A6", name: "Exchange", desc: "Microsoft Exchange via OAuth" },
      { id: "custom", glyph: "@", tbg: "#F2EEE4", tfg: "#5C6B62", name: "Custom IMAP / SMTP", desc: "Any provider with IMAP + SMTP" },
      { id: "mailer", glyph: "cf", tbg: "rgba(53,232,52,.16)", tfg: "#16A82A", name: "Clientforce Mailer", desc: "Managed sending, zero setup" },
    ],
    steps: {
      gmail: [{ kind: "auth", title: "Authorize Google", authLabel: "Sign in with Google", perms: ["Send email on your behalf", "Read reply metadata", "Manage sending limits & warm-up"] }, DNS, { kind: "summary", title: "Connected", summary: ["Authorized via Google OAuth", "Open & reply tracking on", "Warm-up enabled"] }],
      outlook: [{ kind: "auth", title: "Authorize Microsoft", authLabel: "Sign in with Microsoft", perms: ["Send mail as you", "Read reply metadata"] }, DNS, { kind: "summary", title: "Connected", summary: ["Authorized via Microsoft OAuth", "Open & reply tracking on"] }],
      exchange: [{ kind: "auth", title: "Authorize Exchange", authLabel: "Sign in with Microsoft", perms: ["Send mail as you", "Read reply metadata"] }, DNS, { kind: "summary", title: "Connected", summary: ["Authorized via Microsoft OAuth", "Open & reply tracking on"] }],
      custom: [
        { kind: "fields", title: "Sending server (SMTP)", verify: true, fields: [{ label: "From email", ph: "you@domain.com" }, { label: "Sender name", ph: "Jordan at BrightPath" }, { label: "SMTP host", ph: "smtp.domain.com" }, { label: "Port", ph: "587" }, { label: "Encryption", ph: "TLS", sel: true }, { label: "Username", ph: "you@domain.com" }, { label: "Password", ph: "app password", pw: true }] },
        { kind: "fields", title: "Receiving server (IMAP)", verify: true, fields: [{ label: "IMAP host", ph: "imap.domain.com" }, { label: "Port", ph: "993" }, { label: "Username", ph: "you@domain.com" }, { label: "Password", ph: "app password", pw: true }] },
        DNS,
        { kind: "summary", title: "Verified & ready", summary: ["SMTP verified", "IMAP verified", "Sending from you@domain.com"] },
      ],
      mailer: [{ kind: "summary", title: "Use Clientforce Mailer", cta: "Set up Mailer", summary: ["No mailbox required", "Managed deliverability & warm-up", "Add a sending domain to begin"] }],
    },
  },
  phone: {
    title: "Add a phone number",
    chooserTitle: "How do you want to add a number?",
    providers: [
      // P2.1 (DEC-061): the LIVE SMS path — creates a real TWILIO_SMS sender.
      { id: "twilio", glyph: "✆", tbg: "rgba(53,232,52,.16)", tfg: "#16A82A", name: "Connect a Twilio number", desc: "A number + messaging service you already run" },
      { id: "buy", glyph: "#", tbg: "rgba(54,215,237,.16)", tfg: "#1192A6", name: "Buy a number", desc: "Search & provision a new number" },
      { id: "port", glyph: "~", tbg: "rgba(232,196,91,.2)", tfg: "#A87B16", name: "Port an existing number", desc: "Bring your current number over" },
    ],
    steps: {
      twilio: [
        { kind: "fields", title: "Twilio SMS sender", fields: [{ label: "Phone number", ph: "+15125550148" }, { label: "Label", ph: "Clinic SMS" }, { label: "Messaging service SID", ph: "MG0123456789abcdef0123456789abcdef" }] },
        // P3.1 (DEC-078, owner-locked capture): optional workspace default —
        // blank = the "an AI assistant" default wording, no blocked calls.
        { kind: "fields", title: "Who should calls say they are?", cta: "Add SMS sender", spoken: true, fields: [{ label: "Spoken name (optional)", ph: "Ava — leave blank for “an AI assistant”" }] },
      ],
      buy: [
        { kind: "fields", title: "Search numbers", cta: "Search", fields: [{ label: "Country", ph: "United States", sel: true }, { label: "Area code or prefix", ph: "512" }, { label: "Capabilities", ph: "Voice & WhatsApp", sel: true }] },
        { kind: "select", title: "Pick a number", selects: [{ label: "Available number", value: "+1 (512) 555-0148" }, { label: "Capabilities", value: "Voice, SMS & WhatsApp" }] },
        { kind: "fields", title: "Who should calls say they are?", spoken: true, fields: [{ label: "Spoken name (optional)", ph: "Ava — leave blank for “an AI assistant”" }] },
        { kind: "summary", title: "Confirm purchase", cta: "Buy number", summary: ["+1 (512) 555-0148", "Voice, SMS & WhatsApp", "$1.15 / mo plus usage"] },
      ],
      port: [
        { kind: "fields", title: "Number to port", fields: [{ label: "Phone number", ph: "+1 (512) 555-0100" }, { label: "Current carrier", ph: "Twilio", sel: true }, { label: "Account number", ph: "Carrier account #" }, { label: "Account PIN", ph: "PIN", pw: true }] },
        { kind: "fields", title: "Authorization", fields: [{ label: "Authorized name", ph: "Jordan Mensah" }, { label: "Letter of authorization", ph: "Upload LOA (PDF)" }] },
        { kind: "summary", title: "Submit request", cta: "Submit port request", summary: ["Porting takes 7-10 business days", "Number stays active until ported"] },
      ],
    },
  },
  whatsapp: {
    title: "Add WhatsApp sender",
    chooserTitle: "How do you want to connect WhatsApp?",
    providers: [
      { id: "meta", glyph: "f", tbg: "rgba(54,215,237,.16)", tfg: "#1192A6", name: "Meta embedded signup", desc: "Fastest, via Facebook Business" },
      { id: "twilio", glyph: "T", tbg: "rgba(208,245,107,.45)", tfg: "#6B7A1F", name: "Connect via Twilio", desc: "Use your Twilio WhatsApp sender" },
      { id: "manual", glyph: "@", tbg: "#F2EEE4", tfg: "#5C6B62", name: "Manual (Cloud API)", desc: "Phone number ID & token" },
    ],
    steps: {
      meta: [{ kind: "auth", title: "Connect Meta", authLabel: "Continue with Facebook", perms: ["Manage your WhatsApp Business account", "Send & receive messages"] }, { kind: "select", title: "Choose sender", selects: [{ label: "WhatsApp Business account", value: "BrightPath Growth" }, { label: "Phone number", value: "+1 (512) 555-0100" }, { label: "Display name", value: "BrightPath Growth" }] }, { kind: "summary", title: "Submitted for review", cta: "Finish", summary: ["Meta reviews display name (~1 day)", "Messaging enabled once approved"] }],
      twilio: [{ kind: "fields", title: "Twilio credentials", verify: true, fields: [{ label: "Account SID", ph: "AC0000000000000000" }, { label: "Auth token", ph: "your auth token", pw: true }, { label: "WhatsApp number", ph: "+1 (512) 555-0100" }] }, { kind: "summary", title: "Connected", cta: "Finish", summary: ["Sending via Twilio", "Inbound replies enabled"] }],
      manual: [{ kind: "fields", title: "Cloud API details", fields: [{ label: "Phone number ID", ph: "106600000000000" }, { label: "WABA ID", ph: "209900000000000" }, { label: "System user token", ph: "EAAG...", pw: true }] }, { kind: "summary", title: "Connected", cta: "Finish", summary: ["Cloud API connected", "Webhook verified"] }],
    },
  },
  mailer: {
    title: "Add mailer sender",
    single: "sender",
    steps: {
      sender: [
        { kind: "fields", title: "Sender identity", cta: "Continue", fields: [{ label: "From address", ph: "you@mail.brightpathgrowth.co" }, { label: "Display name", ph: "You at BrightPath" }] },
        { kind: "dns", title: "Verify your domain", records: [{ type: "TXT", host: "@", value: "v=spf1 include:cf-mail.co ~all" }, { type: "CNAME", host: "cf._domainkey", value: "cf._domainkey.cf-mail.co" }, { type: "TXT", host: "_dmarc", value: "v=DMARC1; p=none;" }] },
        { kind: "summary", title: "Sender ready", cta: "Add sender", summary: ["SPF, DKIM & DMARC verified", "Managed warm-up active", "Sender available to agents"] },
      ],
    },
  },
};

const COMING_SOON = "Coming soon — Clientforce Mailer is the live tier this phase";

function providerLogo(id: string, size: number, glyph: string) {
  if (id === "gmail") return <EnvelopeLogo fill="#EA4335" size={size} />;
  if (id === "outlook" || id === "exchange") return <EnvelopeLogo fill="#0F6CBD" size={size} />;
  if (id === "custom") return <EnvelopeLogo fill="#7A8A80" size={size} />;
  return <>{glyph}</>;
}

/**
 * Connect-flow drawer (480px). The `mailer` flow is LIVE — its final "Add
 * sender" posts a CF_MANAGED sender. Every other provider renders its
 * designed steps with an inert final submit (the API rejects non-CF_MANAGED
 * by design). Picking "Clientforce Mailer" in the email chooser hands off to
 * the live mailer sender flow (logged interpretation — the prototype's toast
 * there was a dead end for the one live tier).
 */
export function ConnectFlowDrawer({ channel, onClose, toast, onMailerCreated }: { channel: "email" | "phone" | "whatsapp" | "mailer"; onClose: () => void; toast: (m: string) => void; onMailerCreated?: () => void | Promise<void> }) {
  const [ch, setCh] = useState(channel);
  const [prov, setProv] = useState<string | null>(FLOWS[channel]?.single ?? null);
  const [step, setStep] = useState(0);
  const [verified, setVerified] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  // P2.1 (DEC-061): live Twilio SMS sender inputs.
  const [smsPhone, setSmsPhone] = useState("");
  const [smsLabel, setSmsLabel] = useState("");
  const [smsSid, setSmsSid] = useState("");
  // P3.1 (DEC-078): the optional workspace-default spoken name (capture a).
  const [voiceName, setVoiceName] = useState("");
  const [busy, setBusy] = useState(false);

  const def = FLOWS[ch];
  if (!def) return null;
  const steps = prov ? (def.steps[prov] ?? null) : null;
  const cur = steps ? steps[Math.min(step, steps.length - 1)] : null;
  const provObj = def.providers?.find((p) => p.id === prov) ?? null;
  const isMailerLive = ch === "mailer";
  const isSmsLive = ch === "phone" && prov === "twilio";
  const last = steps ? step >= steps.length - 1 : false;
  const emailValid = /.+@.+\..+/.test(fromEmail);
  const smsValid = /^\+[1-9]\d{6,14}$/.test(smsPhone.trim()) && smsLabel.trim().length > 0 && /^MG[a-zA-Z0-9]{32}$/.test(smsSid.trim());
  const mailerGateClosed = (isMailerLive && cur?.kind === "fields" && !emailValid) || (isSmsLive && cur?.kind === "fields" && !smsValid);

  const pick = (id: string) => {
    if (ch === "email" && id === "mailer") {
      // Live tier hand-off: the email chooser's Mailer card leads straight
      // into the CF_MANAGED sender flow instead of the prototype's dead end.
      setCh("mailer");
      setProv("sender");
    } else {
      setProv(id);
    }
    setStep(0);
    setVerified(false);
  };

  const primary = () => {
    if (!steps || !cur) return;
    if (!last) {
      setStep(step + 1);
      setVerified(false);
      return;
    }
    if (isMailerLive) {
      if (busy) return;
      setBusy(true);
      cf("senders", { method: "POST", body: JSON.stringify({ type: "CF_MANAGED", fromEmail: fromEmail.trim(), ...(fromName.trim() ? { fromName: fromName.trim() } : {}) }) })
        .then(async () => {
          await onMailerCreated?.();
          onClose();
          toast(`${def.title} — complete`);
        })
        .catch(() => toast("Couldn’t add the sender — check the from address and try again."))
        .finally(() => setBusy(false));
      return;
    }
    if (isSmsLive) {
      // P2.1 (DEC-061): this flow actually creates the TWILIO_SMS sender.
      // P3.1 (DEC-078): a non-blank spoken name additionally seeds the
      // workspace default (blank = default wording — never blocks the add).
      if (busy) return;
      setBusy(true);
      cf("senders", { method: "POST", body: JSON.stringify({ type: "TWILIO_SMS", phone: smsPhone.trim(), fromName: smsLabel.trim(), messagingServiceSid: smsSid.trim() }) })
        .then(async () => {
          if (voiceName.trim()) {
            await cf("voice/defaults", { method: "PATCH", body: JSON.stringify({ spokenName: voiceName.trim() }) }).catch(() =>
              toast("Number added, but the spoken name was rejected — use a plain first name (no titles)."),
            );
          }
          await onMailerCreated?.();
          onClose();
          toast("SMS sender added — Twilio number connected");
        })
        .catch(() => toast("Couldn’t add the SMS sender — check the number and messaging service SID."))
        .finally(() => setBusy(false));
      return;
    }
    toast(COMING_SOON);
  };
  const back = () => {
    if (step > 0) {
      setStep(step - 1);
      setVerified(false);
    } else if (!def.single && prov) {
      setProv(null);
    } else {
      onClose();
    }
  };
  const backLabel = step > 0 || (!def.single && prov) ? "‹ Back" : "Cancel";
  const primaryLabel = cur?.kind !== undefined && "cta" in (cur ?? {}) && (cur as { cta?: string }).cta ? (cur as { cta?: string }).cta! : last ? "Finish" : "Continue";

  const fieldPill: CSSProperties = { display: "flex", alignItems: "center", borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", padding: "11px 14px", fontSize: 14, color: "#B7BDB6", boxSizing: "border-box" };
  const verifyBtn: CSSProperties = { textAlign: "center", fontSize: 13.5, fontWeight: 700, color: "#0E1512", background: "#fff", border: "1.5px solid #16A82A", borderRadius: 11, padding: 11, cursor: "pointer" };
  const verifiedBanner = (msg: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(53,232,52,.08)", border: "1px solid rgba(53,232,52,.3)", borderRadius: 11, padding: "11px 14px" }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#16A82A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flex: "none" }}>✓</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#16A82A" }}>{msg}</span>
    </div>
  );

  return (
    <DrawerShell width={480} title={def.title} onClose={onClose} z={58} shadow="-24px 0 70px rgba(0,0,0,.28)" testid="connect-drawer"
      footer={
        prov ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 22px", borderTop: "1px solid #EBE3D6", background: "#fff", flex: "none" }}>
            <span onClick={back} style={{ fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }} data-testid="flow-back">{backLabel}</span>
            <span
              onClick={() => { if (!mailerGateClosed) primary(); }}
              title={!isMailerLive && last ? COMING_SOON : undefined}
              style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: mailerGateClosed ? "#9AA59E" : "#0A0F0C", background: mailerGateClosed ? "#ECE7DC" : GRAD, borderRadius: 11, padding: "10px 20px", cursor: mailerGateClosed ? "not-allowed" : "pointer", boxShadow: mailerGateClosed ? "none" : "0 6px 16px rgba(53,232,52,.26)" }}
              data-testid="flow-primary"
            >{busy ? "Adding…" : primaryLabel}</span>
          </div>
        ) : undefined
      }
    >
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "20px 22px" }}>
        {!prov ? (
          <div data-testid="connect-chooser">
            <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 14 }}>{def.chooserTitle ?? "Choose an option"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(def.providers ?? []).map((p) => (
                <div key={p.id} onClick={() => pick(p.id)} style={{ display: "flex", alignItems: "center", gap: 13, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "14px 16px", cursor: "pointer" }} data-testid={`connect-provider-${p.id}`}>
                  <span style={{ width: 42, height: 42, borderRadius: 11, flex: "none", background: p.tbg, color: p.tfg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BRICO, fontWeight: 800, fontSize: 16 }}>{providerLogo(p.id, 22, p.glyph)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, color: "#9AA59E" }}>{p.desc}</div>
                  </div>
                  <span style={{ color: "#C9CFC9", fontSize: 18 }}>›</span>
                </div>
              ))}
            </div>
          </div>
        ) : steps && cur ? (
          <div data-testid="connect-step">
            <span style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em" }}>Step {step + 1} of {steps.length}</span>
            <div style={{ display: "flex", gap: 5, margin: "8px 0 18px" }}>
              {steps.map((_, i) => (
                <span key={i} style={{ flex: 1, height: 5, borderRadius: 100, background: i <= step ? "#16A82A" : "#E4EAE6" }} />
              ))}
            </div>
            <div style={{ fontFamily: BRICO, fontWeight: 700, fontSize: 17, color: "#0E1512", marginBottom: 14 }}>{cur.title}</div>

            {cur.kind === "auth" ? (
              <>
                <div onClick={primary} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#0C140F", color: "#fff", borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>
                  <span style={{ width: 24, height: 24, borderRadius: 7, background: provObj?.tbg ?? "rgba(53,232,52,.16)", color: provObj?.tfg ?? "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BRICO, fontWeight: 800, fontSize: 12 }}>{providerLogo(prov ?? "", 16, provObj?.glyph ?? "cf")}</span>
                  {cur.authLabel}
                </div>
                {cur.perms.length > 0 ? (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7F6B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Clientforce will be able to</div>
                    <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden" }}>
                      {cur.perms.map((pm) => (
                        <div key={pm} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderTop: "1px solid #F2EEE4" }}>
                          <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                          <span style={{ fontSize: 13, color: "#3B463F" }}>{pm}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {cur.kind === "fields" ? (
              cur.spoken && isSmsLive ? (
                <>
                  {/* P3.1 (DEC-078): the LIVE optional spoken-name capture. */}
                  <div style={{ marginBottom: 13 }}>
                    <label style={lbl}>Spoken name (optional)</label>
                    <input value={voiceName} onChange={(e) => setVoiceName(e.target.value)} placeholder="Ava — leave blank for “an AI assistant”" style={{ ...inp, height: 44 }} data-testid="voice-spoken-name" />
                  </div>
                  <div style={{ fontSize: 12, color: "#8A7F6B", lineHeight: 1.5 }}>
                    AI calls open with “Hi, this is {voiceName.trim() ? voiceName.trim() + ", an AI assistant" : "an AI assistant"} calling on behalf of…”. A plain first name only — agents can override it in their Voice settings.
                  </div>
                </>
              ) : isSmsLive ? (
                <>
                  {/* live inputs — this flow actually creates the SMS sender */}
                  <div style={{ marginBottom: 13 }}>
                    <label style={lbl}>Phone number (E.164)</label>
                    <input value={smsPhone} onChange={(e) => setSmsPhone(e.target.value)} placeholder="+15125550148" style={{ ...inp, height: 44 }} data-testid="sms-phone" />
                  </div>
                  <div style={{ marginBottom: 13 }}>
                    <label style={lbl}>Label</label>
                    <input value={smsLabel} onChange={(e) => setSmsLabel(e.target.value)} placeholder="Clinic SMS" style={{ ...inp, height: 44 }} data-testid="sms-label" />
                  </div>
                  <div style={{ marginBottom: 13 }}>
                    <label style={lbl}>Messaging service SID</label>
                    <input value={smsSid} onChange={(e) => setSmsSid(e.target.value)} placeholder="MG0123456789abcdef0123456789abcdef" style={{ ...inp, height: 44 }} data-testid="sms-sid" />
                  </div>
                  <div style={{ fontSize: 12, color: "#8A7F6B", lineHeight: 1.5 }}>
                    Advanced Opt-Out must be ON for this messaging service — STOP replies also suppress here automatically (double rail).
                  </div>
                </>
              ) : isMailerLive ? (
                <>
                  {/* live inputs — this flow actually creates the sender */}
                  <div style={{ marginBottom: 13 }}>
                    <label style={lbl}>From address</label>
                    <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="you@mail.brightpathgrowth.co" style={{ ...inp, height: 44 }} data-testid="mailer-from-email" />
                  </div>
                  <div style={{ marginBottom: 13 }}>
                    <label style={lbl}>Display name</label>
                    <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="You at BrightPath" style={{ ...inp, height: 44 }} data-testid="mailer-from-name" />
                  </div>
                </>
              ) : (
                <>
                  {cur.fields.map((fl) => (
                    <div key={fl.label} style={{ marginBottom: 13 }}>
                      <label style={lbl}>{fl.label}</label>
                      <div style={fieldPill}>
                        {fl.ph}
                        {fl.sel ? <span style={{ marginLeft: "auto", color: "#9AA59E" }}>⌄</span> : null}
                      </div>
                    </div>
                  ))}
                  {cur.verify ? (
                    verified ? verifiedBanner("Connection verified") : (
                      <div onClick={() => setVerified(true)} style={{ ...verifyBtn, marginTop: 4 }}>Verify settings</div>
                    )
                  ) : null}
                </>
              )
            ) : null}

            {cur.kind === "select" ? cur.selects.map((se) => (
              <div key={se.label} style={{ marginBottom: 13 }}>
                <label style={lbl}>{se.label}</label>
                <div style={{ ...fieldPill, color: "#0E1512", fontWeight: 600 }}>
                  {se.value}
                  <span style={{ marginLeft: "auto", color: "#9AA59E" }}>⌄</span>
                </div>
              </div>
            )) : null}

            {cur.kind === "dns" ? (
              <>
                <div style={{ fontSize: 13, color: "#8A7F6B", marginBottom: 12 }}>Add these records at your DNS provider, then verify.</div>
                <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 13, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: ".7fr 1fr 1.6fr", padding: "9px 14px", background: "#FBF7F0", borderBottom: "1px solid #EBE3D6", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#8A7F6B" }}><span>Type</span><span>Host</span><span>Value</span></div>
                  {cur.records.map((rc) => (
                    <div key={rc.host + rc.type} style={{ display: "grid", gridTemplateColumns: ".7fr 1fr 1.6fr", padding: "10px 14px", borderTop: "1px solid #F2EEE4", fontFamily: "monospace", fontSize: 11.5, color: "#3B463F" }}>
                      <span style={{ fontWeight: 700, color: "#0E1512" }}>{rc.type}</span>
                      <span>{rc.host}</span>
                      <span style={{ wordBreak: "break-all" }}>{rc.value}</span>
                    </div>
                  ))}
                </div>
                {verified ? verifiedBanner("DNS verified — SPF, DKIM & DMARC OK") : (
                  <div onClick={() => setVerified(true)} style={verifyBtn}>Verify DNS records</div>
                )}
              </>
            ) : null}

            {cur.kind === "summary" ? (
              <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, overflow: "hidden" }}>
                {cur.summary.map((sm) => (
                  <div key={sm} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 15px", borderTop: "1px solid #F2EEE4" }}>
                    <span style={{ color: "#16A82A", fontSize: 13 }}>✓</span>
                    <span style={{ fontSize: 13.5, color: "#3B463F" }}>{sm}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </DrawerShell>
  );
}
