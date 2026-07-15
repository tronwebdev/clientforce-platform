import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const SESSION_COOKIE = "cf_session";
// B1 W1 (DEC-079): the platform backoffice is a SEPARATE rail on its own cookie.
const STAFF_SESSION_COOKIE = "cf_staff_session";
// A3 (DEC-060): dual-mode — Clerk only when the publishable key is configured;
// otherwise the legacy cookie guard runs byte-identically (CI/e2e: zero Clerk env).
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/** Public paths that don't require a session. */
function isPublic(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/design" ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/api/auth/")
  );
}

/**
 * Legacy (dev-token) guard: unauthenticated requests to protected routes are
 * redirected to /login (with a `next` param); an authenticated user hitting
 * /login is sent to the shell. Role checks happen server-side using /me.
 */
function legacyMiddleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const session = req.cookies.get(SESSION_COOKIE)?.value;

  if (!session && !isPublic(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (session && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/login",
  "/design",
  "/api/auth(.*)",
]);

/** Clerk guard: same policy, Clerk session instead of the dev cookie. */
const clerkGuard = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

/**
 * DEC-060b: in Clerk mode the dev rail must still work — smoke and the staging
 * e2e suite authenticate with `cf_session`, and the api keeps its dual
 * verifier (A3). A dev session is honored only while NO Clerk browser session
 * exists (`__client_uat*` all absent/zero), so a stale dev cookie can never
 * shadow a real Clerk sign-in into a redirect loop.
 */
export function devRail(req: NextRequest): boolean {
  if (!req.cookies.get(SESSION_COOKIE)?.value) return false;
  return !req.cookies
    .getAll()
    .some((c) => c.name.startsWith("__client_uat") && c.value !== "" && c.value !== "0");
}

/** Is this a backoffice path (its own auth rail)? */
function isBackofficePath(pathname: string): boolean {
  return (
    pathname.startsWith("/backoffice") ||
    pathname.startsWith("/api/bo") ||
    pathname.startsWith("/api/staff-auth")
  );
}

function isStaffPublic(pathname: string): boolean {
  return pathname === "/backoffice/login" || pathname.startsWith("/api/staff-auth/");
}

/**
 * Backoffice guard (B1 W1, DEC-079): gates `/backoffice/*` pages on the staff
 * cookie — a TENANT `cf_session` grants nothing here. The `/api/bo` proxy and
 * `/api/staff-auth` routes handle their own auth (401/redirect), so XHR/API
 * paths pass through rather than being redirected.
 */
export function backofficeMiddleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.next();
  const session = req.cookies.get(STAFF_SESSION_COOKIE)?.value;
  if (!session && !isStaffPublic(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/backoffice/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (session && pathname === "/backoffice/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/backoffice/tenants";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

/** Dispatches per mode; named export keeps the legacy guard unit-testable. */
export function middleware(req: NextRequest, event: NextFetchEvent) {
  if (isBackofficePath(req.nextUrl.pathname)) return backofficeMiddleware(req);
  if (!clerkEnabled || devRail(req)) return legacyMiddleware(req);
  return clerkGuard(req, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)).*)"],
};
