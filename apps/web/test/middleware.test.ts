import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { devRail, middleware } from "../middleware";

function reqFor(path: string, session?: string): NextRequest {
  const req = new NextRequest(new URL(`http://localhost${path}`));
  if (session) req.cookies.set("cf_session", session);
  return req;
}

function reqWithCookies(cookies: Record<string, string>): NextRequest {
  const req = new NextRequest(new URL("http://localhost/contacts"));
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

describe("devRail — DEC-060b Clerk-mode dispatch", () => {
  it("is off without a dev session", () => {
    expect(devRail(reqWithCookies({}))).toBe(false);
    expect(devRail(reqWithCookies({ __client_uat: "1751900000" }))).toBe(false);
  });

  it("is on with a dev session and no Clerk browser session", () => {
    expect(devRail(reqWithCookies({ cf_session: "tok" }))).toBe(true);
  });

  it("treats a signed-out Clerk marker (__client_uat=0) as no Clerk session", () => {
    expect(devRail(reqWithCookies({ cf_session: "tok", __client_uat: "0" }))).toBe(true);
  });

  it("yields to an active Clerk session, including suffixed uat cookies", () => {
    expect(devRail(reqWithCookies({ cf_session: "tok", __client_uat: "1751900000" }))).toBe(false);
    expect(devRail(reqWithCookies({ cf_session: "tok", __client_uat_a1b2: "1751900000" }))).toBe(
      false,
    );
  });
});

describe("auth route guard middleware", () => {
  it("redirects an unauthenticated request to /login with a next param", () => {
    const res = middleware(reqFor("/contacts"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location") as string);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/contacts");
  });

  it("allows public paths without a session", () => {
    expect(middleware(reqFor("/login")).headers.get("location")).toBeNull();
    expect(middleware(reqFor("/api/auth/dev-login")).headers.get("location")).toBeNull();
  });

  it("lets an authenticated request through", () => {
    const res = middleware(reqFor("/contacts", "tok"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends an authenticated user away from /login", () => {
    const res = middleware(reqFor("/login", "tok"));
    const loc = new URL(res.headers.get("location") as string);
    expect(loc.pathname).toBe("/");
  });
});
