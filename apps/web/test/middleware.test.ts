import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../middleware";

function reqFor(path: string, session?: string): NextRequest {
  const req = new NextRequest(new URL(`http://localhost${path}`));
  if (session) req.cookies.set("cf_session", session);
  return req;
}

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
