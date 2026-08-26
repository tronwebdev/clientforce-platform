"use client";

import type {
  AgentListItem,
  BoldActivityRow,
  BoldSendRecipientsResponse,
  CampaignOutcomes,
} from "@clientforce/core";

/**
 * Console Bold — client reads (B1, DEC-104). Everything goes through the
 * shipped `/api/cf/*` proxy (auth + workspace headers server-side); every
 * helper fails soft so a dead endpoint renders honest absence, never a crash.
 */

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/cf/${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const fetchBoldAgents = () => get<AgentListItem[]>("agents");
export const fetchBoldOutcomes = (agentId: string) => get<CampaignOutcomes>(`agents/${agentId}/outcomes`);
export const fetchBoldActivity = (agentId: string, kind?: string, cursor?: string) => {
  const q = new URLSearchParams();
  if (kind && kind !== "all") q.set("kind", kind);
  if (cursor) q.set("cursor", cursor);
  const qs = q.toString();
  return get<{ rows: BoldActivityRow[]; nextCursor: string | null }>(
    `agents/${agentId}/activity${qs ? `?${qs}` : ""}`,
  );
};
export const fetchBoldRecipients = (agentId: string, stepNodeId: string | null, day: string) =>
  get<BoldSendRecipientsResponse>(
    `agents/${agentId}/activity/recipients?day=${day}${stepNodeId ? `&stepNodeId=${encodeURIComponent(stepNodeId)}` : ""}`,
  );
export interface TimelineEvent {
  id: string;
  type: string;
  payload: unknown;
  occurredAt: string;
}

/** The shipped timeline read returns `{ events: [...] }` — unwrap defensively
 *  (this exact shape mismatch crashed the person drawer in review). */
export const fetchContactTimeline = async (contactId: string): Promise<TimelineEvent[] | null> => {
  const res = await get<{ events?: TimelineEvent[] }>(`contacts/${contactId}/timeline`);
  if (!res) return null;
  return Array.isArray(res.events) ? res.events : [];
};

export async function patchAgentValue(
  agentId: string,
  body: { valueEstCents?: number | null; valueGoalUnits?: number | null },
): Promise<boolean> {
  try {
    const res = await fetch(`/api/cf/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- formatting */

export function money(cents: number): string {
  const d = cents / 100;
  if (d >= 100_000) return `$${(d / 1000).toFixed(0)}k`;
  if (d >= 10_000) return `$${(d / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${d.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function contactName(c: { firstName: string | null; lastName: string | null; email: string | null } | null): string {
  if (!c) return "A contact";
  const n = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return n || c.email || "A contact";
}

/** Repo avatar convention (no photo data exists — Q-068): initials + tint. */
export function initials(c: { firstName: string | null; lastName: string | null; email: string | null } | null): string {
  if (!c) return "?";
  const a = c.firstName?.trim().charAt(0) ?? "";
  const b = c.lastName?.trim().charAt(0) ?? "";
  return (a + b || c.email?.charAt(0) || "?").toUpperCase();
}
const AV_TINTS = [
  ["var(--cvb-mint)", "var(--cvb-forest)"],
  ["var(--cvb-cyan-tint)", "var(--cvb-cyan)"],
  ["var(--cvb-slate-tint)", "var(--cvb-slate)"],
  ["var(--cvb-amber-bg)", "var(--cvb-amber)"],
] as const;
export function avTint(key: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AV_TINTS[h % AV_TINTS.length]!;
  return { bg, fg };
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 7 * 24 * 60) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dayGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dayKey = (x: Date) => x.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(d) === dayKey(now)) return "TODAY";
  if (dayKey(d) === dayKey(yesterday)) return "YESTERDAY";
  if (now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000) return "EARLIER THIS WEEK";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

/* ------------------------------------------------- row composition (English) */

/** kind → [chip fg, chip bg, chip border, spine, glyph] — prototype KINDS. */
export const KIND_TONES: Record<string, [string, string, string, string, string]> = {
  goal: ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)", "◷"],
  won: ["#0e5c2b", "#e4f3e9", "#c3e2cf", "#0e5c2b", "✓"],
  reply: ["var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)", "↩"],
  question: ["var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "#36a9c4", "?"],
  objection: ["var(--cvb-danger)", "var(--cvb-danger-bg)", "#f0d5ce", "var(--cvb-danger)", "!"],
  send: ["var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)", "var(--cvb-faint)", "➤"],
  call: ["var(--cvb-slate)", "var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)", "☎"],
  decision: ["var(--cvb-amber)", "var(--cvb-amber-bg)", "var(--cvb-amber-line)", "var(--cvb-dot-amber)", "✦"],
  proposal: ["#5b4a8a", "#f0edf9", "#dcd5ef", "#7a66b5", "◫"],
};

/** Intent → the Bold reply sub-kind (question/objection tones ride replies). */
export function replyTone(intent: string | null): keyof typeof KIND_TONES {
  if (intent === "question" || intent === "info_request") return "question";
  if (intent === "objection_price" || intent === "objection_timing" || intent === "not_interested" || intent === "not")
    return "objection";
  return "reply";
}

export interface ComposedRow {
  row: BoldActivityRow;
  tone: keyof typeof KIND_TONES;
  chip: string;
  body: string;
  value: string | null;
}

const INTENT_LINE: Record<string, string> = {
  interested: "replied — interested",
  replied: "replied",
  question: "asked a question",
  info_request: "asked a question",
  objection_price: "raised a price objection",
  objection_timing: "said not right now",
  not: "said not now",
  not_interested: "is not interested",
  wrong_person: "is the wrong person",
  ooo: "is out of office",
  unsubscribe: "unsubscribed",
  booked: "booked",
};

/** Compose one factual English line from a data row — nothing invented. */
export function composeRow(row: BoldActivityRow, stepLabel?: string): ComposedRow {
  const name = contactName(row.contact);
  switch (row.kind) {
    case "goal":
      return {
        row,
        tone: "goal",
        chip: row.goalLabel ?? "Goal met",
        body: `${name} — ${row.goalLabel ?? "reached the goal"}.`,
        value: null,
      };
    case "won":
      return {
        row,
        tone: "won",
        chip: "Paid",
        body: `Payment received — ${name}.`,
        value: row.amountCents != null ? money(row.amountCents) : null,
      };
    case "reply": {
      const tone = replyTone(row.intent);
      return {
        row,
        tone,
        chip: tone === "question" ? "Question" : tone === "objection" ? "Objection" : "Reply",
        body: `${name} ${INTENT_LINE[row.intent ?? ""] ?? "replied"}.`,
        value: null,
      };
    }
    case "send":
      return {
        row,
        tone: "send",
        chip: "Send",
        body: `Sent to ${row.count ?? 0} ${row.channel === "sms" ? "by SMS" : "by email"}${stepLabel ? ` — ${stepLabel}` : ""}.`,
        value: null,
      };
    case "proposal":
      return { row, tone: "proposal", chip: "Proposal", body: `Proposal activity — ${name}.`, value: null };
    case "call":
      return { row, tone: "call", chip: "Call", body: `Call with ${name}.`, value: null };
    case "decision":
      return {
        row,
        tone: "decision",
        chip: "Decision",
        body: `Held ${name} back${row.reason ? ` — ${row.reason}` : ""}.`,
        value: null,
      };
  }
}
