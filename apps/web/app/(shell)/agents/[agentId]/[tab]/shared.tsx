/** Shared bits for the Agent view tabs (C2.4). */

export const GRAD = "linear-gradient(135deg,#36D7ED 0%,#35E834 55%,#D0F56B 100%)";

/** Same goal→emoji map as the Agents List (C2.2 icon table). */
export const GOAL_EMOJI: Record<string, string> = {
  book_appointments: "📅",
  generate_leads: "🎯",
  reactivate_leads: "♻",
  drive_signups: "🚀",
  collect_reviews: "⭐",
  custom: "✎",
};

export const cf = (path: string, init?: RequestInit) =>
  fetch(`/api/cf/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  });

/** Intent → Inbox category chip (prototype `inboxCatDefs`, DEC-034 label set). */
export const INBOX_CATS = [
  { id: "all", label: "All" },
  { id: "interested", label: "Interested" },
  { id: "booked", label: "Meeting booked" },
  { id: "replied", label: "Replied" },
  { id: "question", label: "Question" },
  { id: "not", label: "Not interested" },
  { id: "ooo", label: "Auto-reply" },
] as const;

/** Category chip tint per intent (thread rows + reading pane). */
export const CAT_TINT: Record<string, { fg: string; bg: string; label: string }> = {
  interested: { fg: "#0F7A28", bg: "#D7F5DD", label: "Interested" },
  booked: { fg: "#1192A6", bg: "rgba(54,215,237,.16)", label: "Meeting booked" },
  replied: { fg: "#5C6B62", bg: "#F2EEE4", label: "Replied" },
  question: { fg: "#A87B16", bg: "rgba(232,196,91,.2)", label: "Question" },
  not: { fg: "#C9543F", bg: "rgba(224,121,107,.14)", label: "Not interested" },
  ooo: { fg: "#8A7F6B", bg: "#F2EEE4", label: "Auto-reply" },
  unsubscribe: { fg: "#C9543F", bg: "rgba(224,121,107,.14)", label: "Unsubscribed" },
};

export function initials(first?: string | null, last?: string | null, email?: string | null): string {
  const a = (first ?? "").trim()[0] ?? "";
  const b = (last ?? "").trim()[0] ?? "";
  return (a + b || (email ?? "?").slice(0, 2)).toUpperCase();
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const AV_TINTS = ["rgba(53,232,52,.16)", "rgba(54,215,237,.16)", "rgba(208,245,107,.3)", "#F2EEE4"];
export function avTint(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AV_TINTS[Math.abs(h) % AV_TINTS.length]!;
}
