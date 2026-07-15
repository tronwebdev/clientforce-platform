import { cookies } from "next/headers";
import type {
  AdoptionSummary,
  BackofficeAgencyRow,
  BackofficeAuditRow,
  BackofficeStaff,
  FleetHealthView,
  KillSwitchRow,
  ReconciliationRow,
  VersionPins,
} from "@clientforce/core";
import { API_URL, STAFF_SESSION_COOKIE } from "./config";

/**
 * Server-side backoffice client (B1 W1, DEC-079). Translates the httpOnly
 * `cf_staff_session` cookie into a Bearer token against the NestJS
 * `/backoffice/*` API. This is the operator rail — it never touches the tenant
 * `cf_session` cookie or `x-workspace-id`.
 */
async function staffHeaders(): Promise<Record<string, string> | null> {
  const store = await cookies();
  const token = store.get(STAFF_SESSION_COOKIE)?.value;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export async function fetchStaff(): Promise<BackofficeStaff | null> {
  const headers = await staffHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/backoffice/me`, { headers, cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as BackofficeStaff;
}

export async function fetchAgencies(q?: string): Promise<BackofficeAgencyRow[]> {
  const headers = await staffHeaders();
  if (!headers) return [];
  const url = new URL(`${API_URL}/backoffice/agencies`);
  if (q) url.searchParams.set("q", q);
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as BackofficeAgencyRow[];
}

export async function fetchAuditLog(): Promise<BackofficeAuditRow[]> {
  const headers = await staffHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/backoffice/audit-log`, { headers, cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as BackofficeAuditRow[];
}

export async function fetchReconciliation(): Promise<ReconciliationRow[]> {
  const headers = await staffHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/backoffice/reconciliation`, { headers, cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as ReconciliationRow[];
}

export async function fetchAdoption(): Promise<AdoptionSummary | null> {
  const headers = await staffHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/backoffice/adoption`, { headers, cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as AdoptionSummary;
}

// ── B1 W4 (DEC-082): fleet health · version pins · kill switches ──────────────

export async function fetchFleetHealth(): Promise<FleetHealthView | null> {
  const headers = await staffHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/backoffice/fleet-health`, { headers, cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as FleetHealthView;
}

export async function fetchVersionPins(): Promise<VersionPins | null> {
  const headers = await staffHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/backoffice/version-pins`, { headers, cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as VersionPins;
}

export async function fetchKillSwitches(): Promise<KillSwitchRow[]> {
  const headers = await staffHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/backoffice/kill-switches`, { headers, cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as KillSwitchRow[];
}
