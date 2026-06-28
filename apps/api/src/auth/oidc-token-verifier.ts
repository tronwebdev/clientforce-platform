import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthClaims, TokenVerifier } from "./token-verifier";

export interface OidcVerifierOptions {
  jwksUrl: string;
  issuer?: string;
  audience?: string;
}

/**
 * Production verifier — validates RS256 JWTs against a remote JWKS. Works for any
 * OIDC provider (Auth0, Azure AD B2C, Clerk) by pointing `jwksUrl`/`issuer`/
 * `audience` at the chosen tenant; no vendor SDK required.
 */
export class OidcTokenVerifier implements TokenVerifier {
  private readonly jwks: JWTVerifyGetKey;

  constructor(private readonly opts: OidcVerifierOptions) {
    this.jwks = createRemoteJWKSet(new URL(opts.jwksUrl));
  }

  async verify(token: string): Promise<AuthClaims> {
    const { payload } = await jwtVerify(token, this.jwks, {
      ...(this.opts.issuer ? { issuer: this.opts.issuer } : {}),
      ...(this.opts.audience ? { audience: this.opts.audience } : {}),
    });
    return {
      sub: payload.sub ?? "",
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      orgId: typeof payload.org_id === "string" ? payload.org_id : undefined,
      orgSlug: typeof payload.org_slug === "string" ? payload.org_slug : undefined,
      orgRole: typeof payload.org_role === "string" ? payload.org_role : undefined,
    };
  }
}
