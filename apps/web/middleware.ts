import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const SESSION_COOKIE = "cf_session";
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

/** Dispatches per mode; named export keeps the legacy guard unit-testable. */
export function middleware(req: NextRequest, event: NextFetchEvent) {
  return clerkEnabled ? clerkGuard(req, event) : legacyMiddleware(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)).*)"],
};
