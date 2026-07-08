import { cache } from "react";
import { cookies } from "next/headers";
import { API_URL, WORKSPACE_COOKIE } from "./config";
import { bearerToken } from "./auth-token";
import type { AgentListItem } from "@clientforce/core";
import type { Contact, Me } from "./types";

async function authHeaders(): Promise<Record<string, string> | null> {
  const store = await cookies();
  const token = await bearerToken();
  if (!token) return null;
  const workspace = store.get(WORKSPACE_COOKIE)?.value;
  return {
    Authorization: `Bearer ${token}`,
    ...(workspace ? { "x-workspace-id": workspace } : {}),
  };
}

/** Fetch the current user + memberships + active workspace. Null if unauthenticated.
 *  Request-cached so the layout and page share a single call. */
export const fetchMe = cache(async (): Promise<Me | { noWorkspace: true } | null> => {
  const headers = await authHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/me`, { headers, cache: "no-store" });
  // A3 (DEC-060): a freshly signed-up principal is authenticated but has no
  // membership — the api answers 403 code NO_WORKSPACE and the shell shows
  // the first-run "Create workspace" modal instead of bouncing to login.
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "NO_WORKSPACE") return { noWorkspace: true };
    return null;
  }
  if (!res.ok) return null;
  return (await res.json()) as Me;
});

/** Fetch contacts in the active workspace (RLS-scoped server-side). */
export async function fetchContacts(): Promise<Contact[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/contacts`, { headers, cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as Contact[];
}

/** Fetch agents with live metrics (C2.2, RLS-scoped server-side). */
export async function fetchAgents(): Promise<AgentListItem[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/agents`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`GET /agents failed: ${res.status}`);
  return (await res.json()) as AgentListItem[];
}
