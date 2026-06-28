import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { AUTH_DEV_SECRET, DEV_AUDIENCE, DEV_ISSUER } from "../lib/config";
import { signDevToken } from "../lib/dev-token";

describe("dev sign-in token", () => {
  it("mints a token the API's dev verifier can validate", async () => {
    const token = await signDevToken("owner@demo-agency.test");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(AUTH_DEV_SECRET), {
      issuer: DEV_ISSUER,
      audience: DEV_AUDIENCE,
    });
    expect(payload.email).toBe("owner@demo-agency.test");
    expect(payload.sub).toBe("dev|owner@demo-agency.test");
  });
});
