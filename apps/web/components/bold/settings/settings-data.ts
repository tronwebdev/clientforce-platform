"use client";

/**
 * One load for the whole settings family (SURFACE_SPEC_SETTINGS §3–§8).
 *
 * The hub's pills, the four item pages and their ✦ notes all read the SAME
 * snapshot, so the hub can never say "2 gaps" while the page inside it shows
 * three. Every field is nullable and every reader treats null as "not known
 * yet" rather than zero — a count the server could not compute must render as
 * an honest absence, never as a number that happens to be 0.
 */
import { useCallback, useEffect, useState } from "react";
import { CONTEXT_FIELD_META, isWorkspaceFactKey } from "@clientforce/core";
import {
  fetchBoldAgents,
  fetchCreditsSummary,
  fetchGapReport,
  fetchGuardrailDefaults,
  fetchSenders,
  fetchWorkspaceMembers,
  get,
  type BoldGapItem,
  type BoldSenderRow,
  type CreditsSummary,
  type GuardrailDefaultsView,
  type WorkspaceMemberRow,
} from "../bold-live";
import {
  fetchInvites,
  fetchNumberRequests,
  fetchWorkspaceSources,
  type InviteRow,
  type NumberRequestRow,
  type WorkspaceContextField,
  type WorkspaceSourceRow,
} from "../bold-settings-live";

export interface GapUnionRow extends BoldGapItem {
  /** Which live campaigns are missing it — the honest "who needs this". */
  campaigns: string[];
}

export interface SettingsSnapshot {
  fields: WorkspaceContextField[] | null;
  touchedAt: string | null;
  /** The most recently changed field's label, for the LAST TOUCHED stat. */
  touchedLabel: string | null;
  gaps: GapUnionRow[] | null;
  sources: WorkspaceSourceRow[] | null;
  senders: BoldSenderRow[] | null;
  numbers: NumberRequestRow[] | null;
  members: WorkspaceMemberRow[] | null;
  invites: InviteRow[] | null;
  guard: GuardrailDefaultsView | null;
  credits: CreditsSummary | null;
  connectedIntegrations: number | null;
  /** The workspace's own id — the mono record line at each page's foot. */
  workspaceId: string | null;
  workspaceName: string | null;
  /** Shape + vertical, read-only here; the lead brief owns writing them. */
  icpShape: string | null;
  icpVertical: string | null;
}

const EMPTY: SettingsSnapshot = {
  fields: null,
  touchedAt: null,
  touchedLabel: null,
  gaps: null,
  sources: null,
  senders: null,
  numbers: null,
  members: null,
  invites: null,
  guard: null,
  credits: null,
  connectedIntegrations: null,
  workspaceId: null,
  workspaceName: null,
  icpShape: null,
  icpVertical: null,
};

interface ContextRead {
  workspace?: {
    fields?: Record<string, { value?: string; source?: string; label?: string }>;
    updatedAt?: string;
  } | null;
}

export function useSettingsData(): { data: SettingsSnapshot; reload: () => Promise<void> } {
  const [data, setData] = useState<SettingsSnapshot>(EMPTY);

  const reload = useCallback(async () => {
    const [
      ctx,
      agents,
      senders,
      members,
      invites,
      guard,
      credits,
      ints,
      sources,
      numbers,
      profile,
    ] = await Promise.all([
      get<ContextRead>("context"),
      fetchBoldAgents(),
      fetchSenders(),
      fetchWorkspaceMembers(),
      fetchInvites(),
      fetchGuardrailDefaults(),
      fetchCreditsSummary(),
      get<{ integrations?: Array<{ status?: string }> }>("integrations"),
      fetchWorkspaceSources(),
      fetchNumberRequests(),
      get<{
        id: string;
        name: string;
        icpProfile: { shape?: string; vertical?: string } | null;
      }>("workspaces/profile"),
    ]);

    const raw = ctx?.workspace?.fields ?? {};
    const fields: WorkspaceContextField[] = Object.entries(raw)
      .filter(([, v]) => (v?.value ?? "").trim().length > 0)
      .map(([key, v]) => ({
        key,
        // A taught fact carries its own question; a registry field uses the
        // registry's label; an unknown key shows its key rather than vanishing.
        label:
          v.label ??
          (CONTEXT_FIELD_META as Record<string, { label: string } | undefined>)[key]?.label ??
          key,
        value: v.value ?? "",
        source: (v.source as WorkspaceContextField["source"]) ?? "typed",
        taught: isWorkspaceFactKey(key),
      }));

    // Gaps are goal-relative, so the workspace-level truth is the UNION over
    // the campaigns that are actually live: "what your live campaigns miss".
    const live = (agents ?? []).filter((a) => a.status === "ACTIVE" || a.status === "PAUSED");
    const reports = await Promise.all(live.map((a) => fetchGapReport(a.id, a.goal)));
    const union = new Map<string, GapUnionRow>();
    reports.forEach((rep, i) => {
      for (const g of rep?.gaps ?? []) {
        if (g.status !== "open") continue;
        const prior = union.get(g.key);
        if (prior) prior.campaigns.push(live[i]!.name);
        else union.set(g.key, { ...g, campaigns: [live[i]!.name] });
      }
    });

    setData({
      fields,
      touchedAt: ctx?.workspace?.updatedAt ?? null,
      touchedLabel: fields.length > 0 ? (fields[fields.length - 1]!.label ?? null) : null,
      gaps: [...union.values()],
      sources: sources ?? [],
      senders: senders ?? [],
      numbers: numbers ?? [],
      members: members ?? [],
      invites: invites ?? [],
      guard,
      credits,
      connectedIntegrations: ints
        ? (ints.integrations ?? []).filter((s) => s.status === "connected").length
        : null,
      workspaceId: profile?.id ?? null,
      workspaceName: profile?.name ?? null,
      icpShape: profile?.icpProfile?.shape ?? null,
      icpVertical: profile?.icpProfile?.vertical ?? null,
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, reload };
}

/* ------------------------------------------------------------- derivations */

export const emailSenders = (s: BoldSenderRow[] | null) =>
  (s ?? []).filter((x) => x.type !== "TWILIO_SMS");
export const smsSenders = (s: BoldSenderRow[] | null) =>
  (s ?? []).filter((x) => x.type === "TWILIO_SMS");

/** Verified only when a check said so — never inherited, never assumed. */
export function dnsPosture(s: BoldSenderRow): {
  state: "verified" | "pending" | "unchecked";
  line: string;
} {
  const st = (s.domainAuthStatus ?? {}) as Record<string, { status?: string; pass?: boolean }>;
  const entries = Object.entries(st);
  if (entries.length === 0) return { state: "unchecked", line: "Not checked yet" };
  const names = entries.map(([k]) => k.toUpperCase());
  const passing = entries.filter(([, v]) => v?.status === "verified" || v?.pass === true);
  if (passing.length === entries.length)
    return { state: "verified", line: `${names.join(", ")} all pass` };
  const failing = entries.filter(([, v]) => v?.status === "failed").map(([k]) => k.toUpperCase());
  if (failing.length > 0)
    return { state: "pending", line: `${failing.join(" and ")} still to publish` };
  return { state: "unchecked", line: "The last check could not run" };
}

/** Warm-up percentage where a ramp exists — null means no ramp, not zero. */
export function warmupPercent(senders: BoldSenderRow[] | null): number | null {
  const ramping = (senders ?? []).filter((s) => s.warmup != null);
  if (ramping.length === 0) return null;
  const worst = ramping.reduce((a, b) =>
    (a.warmup?.pct ?? 100) <= (b.warmup?.pct ?? 100) ? a : b,
  );
  return worst.warmup?.pct ?? null;
}

/**
 * "last Tuesday" — when a source was last read, in the prototype's register.
 *
 * The prototype's source sub-line is `Read weekly · 9 pages · last Tuesday`
 * (dc.html ITEMS['ws:core'].sources), and B7.5 dropped the date half of it.
 * The owner called this out directly (REDO §1.2: "Include WHEN IT WAS LAST
 * READ; yield may follow it") — a knowledge source whose freshness you cannot
 * see is a source you cannot trust.
 *
 * Nothing here is invented: `updatedAt` is on the row already. Naming the
 * weekday inside the last week is how a person says it; beyond that a weekday
 * stops being unambiguous, so it degrades to a count of weeks and then to a
 * plain date.
 */
export function lastReadPhrase(iso: string, now: Date = new Date()): string | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `last ${then.toLocaleDateString("en-US", { weekday: "long" })}`;
  if (days < 14) return "a week ago";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return then.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export function pluralise(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The prototype's number style in PROSE: small counts are spelled out
 * ("Two email domains and one number", "Two people plus Ada"), and digits are
 * reserved for measurements and large numbers ("82%", "2,340 left"). Pills are
 * digits in both, so this is only for sub-lines.
 *
 * Ten is the conventional cut-off, and above it a digit reads better anyway.
 */
const SPELLED = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

export function spellCount(n: number, one: string, many: string): string {
  const word = n >= 0 && n <= 10 ? SPELLED[n]! : n.toLocaleString("en-US");
  return `${word} ${n === 1 ? one : many}`;
}

/** Same, capitalised — for a count that opens a sentence. */
export function spellCountLead(n: number, one: string, many: string): string {
  const said = spellCount(n, one, many);
  return `${said[0]!.toUpperCase()}${said.slice(1)}`;
}

/**
 * How many distinct DOMAINS the email senders span. The hub counts domains,
 * not sender rows — the prototype says "Two email domains" and the Senders
 * stat strip agrees (`EMAIL DOMAINS 2`). Two mailboxes on one domain is one
 * domain, and calling that "two" on the hub is simply wrong.
 */
export function domainCount(addresses: Array<string | null | undefined>): number {
  const domains = new Set<string>();
  for (const a of addresses) {
    const at = a?.lastIndexOf("@") ?? -1;
    if (a && at > 0) domains.add(a.slice(at + 1).toLowerCase());
  }
  return domains.size;
}
