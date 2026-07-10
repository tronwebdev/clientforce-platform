/**
 * DEC-060b: the dual verifier. With OIDC and the dev secret both configured,
 * tokens dispatch on the protected-header alg — HS256 rides the dev rail,
 * everything else goes to JWKS — and each branch verifies against its own key
 * material only (no downgrade). No DB needed.
 */
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { AlgDispatchVerifier } from "../src/auth/auth.providers";
import { DevTokenVerifier, signDevToken } from "../src/auth/dev-token-verifier";
import type { AuthClaims, TokenVerifier } from "../src/auth/token-verifier";

const SECRET = "test-dev-secret";

function stubOidc(): { verifier: TokenVerifier; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    verifier: {
      verify(token: string): Promise<AuthClaims> {
        calls.push(token);
        return Promise.resolve({ sub: "oidc-user", email: "oidc@example.test" });
      },
    },
  };
}

describe("AlgDispatchVerifier (DEC-060b dual verifier)", () => {
  it("verifies an HS256 dev token on the dev rail", async () => {
    const oidc = stubOidc();
    const verifier = new AlgDispatchVerifier(oidc.verifier, new DevTokenVerifier(SECRET));
    const token = await signDevToken(SECRET, { sub: "dev-user", email: "dev@example.test" });
    const claims = await verifier.verify(token);
    expect(claims.sub).toBe("dev-user");
    expect(oidc.calls).toHaveLength(0);
  });

  it("routes a non-HS256 token to the OIDC verifier", async () => {
    const oidc = stubOidc();
    const verifier = new AlgDispatchVerifier(oidc.verifier, new DevTokenVerifier(SECRET));
    // Unsigned-shape RS256 header is enough — the stub asserts routing only.
    const rsToken = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.e30.sig`;
    const claims = await verifier.verify(rsToken);
    expect(claims.sub).toBe("oidc-user");
    expect(oidc.calls).toEqual([rsToken]);
  });

  it("rejects an HS256 token signed with the wrong secret (no downgrade)", async () => {
    const oidc = stubOidc();
    const verifier = new AlgDispatchVerifier(oidc.verifier, new DevTokenVerifier(SECRET));
    const forged = await new SignJWT({ email: "attacker@example.test" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("attacker")
      .setIssuer("clientforce-dev")
      .setAudience("clientforce")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("not-the-secret"));
    await expect(verifier.verify(forged)).rejects.toThrow();
    expect(oidc.calls).toHaveLength(0);
  });

  it("rejects a malformed token without consulting either verifier", async () => {
    const oidc = stubOidc();
    const verifier = new AlgDispatchVerifier(oidc.verifier, new DevTokenVerifier(SECRET));
    await expect(verifier.verify("not-a-jwt")).rejects.toThrow("Malformed token header");
    expect(oidc.calls).toHaveLength(0);
  });
});
