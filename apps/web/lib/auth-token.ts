import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./config";
import { clerkEnabled } from "./clerk";

/**
 * A3 (DEC-060): the ONE place a server-side request resolves its API bearer.
 * Clerk mode → the short-lived Clerk session JWT (verified api-side against
 * the instance JWKS); dev mode → the `cf_session` dev token exactly as before.
 * Dynamic import keeps @clerk/nextjs entirely out of the module graph when
 * Clerk is not configured (CI/e2e run with zero Clerk env).
 */
export async function bearerToken(): Promise<string | null> {
  if (clerkEnabled) {
    const { auth } = await import("@clerk/nextjs/server");
    const session = await auth();
    return (await session.getToken()) ?? null;
  }
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
