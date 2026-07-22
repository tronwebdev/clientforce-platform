"use client";

/**
 * Logs tab (checkpoints §4) — the campaign-scoped event feed: every persisted
 * Event row typed + timestamped, newest first. A4: 5s polling. Empty state has
 * no prototype anchor (flagged in the spec) — §0 convention copy used.
 */
import { useCallback, useEffect, useState } from "react";
import { cf, intentTint, meetingTime } from "./shared";

interface LogEvent {
  id: string;
  type: string;
  contact: { firstName: string | null; lastName: string | null; email: string | null } | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

const LOG_ROW: Record<string, { icon: string; bg: string; fg: string }> = {
  "lead.enrolled.v1": { icon: "+", bg: "#F2EEE4", fg: "#8A7F6B" },
  "email.sent.v1": { icon: "✉", bg: "#F2EEE4", fg: "#8A7F6B" },
  "email.delivered.v1": { icon: "✓", bg: "#F2EEE4", fg: "#8A7F6B" },
  "email.opened.v1": { icon: "◔", bg: "#F2EEE4", fg: "#8A7F6B" },
  "email.clicked.v1": { icon: "🔗", bg: "rgba(54,215,237,.16)", fg: "#1192A6" },
  "email.replied.v1": { icon: "↩", bg: "rgba(53,232,52,.16)", fg: "#16A82A" },
  "email.bounced.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F" },
  "email.spam_reported.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F" },
  // G2 (DEC-071): the guided-email compose-refusal amber row (sms twin below).
  "email.compose_refused.v1": { icon: "⚠", bg: "rgba(232,196,91,.2)", fg: "#9A6B12" },
  "lead.stage_changed.v1": { icon: "✦", bg: "rgba(53,232,52,.16)", fg: "#16A82A" },
  "lead.unsubscribed.v1": { icon: "⊘", bg: "rgba(224,121,107,.16)", fg: "#C9543F" },
  // P2.1 sms rows (carry-along: the Logs feed rendered raw sms.* slugs —
  // DEC-057's no-slug rule) + the G1 compose-refusal amber row (DEC-070).
  "sms.sent.v1": { icon: "✆", bg: "#F2EEE4", fg: "#8A7F6B" },
  "sms.delivered.v1": { icon: "✓", bg: "#F2EEE4", fg: "#8A7F6B" },
  "sms.failed.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F" },
  "sms.replied.v1": { icon: "💬", bg: "rgba(54,215,237,.16)", fg: "#1192A6" },
  "sms.opted_out.v1": { icon: "⊘", bg: "rgba(224,121,107,.16)", fg: "#C9543F" },
  "sms.compose_refused.v1": { icon: "⚠", bg: "rgba(232,196,91,.2)", fg: "#9A6B12" },
  // P3.1 (DEC-078): voice — ☎ maps to lucide `phone` (icon table).
  "call.started.v1": { icon: "☎", bg: "rgba(53,232,52,.14)", fg: "#0F7A28" },
  "call.completed.v1": { icon: "☎", bg: "rgba(53,232,52,.14)", fg: "#0F7A28" },
  "call.failed.v1": { icon: "⚠", bg: "rgba(224,121,107,.14)", fg: "#C9543F" },
  "call.refused.v1": { icon: "⊘", bg: "rgba(232,196,91,.2)", fg: "#9A6B12" },
  "voice.compose_refused.v1": { icon: "⚠", bg: "rgba(232,196,91,.2)", fg: "#9A6B12" },
  // LH1 W3 (DEC-087): the enrollment gate's typed refusal — a red row (the
  // contact never entered the sequence; unlike compose refusals nothing is
  // paused, because nothing was enrolled).
  "contact.enrollment_refused.v1": { icon: "⊘", bg: "rgba(224,121,107,.14)", fg: "#C9543F" },
  // INT W2 (DEC-094): calendar rows — booked green · rescheduled neutral ·
  // canceled red (the LeadsTab EVENT_ROW twins).
  "calendar.booked.v1": { icon: "📅", bg: "rgba(53,232,52,.16)", fg: "#16A82A" },
  "calendar.rescheduled.v1": { icon: "⟳", bg: "#F2EEE4", fg: "#8A7F6B" },
  "calendar.canceled.v1": { icon: "✕", bg: "rgba(224,121,107,.16)", fg: "#C9543F" },
  // INT W3 (DEC-095): the payment record row.
  "payment.received.v1": { icon: "💳", bg: "rgba(53,232,52,.16)", fg: "#16A82A" },
};

/** Minor-units → display ("$500.00"); unknown currency falls back to the code. */
function moneyLabel(amount: unknown, currency: unknown): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "";
  const code = typeof currency === "string" && currency ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`;
  }
}

function describe(e: LogEvent): string {
  const who = [e.contact?.firstName, e.contact?.lastName].filter(Boolean).join(" ") || e.contact?.email || "a lead";
  const p = e.payload ?? {};
  switch (e.type) {
    case "lead.enrolled.v1": return `${who} enrolled in the sequence.`;
    case "email.sent.v1": return `Step email sent to ${who}${p.subject ? ` — “${String(p.subject)}”` : ""}.`;
    case "email.delivered.v1": return `Email delivered to ${who}.`;
    case "email.opened.v1": return `${who} opened${p.subject ? ` “${String(p.subject)}”` : " an email"}.`;
    case "email.clicked.v1": return `${who} clicked a link.`;
    case "email.replied.v1": return `Reply received from ${who}${p.intent ? ` — classified “${intentTint(String(p.intent)).label}”` : ""}.`;
    case "email.bounced.v1": return `Email to ${who} hard-bounced.`;
    case "email.spam_reported.v1": return `${who} reported the email as spam.`;
    case "email.compose_refused.v1": return `Composer refused the email for ${who} — ${String(p.reason ?? "checks failed")}${p.detail ? ` (${String(p.detail)})` : ""}. The lead is paused; nothing was sent.`;
    case "lead.stage_changed.v1": return `${who} moved ${p.fromStage ? `from ${String(p.fromStage)} ` : ""}to ${String(p.toStage ?? "a new stage")}${p.manual ? " (manual move)" : ""}.`;
    case "lead.unsubscribed.v1": return `${who} unsubscribed — suppressed from all sequences.`;
    case "sms.sent.v1": return `Step SMS sent to ${who}.`;
    case "sms.delivered.v1": return `SMS delivered to ${who}.`;
    case "sms.failed.v1": return `SMS to ${who} failed${p.reason ? ` — ${String(p.reason)}` : ""}.`;
    case "sms.replied.v1": return `${who} replied by SMS${p.intent ? ` — classified “${String(p.intent)}”` : ""}.`;
    case "sms.opted_out.v1": return `${who} replied STOP — suppressed for SMS.`;
    case "sms.compose_refused.v1": return `Composer refused the SMS for ${who} — ${String(p.reason ?? "checks failed")}${p.detail ? ` (${String(p.detail)})` : ""}. The lead is paused; nothing was sent.`;
    case "call.started.v1": return `AI call to ${who} connected.`;
    case "call.completed.v1": return `AI call with ${who} completed${p.durationSec ? ` — ${Math.floor(Number(p.durationSec) / 60)}:${String(Number(p.durationSec) % 60).padStart(2, "0")}` : ""}. Transcript in the Calls tab.`;
    case "call.failed.v1": return `AI call to ${who} didn't complete${p.reason ? ` — ${String(p.reason).replace(/_/g, " ")}` : ""}.`;
    case "call.refused.v1": return `Dial to ${who} refused — ${String(p.reason ?? "rails blocked it")}. Nothing was dialed.`;
    case "voice.compose_refused.v1": return `A spoken turn for ${who} tripped its checks — ${String(p.reason ?? "check failed")}; the agent used the fallback line and the call continued.`;
    case "contact.enrollment_refused.v1": return `Enrollment refused for ${who} — ${p.reason === "CONTACT_INVALID" ? "invalid email address (list hygiene)" : String(p.reason ?? "refused")}${p.detail ? ` (${String(p.detail)})` : ""}. Nothing was enrolled or sent.`;
    // INT W2 (DEC-094): calendar copy — times render LOCAL from the payload.
    case "calendar.booked.v1": { const t = meetingTime(p.startAt); return `Meeting booked with ${who}${t ? ` — ${t}` : ""}.`; }
    case "calendar.rescheduled.v1": { const t = meetingTime(p.toStartAt); return `Meeting with ${who} rescheduled${t ? ` — now ${t}` : ""}.`; }
    case "calendar.canceled.v1": { const t = meetingTime(p.startAt); return p.reason === "no_show" ? `${who} didn't show for the meeting${t ? ` (${t})` : ""}.` : `Meeting with ${who} canceled${t ? ` (was ${t})` : ""}.`; }
    case "payment.received.v1": { const m = moneyLabel(p.amount, p.currency); return `Payment received from ${who}${m ? ` — ${m}` : ""}.`; }
    default: return `${e.type} — ${who}`;
  }
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (d.toDateString() === today.toDateString()) return `Today, ${d.toLocaleTimeString([], opts)}`;
  const yest = new Date(today.getTime() - 86400_000);
  if (d.toDateString() === yest.toDateString()) return `Yesterday, ${d.toLocaleTimeString([], opts)}`;
  return `${d.toLocaleDateString([], { weekday: "short" })}, ${d.toLocaleTimeString([], opts)}`;
}

export function LogsTab({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<LogEvent[] | null>(null);

  const refresh = useCallback(async () => {
    const res = await cf(`agents/${agentId}/events`).catch(() => null);
    if (res) setEvents(res.events as LogEvent[]);
  }, [agentId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000); // A4
    return () => clearInterval(t);
  }, [refresh]);

  if (events === null) {
    return (
      <div style={{ maxWidth: 760 }} data-testid="logs-skeleton">
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: "#F2EEE4", flex: "none" }} />
            <div style={{ flex: 1, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "13px 16px" }}>
              <div style={{ height: 11, width: "60%", background: "#F2EEE4", borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: "64px 20px", textAlign: "center" }} data-testid="logs-empty">
        <div style={{ fontSize: 26, marginBottom: 10 }}>≣</div>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20, color: "#0E1512", marginBottom: 6 }}>No activity yet</div>
        <div style={{ fontSize: 13.5, color: "#8A7F6B" }}>Every send, open, reply and stage move lands here the moment it happens.</div>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 760 }} data-testid="logs">
      {events.map((e, i) => {
        const row = LOG_ROW[e.type] ?? { icon: "•", bg: "#F2EEE4", fg: "#8A7F6B" };
        return (
          <div key={e.id} style={{ display: "flex", gap: 16 }} data-testid="log-row">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: row.bg, color: row.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flex: "none" }}>{row.icon}</span>
              {i < events.length - 1 ? <span style={{ width: 2, flex: 1, background: "#E6E0D4" }} /> : null}
            </div>
            <div style={{ paddingBottom: 20, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#16A82A", marginBottom: 6 }}>{stamp(e.occurredAt)}</div>
              <div style={{ fontSize: 14.5, color: "#3B463F", lineHeight: 1.5, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "13px 16px", boxShadow: "0 2px 8px rgba(14,21,18,.03)" }}>{describe(e)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
