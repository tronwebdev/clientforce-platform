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
    const [ctx, agents, senders, members, invites, guard, credits, ints, sources, numbers, profile] =
      await Promise.all([
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
  if (passing.length === entries.length) return { state: "verified", line: `${names.join(", ")} all pass` };
  const failing = entries.filter(([, v]) => v?.status === "failed").map(([k]) => k.toUpperCase());
  if (failing.length > 0)
    return { state: "pending", line: `${failing.join(" and ")} still to publish` };
  return { state: "unchecked", line: "The last check could not run" };
}

/** Warm-up percentage where a ramp exists — null means no ramp, not zero. */
export function warmupPercent(senders: BoldSenderRow[] | null): number | null {
  const ramping = (senders ?? []).filter((s) => s.warmup != null);
  if (ramping.length === 0) return null;
  const worst = ramping.reduce((a, b) => ((a.warmup?.pct ?? 100) <= (b.warmup?.pct ?? 100) ? a : b));
  return worst.warmup?.pct ?? null;
}

export function pluralise(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
