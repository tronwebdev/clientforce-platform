import { jwtVerify, SignJWT } from "jose";
import type { AuthClaims, TokenVerifier } from "./token-verifier";

export const DEV_ISSUER = "clientforce-dev";
export const DEV_AUDIENCE = "clientforce";

/**
 * Dev/test verifier — symmetric HS256 with a shared secret. Lets CI and local
 * runs mint and verify tokens without any external provider. NOT for production.
 */
export class DevTokenVerifier implements TokenVerifier {
  private readonly secret: Uint8Array;

  constructor(secret: string) {
    this.secret = new TextEncoder().encode(secret);
  }

  async verify(token: string): Promise<AuthClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: DEV_ISSUER,
      audience: DEV_AUDIENCE,
    });
    return {
      sub: payload.sub ?? "",
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  }
}

/** Mint a dev token (used by tests and local tooling). */
export async function signDevToken(
  secret: string,
  claims: AuthClaims,
  expiresIn = "1h",
): Promise<string> {
  return new SignJWT({
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.name ? { name: claims.name } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(DEV_ISSUER)
    .setAudience(DEV_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}
