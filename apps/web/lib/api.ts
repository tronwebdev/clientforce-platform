import { cache } from "react";
import { cookies } from "next/headers";
import { API_URL, SESSION_COOKIE, WORKSPACE_COOKIE } from "./config";
import type { Contact, Me } from "./types";

async function authHeaders(): Promise<Record<string, string> | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const workspace = store.get(WORKSPACE_COOKIE)?.value;
  return {
    Authorization: `Bearer ${token}`,
    ...(workspace ? { "x-workspace-id": workspace } : {}),
  };
}

/** Fetch the current user + memberships + active workspace. Null if unauthenticated.
 *  Request-cached so the layout and page share a single call. */
export const fetchMe = cache(async (): Promise<Me | null> => {
  const headers = await authHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/me`, { headers, cache: "no-store" });
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
