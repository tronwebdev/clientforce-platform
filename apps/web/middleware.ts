import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "cf_session";

/** Public paths that don't require a session. */
function isPublic(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/design" ||
    pathname.startsWith("/api/auth/")
  );
}

/**
 * Auth route guard: unauthenticated requests to protected routes are redirected
 * to /login (with a `next` param); an authenticated user hitting /login is sent
 * to the shell. Role checks happen server-side in the shell using /me.
 */
export function middleware(req: NextRequest): NextResponse {
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)).*)"],
};
