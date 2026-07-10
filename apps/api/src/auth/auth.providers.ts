import { Logger, type Provider } from "@nestjs/common";
import { DevTokenVerifier } from "./dev-token-verifier";
import { OidcTokenVerifier } from "./oidc-token-verifier";
import { TOKEN_VERIFIER, type AuthClaims, type TokenVerifier } from "./token-verifier";

/** Verifier used when neither OIDC nor a dev secret is configured. */
class UnconfiguredVerifier implements TokenVerifier {
  verify(_token: string): Promise<AuthClaims> {
    return Promise.reject(
      new Error(
        "Auth is not configured. Set AUTH_JWKS_URL (+ AUTH_ISSUER/AUTH_AUDIENCE) for OIDC, or AUTH_DEV_SECRET for dev/test.",
      ),
    );
  }
}

/**
 * DEC-060b: the dual verifier DEC-060 promised. With both OIDC and the dev
 * secret configured, dispatch on the token's protected-header `alg`: HS256 →
 * dev verifier, anything else → JWKS. Each branch still fully verifies
 * signature/issuer/audience against ITS OWN key material, so this cannot be
 * downgraded — an HS256 token is only accepted if signed with AUTH_DEV_SECRET.
 */
export class AlgDispatchVerifier implements TokenVerifier {
  constructor(
    private readonly oidc: TokenVerifier,
    private readonly dev: TokenVerifier,
  ) {}

  verify(token: string): Promise<AuthClaims> {
    let alg: unknown;
    try {
      const header = JSON.parse(
        Buffer.from(token.split(".")[0] ?? "", "base64url").toString(),
      ) as { alg?: unknown };
      alg = header.alg;
    } catch {
      return Promise.reject(new Error("Malformed token header"));
    }
    return alg === "HS256" ? this.dev.verify(token) : this.oidc.verify(token);
  }
}

/**
 * Select the verifier from env: OIDC/JWKS for real principals, the HS256 dev
 * verifier for local/CI — with BOTH configured they run side by side (staging
 * keeps the smoke/e2e dev rail through the Clerk flip, A3) — else fail closed.
 */
export const tokenVerifierProvider: Provider = {
  provide: TOKEN_VERIFIER,
  useFactory: (): TokenVerifier => {
    const logger = new Logger("Auth");
    const oidc = process.env.AUTH_JWKS_URL
      ? new OidcTokenVerifier({
          jwksUrl: process.env.AUTH_JWKS_URL,
          ...(process.env.AUTH_ISSUER ? { issuer: process.env.AUTH_ISSUER } : {}),
          ...(process.env.AUTH_AUDIENCE ? { audience: process.env.AUTH_AUDIENCE } : {}),
        })
      : null;
    const dev = process.env.AUTH_DEV_SECRET
      ? new DevTokenVerifier(process.env.AUTH_DEV_SECRET)
      : null;
    if (oidc && dev) {
      logger.log("Using OIDC token verifier (JWKS) + HS256 dev-rail verifier.");
      return new AlgDispatchVerifier(oidc, dev);
    }
    if (oidc) {
      logger.log("Using OIDC token verifier (JWKS).");
      return oidc;
    }
    if (dev) {
      logger.warn("Using DEV token verifier (HS256). Do not use in production.");
      return dev;
    }
    logger.error("Auth not configured — protected routes will reject all tokens.");
    return new UnconfiguredVerifier();
  },
};
