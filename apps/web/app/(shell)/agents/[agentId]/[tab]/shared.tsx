/** Shared bits for the Agent view tabs (C2.4). Plain module (no "use client")
 * so the server route can import TABS for validation. */

import { CfError } from "../../../../../components/sequence/shared";

export const TABS = [
  { id: "inbox", label: "Inbox", icon: "✉", wired: true },
  // P3.1 (DEC-078): the voice channel shipped — Calls goes live.
  { id: "calls", label: "Calls", icon: "☎", wired: true },
  { id: "steps", label: "Steps", icon: "⋔", wired: true },
  { id: "leads", label: "Leads", icon: "☺", wired: true },
  { id: "preview", label: "Preview", icon: "◉", wired: false },
  { id: "stats", label: "Stats", icon: "▤", wired: false },
  { id: "settings", label: "Settings", icon: "⚙", wired: true },
  { id: "logs", label: "Logs", icon: "≣", wired: true },
] as const;

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

/** Intent → Inbox category chips + per-intent tints: the ONE vocabulary
 *  module (M1b, DEC-068 — prototype `inboxCatDefs` + designed M1b labels,
 *  verbatim fallback for unknown intents). Re-exported for the tab imports. */
export { INBOX_CATS, INTENT_TINT, intentTint, branchWhenLabel } from "../../../../../lib/intents";

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
